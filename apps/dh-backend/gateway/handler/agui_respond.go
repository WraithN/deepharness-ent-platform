package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

const fallbackMsgHistoryLimit = 100
const respondRequestTimeout = 10 * time.Second

type respondToAgentResponse struct {
	Status     string `json:"status"`
	RunID      string `json:"runId,omitempty"`
	ThreadID   string `json:"threadId,omitempty"`
	InstanceID string `json:"instanceId,omitempty"`
	Fallback   bool   `json:"fallback"`
}

// QuickComplete 将 prompt 转发给 agent 运行时做一次同步短文本补全，返回纯文本结果。
// agentKey 为空时使用 handler 默认 pluginKey（通常为 opencode）。
func (h *AGUIHandler) QuickComplete(ctx context.Context, prompt, agentKey string) (string, error) {
	return h.resolveAGUIClient(ctx).QuickComplete(ctx, prompt, agentKey)
}

type respondToAgentRequest struct {
	ThreadID   string `json:"threadId"`
	InstanceID string `json:"instanceId"`
	Message    string `json:"message"`
}

// RespondToAgent 处理前端对 agent.question 的回复，转发给 gatewayd 继续执行。
// 优先使用会话持久化的 GatewaydAgentID 作为实际 instance id（gatewayd 对 agent.question 事件中的
// instance_id 字段可能是 opencode/opencode-1，而前端误用 payload.instanceId 可能拿到 UUID，导致 404）。
// 当直接 Respond 失败后，先通过 RespondAndListen 尝试复用原实例；仍失败才回退到全新 run。
func (h *AGUIHandler) RespondToAgent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, ErrCodeGeneral, "method not allowed")
		return
	}
	var req respondToAgentRequest
	if !DecodeJSONBody(w, r, &req) {
		return
	}
	if req.ThreadID == "" || req.InstanceID == "" {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeUnauthorized, "threadId and instanceId are required")
		return
	}

	ctx := context.Background()

	// 从会话记录中读取真实的 gatewayd agent instance id，覆盖前端可能错误的 UUID。
	effectiveInstanceID := req.InstanceID
	if oldSess, sessErr := h.sessions.Get(ctx, req.ThreadID); sessErr == nil && oldSess.GatewaydAgentID != "" {
		if oldSess.GatewaydAgentID != req.InstanceID {
			log.Printf("[AGUIHandler] RespondToAgent override frontend instanceId=%s with session gatewaydAgentID=%s thread=%s",
				req.InstanceID, oldSess.GatewaydAgentID, req.ThreadID)
		}
		effectiveInstanceID = oldSess.GatewaydAgentID
	}

	// 直接 Respond 通常应该很快返回；如果 gatewayd 实例已死亡/卡住，不要无限等待。
	// 超时后转为 fallback run，由后端主动启动新 run 继续对话，避免前端长时间"思考中"。
	respondCtx, cancel := context.WithTimeout(r.Context(), respondRequestTimeout)
	defer cancel()
	log.Printf("[AGUIHandler] RespondToAgent direct respond start: thread=%s instance=%s timeout=%v",
		req.ThreadID, effectiveInstanceID, respondRequestTimeout)
	directErr := h.resolveAGUIClient(r.Context()).Respond(respondCtx, req.ThreadID, effectiveInstanceID, req.Message)
	if directErr == nil {
		log.Printf("[AGUIHandler] RespondToAgent direct respond ok: thread=%s instance=%s", req.ThreadID, effectiveInstanceID)
		SetJSONHeader(w)
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(respondToAgentResponse{Status: "ok"})
		return
	}
	log.Printf("[AGUIHandler] RespondToAgent direct respond failed, trying RespondAndListen: thread=%s instance=%s err=%v",
		req.ThreadID, effectiveInstanceID, directErr)

	// 直接 Respond 失败后，先尝试通过 WebSocket 事件流复用原实例，避免重建 agent 重新读代码/思考。
	h.respondAndListenFallback(w, r, req, effectiveInstanceID)
}

