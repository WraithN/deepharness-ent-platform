package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
	"github.com/gorilla/websocket"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)


type SSEEvent struct {
	Type       string          `json:"type"`
	Properties json.RawMessage `json:"properties"`
}

type GatewaydClient struct {
	adminURL   string
	agentID    string
	httpClient *http.Client

	mu          sync.RWMutex
	subscribers map[string][]chan SSEEvent

	conn   *websocket.Conn
	connMu sync.Mutex
	done   chan struct{}
	once   sync.Once

	resolvedID  string // actual gatewayd instance ID (resolved from plugin_key)
	resolveMu   sync.RWMutex
	resolveOnce sync.Once

	// running 用于控制后台 WebSocket 连接的懒启动。
	running bool
	runMu   sync.Mutex
}

func NewGatewaydClient(adminURL string, agentID string) *GatewaydClient {
	c := &GatewaydClient{
		adminURL:    adminURL,
		agentID:     agentID,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
		subscribers: make(map[string][]chan SSEEvent),
		done:        make(chan struct{}),
	}
	// 旧版 WebSocket 连接改为懒启动：只有在真正发送消息时才连接，
	// 避免 AG-UI 迁移后仍然持续重试旧 gatewayd 事件通道。
	return c
}

func (c *GatewaydClient) ensureRunning() {
	c.runMu.Lock()
	defer c.runMu.Unlock()

	if c.running {
		return
	}
	c.running = true
	safego.Go("gatewayd-client-run", c.run)
}

func (c *GatewaydClient) run() {
	// 连接成功后重置失败计数；连续失败时使用 capped backoff，
	// 但永不永久放弃，避免 gatewayd 短暂不可达后事件通道永久中断。
	backoff := time.Second
	maxBackoff := 30 * time.Second
	failures := 0
	const maxConsecutiveFailures = 5

	for {
		select {
		case <-c.done:
			return
		default:
		}

		connected := c.connect()
		if connected {
			failures = 0
			backoff = time.Second
		} else {
			failures++
			if failures >= maxConsecutiveFailures {
				log.Printf("[GatewaydClient] reached %d consecutive failures, continuing capped backoff reconnect", maxConsecutiveFailures)
			}
		}

		select {
		case <-c.done:
			return
		case <-time.After(backoff):
		}

		if !connected && backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
}

// Close 优雅关闭 GatewaydClient：停止后台 WebSocket 重连 goroutine 并关闭当前连接。
// 该方法幂等，可安全多次调用；通过 sync.Once 防止重复 close channel 导致 panic。
//
// 关闭顺序说明：
//  1. 先 close(c.done)：通知 run() goroutine 退出重连循环；
//  2. 再置 running=false：避免 Close 之后 ensureRunning 误判为已在运行；
//  3. 最后关闭 WebSocket 连接：打断 connect() 中阻塞的 ReadMessage，使其尽快返回，
//     随后 run() 循环回到顶部 select 检测到 c.done 已关闭而退出。
//
// 注意：c.done 只会被 close 一次。即使 Close 之后再次调用 ensureRunning 启动新 goroutine，
// 新 goroutine 首个 select 也会立即检测到 c.done 已关闭而返回，不会造成新的泄漏。
func (c *GatewaydClient) Close() {
	c.once.Do(func() {
		close(c.done)
		c.runMu.Lock()
		c.running = false
		c.runMu.Unlock()
		c.connMu.Lock()
		if c.conn != nil {
			c.conn.Close()
			c.conn = nil
		}
		c.connMu.Unlock()
	})
}

// connect 尝试建立 WebSocket 连接并读取消息。
// 返回 true 表示已成功建立连接并在读取循环结束后退出（正常断线），
// 返回 false 表示初始拨号失败。
func (c *GatewaydClient) connect() bool {
	wsURL := c.WsURL()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Printf("[GatewaydClient] ws connect failed: %v, retrying...", err)
		return false
	}
	c.connMu.Lock()
	c.conn = conn
	c.connMu.Unlock()
	log.Printf("[GatewaydClient] connected to %s", wsURL)

	defer func() {
		conn.Close()
		c.connMu.Lock()
		c.conn = nil
		c.connMu.Unlock()
	}()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[GatewaydClient] ws read error: %v", err)
			return true
		}
		c.handleWSMessage(msg)
	}
}

type agentEvent struct {
	EventType  string          `json:"event_type"`
	InstanceID *string         `json:"instance_id"`
	Payload    json.RawMessage `json:"payload"`
}

type agentPayload struct {
	ConversationID string `json:"conversation_id"`
	Text           string `json:"text"`
	Content        string `json:"content"`
	Message        string `json:"message"`
	SessionID      string `json:"sessionID"`
}

