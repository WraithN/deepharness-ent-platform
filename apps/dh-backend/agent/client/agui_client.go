package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	// SSE_IDLE_TIMEOUT gatewayd SSE 流无数据超时（agent 进程异常退出后 gatewayd 可能不关闭流）。
	// 必须足够长以覆盖合法的长时间静默（agent 冷启动、长思考），gatewayd 的 SSE
	// keepalive 会在静默期持续保活，因此该超时只应在 gatewayd 真正挂死时触发。
	SSE_IDLE_TIMEOUT = 30 * time.Minute
	// runRequestTimeout 是 POST /sessions/{id}/chat 的最大等待时间，
	// 覆盖整个 run 生命周期，避免 gatewayd 挂死导致后端无限等待。
	// 必须大于 AGUIHandler 的 maxRunDuration，让优雅超时路径先触发。
	runRequestTimeout = 35 * time.Minute
	// sseEventBufferSize 是 SSE 事件输出通道的缓冲大小，降低背压下的事件丢失概率。
	sseEventBufferSize = 1024
	// sseScannerMaxTokenSize 是单个 SSE 事件的最大字节数，工具结果可能较大。
	sseScannerMaxTokenSize = 8 * 1024 * 1024 // 8MB
)

// AGUIClient 通过 AG-UI 协议对接 ent-desktop gatewayd。
type AGUIClient struct {
	adminURL  string
	pluginKey string
	client    *http.Client
	// attachedThreads 记录已成功 attach 过 agent 实例的 threadId。
	// 后续消息跳过 attach 调用，避免 force=true 误杀运行中的 agent 进程。
	attachedThreads sync.Map
}

// NewAGUIClient 创建 AG-UI client。
func NewAGUIClient(adminURL, pluginKey string) *AGUIClient {
	return &AGUIClient{
		adminURL:  adminURL,
		pluginKey: pluginKey,
		client: &http.Client{
			// AttachAgent 会阻塞到 agent ready，需要较长超时。
			Timeout: 5 * time.Minute,
		},
	}
}

