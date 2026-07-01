package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/google/uuid"
)

const (
	// defaultAGUIPluginKey 指定默认挂载的 agent 插件。
	defaultAGUIPluginKey = "claude-code"
	// defaultAGUIWorkspace 是 agent 运行的工作目录。
	defaultAGUIWorkspace = "/home/nan/deepharness-ent-platform"
	// defaultAGUIAdminURL 是 ent-desktop gatewayd 的 Admin 接口地址。
	defaultAGUIAdminURL = "http://127.0.0.1:2346"
)

// AGUIClient 通过 AG-UI 协议对接 ent-desktop gatewayd。
type AGUIClient struct {
	adminURL  string
	pluginKey string
	workspace string
	client    *http.Client
}

// NewAGUIClient 创建 AG-UI client。
func NewAGUIClient(adminURL, pluginKey, workspace string) *AGUIClient {
	if adminURL == "" {
		adminURL = defaultAGUIAdminURL
	}
	if pluginKey == "" {
		pluginKey = defaultAGUIPluginKey
	}
	if workspace == "" {
		workspace = defaultAGUIWorkspace
	}
	return &AGUIClient{
		adminURL:  adminURL,
		pluginKey: pluginKey,
		workspace: workspace,
		client: &http.Client{
			// AttachAgent 会阻塞到 agent ready，需要较长超时。
			Timeout: 5 * time.Minute,
		},
	}
}

// CreateThread 在 gatewayd 上创建新 session，返回 threadId。
func (c *AGUIClient) CreateThread(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.adminURL+"/sessions", nil)
	if err != nil {
		return "", fmt.Errorf("create session request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("create session status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode session response: %w", err)
	}
	if result.SessionID == "" {
		return "", fmt.Errorf("gatewayd returned empty sessionId")
	}
	return result.SessionID, nil
}

// AttachAgent 向指定 thread 挂载默认 agent 实例。
// gatewayd 会阻塞直到 agent 进程 ready，调用方需保证上下文有足够超时。
// force=true 时会强制创建新 instance；force=false 时若 session 已有 instance 则复用。
func (c *AGUIClient) AttachAgent(ctx context.Context, threadID string, force bool) error {
	return c.attachAgentWithKey(ctx, threadID, force, c.pluginKey)
}

