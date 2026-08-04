package handler

import (
	"context"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/wsutil"
	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: wsutil.SameHostnameCheckOrigin(),
}

const (
	proxyChatPath = "/api/v1/sessions"
	proxyWsPath   = "/api/v1/sessions"
)

// BuildProxyWsURLForSession 为 CreateSessionResponse 构建代理 WebSocket URL。
// scheme 和 host 直接从创建会话的 HTTP 请求中获取，确保前端使用相同域名。
func BuildProxyWsURLForSession(scheme, host, sessionID string) string {
	wsScheme := "ws"
	if scheme == "https" {
		wsScheme = "wss"
	}
	return wsScheme + "://" + host + proxyWsPath + "/" + sessionID + "/ws"
}

type GatewaydProxy struct {
	sessions            chat.SessionStore
	agentRuntimeService service.AgentRuntimeService
	defaultGatewaydURL  string
}

func NewGatewaydProxy(
	sessions chat.SessionStore,
	agentRuntimeService service.AgentRuntimeService,
	defaultGatewaydURL string,
) *GatewaydProxy {
	return &GatewaydProxy{
		sessions:            sessions,
		agentRuntimeService: agentRuntimeService,
		defaultGatewaydURL:  defaultGatewaydURL,
	}
}

func (p *GatewaydProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isWebSocketUpgrade(r) {
		p.serveWS(w, r)
		return
	}
	p.serveChat(w, r)
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Connection"), "upgrade") &&
		strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func (p *GatewaydProxy) serveChat(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if sessionID == "" {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, "missing session id")
		return
	}

	sess, err := p.sessions.Get(r.Context(), sessionID)
	if err != nil {
		WriteJSONError(w, http.StatusNotFound, ErrCodeGeneral, "session not found")
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if ok && sess.UserID != "" && sess.UserID != userID {
		WriteJSONError(w, http.StatusForbidden, ErrCodeGeneral, "not allowed to access this session")
		return
	}

	targetURL, err := p.resolveGatewaydURL(r.Context(), sessionID)
	if err != nil {
		log.Printf("[GatewaydProxy] resolve gatewayd url failed: %v", err)
		WriteJSONError(w, http.StatusServiceUnavailable, ErrCodeGeneral, "agent runtime unavailable")
		return
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL+"/sessions/"+sessionID+"/chat", r.Body)
	if err != nil {
		log.Printf("[GatewaydProxy] create proxy request failed: %v", err)
		WriteJSONError(w, http.StatusInternalServerError, ErrCodeGeneral, "proxy request failed")
		return
	}
	copyHeaders(proxyReq.Header, r.Header)

	resp, err := http.DefaultClient.Do(proxyReq)
	if err != nil {
		log.Printf("[GatewaydProxy] proxy request to gatewayd failed: %v", err)
		WriteJSONError(w, http.StatusBadGateway, ErrCodeGeneral, "gateway unreachable")
		return
	}
	defer resp.Body.Close()

	copyHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("[GatewaydProxy] copy response body failed: %v", err)
	}
}

func (p *GatewaydProxy) serveWS(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if sessionID == "" {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, "missing session id")
		return
	}

	sess, err := p.sessions.Get(r.Context(), sessionID)
	if err != nil {
		WriteJSONError(w, http.StatusNotFound, ErrCodeGeneral, "session not found")
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if ok && sess.UserID != "" && sess.UserID != userID {
		WriteJSONError(w, http.StatusForbidden, ErrCodeGeneral, "not allowed to access this session")
		return
	}

	targetURL, err := p.resolveGatewaydURL(r.Context(), sessionID)
	if err != nil {
		log.Printf("[GatewaydProxy] resolve gatewayd url for WS failed: %v", err)
		WriteJSONError(w, http.StatusServiceUnavailable, ErrCodeGeneral, "agent runtime unavailable")
		return
	}

	clientConn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[GatewaydProxy] ws upgrade failed: %v", err)
		return
	}
	defer clientConn.Close()
	// 为客户端连接启用心跳，防止半开连接导致读操作永久阻塞。
	clientHB := wsutil.NewHeartbeat(clientConn, "proxy-client")
	defer clientHB.Stop()

	gatewaydWsURL := buildWsURL(targetURL, "/sessions/"+sessionID+"/events")
	gatewaydConn, _, err := websocket.DefaultDialer.Dial(gatewaydWsURL, nil)
	if err != nil {
		log.Printf("[GatewaydProxy] ws dial gatewayd failed: %v", err)
		return
	}
	defer gatewaydConn.Close()
	// 同样为 gatewayd 连接启用心跳，双向检测半开连接。
	gatewaydHB := wsutil.NewHeartbeat(gatewaydConn, "proxy-gatewayd")
	defer gatewaydHB.Stop()

	done := make(chan struct{})

	safego.Go("ws-proxy-client-to-gatewayd", func() {
		defer close(done)
		defer clientConn.Close()
		for {
			msgType, msg, err := clientConn.ReadMessage()
			if err != nil {
				log.Printf("[GatewaydProxy] client ws read error: %v", err)
				return
			}
			if err := gatewaydConn.WriteMessage(msgType, msg); err != nil {
				log.Printf("[GatewaydProxy] gatewayd ws write error: %v", err)
				return
			}
		}
	})

	safego.Go("ws-proxy-gatewayd-to-client", func() {
		defer gatewaydConn.Close()
		for {
			msgType, msg, err := gatewaydConn.ReadMessage()
			if err != nil {
				log.Printf("[GatewaydProxy] gatewayd ws read error: %v", err)
				return
			}
			if err := clientConn.WriteMessage(msgType, msg); err != nil {
				log.Printf("[GatewaydProxy] client ws write error: %v", err)
				return
			}
		}
	})

	<-done
}

func (p *GatewaydProxy) resolveGatewaydURL(ctx context.Context, sessionID string) (string, error) {
	sess, err := p.sessions.Get(ctx, sessionID)
	if err != nil {
		return "", err
	}

	userID := sess.UserID
	if userID == "" {
		return p.defaultGatewaydURL, nil
	}

	result, err := p.agentRuntimeService.List(object.ListRuntimesFilter{
		UserID:   userID,
		PageSize: 1,
	})
	if err != nil {
		log.Printf("[GatewaydProxy] list runtimes for user=%s failed: %v, fallback to default", userID, err)
		return p.defaultGatewaydURL, nil
	}
	if len(result.List) == 0 || result.List[0].GatewaydURL == "" {
		return p.defaultGatewaydURL, nil
	}

	gatewaydURL := strings.TrimRight(result.List[0].GatewaydURL, "/")
	return gatewaydURL, nil
}

func copyHeaders(dst, src http.Header) {
	for key, values := range src {
		for _, v := range values {
			dst.Add(key, v)
		}
	}
}

func buildWsURL(httpURL, path string) string {
	u, err := url.Parse(httpURL)
	if err != nil {
		return ""
	}
	scheme := "ws"
	if u.Scheme == "https" {
		scheme = "wss"
	}
	host := u.Host
	return scheme + "://" + host + path
}
