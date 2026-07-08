package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/google/uuid"
)

const (
	finishWait     = 90 * time.Second
	maxRunDuration = 10 * time.Minute
)

// USER_PROMPT_MARKER 与前端 useAgUiChat 保持一致，用于从包装后的提示词中提取原始用户输入。
const USER_PROMPT_MARKER = "__USER_PROMPT__"

// contentPart 描述 assistant 消息的一个结构化内容部件，用于落库到 message.metadata，
// 前端恢复历史时据此重建 reasoning / tool-call / text 部件。
type contentPart struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	ToolCallID string `json:"toolCallId,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	ArgsText   string `json:"argsText,omitempty"`
	Result     string `json:"result,omitempty"`
	Done       bool   `json:"done,omitempty"`
}

// AGUIHandler 处理 AG-UI 协议的 agent run 请求。
type AGUIHandler struct {
	aguiClient  *client.AGUIClient
	sessions    chat.SessionStore
	messages    chat.MessageStore
	buffer      buffer.SSEBuffer
	workItemSvc workitemservice.WorkItemService
}

// NewAGUIHandler 创建 AG-UI handler。
func NewAGUIHandler(adminURL, pluginKey string, sessions chat.SessionStore, messages chat.MessageStore, buf buffer.SSEBuffer, workItemSvc workitemservice.WorkItemService) *AGUIHandler {
	return &AGUIHandler{
		aguiClient:  client.NewAGUIClient(adminURL, pluginKey),
		sessions:    sessions,
		messages:    messages,
		buffer:      buf,
		workItemSvc: workItemSvc,
	}
}

// AgentRun 是 POST /api/v1/agent 处理器。
// 接收 RunAgentInput，转发到 ent-desktop gatewayd，并以 SSE 流回传 AG-UI 事件。
func (h *AGUIHandler) AgentRun(w http.ResponseWriter, r *http.Request) {
	reqStart := time.Now()

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, fmt.Sprintf("read body: %v", err), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var input agui.RunAgentInput
	if err := json.Unmarshal(body, &input); err != nil {
		http.Error(w, fmt.Sprintf("invalid json: %v", err), http.StatusBadRequest)
		return
	}

	// 确保每条 run 都有唯一 runId。
	if input.RunID == "" {
		input.RunID = uuid.New().String()
	}

	// 校验并复用已存在的后端 session；不存在时让 gatewayd 创建新 thread 后再写入。
	sessionID := input.ThreadID
	if sessionID != "" && sessionID != "main" {
		if sess, err := h.sessions.Get(r.Context(), sessionID); err == nil {
			_ = h.sessions.UpdateActivity(r.Context(), sessionID)
			log.Printf("[AGUIHandler] run=%s reuse session=%s", input.RunID, sessionID)
			// 从持久化会话中恢复创建工作目录，保证 gatewayd 在该 session 生命周期内始终使用同一工作目录。
			if sess.WorkspacePath != "" {
				input.Workspace = sess.WorkspacePath
			}
		} else {
			log.Printf("[AGUIHandler] run=%s session=%s not found, will create after run", input.RunID, sessionID)
			sessionID = ""
		}
	} else {
		sessionID = ""
	}

	// 保存用户输入消息（最后一条或全部用户消息）。
	// 使用 ON CONFLICT DO NOTHING 避免同一消息因重试或历史消息重复发送而主键冲突。
	h.saveUserMessages(r.Context(), sessionID, input.Messages, input.Context)

	// 设置 SSE 响应头（提前设置，意图识别的闲聊回复也需要 SSE）。
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	// 立即刷新 SSE 响应头，让前端 fetch() 能先拿到 HTTP 头部。
	flusher.Flush()

	// 拦截斜杠指令（/prd-write、/proto-make 等），
	// 将用户消息替换为指令专属提示词模板。
	// 同时处理引用的任务卡片，将卡片信息注入提示词。
	// 在 saveUserMessages 之后执行，确保数据库保存的是用户原始输入。
	commandApplied := interceptCommands(input.Messages, input.Context, h.workItemSvc)

	// 意图识别：用户未输入斜杠指令时，先调用 LLM 判断是闲聊还是任务意图。
	// 闲聊 → 直接返回 LLM 回复，不走正常 agent run。
	// 任务意图 → 映射到对应指令模板，再走正常 agent run。
	if !commandApplied {
		userInput := extractLastUserText(input.Messages)
		// 简单问候语直接返回静态回复，避免在 LLM/agent 不可用时进入长时间等待。
		if isGreeting(userInput) {
			log.Printf("[AGUIHandler] run=%s greeting matched, bypassing intent/agent run", input.RunID)
			h.streamChatResponse(r, w, flusher, greetingResponse(), sessionID, input.RunID)
			return
		}
		if userInput != "" {
			intentResult, err := recognizeIntent(r.Context(), h.aguiClient, userInput)
			if err != nil {
				log.Printf("[AGUIHandler] intent recognition failed, fallback to normal run: %v", err)
			} else if intentResult != nil {
				if intentResult.IsChat {
					// 闲聊：直接流式返回回复，不走 agent run。
					h.streamChatResponse(r, w, flusher, intentResult.Response, sessionID, input.RunID)
					return
				}
				// 任务意图：应用指令模板到用户消息。
				applyIntentCommand(input.Messages, intentResult.Command, userInput)
				log.Printf("[AGUIHandler] intent mapped to command: %s", intentResult.Command)
			}
		}
	}

	// gatewayd 在 /sessions/{id}/chat 中会先发送 RUN_STARTED，
	// 这里不再重复发送，避免前端收到重复的 run 开始事件。

	// 使用 background context 调用 gatewayd，确保前端断连后 gatewayd 继续运行。
	actualThreadID, events, err := h.aguiClient.Run(context.Background(), input)
	if err != nil {
		log.Printf("[AGUIHandler] run=%s run failed after %v: %v", input.RunID, time.Since(reqStart), err)
		h.writeEvent(w, flusher, agui.RunErrorEvent(FormatGatewaydError(err), "RUN_FAILED"))
		return
	}

	// 确保后端 session 记录存在（新会话在发送第一条消息前已通过 /api/v1/sessions 创建，
	// 这里作为兜底，兼容直接调用 /api/v1/agent 的场景）。
	if err := h.ensureSession(context.Background(), actualThreadID); err != nil {
		log.Printf("[AGUIHandler] run=%s ensure session failed: %v", input.RunID, err)
	}
	sessionID = actualThreadID

	// bgCtx 用于 buffer 和持久化操作，独立于 HTTP 请求生命周期。
	bgCtx := context.Background()

	finishTimer := time.NewTimer(finishWait)
	finishTimer.Stop()
	maxTimer := time.NewTimer(maxRunDuration)
	maxTimer.Stop()

	activeToolCallCount := 0
	pendingToolCallIDs := []string{}
	activeTextMessageID := ""

	// run 级累加器：一次 run 的所有部件（reasoning / text / tool-call）
	// 按实际到达顺序累积，RUN_FINISHED 时合并为一条消息入库。
	// 替代之前按 messageID 分条入库的方式，避免同一轮回复被拆成多条消息、
	// 以及思考/工具调用因发生在文本消息之外而丢失的问题。
	var runParts []contentPart
	var runTextBuilder strings.Builder
	var runMessageID string
	var bufMu sync.Mutex

	// writeAndBuffer 将事件写入前端 SSE 流，同时写入 buffer（若启用）。
	writeAndBuffer := func(ev agui.Event) {
		if h.buffer != nil {
			h.buffer.Append(bgCtx, sessionID, ev)
		}
		data, err := json.Marshal(ev)
		if err != nil {
			log.Printf("[AGUIHandler] marshal event failed: %v", err)
			return
		}
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// checkpointRun 将当前 run 级累加器序列化后保存到 buffer，
	// 防止服务器崩溃导致未持久化的消息丢失。生产环境切换 Redis 后可跨重启恢复。
	checkpointRun := func() {
		if h.buffer == nil || sessionID == "" || input.RunID == "" {
			return
		}
		bufMu.Lock()
		state, err := json.Marshal(runParts)
		bufMu.Unlock()
		if err != nil {
			log.Printf("[AGUIHandler] checkpoint marshal failed: %v", err)
			return
		}
		if err := h.buffer.SaveRunState(bgCtx, sessionID, input.RunID, state); err != nil {
			log.Printf("[AGUIHandler] checkpoint save failed: %v", err)
		}
	}

	// persistRunAssistant 将一次 run 累积的所有部件合并为一条消息入库，
	// 然后清除 buffer 中的 checkpoint。在 RUN_FINISHED / RUN_ERROR / 超时 / 断连时调用。
	persistRunAssistant := func() {
		bufMu.Lock()
		parts := runParts
		text := runTextBuilder.String()
		msgID := runMessageID
		runParts = nil
		runTextBuilder.Reset()
		runMessageID = ""
		bufMu.Unlock()

		if sessionID == "" || (len(parts) == 0 && text == "") {
			return
		}
		if msgID == "" {
			msgID = uuid.New().String()
		}
		metadata := map[string]any{}
		if len(parts) > 0 {
			metadata["contentParts"] = parts
		}
		msg := chat.Message{
			ID:        msgID,
			SessionID: sessionID,
			Role:      "assistant",
			Type:      "text",
			Content:   text,
			Metadata:  metadata,
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(bgCtx, sessionID, msg); err != nil {
			log.Printf("[AGUIHandler] save assistant message failed: %v", err)
		} else {
			log.Printf("[AGUIHandler] saved assistant message id=%s parts=%d textLen=%d", msgID, len(parts), len(text))
		}
		if h.buffer != nil && sessionID != "" && input.RunID != "" {
			_ = h.buffer.ClearRunState(bgCtx, sessionID, input.RunID)
		}
	}

	flushPendingState := func() {
		for _, id := range pendingToolCallIDs {
			writeAndBuffer(agui.Event{
				Type:       agui.EventToolCallEnd,
				ToolCallID: id,
				Timestamp:  float64(time.Now().UnixMilli()) / 1000,
			})
		}
		pendingToolCallIDs = pendingToolCallIDs[:0]
		activeToolCallCount = 0

		if activeTextMessageID != "" {
			writeAndBuffer(agui.Event{
				Type:      agui.EventTextMessageEnd,
				MessageID: activeTextMessageID,
				Timestamp: float64(time.Now().UnixMilli()) / 1000,
			})
			activeTextMessageID = ""
		}
	}

	completeRun := func() {
		finishTimer.Stop()
		maxTimer.Stop()
		flushPendingState()
		writeAndBuffer(agui.RunFinishedEvent(actualThreadID, input.RunID))
		persistRunAssistant()
		h.finalizeSession(bgCtx, sessionID, input.Messages)
	}

	firstEventSeen := false
	firstContentSeen := false
	frontendDone := false
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				log.Printf("[AGUIHandler] run=%s event stream closed, total elapsed=%v", input.RunID, time.Since(reqStart))
				completeRun()
				return
			}
			// 无条件缓冲所有 gatewayd 事件，供前端重连回放。
			if h.buffer != nil {
				h.buffer.Append(bgCtx, sessionID, ev)
			}
			if !firstEventSeen {
				firstEventSeen = true
				log.Printf("[AGUIHandler] run=%s first SSE event from gatewayd after %v: type=%s", input.RunID, time.Since(reqStart), ev.Type)
				maxTimer.Reset(maxRunDuration)
			}
		switch ev.Type {
		case agui.EventThinkingStart:
			log.Printf("[AGUIHandler] run=%s THINKING_START after %v", input.RunID, time.Since(reqStart))
		case agui.EventTextMessageStart:
			log.Printf("[AGUIHandler] run=%s TEXT_MESSAGE_START (TTFT) after %v", input.RunID, time.Since(reqStart))
			activeTextMessageID = ev.MessageID
			bufMu.Lock()
			if runMessageID == "" {
				runMessageID = ev.MessageID
			}
			bufMu.Unlock()
		case agui.EventTextMessageContent:
			if !firstContentSeen {
				firstContentSeen = true
				log.Printf("[AGUIHandler] run=%s first TEXT_MESSAGE_CONTENT after %v", input.RunID, time.Since(reqStart))
			}
			if ev.Delta == "" {
				break
			}
			bufMu.Lock()
			if len(runParts) == 0 || runParts[len(runParts)-1].Type != "text" {
				runParts = append(runParts, contentPart{Type: "text", Text: ev.Delta})
			} else {
				runParts[len(runParts)-1].Text += ev.Delta
			}
			runTextBuilder.WriteString(ev.Delta)
			bufMu.Unlock()
			checkpointRun()
		case agui.EventTextMessageEnd:
			log.Printf("[AGUIHandler] run=%s TEXT_MESSAGE_END id=%s after %v", input.RunID, ev.MessageID, time.Since(reqStart))
			activeTextMessageID = ""
		case agui.EventThinkingTextMessageContent:
			if ev.Delta == "" {
				break
			}
			bufMu.Lock()
			if len(runParts) == 0 || runParts[len(runParts)-1].Type != "reasoning" {
				runParts = append(runParts, contentPart{Type: "reasoning", Text: ev.Delta})
			} else {
				runParts[len(runParts)-1].Text += ev.Delta
			}
			bufMu.Unlock()
			checkpointRun()
		case agui.EventThinkingEnd:
			bufMu.Lock()
			for i := len(runParts) - 1; i >= 0; i-- {
				if runParts[i].Type == "reasoning" {
					runParts[i].Done = true
					break
				}
			}
			bufMu.Unlock()
			checkpointRun()
		case agui.EventToolCallStart:
			log.Printf("[AGUIHandler] run=%s TOOL_CALL_START id=%s tool=%s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, time.Since(reqStart))
			activeToolCallCount++
			pendingToolCallIDs = append(pendingToolCallIDs, ev.ToolCallID)
			bufMu.Lock()
			runParts = append(runParts, contentPart{
				Type:       "tool-call",
				ToolCallID: ev.ToolCallID,
				ToolName:   ev.ToolCallName,
			})
			bufMu.Unlock()
			checkpointRun()
		case agui.EventToolCallArgs:
			log.Printf("[AGUIHandler] run=%s TOOL_CALL_ARGS id=%s tool=%s args=%.200s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, ev.Content, time.Since(reqStart))
			if len(pendingToolCallIDs) > 0 {
				expectedID := pendingToolCallIDs[len(pendingToolCallIDs)-1]
				if ev.ToolCallID != expectedID {
					log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_ARGS id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
					ev.ToolCallID = expectedID
				}
			} else {
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_ARGS id=%s but no pending tool call", input.RunID, ev.ToolCallID)
			}
			if ev.Delta != "" {
				bufMu.Lock()
				for i := len(runParts) - 1; i >= 0; i-- {
					if runParts[i].Type == "tool-call" && runParts[i].ToolCallID == ev.ToolCallID {
						runParts[i].ArgsText += ev.Delta
						break
					}
				}
				bufMu.Unlock()
				checkpointRun()
			}
		case agui.EventToolCallEnd:
			log.Printf("[AGUIHandler] run=%s TOOL_CALL_END id=%s after %v", input.RunID, ev.ToolCallID, time.Since(reqStart))
			if len(pendingToolCallIDs) > 0 {
				expectedID := pendingToolCallIDs[0]
				pendingToolCallIDs = pendingToolCallIDs[1:]
				if ev.ToolCallID != expectedID {
					log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_END id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
					ev.ToolCallID = expectedID
				}
				if activeToolCallCount > 0 {
					activeToolCallCount--
				}
			} else {
				log.Printf("[AGUIHandler] run=%s ignore orphan TOOL_CALL_END id=%s", input.RunID, ev.ToolCallID)
				continue
			}
		case agui.EventToolCallResult:
			log.Printf("[AGUIHandler] run=%s TOOL_CALL_RESULT id=%s tool=%s result=%.200s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, ev.Content, time.Since(reqStart))
			if len(pendingToolCallIDs) > 0 {
				expectedID := pendingToolCallIDs[0]
				pendingToolCallIDs = pendingToolCallIDs[1:]
				if ev.ToolCallID != expectedID {
					log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_RESULT id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
					ev.ToolCallID = expectedID
				}
				writeAndBuffer(agui.Event{
					Type:       agui.EventToolCallEnd,
					ToolCallID: expectedID,
					Timestamp:  float64(time.Now().UnixMilli()) / 1000,
				})
				if activeToolCallCount > 0 {
					activeToolCallCount--
				}
			} else {
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_RESULT id=%s but no pending tool call", input.RunID, ev.ToolCallID)
			}
			if ev.ToolCallID != "" {
				bufMu.Lock()
				for i := len(runParts) - 1; i >= 0; i-- {
					if runParts[i].Type == "tool-call" && runParts[i].ToolCallID == ev.ToolCallID {
						runParts[i].Result = ev.Content
						break
					}
				}
				bufMu.Unlock()
				checkpointRun()
			}
		case agui.EventRunError:
			log.Printf("[AGUIHandler] run=%s RUN_ERROR after %v: %s", input.RunID, time.Since(reqStart), ev.Message)
			flushPendingState()
			writeAndBuffer(ev)
			persistRunAssistant()
			h.finalizeSession(bgCtx, sessionID, input.Messages)
			return
		}
			writeAndBuffer(ev)
			if activeToolCallCount == 0 {
				finishTimer.Reset(finishWait)
			} else {
				finishTimer.Stop()
			}
		case <-r.Context().Done():
			if frontendDone {
				continue
			}
			frontendDone = true
			log.Printf("[AGUIHandler] run=%s frontend disconnected, continuing buffering in background", input.RunID)

			// 前端断连后继续从 gatewayd 读取事件并缓冲，直到 stream 结束。
			finishTimer.Stop()
			maxTimer.Stop()
			for ev := range events {
				if h.buffer != nil {
					h.buffer.Append(bgCtx, sessionID, ev)
				}
				// 使用与主循环相同的 run 级累加逻辑追踪部件。
				switch ev.Type {
				case agui.EventTextMessageStart:
					activeTextMessageID = ev.MessageID
					bufMu.Lock()
					if runMessageID == "" {
						runMessageID = ev.MessageID
					}
					bufMu.Unlock()
				case agui.EventTextMessageContent:
					if ev.Delta == "" {
						continue
					}
					bufMu.Lock()
					if len(runParts) == 0 || runParts[len(runParts)-1].Type != "text" {
						runParts = append(runParts, contentPart{Type: "text", Text: ev.Delta})
					} else {
						runParts[len(runParts)-1].Text += ev.Delta
					}
					runTextBuilder.WriteString(ev.Delta)
					bufMu.Unlock()
				case agui.EventTextMessageEnd:
					activeTextMessageID = ""
				case agui.EventThinkingTextMessageContent:
					if ev.Delta == "" {
						continue
					}
					bufMu.Lock()
					if len(runParts) == 0 || runParts[len(runParts)-1].Type != "reasoning" {
						runParts = append(runParts, contentPart{Type: "reasoning", Text: ev.Delta})
					} else {
						runParts[len(runParts)-1].Text += ev.Delta
					}
					bufMu.Unlock()
				case agui.EventThinkingEnd:
					bufMu.Lock()
					for i := len(runParts) - 1; i >= 0; i-- {
						if runParts[i].Type == "reasoning" {
							runParts[i].Done = true
							break
						}
					}
					bufMu.Unlock()
				case agui.EventToolCallStart:
					activeToolCallCount++
					pendingToolCallIDs = append(pendingToolCallIDs, ev.ToolCallID)
					bufMu.Lock()
					runParts = append(runParts, contentPart{
						Type:       "tool-call",
						ToolCallID: ev.ToolCallID,
						ToolName:   ev.ToolCallName,
					})
					bufMu.Unlock()
				case agui.EventToolCallArgs:
					if ev.Delta != "" {
						bufMu.Lock()
						for i := len(runParts) - 1; i >= 0; i-- {
							if runParts[i].Type == "tool-call" && runParts[i].ToolCallID == ev.ToolCallID {
								runParts[i].ArgsText += ev.Delta
								break
							}
						}
						bufMu.Unlock()
					}
				case agui.EventToolCallEnd:
					if len(pendingToolCallIDs) > 0 {
						pendingToolCallIDs = pendingToolCallIDs[1:]
						if activeToolCallCount > 0 {
							activeToolCallCount--
						}
					}
				case agui.EventToolCallResult:
					if len(pendingToolCallIDs) > 0 {
						pendingToolCallIDs = pendingToolCallIDs[1:]
						if activeToolCallCount > 0 {
							activeToolCallCount--
						}
					}
					if ev.ToolCallID != "" {
						bufMu.Lock()
						for i := len(runParts) - 1; i >= 0; i-- {
							if runParts[i].Type == "tool-call" && runParts[i].ToolCallID == ev.ToolCallID {
								runParts[i].Result = ev.Content
								break
							}
						}
						bufMu.Unlock()
					}
				}
			}
			// 缓冲最终合成事件并持久化。
			if h.buffer != nil {
				now := float64(time.Now().UnixMilli()) / 1000
				for _, id := range pendingToolCallIDs {
					h.buffer.Append(bgCtx, sessionID, agui.Event{
						Type:       agui.EventToolCallEnd,
						ToolCallID: id,
						Timestamp:  now,
					})
				}
				h.buffer.Append(bgCtx, sessionID, agui.RunFinishedEvent(actualThreadID, input.RunID))
			}
			persistRunAssistant()
			h.finalizeSession(bgCtx, sessionID, input.Messages)
			return
		case <-finishTimer.C:
			log.Printf("[AGUIHandler] run=%s finish timer fired, total elapsed=%v", input.RunID, time.Since(reqStart))
			if activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				writeAndBuffer(agui.Event{
					Type:      agui.EventTextMessageContent,
					MessageID: activeTextMessageID,
					Delta:     "\n\n（模型响应超时或中断，请检查模型配置、网络或账户余额后重试。）",
					Timestamp: ts,
				})
				writeAndBuffer(agui.Event{
					Type:      agui.EventTextMessageEnd,
					MessageID: activeTextMessageID,
					Timestamp: ts,
				})
				activeTextMessageID = ""
			}
			flushPendingState()
			writeAndBuffer(agui.RunFinishedEvent(actualThreadID, input.RunID))
			persistRunAssistant()
			h.finalizeSession(bgCtx, sessionID, input.Messages)
			return
		case <-maxTimer.C:
			log.Printf("[AGUIHandler] run=%s max run duration reached, total elapsed=%v", input.RunID, time.Since(reqStart))
			if activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				writeAndBuffer(agui.Event{
					Type:      agui.EventTextMessageContent,
					MessageID: activeTextMessageID,
					Delta:     "\n\n（模型运行超过最大时长，已自动结束。）",
					Timestamp: ts,
				})
				writeAndBuffer(agui.Event{
					Type:      agui.EventTextMessageEnd,
					MessageID: activeTextMessageID,
					Timestamp: ts,
				})
				activeTextMessageID = ""
			}
			flushPendingState()
			writeAndBuffer(agui.RunFinishedEvent(actualThreadID, input.RunID))
			persistRunAssistant()
			h.finalizeSession(bgCtx, sessionID, input.Messages)
			return
		}
	}
}

// writeEvent 将 AG-UI 事件以 SSE data: 格式写入响应。
func (h *AGUIHandler) writeEvent(w http.ResponseWriter, flusher http.Flusher, ev agui.Event) {
	data, err := json.Marshal(ev)
	if err != nil {
		log.Printf("[AGUIHandler] marshal event failed: %v", err)
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

// ensureSession 保证指定 session id 在数据库中存在。
func (h *AGUIHandler) ensureSession(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	_, err := h.sessions.Get(ctx, sessionID)
	if err == nil {
		return nil
	}
	sess := chat.Session{
		ID:          sessionID,
		WorkspaceID: "ws-default",
		AgentID:     "agent-default",
		AgentType:   "chat",
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	return h.sessions.Create(ctx, sess)
}

// saveUserMessages 将用户输入消息持久化到数据库，并在第一条用户消息到达时生成会话标题。
// ctxItems 携带前端发送的上下文数据（quotedCard、selectedRepos），写入消息 metadata 以便历史恢复。
func (h *AGUIHandler) saveUserMessages(ctx context.Context, sessionID string, messages []agui.Message, ctxItems []agui.ContextItem) {
	if sessionID == "" {
		log.Printf("[AGUIHandler] saveUserMessages skipped: empty sessionID, count=%d", len(messages))
		return
	}
	log.Printf("[AGUIHandler] saveUserMessages session=%s count=%d", sessionID, len(messages))

	// 从上下文项中提取 quotedCard 和 selectedRepos，持久化到用户消息 metadata。
	quotedCardRaw := extractContextItemRaw(ctxItems, "quotedCard")
	selectedReposRaw := extractContextItemRaw(ctxItems, "selectedRepos")

	for _, m := range messages {
		content := m.ContentText()
		metadata := map[string]any{}
		if m.Role == agui.RoleUser {
			original := extractOriginalUserPrompt(content)
			if original != "" && original != content {
				metadata["originalText"] = original
			}
			// 持久化引用卡片和代码库，以便历史会话恢复。
			if quotedCardRaw != nil {
				var card any
				if json.Unmarshal(quotedCardRaw, &card) == nil {
					metadata["quotedCard"] = card
				}
			}
			if selectedReposRaw != nil {
				var repos any
				if json.Unmarshal(selectedReposRaw, &repos) == nil {
					metadata["selectedRepos"] = repos
				}
			}
		}
		msg := chat.Message{
			ID:        m.ID,
			SessionID: sessionID,
			Role:      string(m.Role),
			Type:      "text",
			Content:   content,
			Metadata:  metadata,
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(ctx, sessionID, msg); err != nil {
			log.Printf("[AGUIHandler] save user message failed: %v", err)
		} else {
			log.Printf("[AGUIHandler] saved user message id=%s role=%s", msg.ID, msg.Role)
		}
	}
	// 若会话尚无标题，取第一条非问候用户消息生成标题。
	h.ensureSessionTitle(ctx, sessionID, messages)
}

// finalizeSession 更新会话活动时间，并根据第一条非问候用户消息生成标题。
func (h *AGUIHandler) finalizeSession(ctx context.Context, sessionID string, inputMessages []agui.Message) {
	if sessionID == "" {
		return
	}
	_ = h.sessions.UpdateActivity(ctx, sessionID)

	// 若会话尚无标题，取第一条非问候用户消息生成标题。
	h.ensureSessionTitle(ctx, sessionID, inputMessages)
}

// extractOriginalUserPrompt 从包装后的提示词模板中提取用户原始输入。
func extractOriginalUserPrompt(text string) string {
	// 兼容历史数据：前端曾经用 JSON.stringify 双重编码 content，导致此处收到的
	// 文本以 " 开头且换行为字面量 \n。尝试再解码一层以还原真实内容。
	if strings.HasPrefix(text, "\"") {
		var decoded string
		if err := json.Unmarshal([]byte(text), &decoded); err == nil {
			text = decoded
		}
	}
	idx := strings.Index(text, USER_PROMPT_MARKER)
	if idx == -1 {
		return ""
	}
	return strings.TrimSpace(text[idx+len(USER_PROMPT_MARKER):])
}

// deriveSessionTitle 根据用户提示词生成会话标题，最多 30 个字符。
func deriveSessionTitle(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return "新会话"
	}
	// 优先使用原始提示词（如果包含模板标记）。
	original := extractOriginalUserPrompt(text)
	if original != "" {
		text = original
	}
	text = strings.ReplaceAll(text, "\n", " ")
	if utf8.RuneCountInString(text) <= 30 {
		return text
	}
	return string([]rune(text)[:30]) + "..."
}

// ensureSessionTitle 在会话尚无标题时，根据第一条非问候用户消息生成标题。
// 规则：用户首个输入若是问候语，则跳过，等待后续功能性输入再生成标题。
func (h *AGUIHandler) ensureSessionTitle(ctx context.Context, sessionID string, messages []agui.Message) {
	sess, err := h.sessions.Get(ctx, sessionID)
	if err != nil || sess.Title != "" {
		return
	}
	for _, m := range messages {
		if m.Role != agui.RoleUser {
			continue
		}
		text := m.ContentText()
		if original := extractOriginalUserPrompt(text); original != "" {
			text = original
		}
		text = strings.TrimSpace(text)
		if text == "" || isGreeting(text) {
			continue
		}
		title := deriveSessionTitle(text)
		if title != "" {
			_ = h.sessions.UpdateTitle(ctx, sessionID, title)
		}
		break
	}
}

// extractContextItemRaw 从上下文项列表中按名称查找并返回原始 JSON 值。
func extractContextItemRaw(items []agui.ContextItem, name string) json.RawMessage {
	for _, item := range items {
		if item.Name == name {
			return item.Value
		}
	}
	return nil
}

// extractLastUserText 从消息列表中提取最后一条用户消息的纯文本。
// 用于意图识别时获取用户的原始输入。
func extractLastUserText(messages []agui.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != agui.RoleUser {
			continue
		}
		rawText := messages[i].ContentText()
		original := extractOriginalUserPrompt(rawText)
		if original != "" {
			return original
		}
		return rawText
	}
	return ""
}

// streamChatResponse 将闲聊回复以 AG-UI SSE 事件格式流式发送给前端。
// 生成完整的 TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT → TEXT_MESSAGE_END → RUN_FINISHED 事件序列。
func (h *AGUIHandler) streamChatResponse(r *http.Request, w http.ResponseWriter, flusher http.Flusher, response, sessionID, runID string) {
	messageID := generateMessageID()

	// 构建并发送事件序列。
	events := []agui.Event{
		{Type: agui.EventTextMessageStart, MessageID: messageID, Role: "assistant", ThreadID: sessionID, RunID: runID},
	}

	// 将回复按行分段发送，模拟流式输出效果。
	lines := strings.Split(response, "\n")
	for _, line := range lines {
		events = append(events, agui.Event{
			Type:      agui.EventTextMessageContent,
			MessageID: messageID,
			Delta:     line + "\n",
			ThreadID:  sessionID,
			RunID:     runID,
		})
	}

	events = append(events,
		agui.Event{Type: agui.EventTextMessageEnd, MessageID: messageID, ThreadID: sessionID, RunID: runID},
		agui.Event{Type: agui.EventRunFinished, ThreadID: sessionID, RunID: runID},
	)

	// 逐个写入 SSE 并缓冲。
	for _, ev := range events {
		data, err := json.Marshal(ev)
		if err != nil {
			continue
		}
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()

		// 缓冲事件供前端重连时回放。
		if h.buffer != nil {
			_ = h.buffer.Append(r.Context(), sessionID, ev)
		}
	}

	// 持久化助手消息。
	assistantMsg := chat.Message{
		ID:        messageID,
		SessionID: sessionID,
		Role:      "assistant",
		Type:      "text",
		Content:   response,
		Timestamp: time.Now(),
	}
	if h.messages != nil {
		_ = h.messages.Append(r.Context(), sessionID, assistantMsg)
	}

	log.Printf("[AGUIHandler] chat response streamed: session=%s run=%s len=%d", sessionID, runID, len(response))
}

// generateMessageID 生成消息 ID。
func generateMessageID() string {
	return "msg-" + uuid.New().String()[:8]
}