// attachAgentWithKey 向指定 thread 挂载指定插件的 agent 实例。
func (c *AGUIClient) attachAgentWithKey(ctx context.Context, threadID string, force bool, pluginKey string) error {
	body, _ := json.Marshal(map[string]any{
		"plugin_key": pluginKey,
		"name":       pluginKey + "-" + uuid.New().String()[:8],
		"workspace":  c.workspace,
		"force":      force,
	})

	url := fmt.Sprintf("%s/sessions/%s/agents", c.adminURL, threadID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create attach request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("attach agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("attach agent status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// Run 向 gatewayd 发送 RunAgentInput 并返回 AG-UI 事件流。
// 如果 input.ThreadID 为空或 session 已失效，会先创建新 thread 并挂载 agent。
// 返回实际使用的 threadID、事件流和错误。
func (c *AGUIClient) Run(ctx context.Context, input agui.RunAgentInput) (string, <-chan agui.Event, error) {
	runStart := time.Now()
	if input.RunID == "" {
		input.RunID = uuid.New().String()
	}

	// 优先使用输入中指定的 agent 插件 key，否则尝试从 forwardedProps 读取，最后回退到 client 默认值。
	// agent_key 是 agentPluginKey 的别名，优先使用 agent_key。
	pluginKey := c.pluginKey
	if input.AgentKey != "" {
		pluginKey = input.AgentKey
	} else if input.AgentPluginKey != "" {
		pluginKey = input.AgentPluginKey
	} else if len(input.ForwardedProps) > 0 {
		var forwarded struct {
			AgentPluginKey string `json:"agentPluginKey"`
		}
		if err := json.Unmarshal(input.ForwardedProps, &forwarded); err == nil && forwarded.AgentPluginKey != "" {
			pluginKey = forwarded.AgentPluginKey
		}
	}

	if input.ThreadID == "" {
		createStart := time.Now()
		threadID, err := c.CreateThread(ctx)
		if err != nil {
			return "", nil, err
		}
		input.ThreadID = threadID
		log.Printf("[AGUIClient] run=%s CreateThread took %v, threadId=%s", input.RunID, time.Since(createStart), input.ThreadID)
	}

	// 挂载 agent；使用独立超时，避免整体 run 上下文被拉长。
	// 若 gatewayd 因重启等原因丢失 session，自动创建新 session 并重试。
	// 优先尝试 force=false 复用已有 instance，减少重复创建 Claude 进程带来的 ~0.9s 延迟。
	attachCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	attachStart := time.Now()
	if err := c.attachAgentWithKey(attachCtx, input.ThreadID, false, pluginKey); err != nil {
		if isInstanceAlreadyExists(err) {
			log.Printf("[AGUIClient] run=%s thread=%s reuse existing instance after %v", input.RunID, input.ThreadID, time.Since(attachStart))
		} else if isSessionNotFound(err) {
			log.Printf("[AGUIClient] run=%s session %s not found, creating new thread", input.RunID, input.ThreadID)
			newThreadID, createErr := c.CreateThread(ctx)
			if createErr != nil {
				return "", nil, fmt.Errorf("recreate thread after session lost: %w", createErr)
			}
			input.ThreadID = newThreadID
			if attachErr := c.attachAgentWithKey(attachCtx, input.ThreadID, true, pluginKey); attachErr != nil {
				return "", nil, fmt.Errorf("attach agent after recreate: %w", attachErr)
			}
			log.Printf("[AGUIClient] run=%s created new instance after recreate in %v", input.RunID, time.Since(attachStart))
		} else {
			// 其他错误时回退到 force=true，尝试新建 instance（例如旧 instance 已失效）。
			log.Printf("[AGUIClient] run=%s AttachAgent force=false failed (%v), retrying with force=true", input.RunID, err)
			if attachErr := c.attachAgentWithKey(attachCtx, input.ThreadID, true, pluginKey); attachErr != nil {
				return "", nil, fmt.Errorf("attach agent: %w", attachErr)
			}
			log.Printf("[AGUIClient] run=%s created new instance with force=true after %v", input.RunID, time.Since(attachStart))
		}
	} else {
		log.Printf("[AGUIClient] run=%s created new instance (force=false) after %v", input.RunID, time.Since(attachStart))
	}

	if input.State == nil {
		input.State = []byte("{}")
	}
	if input.ForwardedProps == nil {
		input.ForwardedProps = []byte("{}")
	}
	// gatewayd 要求数组字段不能为 null，否则反序列化失败。
	if input.Tools == nil {
		input.Tools = []agui.Tool{}
	}
	if input.Context == nil {
		input.Context = []agui.ContextItem{}
	}
	if input.Messages == nil {
		input.Messages = []agui.Message{}
	}

	// gatewayd 当前只接受字符串 content，将 AG-UI 数组 content 提取为文本。
	gatewaydMessages := make([]map[string]any, 0, len(input.Messages))
	for _, m := range input.Messages {
		gatewaydMessages = append(gatewaydMessages, m.ToGatewaydMessage())
	}

	body, err := json.Marshal(map[string]any{
		"threadId":       input.ThreadID,
		"runId":          input.RunID,
		"state":          input.State,
		"messages":       gatewaydMessages,
		"tools":          input.Tools,
		"context":        input.Context,
		"forwardedProps": input.ForwardedProps,
		"agent_key":      pluginKey,
	})
	if err != nil {
		return "", nil, fmt.Errorf("marshal run input: %w", err)
	}

	url := fmt.Sprintf("%s/sessions/%s/runs", c.adminURL, input.ThreadID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", nil, fmt.Errorf("create run request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	// Run 请求需要长连接，单独使用无超时 client。
	runClient := &http.Client{}
	postStart := time.Now()
	resp, err := runClient.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("run request: %w", err)
	}
	log.Printf("[AGUIClient] run=%s POST /sessions/%s/runs response status=%d after %v", input.RunID, input.ThreadID, resp.StatusCode, time.Since(postStart))

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return "", nil, fmt.Errorf("run status %d: %s", resp.StatusCode, string(respBody))
	}

	out := make(chan agui.Event, 64)
	go c.readSSE(resp.Body, out, input.ThreadID, input.RunID, runStart)
	log.Printf("[AGUIClient] run=%s returning event channel to handler after %v", input.RunID, time.Since(runStart))
	return input.ThreadID, out, nil
}

// isSessionNotFound 判断 attach 错误是否因为 gatewayd session 丢失。
func isSessionNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") && strings.Contains(msg, "session")
}

// isInstanceAlreadyExists 判断 attach 错误是否因为 session 已有 instance（可复用）。
func isInstanceAlreadyExists(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "already has") && strings.Contains(msg, "agent instance")
}

// readSSE 从 gatewayd SSE 响应中解析 AG-UI 事件。
func (c *AGUIClient) readSSE(body io.ReadCloser, out chan<- agui.Event, threadID, runID string, runStart time.Time) {
	defer body.Close()
	defer close(out)

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 4096), 1024*1024)

	firstEventSeen := false
	firstContentSeen := false
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}

		var ev agui.Event
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			log.Printf("[AGUIClient] run=%s failed to parse event: %v, data=%s", runID, err, data)
			continue
		}
		// 补全 threadId / runId，方便下游消费。
		if ev.ThreadID == "" {
			ev.ThreadID = threadID
		}
		if ev.RunID == "" {
			ev.RunID = runID
		}
		if !firstEventSeen {
			firstEventSeen = true
			log.Printf("[AGUIClient] run=%s first SSE event after %v: type=%s", runID, time.Since(runStart), ev.Type)
		}
		switch ev.Type {
		case agui.EventThinkingStart:
			log.Printf("[AGUIClient] run=%s THINKING_START after %v", runID, time.Since(runStart))
		case agui.EventTextMessageStart:
			log.Printf("[AGUIClient] run=%s TEXT_MESSAGE_START (TTFT) after %v", runID, time.Since(runStart))
		case agui.EventTextMessageContent:
			if !firstContentSeen {
				firstContentSeen = true
				log.Printf("[AGUIClient] run=%s first TEXT_MESSAGE_CONTENT after %v", runID, time.Since(runStart))
			}
		}
		select {
		case out <- ev:
		case <-time.After(time.Second):
			log.Printf("[AGUIClient] run=%s event channel blocked, dropping event %s", runID, ev.Type)
		}
	}

	if err := scanner.Err(); err != nil {
		log.Printf("[AGUIClient] run=%s sse scanner error: %v", runID, err)
	}
	log.Printf("[AGUIClient] run=%s SSE stream ended, total elapsed=%v", runID, time.Since(runStart))
}