func (c *GatewaydClient) handleWSMessage(msg []byte) {
	var ev agentEvent
	if err := json.Unmarshal(msg, &ev); err != nil {
		log.Printf("[GatewaydClient] failed to unmarshal event: %v", err)
		return
	}

	var payload agentPayload
	json.Unmarshal(ev.Payload, &payload)

	convID := payload.ConversationID
	if convID == "" {
		convID = payload.SessionID
	}
	if convID == "" {
		return
	}

	c.mu.RLock()
	subs, ok := c.subscribers[convID]
	c.mu.RUnlock()
	if !ok || len(subs) == 0 {
		return
	}

	sseEvent := c.transformEvent(ev.EventType, ev.Payload)

	if sseEvent != nil {
		for _, ch := range subs {
			select {
			case ch <- *sseEvent:
			default:
			}
		}
	}

	if ev.EventType == "agent.done" || ev.EventType == "agent.error" {
		c.mu.Lock()
		delete(c.subscribers, convID)
		c.mu.Unlock()
		for _, ch := range subs {
			close(ch)
		}
	}
}

func (c *GatewaydClient) transformEvent(eventType string, rawPayload json.RawMessage) *SSEEvent {
	switch eventType {
	case "agent.token":
		var p struct {
			Text string `json:"text"`
		}
		json.Unmarshal(rawPayload, &p)

		props, _ := json.Marshal(map[string]any{
			"part": map[string]any{
				"id":      uuid.New().String(),
				"type":    "text",
				"content": p.Text,
				"delta":   p.Text,
			},
		})
		return &SSEEvent{Type: "message.part.updated", Properties: props}

	case "agent.thinking":
		var p struct {
			Content  string `json:"content"`
			Type     string `json:"type"`
			ToolName string `json:"toolName"`
			Failed   bool   `json:"failed"`
		}
		json.Unmarshal(rawPayload, &p)

		partType := "reasoning"
		if p.Type == "tool_use" {
			partType = "tool_use"
		} else if p.Type == "tool_result" {
			partType = "tool_result"
		}

		props, _ := json.Marshal(map[string]any{
			"part": map[string]any{
				"id":      uuid.New().String(),
				"type":    partType,
				"content": p.Content,
				"name":    p.ToolName,
			},
		})
		return &SSEEvent{Type: "message.part.updated", Properties: props}

	case "agent.error":
		var p struct {
			Message string `json:"message"`
		}
		json.Unmarshal(rawPayload, &p)

		props, _ := json.Marshal(map[string]any{
			"error": map[string]any{
				"message": p.Message,
				"code":    0,
			},
		})
		return &SSEEvent{Type: "session.error", Properties: props}

	case "agent.done":
		return nil
	default:
		return nil
	}
}