// CreateThread 在 gatewayd 上创建新 session，返回 threadId。
// 如果 preferredID 非空，gatewayd 会尝试使用该 ID 而非生成新 UUID，
// 这样 gatewayd 重启后 session 可以复用之前的 ID。
func (c *AGUIClient) CreateThread(ctx context.Context, preferredID string) (string, error) {
	// preferredID 为空时发送空 JSON 对象 {}，而非 nil body。
	// gatewayd 在 Content-Type: application/json 下会尝试解析请求体，
	// 空 body 会导致 "EOF while parsing" 错误。
	var bodyBytes []byte
	if preferredID != "" {
		bodyBytes, _ = json.Marshal(map[string]string{"id": preferredID})
	} else {
		bodyBytes = []byte("{}")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.adminURL+"/sessions", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("create session request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
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
func (c *AGUIClient) AttachAgent(ctx context.Context, threadID string, force bool, workspace string) error {
	return c.attachAgentWithKey(ctx, threadID, force, c.pluginKey, workspace)
}

// attachAgentWithKey 向指定 thread 挂载指定插件的 agent 实例。
// gatewayd 会阻塞直到 agent 进程 ready，调用方需保证上下文有足够超时。
// force=true 时会强制创建新 instance；force=false 时若 session 已有 instance 则复用。
func (c *AGUIClient) attachAgentWithKey(ctx context.Context, threadID string, force bool, pluginKey string, workspace string) error {
	body, _ := json.Marshal(map[string]any{
		"agent_key":      pluginKey,
		"name":           pluginKey + "-" + uuid.New().String()[:8],
		"work_directory": workspace,
		"force":          force,
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

// Respond 向 gatewayd 指定 session/agent 发送用户响应，用于继续被 question 工具中断的 agent 运行。
// 对应 gatewayd POST /sessions/{sessionId}/agents/{instanceId}/respond。
func (c *AGUIClient) Respond(ctx context.Context, threadID, instanceID, message string) error {
	if threadID == "" || instanceID == "" {
		return fmt.Errorf("thread id and instance id are required")
	}
	body, _ := json.Marshal(map[string]any{
		"message": message,
	})
	url := fmt.Sprintf("%s/sessions/%s/agents/%s/respond", c.adminURL, threadID, instanceID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create respond request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("respond to agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("respond to agent status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// ForgetThread 清除已缓存的 thread 附加状态，使下一次 Run 调用走完整的 attach 流程。
// 用于 gatewayd 实例已死亡需要重建 session 的回退场景。
func (c *AGUIClient) ForgetThread(threadID string) {
	c.attachedThreads.Delete(threadID)
}

// Run 向 gatewayd 发送 RunAgentInput 并返回 AG-UI 事件流。
// 如果 input.ThreadID 为空或 session 已失效，会先创建新 thread 并挂载 agent。
// 返回实际使用的 threadID、事件流和错误。
func (c *AGUIClient) Run(ctx context.Context, input agui.RunAgentInput) (string, <-chan agui.Event, error) {
	runStart := time.Now()
	if input.RunID == "" {
		input.RunID = uuid.New().String()
	}

	log.Printf("[AGUIClient] >>> Run ENTER run=%s threadId=%q agentKeyInput=%q workspace=%q msgCount=%d toolsCount=%d contextCount=%d",
		input.RunID, input.ThreadID, input.AgentKey, input.Workspace, len(input.Messages), len(input.Tools), len(input.Context))

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
		threadID, err := c.CreateThread(ctx, input.ThreadID)
		if err != nil {
			log.Printf("[AGUIClient] run=%s <<< CreateThread FAILED after %v: %v", input.RunID, time.Since(createStart), err)
			return "", nil, err
		}
		input.ThreadID = threadID
		log.Printf("[AGUIClient] run=%s CreateThread OK threadId=%s after %v", input.RunID, input.ThreadID, time.Since(createStart))
	} else {
		log.Printf("[AGUIClient] run=%s reusing existing threadId=%s", input.RunID, input.ThreadID)
	}

	workspace := input.Workspace

	// 挂载 agent；使用独立超时，避免整体 run 上下文被拉长。
	// 若 gatewayd 因重启等原因丢失 session，自动创建新 session 并重试。
	// 优化：已 attach 过的 thread 跳过 attach 调用，直接进入 chat。
	// 这避免了 force=false 失败后误触发 force=true 重建，保持 agent 进程和 session_id 不中断。
	_, alreadyAttached := c.attachedThreads.Load(input.ThreadID)
	if alreadyAttached {
		log.Printf("[AGUIClient] run=%s SKIP AttachAgent (thread already attached) threadId=%s", input.RunID, input.ThreadID)
	} else {
		attachCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		attachStart := time.Now()
		log.Printf("[AGUIClient] run=%s >>> AttachAgent START threadId=%s pluginKey=%s workspace=%q",
			input.RunID, input.ThreadID, pluginKey, workspace)
		if err := c.attachWithReuse(attachCtx, input.ThreadID, pluginKey, workspace); err != nil {
			if isSessionNotFound(err) {
				log.Printf("[AGUIClient] run=%s session %s not found, creating new thread (preferredID=%s)", input.RunID, input.ThreadID, input.ThreadID)
				newThreadID, createErr := c.CreateThread(ctx, input.ThreadID)
				if createErr != nil {
					cancel()
					log.Printf("[AGUIClient] run=%s <<< CreateThread (retry) FAILED: %v", input.RunID, createErr)
					return "", nil, fmt.Errorf("recreate thread after session lost: %w", createErr)
				}
				if newThreadID != input.ThreadID {
					log.Printf("[AGUIClient] run=%s WARNING: gatewayd returned different threadId! preferred=%s actual=%s (agent local history may be lost)",
						input.RunID, input.ThreadID, newThreadID)
				}
				input.ThreadID = newThreadID
				// 重试时使用全新的 attach 超时上下文，避免第一次调用已消耗大部分超时预算。
				retryAttachCtx, retryCancel := context.WithTimeout(ctx, 2*time.Minute)
				if attachErr := c.attachWithReuse(retryAttachCtx, input.ThreadID, pluginKey, workspace); attachErr != nil {
					retryCancel()
					cancel()
					log.Printf("[AGUIClient] run=%s <<< AttachAgent (retry) FAILED after %v: %v", input.RunID, time.Since(attachStart), attachErr)
					return "", nil, fmt.Errorf("attach agent after recreate: %w", attachErr)
				}
				retryCancel()
				log.Printf("[AGUIClient] run=%s AttachAgent OK (after recreate) newThreadId=%s after %v", input.RunID, newThreadID, time.Since(attachStart))
			} else {
				cancel()
				log.Printf("[AGUIClient] run=%s <<< AttachAgent FAILED after %v: %v", input.RunID, time.Since(attachStart), err)
				return "", nil, fmt.Errorf("attach agent: %w", err)
			}
		} else {
			log.Printf("[AGUIClient] run=%s AttachAgent OK (reuse-first) after %v", input.RunID, time.Since(attachStart))
		}
		cancel()
		// 标记此 thread 已 attach，后续消息跳过 attach 调用。
		c.attachedThreads.Store(input.ThreadID, true)
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

	// gatewayd AG-UI 协议使用 POST /sessions/{sessionId}/chat 启动 run 并返回 SSE 流。
	url := fmt.Sprintf("%s/sessions/%s/chat", c.adminURL, input.ThreadID)
	log.Printf("[AGUIClient] run=%s >>> POST CHAT url=%s msgCount=%d agentKey=%s",
		input.RunID, url, len(gatewaydMessages), pluginKey)

	resp, err := c.doChatRequest(ctx, url, body, input.RunID)
	if err != nil {
		// 如果之前跳过了 attach（认为实例已存在），chat 失败可能是因为实例已丢失。
		// 清除缓存并重新 attach 后重试一次。
		if alreadyAttached {
			log.Printf("[AGUIClient] run=%s chat failed after skip-attach, retrying with full attach: %v", input.RunID, err)
			c.attachedThreads.Delete(input.ThreadID)
			retryAttachCtx, retryCancel := context.WithTimeout(ctx, 2*time.Minute)
			if attachErr := c.attachWithReuse(retryAttachCtx, input.ThreadID, pluginKey, workspace); attachErr != nil {
				retryCancel()
				return "", nil, fmt.Errorf("attach agent (chat retry): %w", attachErr)
			}
			retryCancel()
			c.attachedThreads.Store(input.ThreadID, true)
			resp, err = c.doChatRequest(ctx, url, body, input.RunID)
			if err != nil {
				return "", nil, fmt.Errorf("run request (after retry): %w", err)
			}
		} else {
			return "", nil, fmt.Errorf("run request: %w", err)
		}
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return "", nil, fmt.Errorf("run status %d: %s", resp.StatusCode, string(respBody))
	}

	out := make(chan agui.Event, sseEventBufferSize)
	safego.Go("agui-read-sse", func() { c.readSSE(resp.Body, out, input.ThreadID, input.RunID, runStart) })
	log.Printf("[AGUIClient] run=%s <<< RETURN event channel after %v totalElapsed", input.RunID, time.Since(runStart))
	return input.ThreadID, out, nil
}

// doChatRequest 发送 POST chat 请求到 gatewayd，返回 HTTP 响应。
func (c *AGUIClient) doChatRequest(ctx context.Context, url string, body []byte, runID string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create run request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	runClient := &http.Client{Timeout: runRequestTimeout}
	postStart := time.Now()
	resp, err := runClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("run request: %w", err)
	}
	log.Printf("[AGUIClient] run=%s <<< POST CHAT response status=%d after %v",
		runID, resp.StatusCode, time.Since(postStart))
	return resp, nil
}

// isSessionNotFound 判断 attach 错误是否因为 gatewayd session 丢失。
// gatewayd 两种 session 丢失回包格式：
//   - {"error":"session not found"}   (旧格式)
//   - {"error":"session <session_id>"} (新格式，含 session ID)
// 后者不含 "not found" 字样，需通过 404 状态码 + session 关键字综合判断。
func isSessionNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	hasSession := strings.Contains(msg, "session")
	hasNotFound := strings.Contains(msg, "not found")
	hasStatus404 := strings.Contains(msg, "status 404")
	return hasSession && (hasNotFound || hasStatus404)
}

// isInstanceAlreadyExists 判断 attach 错误是否因为 session 已有 instance（可复用）。
func isInstanceAlreadyExists(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "already has") && strings.Contains(msg, "agent instance")
}

// attachWithReuse 优先以 force=false 复用已有 agent instance，保持 claude/opencode 子进程
// 的 stdin 长连接和进程内 session_id 不被中断。
//
// 复用失败时按错误类型分别处理：
//   - isInstanceAlreadyExists：gatewayd 某些版本对 force=false 返回"已有 instance"错误，
//     视为复用成功，不重建。
//   - isSessionNotFound：向上传播，由调用方重建 thread 后重试。
//   - 其他错误：不再回退 force=true。force=true 会杀掉正在运行的 agent 进程并启动新进程，
//     新进程不传 --resume session_id，导致多轮对话失忆。改为直接放行到 chat，
//     如果实例确实不存在，chat 端点会返回明确错误。
func (c *AGUIClient) attachWithReuse(ctx context.Context, threadID, pluginKey, workspace string) error {
	err := c.attachAgentWithKey(ctx, threadID, false, pluginKey, workspace)
	if err == nil {
		log.Printf("[AGUIClient] attachWithReuse force=false OK threadId=%s", threadID)
		return nil
	}
	if isInstanceAlreadyExists(err) {
		log.Printf("[AGUIClient] attachWithReuse reuse existing instance for threadId=%s", threadID)
		return nil
	}
	if isSessionNotFound(err) {
		log.Printf("[AGUIClient] attachWithReuse session not found threadId=%s err=%v", threadID, err)
		return err
	}
	// force=false 返回未知错误时，不回退 force=true（会杀掉运行中的 agent 进程导致失忆）。
	// 实例可能仍在运行，直接放行到 chat。如果实例确实不存在，chat 端点会返回明确错误。
	log.Printf("[AGUIClient] attachWithReuse force=false failed (err=%v), proceeding to chat WITHOUT rebuild to preserve agent session threadId=%s", err, threadID)
	return nil
}

// readSSE 从 gatewayd SSE 响应中解析 AG-UI 事件。
// 支持多行 data: 合并为一个事件，并在扫描器异常时向下游发送 RUN_ERROR，
// 避免 gatewayd 流异常时后端无感知地静默结束。
func (c *AGUIClient) readSSE(body io.ReadCloser, out chan<- agui.Event, threadID, runID string, runStart time.Time) {
	defer body.Close()
	defer close(out)

	bodyWithTimeout := newInactivityReadCloser(body, SSE_IDLE_TIMEOUT)
	scanner := bufio.NewScanner(bodyWithTimeout)
	scanner.Buffer(make([]byte, 4096), sseScannerMaxTokenSize)

	firstEventSeen := false
	firstContentSeen := false
	eventCount := 0
	var pendingData strings.Builder
	// 收到 RUN_FINISHED / RUN_ERROR 后主动关闭 body，避免 gatewayd 长期不关闭 SSE 流导致下游 goroutine 泄漏。
	finished := false

	// send 带超时保护，防止下游阻塞导致事件无限堆积。
	send := func(ev agui.Event) {
		select {
		case out <- ev:
		case <-time.After(5 * time.Second):
			log.Printf("[AGUIClient] run=%s event channel blocked for 5s, dropping event %s", runID, ev.Type)
		}
	}

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			// 空行表示一个 SSE 事件结束。
			data := pendingData.String()
			pendingData.Reset()
			if data == "" {
				continue
			}
			var ev agui.Event
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				log.Printf("[AGUIClient] run=%s failed to parse event: %v, data=%s", runID, err, data)
				send(agui.RunErrorEvent(fmt.Sprintf("failed to parse sse event: %v", err), "SSE_PARSE_ERROR"))
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
				log.Printf("[AGUIClient] run=%s >>> FIRST SSE event after %v: type=%s", runID, time.Since(runStart), ev.Type)
			}
			eventCount++
			logEvent(ev, runID, eventCount, runStart, &firstContentSeen)
			send(ev)
			if ev.Type == agui.EventRunFinished || ev.Type == agui.EventRunError {
				finished = true
				break
			}
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		// 按 SSE 规范去掉 "data:" 后可选的一个前导空格。
		data := strings.TrimPrefix(line, "data:")
		if len(data) > 0 && data[0] == ' ' {
			data = data[1:]
		}
		if pendingData.Len() > 0 {
			pendingData.WriteByte('\n')
		}
		pendingData.WriteString(data)
	}

	if err := scanner.Err(); err != nil && !finished {
		log.Printf("[AGUIClient] run=%s sse scanner error: %v", runID, err)
		send(agui.RunErrorEvent(fmt.Sprintf("sse scanner error: %v", err), "SSE_SCANNER_ERROR"))
	}
	// 流结束但没有 trailing 空行时，pendingData 中可能仍有一个最终事件未发出。
	if pendingData.Len() > 0 {
		log.Printf("[AGUIClient] run=%s emitting final pending SSE data without trailing blank line", runID)
		emitPendingEvent(pendingData.String(), threadID, runID, runStart, &firstEventSeen, &firstContentSeen, &eventCount, send)
	}
	if finished {
		// 主动关闭底层连接，让 deferred body.Close() 和 close(out) 尽快释放资源。
		_ = body.Close()
	}
	log.Printf("[AGUIClient] run=%s SSE stream ended, total elapsed=%v", runID, time.Since(runStart))
}

// emitPendingEvent 将一条 SSE data 解析为 AG-UI 事件并发送。
// 解析失败时发送 RUN_ERROR，避免异常事件被静默丢弃。
func emitPendingEvent(data, threadID, runID string, runStart time.Time, firstEventSeen, firstContentSeen *bool, eventCount *int, send func(agui.Event)) {
	if data == "" {
		return
	}
	var ev agui.Event
	if err := json.Unmarshal([]byte(data), &ev); err != nil {
		log.Printf("[AGUIClient] run=%s failed to parse event: %v, data=%s", runID, err, data)
		send(agui.RunErrorEvent(fmt.Sprintf("failed to parse sse event: %v", err), "SSE_PARSE_ERROR"))
		return
	}
	if ev.ThreadID == "" {
		ev.ThreadID = threadID
	}
	if ev.RunID == "" {
		ev.RunID = runID
	}
	if !*firstEventSeen {
		*firstEventSeen = true
		log.Printf("[AGUIClient] run=%s >>> FIRST SSE event after %v: type=%s", runID, time.Since(runStart), ev.Type)
	}
	*eventCount++
	logEvent(ev, runID, *eventCount, runStart, firstContentSeen)
	send(ev)
}

func logEvent(ev agui.Event, runID string, eventCount int, runStart time.Time, firstContentSeen *bool) {
	switch ev.Type {
	case agui.EventThinkingStart:
		log.Printf("[AGUIClient] run=%s SSE#%d THINKING_START after %v", runID, eventCount, time.Since(runStart))
	case agui.EventTextMessageStart:
		log.Printf("[AGUIClient] run=%s SSE#%d TEXT_MESSAGE_START (TTFT) after %v", runID, eventCount, time.Since(runStart))
	case agui.EventTextMessageEnd:
		log.Printf("[AGUIClient] run=%s SSE#%d TEXT_MESSAGE_END after %v", runID, eventCount, time.Since(runStart))
	case agui.EventTextMessageContent:
		if !*firstContentSeen {
			*firstContentSeen = true
			log.Printf("[AGUIClient] run=%s SSE#%d first TEXT_MESSAGE_CONTENT after %v", runID, eventCount, time.Since(runStart))
		}
	case agui.EventToolCallStart:
		log.Printf("[AGUIClient] run=%s SSE#%d TOOL_CALL_START id=%s tool=%s after %v", runID, eventCount, ev.ToolCallID, ev.ToolCallName, time.Since(runStart))
	case agui.EventToolCallResult:
		log.Printf("[AGUIClient] run=%s SSE#%d TOOL_CALL_RESULT id=%s after %v", runID, eventCount, ev.ToolCallID, time.Since(runStart))
	case agui.EventRunStarted:
		log.Printf("[AGUIClient] run=%s SSE#%d RUN_STARTED threadId=%s after %v", runID, eventCount, ev.ThreadID, time.Since(runStart))
	case agui.EventRunFinished:
		log.Printf("[AGUIClient] run=%s SSE#%d RUN_FINISHED threadId=%s after %v", runID, eventCount, ev.ThreadID, time.Since(runStart))
	case agui.EventRunError:
		log.Printf("[AGUIClient] run=%s SSE#%d RUN_ERROR threadId=%s after %v", runID, eventCount, ev.ThreadID, time.Since(runStart))
	case agui.EventCustom:
		log.Printf("[AGUIClient] run=%s SSE#%d CUSTOM name=%s after %v", runID, eventCount, ev.Name, time.Since(runStart))
	}
}

// inactivityReadCloser 在超时无读取时关闭底层连接，避免 gatewayd SSE 流挂死。
// 使用 done 通道与 sync.Once 保证 monitor goroutine 正常退出并避免重复关闭。
type inactivityReadCloser struct {
	rc        io.ReadCloser
	timeout   time.Duration
	heartbeat chan struct{}
	mu        sync.Mutex
	timedOut  bool
	closed    bool
	closeOnce sync.Once
	done      chan struct{}
}

func newInactivityReadCloser(rc io.ReadCloser, timeout time.Duration) *inactivityReadCloser {
	w := &inactivityReadCloser{
		rc:        rc,
		timeout:   timeout,
		heartbeat: make(chan struct{}, 1),
		done:      make(chan struct{}),
	}
	safego.Go("agui-inactivity-monitor", w.monitor)
	return w
}

func (r *inactivityReadCloser) Read(p []byte) (int, error) {
	r.mu.Lock()
	if r.timedOut {
		r.mu.Unlock()
		return 0, fmt.Errorf("sse stream idle timeout after %v", r.timeout)
	}
	r.mu.Unlock()

	n, err := r.rc.Read(p)
	if n > 0 {
		select {
		case r.heartbeat <- struct{}{}:
		default:
		}
	}
	return n, err
}

func (r *inactivityReadCloser) monitor() {
	timer := time.NewTimer(r.timeout)
	defer timer.Stop()
	for {
		select {
		case <-r.heartbeat:
			if !timer.Stop() {
				select {
				case <-timer.C:
				case <-r.done:
					return
				}
			}
			timer.Reset(r.timeout)
		case <-timer.C:
			r.mu.Lock()
			if r.closed {
				r.mu.Unlock()
				return
			}
			r.timedOut = true
			r.mu.Unlock()
			// 关闭底层连接以唤醒阻塞的 Read，并触发 scanner 退出。
			// 通过 Close 的 sync.Once 保证 rc 不会被重复关闭。
			_ = r.Close()
			return
		case <-r.done:
			return
		}
	}
}

func (r *inactivityReadCloser) Close() error {
	r.closeOnce.Do(func() {
		r.mu.Lock()
		r.closed = true
		r.timedOut = true
		r.mu.Unlock()
		close(r.done)
		_ = r.rc.Close()
	})
	return nil
}

// RespondAndListen 通过 gatewayd 的 WebSocket 事件流继续被 question 工具中断的 agent 运行。
// 它先建立 WS /sessions/{threadId}/events 连接，然后调用 Respond，最后把事件流返回给调用方。
// 这样可以在不重建 agent 实例的情况下继续原实例，避免新实例重新读取代码/重新思考。
func (c *AGUIClient) RespondAndListen(ctx context.Context, threadID, instanceID, message string) (<-chan agui.Event, func(), error) {
	wsURL, err := c.eventsWsURL(threadID)
	if err != nil {
		return nil, nil, fmt.Errorf("build events websocket url: %w", err)
	}

	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("dial events websocket: %w", err)
	}

	out := make(chan agui.Event, sseEventBufferSize)
	stop := make(chan struct{})
	closeOnce := sync.Once{}
	closeConn := func() {
		closeOnce.Do(func() {
			close(stop)
			_ = wsConn.Close()
		})
	}

	// 先启动 goroutine 读取事件，避免 Respond 后事件立即到达而丢失。
	safego.Go("agui-respond-listen", func() {
		defer close(out)
		defer wsConn.Close()
		log.Printf("[AGUIClient] RespondAndListen event reader started: thread=%s", threadID)
		for {
			select {
			case <-stop:
				log.Printf("[AGUIClient] RespondAndListen event reader stopped by signal: thread=%s", threadID)
				return
			default:
			}

			_ = wsConn.SetReadDeadline(time.Now().Add(5 * time.Second))
			msgType, msg, err := wsConn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) || websocket.IsCloseError(err, websocket.CloseNormalClosure) {
					log.Printf("[AGUIClient] respond listen websocket closed: thread=%s err=%v", threadID, err)
				} else if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					// 5 秒读超时，继续循环，检查 stop 信号。
					continue
				} else {
					log.Printf("[AGUIClient] respond listen websocket read error: thread=%s err=%v", threadID, err)
				}
				return
			}
			if msgType != websocket.TextMessage {
				log.Printf("[AGUIClient] RespondAndListen ignoring non-text websocket message: thread=%s type=%d", threadID, msgType)
				continue
			}

			var ev agui.Event
			if err := json.Unmarshal(msg, &ev); err != nil {
				log.Printf("[AGUIClient] respond listen failed to parse event: thread=%s err=%v msg=%.200s", threadID, err, string(msg))
				continue
			}
			if ev.ThreadID == "" {
				ev.ThreadID = threadID
			}
			log.Printf("[AGUIClient] RespondAndListen received event: thread=%s type=%s name=%s msgId=%s", threadID, ev.Type, ev.Name, ev.MessageID)
			select {
			case out <- ev:
			case <-stop:
				log.Printf("[AGUIClient] RespondAndListen event dropped after stop signal: thread=%s type=%s", threadID, ev.Type)
				return
			}
		}
	})

	// 短暂等待 WebSocket 连接就绪，避免 Respond 立即发出后事件未开始监听。
	time.Sleep(200 * time.Millisecond)

	log.Printf("[AGUIClient] RespondAndListen sending respond: thread=%s instance=%s", threadID, instanceID)
	if err := c.Respond(ctx, threadID, instanceID, message); err != nil {
		closeConn()
		return nil, nil, fmt.Errorf("respond to agent: %w", err)
	}

	log.Printf("[AGUIClient] RespondAndListen: respond sent thread=%s instance=%s, listening events", threadID, instanceID)
	return out, closeConn, nil
}

// eventsWsURL 把 gatewayd admin HTTP URL 转换为该 session 的事件 WebSocket URL。
func (c *AGUIClient) eventsWsURL(threadID string) (string, error) {
	u, err := url.Parse(c.adminURL)
	if err != nil {
		return "", err
	}
	scheme := "ws"
	if u.Scheme == "https" {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s/sessions/%s/events", scheme, u.Host, threadID), nil
}