// respondAndListenFallback 在直接 Respond 失败后尝试复用原 gatewayd 实例：
// 先建立 WebSocket 事件流监听，再调用 Respond，把事件捕获到 SSE buffer 供前端重放。
// 如果仍然失败，最后回退到 fallbackRunForRespond（创建新 thread）。
func (h *AGUIHandler) respondAndListenFallback(w http.ResponseWriter, r *http.Request, req respondToAgentRequest, effectiveInstanceID string) {
	ctx := context.Background()
	listenCtx, listenCancel := context.WithTimeout(ctx, respondRequestTimeout)
	defer listenCancel()

	events, closeConn, err := h.resolveAGUIClient(ctx).RespondAndListen(listenCtx, req.ThreadID, effectiveInstanceID, req.Message)
	if err != nil {
		log.Printf("[AGUIHandler] RespondAndListen failed, falling back to new-thread run: thread=%s instance=%s err=%v",
			req.ThreadID, effectiveInstanceID, err)
		h.fallbackRunForRespond(w, r, req)
		return
	}

	runID := idutil.GenerateID()
	go h.bufferRespondAndListenEvents(ctx, events, closeConn, req.ThreadID, runID, effectiveInstanceID)

	SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(respondToAgentResponse{
		Status:     "ok",
		RunID:      runID,
		ThreadID:   req.ThreadID,
		InstanceID: effectiveInstanceID,
		Fallback:   true,
	})
	log.Printf("[AGUIHandler] RespondAndListen started: thread=%s run=%s instance=%s", req.ThreadID, runID, effectiveInstanceID)
}