// WsURL 返回旧版全局 WebSocket 事件地址（/agents/events）。
//
// Deprecated: gatewayd 已废弃 /agents/events 接口，请使用 WsURLForSession
// 获取 AG-UI 协议的按会话 WebSocket 地址 WS /sessions/{sessionId}/events。
// 该方法仅供旧版 GatewaydClient 内部 connect() 使用。
func (c *GatewaydClient) WsURL() string {
	u, err := url.Parse(c.adminURL)
	if err != nil {
		return ""
	}
	scheme := "ws"
	if u.Scheme == "https" {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s/agents/events", scheme, u.Host)
}

// WsURLForSession 返回 AG-UI 协议按会话的 WebSocket 事件地址。
// 对应 gatewayd 文档中的 WS /sessions/{sessionId}/events。
func (c *GatewaydClient) WsURLForSession(sessionID string) string {
	u, err := url.Parse(c.adminURL)
	if err != nil {
		return ""
	}
	scheme := "ws"
	if u.Scheme == "https" {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s/sessions/%s/events", scheme, u.Host, sessionID)
}

// CreateThread 在 gatewayd 上创建新 thread，返回 gatewayd 的 threadId。
// preferredID 可选，若不为空则作为 session 的 ID 发送给 gatewayd，使其复用相同 session。
func (c *GatewaydClient) CreateThread(ctx context.Context, preferredID string) (string, error) {
	var bodyReader io.Reader
	if preferredID != "" {
		reqBody := map[string]string{"id": preferredID}
		data, _ := json.Marshal(reqBody)
		bodyReader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.adminURL+"/sessions", bodyReader)
	if err != nil {
		return "", fmt.Errorf("create thread request: %w", err)
	}
	if preferredID != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("create thread: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("create thread status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode thread response: %w", err)
	}
	if result.SessionID == "" {
		return "", fmt.Errorf("gatewayd returned empty sessionId")
	}
	return result.SessionID, nil
}

// SetContext 向 gatewayd 注入当前运行上下文，包括智能体类型、会话 ID、工作目录和模型。
// 对应 desktop gatewayd 的 POST /context 接口。
func (c *GatewaydClient) SetContext(ctx context.Context, agentType, sessionID, workspace, model string) error {
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	body, _ := json.Marshal(map[string]any{
		"agent_type":     agentType,
		"session_id":     sessionID,
		"work_directory": workspace,
		"model":          model,
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.adminURL+"/context", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create context request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("set context: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("set context status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// AdminURL returns the gatewayd HTTP admin URL.
func (c *GatewaydClient) AdminURL() string {
	return c.adminURL
}

// AgentID returns the configured agent plugin key.
func (c *GatewaydClient) AgentID() string {
	return c.agentID
}

// UpdateAgentConfigRequest 是更新 gatewayd agent 模型配置的请求体。
type UpdateAgentConfigRequest struct {
	Model               string   `json:"model,omitempty"`
	ModelType           string   `json:"model_type,omitempty"`
	BaseURL             string   `json:"base_url,omitempty"`
	APIKey              string   `json:"api_key,omitempty"`
	Temperature         *float64 `json:"temperature,omitempty"`
	MaxTokens           *int     `json:"max_tokens,omitempty"`
	WatchdogTimeoutSecs *uint64  `json:"watchdog_timeout_secs,omitempty"`
}

// UpdateAgentConfig 向 gatewayd 推送指定 session/agent 的模型配置。
func (c *GatewaydClient) UpdateAgentConfig(ctx context.Context, sessionID, instanceID string, req UpdateAgentConfigRequest) error {
	if sessionID == "" || instanceID == "" {
		return fmt.Errorf("session id and instance id are required")
	}
	body, _ := json.Marshal(req)
	url := fmt.Sprintf("%s/sessions/%s/agents/%s/config", c.adminURL, sessionID, instanceID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create update config request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("update agent config: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update agent config status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// AttachAgent 向 gatewayd 指定 thread 挂载指定插件的 agent 实例，
// 返回 gatewayd 生成的 instance_id，用于前端展示智能体唯一标识。
func (c *GatewaydClient) AttachAgent(ctx context.Context, threadID, pluginKey, workspace string) (string, error) {
	if threadID == "" {
		return "", fmt.Errorf("thread id is required")
	}
	if pluginKey == "" {
		pluginKey = c.agentID
	}

	body, _ := json.Marshal(map[string]any{
		"agent_key":      pluginKey,
		"name":           pluginKey + "-" + uuid.New().String()[:8],
		"work_directory": workspace,
		"force":          true,
	})

	postURL := fmt.Sprintf("%s/sessions/%s/agents", c.adminURL, threadID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, postURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create attach request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("attach agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("attach agent status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		InstanceID string `json:"instance_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode attach response: %w", err)
	}
	return result.InstanceID, nil
}

// ResolveAgentID queries the gatewayd /agents API to find the actual instance ID
// matching the configured plugin_key (c.agentID, e.g. "opencode").
// Cached after first successful resolution.
//
// Deprecated: gatewayd 已废弃 GET /agents 接口。AG-UI 协议下 agent 实例通过
// POST /sessions/{sessionId}/agents 挂载并直接返回 instance_id，无需再查询 /agents。
// 该方法仅被旧版 SendMessage 路径使用，新代码应通过 AGUIClient.Run 发送消息。
func (c *GatewaydClient) ResolveAgentID(ctx context.Context) (string, error) {
	c.resolveMu.RLock()
	if c.resolvedID != "" {
		c.resolveMu.RUnlock()
		return c.resolvedID, nil
	}
	c.resolveMu.RUnlock()

	var agentID string
	c.resolveOnce.Do(func() {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.adminURL+"/agents", nil)
		resp, err := c.httpClient.Do(req)
		if err != nil {
			agentID = c.agentID // fallback
			return
		}
		defer resp.Body.Close()

		var agents []struct {
			ID        string `json:"id"`
			PluginKey string `json:"plugin_key"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&agents); err != nil {
			agentID = c.agentID
			return
		}
		for _, a := range agents {
			if a.PluginKey == c.agentID {
				agentID = a.ID
				break
			}
		}
		if agentID == "" {
			agentID = c.agentID
		}

		c.resolveMu.Lock()
		c.resolvedID = agentID
		c.resolveMu.Unlock()
	})
	return agentID, nil
}

// SendMessage 通过旧版 POST /agents/{id}/message 接口发送消息，并监听
// 旧版 WS /agents/events 事件流。
//
// Deprecated: gatewayd 已废弃 /agents/{id}/message 与 /agents/events 接口。
// 新代码应使用 AGUIClient.Run，通过 POST /sessions/{sessionId}/chat 获取 SSE 事件流。
func (c *GatewaydClient) SendMessage(ctx context.Context, session chat.Session, msg chat.Message) (<-chan SSEEvent, error) {
	// 只有在旧版会话路径真正发送消息时，才启动 WebSocket 监听。
	c.ensureRunning()

	convID := session.ID

	agentID, err := c.ResolveAgentID(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve agent: %w", err)
	}

	body, _ := json.Marshal(map[string]string{
		"conversation_id": convID,
		"message":         msg.Content,
	})

	postURL := fmt.Sprintf("%s/agents/%s/message", c.adminURL, agentID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, postURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("post message: %w", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gatewayd returned status %d", resp.StatusCode)
	}

	ch := make(chan SSEEvent, 100)
	c.mu.Lock()
	c.subscribers[convID] = append(c.subscribers[convID], ch)
	c.mu.Unlock()

	msgID := uuid.New().String()
	msgProps, _ := json.Marshal(map[string]any{
		"info": map[string]any{
			"id": msgID,
		},
	})
	ch <- SSEEvent{Type: "message.updated", Properties: msgProps}

	return ch, nil
}
