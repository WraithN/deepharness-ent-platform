package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/google/uuid"
)

const (
	// finishWait 是 run 开始响应后、无新事件时的优雅结束等待时间。
	// 需要覆盖模型长时间思考（无事件输出）的场景，避免误判超时提前结束 run。
	finishWait = 10 * time.Minute
	// maxRunDuration 是单次 run 的总时长上限。PRD/原型生成等长任务可能超过 10 分钟，
	// 过短会在 agent 仍在正常工作时强制终止，导致回复丢失。
	maxRunDuration = 30 * time.Minute
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

// runState 保存一次 agent run 在处理过程中的可变状态，
// 供主循环与前端断连后的后台恢复路径共享。
type runState struct {
	bufMu               sync.Mutex
	eventCount          int
	activeToolCallCount int
	pendingToolCallIDs    []string
	activeTextMessageID string
	firstResponseSeen   bool
	runParts            []contentPart
	runTextBuilder      strings.Builder
	runMessageID        string
}

// cloneAGUIMessages 深拷贝 AG-UI 消息切片，避免 interceptCommands / applyIntentCommand
// 替换最后一条消息内容时污染原始用户输入的备份。
func cloneAGUIMessages(msgs []agui.Message) []agui.Message {
	out := make([]agui.Message, len(msgs))
	for i, m := range msgs {
		out[i] = m
		if m.Content != nil {
			out[i].Content = append(json.RawMessage(nil), m.Content...)
		}
		if m.ToolCalls != nil {
			out[i].ToolCalls = append(json.RawMessage(nil), m.ToolCalls...)
		}
	}
	return out
}

// AGUIHandler 处理 AG-UI 协议的 agent run 请求。
type AGUIHandler struct {
	aguiClient    *client.AGUIClient
	sessions      chat.SessionStore
	messages      chat.MessageStore
	buffer        buffer.SSEBuffer
	workItemSvc   workitemservice.WorkItemService
	workspaceRoot string
}

// NewAGUIHandler 创建 AG-UI handler。
func NewAGUIHandler(adminURL, pluginKey, workspaceRoot string, sessions chat.SessionStore, messages chat.MessageStore, buf buffer.SSEBuffer, workItemSvc workitemservice.WorkItemService) *AGUIHandler {
	return &AGUIHandler{
		aguiClient:    client.NewAGUIClient(adminURL, pluginKey),
		sessions:      sessions,
		messages:      messages,
		buffer:        buf,
		workItemSvc:   workItemSvc,
		workspaceRoot: workspaceRoot,
	}
}

// QuickComplete 将 prompt 转发给 agent 运行时做一次同步短文本补全，返回纯文本结果。
// 供非流式场景复用（如意图识别、规范智能生成）。
func (h *AGUIHandler) QuickComplete(ctx context.Context, prompt string) (string, error) {
	return h.aguiClient.QuickComplete(ctx, prompt)
}

// AgentRun 是 POST /api/v1/agent 处理器。
// 接收 RunAgentInput，转发到 ent-desktop gatewayd，并以 SSE 流回传 AG-UI 事件。
func (h *AGUIHandler) AgentRun(w http.ResponseWriter, r *http.Request) {
	reqStart := time.Now()
	var intentCommand string

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "workspaceId is required")
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

	// 提取最后一条用户消息文本，用于 debug 日志。
	lastMsgText := extractLastUserText(input.Messages)
	log.Printf("[AGUIHandler] >>> HandleRun ENTER run=%s threadId=%s workspace=%s msgCount=%d lastMsg=%q contextCount=%d agentKey=%s",
		input.RunID, input.ThreadID, workspaceID, len(input.Messages), lastMsgText, len(input.Context), input.AgentKey)

	// 校验并复用已存在的后端 session；不存在时让 gatewayd 创建新 thread 后再写入。
	sessionID := input.ThreadID
	savedEarly := false
	if sessionID != "" && sessionID != "main" {
		if sess, err := h.sessions.Get(r.Context(), sessionID); err == nil {
			_ = h.sessions.UpdateActivity(r.Context(), sessionID)
			log.Printf("[AGUIHandler] run=%s reuse session=%s", input.RunID, sessionID)
			// 从持久化会话中恢复创建工作目录，保证 gatewayd 在该 session 生命周期内始终使用同一工作目录。
			if sess.WorkspacePath != "" {
				input.Workspace = sess.WorkspacePath
			}
			savedEarly = true
		} else {
			log.Printf("[AGUIHandler] run=%s session=%s not found, will create after run", input.RunID, sessionID)
			sessionID = ""
		}
	} else {
		sessionID = ""
	}

	// 从请求上下文中获取当前用户 ID，用于在 session 未命中时兜底解析 workspace 路径。
	userID, _ := middleware.UserIDFromContext(r.Context())
	// 确定本次 run 使用的 workspace 路径：优先使用 session 中保存的路径，否则按
	// workspace_root/{workspace_id}/{user_id} 实时解析。该路径会替换指令模板中的
	// {WORKSPACE_PATH} 占位符，避免 AI 把相对路径 projects/ 解析到 agent 的 cwd。
	workspacePath := input.Workspace
	if workspacePath == "" && workspaceID != "" && userID != "" && h.workspaceRoot != "" {
		resolved, err := resolveWorkspacePath(workspaceID, userID, h.workspaceRoot)
		if err != nil {
			log.Printf("[AGUIHandler] run=%s resolve workspace path failed: %v", input.RunID, err)
		} else {
			workspacePath = resolved
			input.Workspace = workspacePath
			log.Printf("[AGUIHandler] run=%s resolved workspace path: %s", input.RunID, workspacePath)
		}
	}

	// 保存用户输入消息（最后一条或全部用户消息）。
	// 对已知 session 提前保存；新 session 的实际 threadId 在 gatewayd 返回后才能确定，
	// 避免消息落到空 session 而丢失。message store 使用 upsert 语义，
	// 保证同一消息因重试或历史消息重复发送时内容最终一致。
	if savedEarly {
		h.saveUserMessages(r.Context(), sessionID, input.Messages, input.Context)
	}

	// 设置 SSE 响应头（提前设置，意图识别的闲聊回复也需要 SSE）。
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		log.Printf("[AGUIHandler] run=%s streaming unsupported", input.RunID)
		return
	}
	// 立即刷新 SSE 响应头，让前端 fetch() 能先拿到 HTTP 头部。
	flusher.Flush()

	// 保存原始用户消息的深拷贝，供后续落库使用。
	// interceptCommands / applyIntentCommand 会替换最后一条用户消息的内容，
	// 使用原始拷贝可保证持久化的是用户真实输入。
	originalMessages := cloneAGUIMessages(input.Messages)

	// 在执行指令模板替换前，先记录用户输入的斜杠指令名，用于后续进度反馈。
	slashCommand := ""
	for i := len(input.Messages) - 1; i >= 0; i-- {
		if input.Messages[i].Role != agui.RoleUser {
			continue
		}
		rawText := input.Messages[i].ContentText()
		original := extractOriginalUserPrompt(rawText)
		if original == "" {
			original = rawText
		}
		if cmd, _, ok := parseSlashCommand(original); ok {
			slashCommand = cmd
		}
		break
	}

	// 拦截斜杠指令（/prd-write、/proto-make 等），
	// 将用户消息替换为指令专属提示词模板。
	// 同时处理引用的任务卡片，将卡片信息注入提示词。
	// 在 saveUserMessages 之后执行，确保数据库保存的是用户原始输入。
	commandApplied, err := interceptCommands(input.Messages, input.Context, workspacePath, h.workItemSvc)
	if err != nil {
		log.Printf("[AGUIHandler] run=%s intercept commands failed: %v", input.RunID, err)
		h.writeEvent(w, flusher, agui.RunErrorEvent(fmt.Sprintf("intercept commands: %v", err), "COMMAND_FAILED"))
		return
	}
	// 将最终发送给 agent 的提示词写入调试文件，方便排查提示词是否过长或包含敏感路径。
	logPrompt(input.RunID, input.Messages)

	// 意图识别：用户未输入斜杠指令时，先调用 LLM 判断是闲聊还是任务意图。
	// 闲聊 → 直接返回 LLM 回复，不走正常 agent run。
	// 任务意图 → 映射到对应指令模板，再走正常 agent run。
	if !commandApplied {
		userInput := extractLastUserText(input.Messages)
		// 简单问候语直接返回静态回复，避免在 LLM/agent 不可用时进入长时间等待。
		if isGreeting(userInput) {
			log.Printf("[AGUIHandler] run=%s greeting matched, bypassing intent/agent run", input.RunID)
			h.streamChatResponse(context.Background(), w, flusher, greetingResponse(), sessionID, input.RunID)
			// 与正常 agent run 保持一致：更新会话活动时间并尝试生成标题。
			h.finalizeSession(context.Background(), sessionID, input.Messages)
			return
		}
		if userInput != "" {
			intentResult, err := recognizeIntent(r.Context(), h.aguiClient, userInput)
			if err != nil {
				log.Printf("[AGUIHandler] intent recognition failed, fallback to normal run: %v", err)
			} else if intentResult != nil {
				if intentResult.IsChat {
					// 闲聊：直接流式返回回复，不走 agent run。
					h.streamChatResponse(context.Background(), w, flusher, intentResult.Response, sessionID, input.RunID)
					// 与正常 agent run 保持一致：更新会话活动时间并尝试生成标题。
					h.finalizeSession(context.Background(), sessionID, input.Messages)
					return
				}
				// 任务意图：应用指令模板到用户消息。
				if err := applyIntentCommand(input.Messages, intentResult.Command, userInput, workspacePath, input.Context, h.workItemSvc); err != nil {
					log.Printf("[AGUIHandler] run=%s apply intent command failed: %v", input.RunID, err)
					h.writeEvent(w, flusher, agui.RunErrorEvent(fmt.Sprintf("apply intent command: %v", err), "INTENT_FAILED"))
					return
				}
				intentCommand = intentResult.Command
				slashCommand = intentResult.Command
				log.Printf("[AGUIHandler] intent mapped to command: %s", intentResult.Command)
			}
		}
	}

	// 无斜杠指令且无意图指令 → 纯聊天场景，若有引用任务卡片则注入卡片信息。
	if !commandApplied && intentCommand == "" {
		injectCardForChat(input.Messages, input.Context, h.workItemSvc, input.RunID)
	}

	// 检查 session 是否来自 gatewayd 不可达时的 fallback，避免向不存在的 gatewayd session 发送 run。
	if sessionID != "" {
		if sess, err := h.sessions.Get(context.Background(), sessionID); err == nil {
			if v, ok := sess.Context["gatewaydUnreachable"]; ok {
				if unreachable, _ := v.(bool); unreachable {
					log.Printf("[AGUIHandler] run=%s gatewayd unreachable for session %s, aborting run", input.RunID, sessionID)
					h.writeEvent(w, flusher, agui.RunErrorEvent("gatewayd unreachable, please create a new session", "GATEWAYD_UNREACHABLE"))
					return
				}
			}
		}
	}

	// gatewayd 在 /sessions/{id}/chat 中会先发送 RUN_STARTED，
	// 这里不再重复发送，避免前端收到重复的 run 开始事件。

	// 使用 background context 调用 gatewayd，确保前端断连后 gatewayd 继续运行。
	log.Printf("[AGUIHandler] run=%s >>> aguiClient.Run ENTER input.ThreadId=%q workspace=%q commandApplied=%v messageCount=%d",
		input.RunID, input.ThreadID, input.Workspace, commandApplied, len(input.Messages))
	actualThreadID, events, err := h.aguiClient.Run(context.Background(), input)
	if err != nil {
		log.Printf("[AGUIHandler] run=%s <<< aguiClient.Run FAILED after %v: %v", input.RunID, time.Since(reqStart), err)
		h.writeEvent(w, flusher, agui.RunErrorEvent(FormatGatewaydError(err), "RUN_FAILED"))
		return
	}
	log.Printf("[AGUIHandler] run=%s <<< aguiClient.Run OK actualThreadId=%s after %v",
		input.RunID, actualThreadID, time.Since(reqStart))

	// 确保后端 session 记录存在（新会话在发送第一条消息前已通过 /api/v1/sessions 创建，
	// 这里作为兜底，兼容直接调用 /api/v1/agent 的场景）。
	if err := h.ensureSession(context.Background(), actualThreadID, workspaceID); err != nil {
		log.Printf("[AGUIHandler] run=%s ensure session failed: %v", input.RunID, err)
	}
	sessionID = actualThreadID

	if actualThreadID != input.ThreadID {
		log.Printf("[AGUIHandler] run=%s threadID changed: %q -> %q, migrating messages",
			input.RunID, input.ThreadID, actualThreadID)
		if err := h.messages.MigrateMessages(context.Background(), input.ThreadID, actualThreadID); err != nil {
			log.Printf("[AGUIHandler] run=%s migrate messages failed: %v", input.RunID, err)
		}
		if oldSess, err := h.sessions.Get(context.Background(), input.ThreadID); err == nil && oldSess.Title != "" {
			_ = h.sessions.UpdateTitle(context.Background(), actualThreadID, oldSess.Title)
		}
		// 保留旧 session 不删除，避免前端在 RUN_STARTED 更新 threadId 前
		// 查询旧 session 时得到 404 —— 旧 session 变空但至少不会触发前端重建会话。
	}

	// 新 session 的实际 threadId 已确定，保存用户原始输入消息，避免直接调用 /api/v1/agent 时丢失首条消息。
	if !savedEarly {
		h.saveUserMessages(context.Background(), sessionID, originalMessages, input.Context)
	}

	// bgCtx 用于 buffer 和持久化操作，独立于 HTTP 请求生命周期。
	bgCtx := context.Background()

	finishTimer := time.NewTimer(finishWait)
	finishTimer.Stop()
	maxTimer := time.NewTimer(maxRunDuration)
	maxTimer.Stop()
	defer finishTimer.Stop()
	defer maxTimer.Stop()

	runState := &runState{
		pendingToolCallIDs: []string{},
	}

	// writeEvent 将事件写入前端 SSE 流并追加到 buffer（若启用）。
	// 返回错误，调用方可据此决定是否继续或仅记录日志。
	writeEvent := func(ev agui.Event) error {
		if h.buffer != nil {
			if err := h.buffer.Append(bgCtx, sessionID, ev); err != nil {
				log.Printf("[AGUIHandler] run=%s buffer append failed: %v", input.RunID, err)
			}
		}
		data, err := json.Marshal(ev)
		if err != nil {
			return fmt.Errorf("marshal event: %w", err)
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return fmt.Errorf("write event: %w", err)
		}
		flusher.Flush()
		return nil
	}

	// bufferEvent 仅将事件追加到 buffer，用于断连恢复路径。
	bufferEvent := func(ev agui.Event) {
		if h.buffer == nil {
			return
		}
		if err := h.buffer.Append(bgCtx, sessionID, ev); err != nil {
			log.Printf("[AGUIHandler] run=%s buffer append failed: %v", input.RunID, err)
		}
	}

	// checkpointRun 将当前 run 级累加器序列化后保存到 buffer，
	// 防止服务器崩溃导致未持久化的消息丢失。生产环境切换 Redis 后可跨重启恢复。
	checkpointRun := func() {
		if h.buffer == nil || sessionID == "" || input.RunID == "" {
			return
		}
		runState.bufMu.Lock()
		state, err := json.Marshal(runState.runParts)
		runState.bufMu.Unlock()
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
		runState.bufMu.Lock()
		parts := runState.runParts
		text := runState.runTextBuilder.String()
		msgID := runState.runMessageID
		runState.runParts = nil
		runState.runTextBuilder.Reset()
		runState.runMessageID = ""
		runState.bufMu.Unlock()

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
		if intentCommand != "" {
			cardType := strings.TrimPrefix(intentCommand, "/")
			cardType = strings.ReplaceAll(cardType, "-", "_")
			metadata["cardType"] = cardType
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

	// flushPendingState 将未闭合的 tool-call / text-message 状态强制结束。
	// writeToClient 为 true 时同时写入前端 SSE，false 时仅追加到 buffer。
	flushPendingState := func(writeToClient bool) {
		now := float64(time.Now().UnixMilli()) / 1000
		for _, id := range runState.pendingToolCallIDs {
			ev := agui.Event{
				Type:       agui.EventToolCallEnd,
				ToolCallID: id,
				Timestamp:  now,
			}
			if writeToClient {
				if err := writeEvent(ev); err != nil {
					log.Printf("[AGUIHandler] run=%s flush tool-call-end failed: %v", input.RunID, err)
				}
			} else {
				bufferEvent(ev)
			}
		}
		runState.pendingToolCallIDs = runState.pendingToolCallIDs[:0]
		runState.activeToolCallCount = 0

		if runState.activeTextMessageID != "" {
			ev := agui.Event{
				Type:      agui.EventTextMessageEnd,
				MessageID: runState.activeTextMessageID,
				Timestamp: now,
			}
			if writeToClient {
				if err := writeEvent(ev); err != nil {
					log.Printf("[AGUIHandler] run=%s flush text-message-end failed: %v", input.RunID, err)
				}
			} else {
				bufferEvent(ev)
			}
			runState.activeTextMessageID = ""
		}
	}

	// completeRun 在 run 正常结束时调用。
	completeRun := func() {
		finishTimer.Stop()
		maxTimer.Stop()
		flushPendingState(true)
		if err := writeEvent(agui.RunFinishedEvent(actualThreadID, input.RunID)); err != nil {
			log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", input.RunID, err)
		}
		persistRunAssistant()
		h.finalizeSession(bgCtx, sessionID, input.Messages)
	}

	// processEvent 更新一次 gatewayd 事件对应的 run 状态，并返回需要继续传播的事件列表。
	// 在断连恢复路径中，调用方仍可使用返回列表，但选择仅追加到 buffer 而非发送给前端。
	processEvent := func(ev agui.Event) []agui.Event {
		switch ev.Type {
		case agui.EventTextMessageStart:
			runState.activeTextMessageID = ev.MessageID
			runState.bufMu.Lock()
			if runState.runMessageID == "" {
				runState.runMessageID = ev.MessageID
			}
			runState.bufMu.Unlock()
		case agui.EventTextMessageContent:
			if ev.Delta == "" {
				return []agui.Event{}
			}
			runState.bufMu.Lock()
			if len(runState.runParts) == 0 || runState.runParts[len(runState.runParts)-1].Type != "text" {
				runState.runParts = append(runState.runParts, contentPart{Type: "text", Text: ev.Delta})
			} else {
				runState.runParts[len(runState.runParts)-1].Text += ev.Delta
			}
			runState.runTextBuilder.WriteString(ev.Delta)
			runState.bufMu.Unlock()
			checkpointRun()
		case agui.EventTextMessageEnd:
			runState.activeTextMessageID = ""
		case agui.EventThinkingTextMessageContent:
			if ev.Delta == "" {
				return []agui.Event{}
			}
			runState.bufMu.Lock()
			if len(runState.runParts) == 0 || runState.runParts[len(runState.runParts)-1].Type != "reasoning" {
				runState.runParts = append(runState.runParts, contentPart{Type: "reasoning", Text: ev.Delta})
			} else {
				runState.runParts[len(runState.runParts)-1].Text += ev.Delta
			}
			runState.bufMu.Unlock()
			checkpointRun()
		case agui.EventThinkingEnd:
			runState.bufMu.Lock()
			for i := len(runState.runParts) - 1; i >= 0; i-- {
				if runState.runParts[i].Type == "reasoning" {
					runState.runParts[i].Done = true
					break
				}
			}
			runState.bufMu.Unlock()
			checkpointRun()
		case agui.EventToolCallStart:
			runState.activeToolCallCount++
			runState.pendingToolCallIDs = append(runState.pendingToolCallIDs, ev.ToolCallID)
			runState.bufMu.Lock()
			runState.runParts = append(runState.runParts, contentPart{
				Type:       "tool-call",
				ToolCallID: ev.ToolCallID,
				ToolName:   ev.ToolCallName,
			})
			runState.bufMu.Unlock()
			checkpointRun()
		case agui.EventToolCallArgs:
			if len(runState.pendingToolCallIDs) > 0 {
				expectedID := runState.pendingToolCallIDs[len(runState.pendingToolCallIDs)-1]
				if ev.ToolCallID != expectedID {
					log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_ARGS id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
					ev.ToolCallID = expectedID
				}
			} else {
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_ARGS id=%s but no pending tool call", input.RunID, ev.ToolCallID)
			}
			if ev.Delta != "" {
				runState.bufMu.Lock()
				for i := len(runState.runParts) - 1; i >= 0; i-- {
					if runState.runParts[i].Type == "tool-call" && runState.runParts[i].ToolCallID == ev.ToolCallID {
						runState.runParts[i].ArgsText += ev.Delta
						break
					}
				}
				runState.bufMu.Unlock()
				checkpointRun()
			}
		case agui.EventToolCallEnd:
			if len(runState.pendingToolCallIDs) == 0 {
				log.Printf("[AGUIHandler] run=%s ignore orphan TOOL_CALL_END id=%s", input.RunID, ev.ToolCallID)
				return []agui.Event{}
			}
			expectedID := runState.pendingToolCallIDs[0]
			runState.pendingToolCallIDs = runState.pendingToolCallIDs[1:]
			if ev.ToolCallID != expectedID {
				log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_END id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
				ev.ToolCallID = expectedID
			}
			if runState.activeToolCallCount > 0 {
				runState.activeToolCallCount--
			}
		case agui.EventToolCallResult:
			var syntheticEnd *agui.Event
			if len(runState.pendingToolCallIDs) > 0 {
				expectedID := runState.pendingToolCallIDs[0]
				runState.pendingToolCallIDs = runState.pendingToolCallIDs[1:]
				if ev.ToolCallID != expectedID {
					log.Printf("[AGUIHandler] run=%s rewrite TOOL_CALL_RESULT id %s -> %s", input.RunID, ev.ToolCallID, expectedID)
					ev.ToolCallID = expectedID
				}
				syntheticEnd = &agui.Event{
					Type:       agui.EventToolCallEnd,
					ToolCallID: expectedID,
					Timestamp:  float64(time.Now().UnixMilli()) / 1000,
				}
				if runState.activeToolCallCount > 0 {
					runState.activeToolCallCount--
				}
			} else {
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_RESULT id=%s but no pending tool call", input.RunID, ev.ToolCallID)
			}
			if ev.ToolCallID != "" {
				runState.bufMu.Lock()
				for i := len(runState.runParts) - 1; i >= 0; i-- {
					if runState.runParts[i].Type == "tool-call" && runState.runParts[i].ToolCallID == ev.ToolCallID {
						runState.runParts[i].Result = ev.Content
						break
					}
				}
				runState.bufMu.Unlock()
				checkpointRun()
			}
			if syntheticEnd != nil {
				return []agui.Event{ev, *syntheticEnd}
			}
		}
		return []agui.Event{ev}
	}

	firstEventSeen := false
	firstContentSeen := false
	feedbackEmitted := false
	frontendDone := false
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				log.Printf("[AGUIHandler] run=%s event stream closed, total elapsed=%v totalEvents=%d",
					input.RunID, time.Since(reqStart), runState.eventCount)
				completeRun()
				return
			}
			runState.eventCount++
			if !firstEventSeen {
				firstEventSeen = true
				log.Printf("[AGUIHandler] run=%s first SSE event from gatewayd after %v: type=%s threadId=%s",
					input.RunID, time.Since(reqStart), ev.Type, ev.ThreadID)
				maxTimer.Reset(maxRunDuration)
				if !feedbackEmitted {
					feedbackEmitted = true
					if err := emitLongTaskFeedback(slashCommand, input.RunID, sessionID, writeEvent); err != nil {
						log.Printf("[AGUIHandler] run=%s emit long task feedback failed: %v", input.RunID, err)
					}
				}
			}
			switch ev.Type {
			case agui.EventThinkingStart:
				log.Printf("[AGUIHandler] run=%s THINKING_START after %v", input.RunID, time.Since(reqStart))
			case agui.EventTextMessageStart:
				log.Printf("[AGUIHandler] run=%s TEXT_MESSAGE_START (TTFT) after %v", input.RunID, time.Since(reqStart))
				runState.firstResponseSeen = true
			case agui.EventTextMessageContent:
				if !firstContentSeen {
					firstContentSeen = true
					log.Printf("[AGUIHandler] run=%s first TEXT_MESSAGE_CONTENT after %v", input.RunID, time.Since(reqStart))
				}
			case agui.EventToolCallStart:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_START id=%s tool=%s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, time.Since(reqStart))
				runState.firstResponseSeen = true
			case agui.EventToolCallResult:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_RESULT id=%s tool=%s result=%.200s after %v", input.RunID, ev.ToolCallID, ev.ToolCallName, ev.Content, time.Since(reqStart))
			case agui.EventRunStarted:
				log.Printf("[AGUIHandler] run=%s RUN_STARTED threadId=%s after %v", input.RunID, ev.ThreadID, time.Since(reqStart))
			case agui.EventRunFinished:
				log.Printf("[AGUIHandler] run=%s RUN_FINISHED threadId=%s after %v", input.RunID, ev.ThreadID, time.Since(reqStart))
				finishTimer.Stop()
				maxTimer.Stop()
				flushPendingState(true)
				if err := writeEvent(ev); err != nil {
					log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", input.RunID, err)
				}
				persistRunAssistant()
				h.finalizeSession(bgCtx, sessionID, input.Messages)
				return
			case agui.EventRunError:
				log.Printf("[AGUIHandler] run=%s RUN_ERROR after %v: %s", input.RunID, time.Since(reqStart), ev.Message)
				finishTimer.Stop()
				maxTimer.Stop()
				flushPendingState(true)
				if err := writeEvent(ev); err != nil {
					log.Printf("[AGUIHandler] run=%s write RUN_ERROR failed: %v", input.RunID, err)
				}
				persistRunAssistant()
				h.finalizeSession(bgCtx, sessionID, input.Messages)
				return
			}
			toEmit := processEvent(ev)
			for _, e := range toEmit {
				if err := writeEvent(e); err != nil {
					log.Printf("[AGUIHandler] run=%s write event failed: %v", input.RunID, err)
				}
			}
			if runState.firstResponseSeen {
				if runState.activeToolCallCount == 0 {
					finishTimer.Reset(finishWait)
				} else {
					finishTimer.Stop()
				}
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
				toEmit := processEvent(ev)
				for _, e := range toEmit {
					bufferEvent(e)
				}
			}
			// 缓冲最终合成事件并持久化。
			flushPendingState(false)
			bufferEvent(agui.RunFinishedEvent(actualThreadID, input.RunID))
			persistRunAssistant()
			h.finalizeSession(bgCtx, sessionID, input.Messages)
			return
		case <-finishTimer.C:
			log.Printf("[AGUIHandler] run=%s finish timer fired, total elapsed=%v", input.RunID, time.Since(reqStart))
			if runState.activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				for _, ev := range []agui.Event{
					{
						Type:      agui.EventTextMessageContent,
						MessageID: runState.activeTextMessageID,
						Delta:     "\n\n（模型响应超时或中断，请检查模型配置、网络或账户余额后重试。）",
						Timestamp: ts,
					},
					{
						Type:      agui.EventTextMessageEnd,
						MessageID: runState.activeTextMessageID,
						Timestamp: ts,
					},
				} {
					if err := writeEvent(ev); err != nil {
						log.Printf("[AGUIHandler] run=%s write timeout text event failed: %v", input.RunID, err)
					}
				}
				runState.activeTextMessageID = ""
			}
			flushPendingState(true)
			if err := writeEvent(agui.RunFinishedEvent(actualThreadID, input.RunID)); err != nil {
				log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", input.RunID, err)
			}
			persistRunAssistant()
			h.finalizeSession(bgCtx, sessionID, input.Messages)
			return
		case <-maxTimer.C:
			log.Printf("[AGUIHandler] run=%s max run duration reached, total elapsed=%v", input.RunID, time.Since(reqStart))
			if runState.activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				for _, ev := range []agui.Event{
					{
						Type:      agui.EventTextMessageContent,
						MessageID: runState.activeTextMessageID,
						Delta:     "\n\n（模型运行超过最大时长，已自动结束。）",
						Timestamp: ts,
					},
					{
						Type:      agui.EventTextMessageEnd,
						MessageID: runState.activeTextMessageID,
						Timestamp: ts,
					},
				} {
					if err := writeEvent(ev); err != nil {
						log.Printf("[AGUIHandler] run=%s write timeout text event failed: %v", input.RunID, err)
					}
				}
				runState.activeTextMessageID = ""
			}
			flushPendingState(true)
			if err := writeEvent(agui.RunFinishedEvent(actualThreadID, input.RunID)); err != nil {
				log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", input.RunID, err)
			}
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
func (h *AGUIHandler) ensureSession(ctx context.Context, sessionID, workspaceID string) error {
	if sessionID == "" {
		return nil
	}
	_, err := h.sessions.Get(ctx, sessionID)
	if err == nil {
		return nil
	}
	if workspaceID == "" {
		return fmt.Errorf("workspaceId is required")
	}
	sess := chat.Session{
		ID:          sessionID,
		WorkspaceID: workspaceID,
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
func (h *AGUIHandler) streamChatResponse(ctx context.Context, w http.ResponseWriter, flusher http.Flusher, response, sessionID, runID string) {
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
			log.Printf("[AGUIHandler] marshal chat event failed: %v", err)
			continue
		}
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()

		// 缓冲事件供前端重连时回放。
		if h.buffer != nil {
			if err := h.buffer.Append(ctx, sessionID, ev); err != nil {
				log.Printf("[AGUIHandler] buffer chat event failed: %v", err)
			}
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
		if err := h.messages.Append(ctx, sessionID, assistantMsg); err != nil {
			log.Printf("[AGUIHandler] save chat assistant message failed: %v", err)
		}
	}

	log.Printf("[AGUIHandler] chat response streamed: session=%s run=%s len=%d", sessionID, runID, len(response))
}

// generateMessageID 生成消息 ID。
func generateMessageID() string {
	return "msg-" + uuid.New().String()[:8]
}

// LONG_TASK_COMMANDS 需要在前端显示中间进度反馈的斜杠指令集合。
// 这些指令通常涉及文件写入、工程生成等长耗时操作，模型可能长时间无 text token 输出。
var LONG_TASK_COMMANDS = map[string]bool{
	"/proto-make":  true,
	"/code":        true,
	"/user-story":  true,
	"/prd-write":   true,
	"/prd-research": true,
	"/ui-kit":      true,
	"/test-case":   true,
	"/auto-test":   true,
	"/unit-test":   true,
}

// logPrompt 将最终发送给 agent 的提示词写入调试文件，避免主日志膨胀。
// 主日志只记录提示词长度和文件路径，排查时可直接查看对应文件。
func logPrompt(runID string, messages []agui.Message) {
	if runID == "" {
		return
	}
	dir := "/tmp/dh-prompts"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("[AGUIHandler] create prompt log dir failed: %v", err)
		return
	}
	path := filepath.Join(dir, runID+".txt")
	f, err := os.Create(path)
	if err != nil {
		log.Printf("[AGUIHandler] create prompt log file failed: %v", err)
		return
	}
	defer f.Close()

	var totalLen int
	for i, m := range messages {
		text := m.ContentText()
		totalLen += len(text)
		fmt.Fprintf(f, "--- Message %d (%s) ---\n%s\n\n", i+1, m.Role, text)
	}
	log.Printf("[AGUIHandler] prompt logged to %s, messages=%d totalChars=%d", path, len(messages), totalLen)
}