// bufferRespondAndListenEvents 在后台 goroutine 中读取 RespondAndListen 事件流，
// 将事件写入 SSE buffer 供前端重放，并在流结束时持久化 assistant 文本消息。
func (h *AGUIHandler) bufferRespondAndListenEvents(ctx context.Context, events <-chan agui.Event, closeConn func(), threadID, runID, instanceID string) {
	defer closeConn()

	bgCtx := context.Background()
	var textBuilder strings.Builder
	var msgID string
	sawRunFinished := false
	sawRunError := false

	for ev := range events {
		if ev.ThreadID == "" {
			ev.ThreadID = threadID
		}
		if ev.RunID == "" {
			ev.RunID = runID
		}
		log.Printf("[AGUIHandler] RespondAndListen event received: thread=%s run=%s type=%s name=%s msgId=%s", threadID, runID, ev.Type, ev.Name, ev.MessageID)
		if h.buffer != nil {
			if err := h.buffer.Append(bgCtx, threadID, ev); err != nil {
				log.Printf("[AGUIHandler] RespondAndListen buffer append failed: thread=%s run=%s type=%s err=%v", threadID, runID, ev.Type, err)
			}
		}

		switch ev.Type {
		case agui.EventTextMessageStart:
			msgID = ev.MessageID
		case agui.EventTextMessageContent:
			textBuilder.WriteString(ev.Delta)
		case agui.EventRunFinished:
			sawRunFinished = true
		case agui.EventRunError:
			sawRunError = true
		}
	}
	log.Printf("[AGUIHandler] RespondAndListen event channel closed: thread=%s run=%s textLen=%d", threadID, runID, textBuilder.Len())

	if !sawRunFinished && !sawRunError {
		if h.buffer != nil {
			_ = h.buffer.Append(bgCtx, threadID, agui.RunFinishedEvent(threadID, runID))
		}
	}

	text := textBuilder.String()
	if text != "" {
		finalMsgID := msgID
		if finalMsgID == "" {
			finalMsgID = idutil.GenerateID()
		}
		msg := chat.Message{
			ID:        finalMsgID,
			SessionID: threadID,
			Role:      "assistant",
			Type:      "text",
			Content:   text,
			Metadata:  map[string]any{},
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(bgCtx, threadID, msg); err != nil {
			log.Printf("[AGUIHandler] RespondAndListen persist assistant message failed: %v", err)
		} else {
			log.Printf("[AGUIHandler] RespondAndListen persist assistant message ok: id=%s textLen=%d", finalMsgID, len(text))
		}
	}

	_ = h.sessions.UpdateActivity(bgCtx, threadID)
	log.Printf("[AGUIHandler] RespondAndListen buffering finished: thread=%s run=%s", threadID, runID)
}

// fallbackRunForRespond 在 gatewayd Respond 不可用或超时时作为回退：收集会话上下文后
// 启动新的 agent run，将用户回答与历史消息一并下发，事件通过 SSE buffer 供前端重放。
func (h *AGUIHandler) fallbackRunForRespond(w http.ResponseWriter, r *http.Request, req respondToAgentRequest) {
	userID, _ := middleware.UserIDFromContext(r.Context())

	// 原请求上下文可能已经超时，回退流程使用独立后台上下文，避免 DB 操作被取消。
	// 但需保留原请求中 containerMW 注入的 per-user stubclient，否则 ensureWorkspaceDir
	// 会降级到 default stubclient（slot 0），在 direct-host 模式下可能因 slot 0 未启动而失败。
	ctx := context.Background()
	if sc := stubclient.FromContext(r.Context()); sc != nil {
		ctx = stubclient.WithClient(ctx, sc)
	}

	oldSess, sessErr := h.sessions.Get(ctx, req.ThreadID)
	workspaceID := ""
	oldContext := map[string]any{}
	if sessErr == nil {
		workspaceID = oldSess.WorkspaceID
		if oldSess.Context != nil {
			oldContext = oldSess.Context
		}
	} else {
		log.Printf("[AGUIHandler] fallback: session=%s not found, proceeding without workspace context", req.ThreadID)
	}

	workspacePath := ""
	if workspaceID != "" && userID != "" {
		resolved, resolveErr := resolveWorkspacePath(ctx, workspaceID, userID, h.workspaceRoot)
		if resolveErr == nil {
			workspacePath = resolved
		} else {
			log.Printf("[AGUIHandler] fallback: resolve workspace path failed: %v", resolveErr)
		}
	}

	history, _ := h.messages.GetHistory(ctx, req.ThreadID, fallbackMsgHistoryLimit)

	// 从旧会话历史中恢复上下文项（任务卡片、代码库等），确保 fallback run 与原始 run 有相同的上下文。
	ctxItems := extractContextItemsFromHistory(history)

	// 使用原始 run 的 agent 插件 key，避免 fallback run 误用默认 agent。
	agentKey := ""
	if v, ok := oldContext["pluginKey"].(string); ok && v != "" {
		agentKey = v
	}

	answerMessage := agui.UserMessage("", req.Message)

	messages := make([]agui.Message, 0, len(history)+2)
	for _, hm := range history {
		role := agui.MessageRole(hm.Role)
		if role == "" {
			role = agui.RoleUser
		}
		content := json.RawMessage(fmt.Sprintf("%q", hm.Content))
		messages = append(messages, agui.Message{
			Role:    role,
			ID:      hm.ID,
			Content: content,
		})
	}
	messages = append(messages, answerMessage)

	// gatewayd/opencode 的 question 工具会结束当前 run，respond 后 fallback 启动新 run。
	// 新 run 中 agent 可能把用户回答当作最终指令而提前开始生成文档、探索代码或忘记使用 question 工具。
	// 用最强制的 developer 提示重申当前所处阶段、输出格式和绝对禁止事项。
	// 提问约束与前端提问卡片渲染约定对齐：每轮一问、全程中文、必须附 2~3 个参考选项
	// （question 工具的 options 与文本 "A. xxx" 选项均需给出，供前端解析为可点选按钮）。
	continueReminder := `【系统强制指令 - 最高优先级】
你当前处于需求澄清流程的“继续提问”阶段。
上一条消息是用户对上一个问题的回答， ONLY 用于澄清需求，不是新任务，不是开发指令，不是要求你立即实现或探索代码。
你的唯一任务是：根据用户回答，继续提出下一个澄清问题。

绝对禁止：
1. 调用任何工具（read/grep/glob/bash/write/edit/apply_diff 等）。
2. 探索代码库、查看文件、搜索文件、分析实现细节。
3. 生成文档、设计实现方案、输出代码、输出架构分析。
4. 输出任何英文思考过程、分析、解释、总结。

输出必须严格遵循：
1. 先用一句中文确认用户回答。
2. 然后输出下一个问题正文（必须以 ? 或 ？ 结尾），提问与选项全程使用中文，禁止英文提问。
3. 然后输出 2-3 个选项，每个选项一行，格式为：A. 选项说明。
4. 最后立即调用 question 工具，参数 questions[0].question 只填问题正文，questions[0].options 必须填 2~3 个参考选项（与上面的文本选项一致），禁止空数组。

示例：
收到，核心场景已明确。
下一个问题：请确认导出数据的时间范围？
A. 仅导出当前筛选条件下的数据
B. 导出过去 7 天的数据
C. 导出过去 30 天的数据

在所有维度澄清完成前，禁止任何工具调用和任何实现/探索行为。重复：不要探索代码，不要生成文档，只提问。`
	messages = append(messages, agui.Message{
		Role:    agui.RoleDeveloper,
		ID:      idutil.GenerateID(),
		Content: json.RawMessage(fmt.Sprintf("%q", continueReminder)),
	})

	sessionID := req.ThreadID

	// 保存用户回答消息到原 session；同时把恢复出的上下文项存入 metadata，方便后续再次 fallback。
	h.saveUserMessages(ctx, sessionID, []agui.Message{answerMessage}, ctxItems)

	runID := idutil.GenerateID()
	fallbackInstanceID := idutil.GenerateID()
	fallbackInput := agui.RunAgentInput{
		ThreadID:  sessionID,
		RunID:     runID,
		Messages:  messages,
		Context:   ctxItems,
		Workspace: workspacePath,
		AgentKey:  agentKey,
	}

	log.Printf("[AGUIHandler] fallbackRunForRespond: starting fallback run=%s thread=%s msgCount=%d contextCount=%d agentKey=%s",
		runID, sessionID, len(messages), len(ctxItems), agentKey)
	// 优先在原 thread 上强制替换 agent 实例继续运行，避免新建 thread 导致上下文迁移与冷启动。
	go h.runFallback(userID, fallbackInput, sessionID, fallbackInstanceID, true)

	SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(respondToAgentResponse{
		Status:     "ok",
		RunID:      runID,
		ThreadID:   sessionID,
		InstanceID: fallbackInstanceID,
		Fallback:   true,
	})
}

// createFallbackThread 在旧 session 不可复用时创建新 thread，并迁移消息与上下文。
func (h *AGUIHandler) createFallbackThread(ctx context.Context, oldSessionID string) (newThreadID string, err error) {
	newThreadID, err = h.resolveAGUIClient(ctx).CreateThread(ctx, "")
	if err != nil {
		return "", err
	}
	log.Printf("[AGUIHandler] fallback run: created new thread %s -> %s", oldSessionID, newThreadID)

	if err := h.messages.MigrateMessages(ctx, oldSessionID, newThreadID); err != nil {
		log.Printf("[AGUIHandler] fallback run: migrate messages failed: %v", err)
	}

	oldSess, _ := h.sessions.Get(ctx, oldSessionID)
	if oldSess.Title != "" {
		_ = h.sessions.UpdateTitle(ctx, newThreadID, oldSess.Title)
	}
	if err := h.sessions.Create(ctx, chat.Session{
		ID:          newThreadID,
		WorkspaceID: oldSess.WorkspaceID,
		AgentID:     "agent-default",
		AgentType:   "chat",
		Context:     oldSess.Context,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}); err != nil && !errors.Is(err, common.ErrAlreadyExists) {
		log.Printf("[AGUIHandler] fallback run: create new session record failed: %v", err)
	}
	return newThreadID, nil
}

// extractContextItemsFromHistory 从历史消息 metadata 中恢复上下文项（quotedCard / selectedRepos），
// 用于 fallback run 保持与原始 run 相同的上下文。
func extractContextItemsFromHistory(history []chat.Message) []agui.ContextItem {
	var items []agui.ContextItem
	for _, m := range history {
		if m.Role != "user" && m.Role != string(agui.RoleUser) {
			continue
		}
		if m.Metadata == nil {
			continue
		}
		added := false
		if raw, ok := m.Metadata["quotedCard"]; ok {
			data, _ := json.Marshal(raw)
			if len(data) > 0 {
				items = append(items, agui.ContextItem{Name: "quotedCard", Value: data})
				added = true
			}
		}
		if raw, ok := m.Metadata["selectedRepos"]; ok {
			data, _ := json.Marshal(raw)
			if len(data) > 0 {
				items = append(items, agui.ContextItem{Name: "selectedRepos", Value: data})
				added = true
			}
		}
		if added {
			break
		}
	}
	return items
}

// runFallback 在独立 goroutine 中执行回退 agent run：
//  1. 优先尝试在原 thread 上强制替换 agent 实例（trySameThread=true），避免新建 thread 导致上下文迁移；
//  2. 若原 thread 失败，则创建新 thread 并迁移消息后重试；
//  3. 调用 aguiClient.Run 获取事件流；
//  4. 过滤掉思考过程，对 assistant 文本做“问题 + 选项”解析；
//  5. 如果 agent 未发出 agent.question 自定义事件，则补发一个合成的 agent.question 事件，
//     并把 assistant 文本裁剪为仅展示问题与选项，保证前端能渲染内联问题卡片；
//  6. 缓冲最终事件到 SSE buffer 供前端轮询重放，并持久化简化的 assistant 消息。
func (h *AGUIHandler) runFallback(userID string, input agui.RunAgentInput, sessionID, fallbackInstanceID string, trySameThread bool) {
	bgCtx := context.Background()
	log.Printf("[AGUIHandler] fallback run: starting run=%s originalThread=%s trySameThread=%v msgCount=%d",
		input.RunID, sessionID, trySameThread, len(input.Messages))

	activeSessionID := sessionID
	activeThreadID := input.ThreadID

	if trySameThread && activeThreadID != "" {
		// 强制替换原 thread 上的 agent 实例，避免旧实例占用 session 导致新 run 被排队。
		h.resolveAGUIClient(bgCtx).ForgetThread(activeThreadID)
		attachCtx, cancel := context.WithTimeout(bgCtx, 2*time.Minute)
		attachErr := h.resolveAGUIClient(attachCtx).AttachAgent(attachCtx, activeThreadID, true, input.Workspace)
		cancel()
		if attachErr != nil {
			log.Printf("[AGUIHandler] fallback run: force attach on same thread failed: %v", attachErr)
		} else {
			log.Printf("[AGUIHandler] fallback run: force attach on same thread succeeded")
		}
	}

	actualThreadID, events, err := h.resolveAGUIClient(bgCtx).Run(bgCtx, input)
	if err != nil {
		log.Printf("[AGUIHandler] fallback run: run failed on thread=%s: %v", activeThreadID, err)
		if trySameThread && activeSessionID != "" {
			log.Printf("[AGUIHandler] fallback run: retrying on new thread after same-thread failure")
			newThreadID, createErr := h.createFallbackThread(bgCtx, activeSessionID)
			if createErr != nil {
				log.Printf("[AGUIHandler] fallback run: create new thread failed: %v", createErr)
				if h.buffer != nil {
					_ = h.buffer.Append(bgCtx, activeSessionID, agui.RunErrorEvent(
						FormatGatewaydError(err), "FALLBACK_RUN_FAILED",
					))
				}
				return
			}
			activeSessionID = newThreadID
			activeThreadID = newThreadID
			input.ThreadID = newThreadID
			actualThreadID, events, err = h.resolveAGUIClient(bgCtx).Run(bgCtx, input)
			if err != nil {
				log.Printf("[AGUIHandler] fallback run: run failed on new thread=%s: %v", newThreadID, err)
				if h.buffer != nil {
					_ = h.buffer.Append(bgCtx, activeSessionID, agui.RunErrorEvent(
						FormatGatewaydError(err), "FALLBACK_RUN_FAILED",
					))
				}
				return
			}
			log.Printf("[AGUIHandler] fallback run: agent started on new thread run=%s actualThread=%s", input.RunID, actualThreadID)
		} else {
			if h.buffer != nil {
				_ = h.buffer.Append(bgCtx, activeSessionID, agui.RunErrorEvent(
					FormatGatewaydError(err), "FALLBACK_RUN_FAILED",
				))
			}
			return
		}
	}
	log.Printf("[AGUIHandler] fallback run: agent started run=%s actualThread=%s", input.RunID, actualThreadID)

	if activeSessionID != "" && activeSessionID != actualThreadID {
		h.migrateThreadIfNeeded(bgCtx, input.RunID, activeSessionID, actualThreadID)
		activeSessionID = actualThreadID
	}

	var textBuilder strings.Builder
	var msgID string
	sawQuestionEvent := false
	var collectedEvents []agui.Event

	for ev := range events {
		log.Printf("[AGUIHandler] fallback run event received: run=%s type=%s name=%s msgId=%s thread=%s",
			input.RunID, ev.Type, ev.Name, ev.MessageID, ev.ThreadID)

		// 思考过程不展示给用户，也不写入 buffer；但仍记录文本内容用于最后解析。
		if ev.Type == agui.EventThinkingStart || ev.Type == agui.EventThinkingEnd ||
			ev.Type == agui.EventThinkingTextMessageStart || ev.Type == agui.EventThinkingTextMessageContent || ev.Type == agui.EventThinkingTextMessageEnd {
			continue
		}

		// 文本内容先累积，最后再统一输出（避免与实时流重复）。
		if ev.Type == agui.EventTextMessageStart {
			msgID = ev.MessageID
			continue
		}
		if ev.Type == agui.EventTextMessageContent {
			textBuilder.WriteString(ev.Delta)
			continue
		}
		if ev.Type == agui.EventTextMessageEnd {
			continue
		}

		// 关键事件（agent.question / 生命周期 / 工具事件）立即写入 buffer，
		// 使前端在 run 未结束时也能看到问题卡片或状态变化。
		if ev.Type == agui.EventCustom && ev.Name == "agent.question" {
			sawQuestionEvent = true
		}
		if h.buffer != nil {
			if err := h.buffer.Append(bgCtx, activeSessionID, ev); err != nil {
				log.Printf("[AGUIHandler] fallback run buffer append failed: run=%s type=%s err=%v", input.RunID, ev.Type, err)
			}
		}
		collectedEvents = append(collectedEvents, ev)
	}
	log.Printf("[AGUIHandler] fallback run event channel closed: run=%s textLen=%d collectedEvents=%d sawQuestionEvent=%v thread=%s",
		input.RunID, textBuilder.Len(), len(collectedEvents), sawQuestionEvent, activeSessionID)

	text := textBuilder.String()
	questionPayload := parseQuestionFromText(text)

	finalMsgID := msgID
	if finalMsgID == "" {
		finalMsgID = idutil.GenerateID()
	}
	finalText := text

	if questionPayload != nil && !sawQuestionEvent {
		finalText = formatQuestionText(questionPayload)
		qev := questionPayload.toEvent(activeSessionID, input.RunID, fallbackInstanceID)
		if h.buffer != nil {
			_ = h.buffer.Append(bgCtx, activeSessionID, qev)
		}
		log.Printf("[AGUIHandler] fallback run: emitted synthetic agent.question for run=%s question=%.50s options=%d",
			input.RunID, questionPayload.Question, len(questionPayload.Options))
	}

	if finalText != "" {
		if h.buffer != nil {
			_ = h.buffer.Append(bgCtx, activeSessionID, agui.TextMessageStartEvent(finalMsgID, "assistant"))
			_ = h.buffer.Append(bgCtx, activeSessionID, agui.TextMessageContentEvent(finalMsgID, finalText))
			_ = h.buffer.Append(bgCtx, activeSessionID, agui.TextMessageEndEvent(finalMsgID))
		}
	}

	// 如果事件流正常以 RUN_FINISHED / RUN_ERROR 结束，则已经在循环中写入 buffer；
	// 否则补发 RUN_FINISHED，避免前端一直轮询等待。
	var lastEvent *agui.Event
	if len(collectedEvents) > 0 {
		lastEvent = &collectedEvents[len(collectedEvents)-1]
	}
	if lastEvent == nil || (lastEvent.Type != agui.EventRunFinished && lastEvent.Type != agui.EventRunError) {
		if h.buffer != nil {
			if err := h.buffer.Append(bgCtx, activeSessionID, agui.RunFinishedEvent(actualThreadID, input.RunID)); err != nil {
				log.Printf("[AGUIHandler] fallback run append RUN_FINISHED failed: run=%s err=%v", input.RunID, err)
			}
		}
		log.Printf("[AGUIHandler] fallback run: appended trailing RUN_FINISHED: run=%s thread=%s", input.RunID, activeSessionID)
	}

	if activeSessionID != "" && finalText != "" {
		msg := chat.Message{
			ID:        finalMsgID,
			SessionID: activeSessionID,
			Role:      "assistant",
			Type:      "text",
			Content:   finalText,
			Metadata:  map[string]any{},
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(bgCtx, activeSessionID, msg); err != nil {
			log.Printf("[AGUIHandler] fallback persist assistant message failed: %v", err)
		} else {
			log.Printf("[AGUIHandler] fallback persist assistant message ok: id=%s textLen=%d", finalMsgID, len(finalText))
		}
	}

	_ = h.sessions.UpdateActivity(bgCtx, activeSessionID)
	log.Printf("[AGUIHandler] fallback run finished: run=%s thread=%s", input.RunID, activeSessionID)
}
