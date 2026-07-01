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
	if adminURL == "" {
		adminURL = "http://127.0.0.1:2346"
	}
	if agentID == "" {
		agentID = "opencode"
	}
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
	go c.run()
}

func (c *GatewaydClient) run() {
	// 首次失败后使用指数退避，最多重试 5 次，避免无限打印日志。
	backoff := time.Second
	maxBackoff := 30 * time.Second
	failures := 0
	const maxFailures = 5

	for {
		select {
		case <-c.done:
			return
		default:
		}

		c.connect()

		select {
		case <-c.done:
			return
		case <-time.After(backoff):
		}

		failures++
		if failures >= maxFailures {
			log.Printf("[GatewaydClient] reached max reconnection attempts (%d), stopping background reconnect", maxFailures)
			c.runMu.Lock()
			c.running = false
			c.runMu.Unlock()
			return
		}
		if backoff < maxBackoff {
			backoff *= 2
		}
	}
}

func (c *GatewaydClient) connect() {
	wsURL := c.WsURL()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Printf("[GatewaydClient] ws connect failed: %v, retrying...", err)
		return
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
			return
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

func (c *GatewaydClient) WsURL() string {
	u, err := url.Parse(c.adminURL)
	if err != nil {
		return "ws://127.0.0.1:2346/agents/events"
	}
	scheme := "ws"
	if u.Scheme == "https" {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s/agents/events", scheme, u.Host)
}

// AdminURL returns the gatewayd HTTP admin URL.
func (c *GatewaydClient) AdminURL() string {
	return c.adminURL
}

// AgentID returns the configured agent plugin key.
func (c *GatewaydClient) AgentID() string {
	return c.agentID
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
	if workspace == "" {
		workspace = defaultWorkspace
	}

	body, _ := json.Marshal(map[string]any{
		"plugin_key": pluginKey,
		"name":       pluginKey + "-" + uuid.New().String()[:8],
		"workspace":  workspace,
		"force":      false,
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