// emitLongTaskFeedback 对长耗时指令发送合成进度反馈，避免前端长时间显示"思考中"。
// 收到第一个 SSE 事件后即发送，告诉用户任务已启动并正在执行。
func emitLongTaskFeedback(command, runID, sessionID string, writeEvent func(agui.Event) error) error {
	if command == "" || !LONG_TASK_COMMANDS[command] {
		return nil
	}
	label := map[string]string{
		"/proto-make":  "正在生成原型工程",
		"/code":        "正在编写代码",
		"/user-story":  "正在拆分用户故事",
		"/prd-write":   "正在撰写 PRD",
		"/prd-research": "正在进行技术调研",
		"/ui-kit":      "正在生成 UI 组件库规范",
		"/test-case":   "正在生成测试用例",
		"/auto-test":   "正在生成自动化脚本",
		"/unit-test":   "正在生成单元测试",
	}[command]
	if label == "" {
		label = "正在处理任务"
	}

	msgID := "feedback-" + runID[:8]
	ts := float64(time.Now().UnixMilli()) / 1000
	// 先发送一个独立的 thinking 内容，前端会把它渲染为 reasoning 部件。
	if err := writeEvent(agui.Event{
		Type:      agui.EventThinkingTextMessageContent,
		MessageID: msgID,
		Delta:     fmt.Sprintf("%s，可能需要一些时间，请稍候...", label),
		Timestamp: ts,
		ThreadID:  sessionID,
		RunID:     runID,
	}); err != nil {
		return err
	}
	return writeEvent(agui.Event{
		Type:      agui.EventThinkingEnd,
		MessageID: msgID,
		Timestamp: ts + 0.001,
		ThreadID:  sessionID,
		RunID:     runID,
	})
}
