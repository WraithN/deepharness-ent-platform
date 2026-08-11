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

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

// contentPart 描述 assistant 消息的一个结构化内容部件，用于落库到 message.metadata，
// 前端恢复历史时据此重建 reasoning / tool-call / text 部件。
type contentPart struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	MessageID  string `json:"messageId,omitempty"`
	ToolCallID string `json:"toolCallId,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	ArgsText   string `json:"argsText,omitempty"`
	// Result 不使用 omitempty：空结果也需要持久化，
	// 否则历史恢复时 result 为 undefined，前端误判为"执行中"。
	Result string `json:"result"`
	Done   bool   `json:"done,omitempty"`
}

// runState 保存一次 agent run 在处理过程中的可变状态，
// 供主循环与前端断连后的后台恢复路径共享。
type runState struct {
	bufMu               sync.Mutex
	eventCount          int
	activeToolCallCount int
	pendingToolCallIDs  []string
	// endedToolCallIDs 跟踪已收到 END 但尚未收到 RESULT 的工具调用 ID。
	// flushPendingState 会为这些 ID 补发合成 RESULT，防止前端永久卡在"执行中"。
	endedToolCallIDs    []string
	activeTextMessageID string
	firstResponseSeen   bool
	runParts            []contentPart
	runTextBuilder      strings.Builder
	runMessageID        string
}

// agentRunStream 封装一次 agent run 的事件流处理上下文。
// 将原 AgentRun 中相互引用的闭包（writeEvent / processEvent / flushPendingState /
// persistRunAssistant / emitProtoFallbackMarker 等）收敛为方法，
// 避免主函数持有大量闭包变量，同时保证状态在主循环与后台恢复路径间正确共享。
type agentRunStream struct {
	h             *AGUIHandler
	w             http.ResponseWriter
	flusher       http.Flusher
	input         agui.RunAgentInput
	sessionID     string
	actualThread  string
	intentCommand string
	slashCommand  string
	workspacePath string
	reqStart      time.Time
	bgCtx         context.Context
	state         *runState
	finishTimer   *time.Timer
	maxTimer      *time.Timer
	// workitemID 当前 run 关联的需求 ID（从 quotedCard 提取），供 commit 记录使用
	workitemID    string
}

// AgentRun 是 POST /api/v1/agent 处理器。
// 接收 RunAgentInput，转发到 ent-desktop gatewayd，并以 SSE 流回传 AG-UI 事件。
// 主函数仅做线性阶段编排，具体逻辑见各阶段子方法。
func (h *AGUIHandler) AgentRun(w http.ResponseWriter, r *http.Request) {
	reqStart := time.Now()

	// 阶段1：请求解析与校验（HTTP 方法、body、runID 生成）。
	input, workspaceID, ok := h.parseAndValidateRunRequest(w, r)
	if !ok {
		return
	}

	// 阶段2：session 复用/创建决策。
	sessionID, savedEarly := h.resolveSessionReuse(r.Context(), input)

	// 阶段3：workspace 路径解析（实时按 user_id/workspace_id 解析，不依赖 session 旧路径）。
	workspacePath := h.resolveRunWorkspace(r, input.RunID, workspaceID)
	input.Workspace = workspacePath

	// 阶段4：已知 session 提前持久化用户消息；新 session 等 gatewayd 返回 threadId 后再保存，
	// 避免消息落到空 session 而丢失。
	if savedEarly {
		h.saveUserMessages(r.Context(), sessionID, input.Messages, input.Context)
	}

	// 阶段5：SSE 握手（响应头、flusher）。
	flusher, ok := prepareSSEStream(w, input.RunID)
	if !ok {
		return
	}

	// 保存原始用户消息的深拷贝，供后续落库使用。
	// interceptCommands / applyIntentCommand 会替换最后一条用户消息的内容，
	// 使用原始拷贝可保证持久化的是用户真实输入。
	originalMessages := cloneAGUIMessages(input.Messages)
	slashCommand := extractSlashCommand(input.Messages)

	// 阶段6：斜杠指令拦截 + 意图识别。abort=true 表示已写入终态响应（闲聊/错误），直接返回。
	commandApplied, intentCommand, slashCommand, abort := h.applyCommandsAndIntent(
		r, w, flusher, &input, workspacePath, workspaceID, slashCommand, sessionID)
	if abort {
		return
	}

	// 阶段7：gatewayd 不可达兜底检查。
	if h.abortIfGatewaydUnreachable(r.Context(), w, flusher, sessionID, input.RunID) {
		return
	}

	// 阶段8：调用 gatewayd 执行 agent run，获取事件流。
	actualThreadID, events, ok := h.executeAgentRun(r.Context(), w, flusher, input, reqStart, commandApplied, workspaceID)
	if !ok {
		return
	}

	// 兜底保证后端 session 记录存在（兼容直接调用 /api/v1/agent 的场景）。
	if err := h.ensureSession(r.Context(), actualThreadID, workspaceID); err != nil {
		log.Printf("[AGUIHandler] run=%s ensure session failed: %v", input.RunID, err)
	}
	sessionID = actualThreadID

	// 阶段9：threadId 变更时迁移消息与标题。
	h.migrateThreadIfNeeded(r.Context(), input.RunID, input.ThreadID, actualThreadID)

	// 新 session 的实际 threadId 已确定，保存用户原始输入消息。
	if !savedEarly {
		h.saveUserMessages(r.Context(), sessionID, originalMessages, input.Context)
	}

	// 从本次 run 的 context 提取 quotedCard，持久化会话关联的需求 ID（首条引用锁定）。
	// 提取失败或持久化失败均不阻断主流程，仅记录日志：需求关联为增强信息，不影响 run 正常执行。
	runWorkitemID := ""
	if card, hasCard, cardErr := extractQuotedCard(input.Context); cardErr != nil {
		log.Printf("[AGUIHandler] run=%s extract quotedCard failed: %v", input.RunID, cardErr)
	} else if hasCard && card.ID != "" {
		runWorkitemID = card.ID
		if err := h.sessions.UpdateWorkitemID(r.Context(), sessionID, runWorkitemID); err != nil {
			log.Printf("[AGUIHandler] run=%s persist workitem_id failed: %v", input.RunID, err)
		}
	}

	// 阶段10：事件流消费与 SSE 转发（含超时兜底、断连缓冲、心跳保活）。
	finishTimer := time.NewTimer(finishWait)
	finishTimer.Stop()
	maxTimer := time.NewTimer(maxRunDuration)
	maxTimer.Stop()
	defer finishTimer.Stop()
	defer maxTimer.Stop()

	stream := &agentRunStream{
		h:             h,
		w:             w,
		flusher:       flusher,
		input:         input,
		sessionID:     sessionID,
		actualThread:  actualThreadID,
		intentCommand: intentCommand,
		slashCommand:  slashCommand,
		workspacePath: workspacePath,
		reqStart:      reqStart,
		// bgCtx 独立于请求 context：前端断连后仍需继续从 gatewayd 读取事件并缓冲/持久化，
		// 因此必须使用 background context 避免请求取消导致缓冲与落库失败。
		bgCtx:       context.Background(),
		state:       &runState{pendingToolCallIDs: []string{}},
		finishTimer: finishTimer,
		maxTimer:    maxTimer,
		workitemID:  runWorkitemID,
	}
	stream.run(r, events)
}

// parseAndValidateRunRequest 校验 HTTP 方法、解析请求体并生成 runId。
// 返回 (input, workspaceID, ok)；ok=false 表示已写入错误响应，调用方应直接返回。
func (h *AGUIHandler) parseAndValidateRunRequest(w http.ResponseWriter, r *http.Request) (agui.RunAgentInput, string, bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return agui.RunAgentInput{}, "", false
	}

	workspaceID := r.URL.Query().Get("workspaceId")
	if workspaceID == "" {
		WriteJSONError(w, http.StatusBadRequest, ErrCodeGeneral, "workspaceId is required")
		return agui.RunAgentInput{}, "", false
	}

	body, err := io.ReadAll(r.Body)
	defer r.Body.Close()
	if err != nil {
		http.Error(w, fmt.Sprintf("read body: %v", err), http.StatusBadRequest)
		return agui.RunAgentInput{}, "", false
	}

	var input agui.RunAgentInput
	if err := json.Unmarshal(body, &input); err != nil {
		http.Error(w, fmt.Sprintf("invalid json: %v", err), http.StatusBadRequest)
		return agui.RunAgentInput{}, "", false
	}

	// 确保每条 run 都有唯一 runId。
	if input.RunID == "" {
		input.RunID = idutil.GenerateID()
	}

	// 提取最后一条用户消息文本，用于 debug 日志。
	lastMsgText := extractLastUserText(input.Messages)
	log.Printf("[AGUIHandler] >>> HandleRun ENTER run=%s threadId=%s workspace=%s msgCount=%d lastMsg=%q contextCount=%d agentKey=%s",
		input.RunID, input.ThreadID, workspaceID, len(input.Messages), lastMsgText, len(input.Context), input.AgentKey)

	return input, workspaceID, true
}

// resolveSessionReuse 决定是否复用已存在的后端 session。
// 返回 (sessionID, savedEarly)：savedEarly=true 表示已复用已知 session，可提前保存用户消息。
// 不直接使用 session 中保存的 WorkspacePath：目录结构可能已变更（如 user_id/workspace_id 调整），
// 统一由 resolveRunWorkspace 实时解析，确保路径始终与当前代码一致。
func (h *AGUIHandler) resolveSessionReuse(ctx context.Context, input agui.RunAgentInput) (sessionID string, savedEarly bool) {
	sessionID = input.ThreadID
	if sessionID == "" || sessionID == "main" {
		return "", false
	}
	if _, err := h.sessions.Get(ctx, sessionID); err == nil {
		_ = h.sessions.UpdateActivity(ctx, sessionID)
		log.Printf("[AGUIHandler] run=%s reuse session=%s", input.RunID, sessionID)
		return sessionID, true
	}
	log.Printf("[AGUIHandler] run=%s session=%s not found, will create after run", input.RunID, sessionID)
	return "", false
}

// resolveRunWorkspace 始终按 workspace_root/{user_id}/{workspace_id} 实时解析工作目录。
// 该路径会替换指令模板中的 {WORKSPACE_PATH} 占位符，避免 AI 把相对路径 projects/ 解析到 agent 的 cwd。
func (h *AGUIHandler) resolveRunWorkspace(r *http.Request, runID, workspaceID string) string {
	userID, _ := middleware.UserIDFromContext(r.Context())
	if workspaceID == "" || userID == "" || h.workspaceRoot == "" {
		return ""
	}
	resolved, err := resolveWorkspacePath(workspaceID, userID, h.workspaceRoot)
	if err != nil {
		log.Printf("[AGUIHandler] run=%s resolve workspace path failed: %v", runID, err)
		return ""
	}
	log.Printf("[AGUIHandler] run=%s resolved workspace path: %s", runID, resolved)
	return resolved
}

// prepareSSEStream 设置 SSE 响应头并获取 flusher。
// 返回 (flusher, ok)；ok=false 表示不支持流式响应（已记录日志），调用方应直接返回。
func prepareSSEStream(w http.ResponseWriter, runID string) (http.Flusher, bool) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		log.Printf("[AGUIHandler] run=%s streaming unsupported", runID)
		return nil, false
	}
	// 立即刷新 SSE 响应头，让前端 fetch() 能先拿到 HTTP 头部。
	flusher.Flush()
	return flusher, true
}

// extractSlashCommand 从最后一条用户消息中提取斜杠指令名，用于后续进度反馈。
// 在执行指令模板替换前记录，确保拿到的是用户原始输入中的指令名。
func extractSlashCommand(messages []agui.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != agui.RoleUser {
			continue
		}
		rawText := messages[i].ContentText()
		original := extractOriginalUserPrompt(rawText)
		if original == "" {
			original = rawText
		}
		if cmd, _, ok := parseSlashCommand(original); ok {
			return cmd
		}
		return ""
	}
	return ""
}

// applyCommandsAndIntent 拦截斜杠指令并执行意图识别。
// 依次执行：interceptCommands -> 闲聊/问候直返 -> recognizeIntent 任务映射 -> 纯聊天卡片注入。
// 返回 (commandApplied, intentCommand, slashCmdOut, abort)：
//   - commandApplied：interceptCommands 是否匹配到已知斜杠指令（用于 aguiClient.Run 调试日志）。
//   - intentCommand：最终生效的指令名（直配斜杠指令或意图映射结果），供落库 cardType 与 proto 兜底使用。
//   - slashCmdOut：更新后的斜杠指令名（意图映射会覆盖），供长任务进度反馈使用。
//   - abort：true 表示已写入终态响应（闲聊/错误），调用方应直接返回。
//
// 在 saveUserMessages 之后执行，确保数据库保存的是用户原始输入。
func (h *AGUIHandler) applyCommandsAndIntent(
	r *http.Request, w http.ResponseWriter, flusher http.Flusher,
	input *agui.RunAgentInput, workspacePath, workspaceID, slashCommand, sessionID string,
) (commandApplied bool, intentCommand, slashCmdOut string, abort bool) {
	slashCmdOut = slashCommand
	var err error

	// /prd-analysis 指令预处理：先抓取目标网站，再把结果追加到用户消息参数中，
	// 后续 interceptCommands 即可按普通斜杠指令模板渲染。
	if matched, fatal := h.tryAugmentPRDAnalysisMessage(r, input.Messages, workspaceID, input.RunID); fatal {
		abort = true
		return
	} else if matched {
		log.Printf("[AGUIHandler] run=%s prd-analysis message augmented", input.RunID)
	}

	// /prd-research 指令预处理：与 /prd-analysis 同类流程，
	// 先抓取目标网站，再把结果追加到用户消息参数中。
	if matched, fatal := h.tryAugmentPRDResearchMessage(r, input.Messages, workspaceID, input.RunID); fatal {
		abort = true
		return
	} else if matched {
		log.Printf("[AGUIHandler] run=%s prd-research message augmented", input.RunID)
	}

	commandApplied, err = interceptCommands(input.Messages, input.Context, workspacePath, workspaceID, h.workItemSvc)
	if err != nil {
		log.Printf("[AGUIHandler] run=%s intercept commands failed: %v", input.RunID, err)
		h.writeEvent(w, flusher, agui.RunErrorEvent(fmt.Sprintf("intercept commands: %v", err), "COMMAND_FAILED"))
		abort = true
		return
	}
	// 将最终发送给 agent 的提示词写入调试文件，方便排查提示词是否过长或包含敏感路径。
	logPrompt(input.RunID, input.Messages)

	if commandApplied {
		return
	}

	// 意图识别：用户未输入斜杠指令时，先调用 LLM 判断是闲聊还是任务意图。
	// 闲聊 -> 直接返回 LLM 回复，不走正常 agent run。
	// 任务意图 -> 映射到对应指令模板，再走正常 agent run。
	userInput := extractLastUserText(input.Messages)
	// 简单问候语直接返回静态回复，避免在 LLM/agent 不可用时进入长时间等待。
	if isGreeting(userInput) {
		log.Printf("[AGUIHandler] run=%s greeting matched, bypassing intent/agent run", input.RunID)
		h.streamChatResponse(r.Context(), w, flusher, greetingResponse(), sessionID, input.RunID)
		// 与正常 agent run 保持一致：更新会话活动时间并尝试生成标题。
		h.finalizeSession(r.Context(), sessionID, input.Messages)
		abort = true
		return
	}
	if userInput != "" {
		var intentResult *IntentResult
		intentResult, err = recognizeIntent(r.Context(), h.resolveAGUIClient(r.Context()), userInput)
		if err != nil {
			log.Printf("[AGUIHandler] intent recognition failed, fallback to normal run: %v", err)
		} else if intentResult != nil {
			if intentResult.IsChat {
				// 闲聊：直接流式返回回复，不走 agent run。
				h.streamChatResponse(r.Context(), w, flusher, intentResult.Response, sessionID, input.RunID)
				// 与正常 agent run 保持一致：更新会话活动时间并尝试生成标题。
				h.finalizeSession(r.Context(), sessionID, input.Messages)
				abort = true
				return
			}
			// 任务意图：应用指令模板到用户消息。
			if err = applyIntentCommand(input.Messages, intentResult.Command, userInput, workspacePath, workspaceID, input.Context, h.workItemSvc); err != nil {
				log.Printf("[AGUIHandler] run=%s apply intent command failed: %v", input.RunID, err)
				h.writeEvent(w, flusher, agui.RunErrorEvent(fmt.Sprintf("apply intent command: %v", err), "INTENT_FAILED"))
				abort = true
				return
			}
			intentCommand = intentResult.Command
			slashCmdOut = intentResult.Command
			log.Printf("[AGUIHandler] intent mapped to command: %s", intentResult.Command)
		}
	}

	// 无斜杠指令且无意图指令 -> 纯聊天场景，若有引用任务卡片则注入卡片信息。
	if intentCommand == "" {
		injectCardForChat(input.Messages, input.Context, h.workItemSvc, input.RunID)
	}

	// 统一注入通用规则和工作空间规范引用（CommonPromptRules + AGENTS.md / DESIGN.md），
	// 对所有路径（斜杠指令 / 意图识别 / 纯聊天）生效。
	// 与 flow prompt 的 prompts.ApplyPromptCommon 保持一致，实现全链路统一。
	applyPromptCommonToMessages(input.Messages, workspacePath)
	return
}

// abortIfGatewaydUnreachable 检查 session 是否标记为 gatewayd 不可达，
// 若不可达则写入 RUN_ERROR 事件并返回 true（调用方应终止本次 run）。
// 避免 session 来自 gatewayd 不可达时的 fallback，向不存在的 gatewayd session 发送 run。
func (h *AGUIHandler) abortIfGatewaydUnreachable(ctx context.Context, w http.ResponseWriter, flusher http.Flusher, sessionID, runID string) bool {
	if sessionID == "" {
		return false
	}
	sess, err := h.sessions.Get(ctx, sessionID)
	if err != nil {
		return false
	}
	v, ok := sess.Context["gatewaydUnreachable"]
	if !ok {
		return false
	}
	if unreachable, _ := v.(bool); unreachable {
		log.Printf("[AGUIHandler] run=%s gatewayd unreachable for session %s, aborting run", runID, sessionID)
		h.writeEvent(w, flusher, agui.RunErrorEvent("gatewayd unreachable, please create a new session", "GATEWAYD_UNREACHABLE"))
		return true
	}
	return false
}

// executeAgentRun 调用 gatewayd 执行 agent run，返回事件流。
// 使用 background context 调用 gatewayd，确保前端断连后 gatewayd 继续运行。
// ctx 用于解析用户容器的 gatewayd 地址；实际 Run 调用使用 context.Background() 以超越 HTTP 请求生命周期。
// 失败时已写入 RUN_ERROR 事件，返回 ok=false，调用方应直接返回。
func (h *AGUIHandler) executeAgentRun(ctx context.Context, w http.ResponseWriter, flusher http.Flusher, input agui.RunAgentInput, reqStart time.Time, commandApplied bool, workspaceID string) (string, <-chan agui.Event, bool) {
	aguiClient := h.resolveAGUIClient(ctx)
	// attach 完成后同步空间级 agent 配置（模型、watchdog 超时等）。
	// 仅 CreateSession 时同步会在 gatewayd 重启后失效，因此每次 run attach 后都重新同步。
	onAttached := func(threadID, instanceID string) error {
		return h.syncAgentConfigToGatewayd(ctx, aguiClient, workspaceID, input, threadID, instanceID)
	}
	log.Printf("[AGUIHandler] run=%s >>> aguiClient.Run ENTER input.ThreadId=%q workspace=%q commandApplied=%v messageCount=%d",
		input.RunID, input.ThreadID, input.Workspace, commandApplied, len(input.Messages))
	actualThreadID, events, err := aguiClient.RunWithOnAttached(context.Background(), input, onAttached)
	if err != nil {
		log.Printf("[AGUIHandler] run=%s <<< aguiClient.Run FAILED after %v: %v", input.RunID, time.Since(reqStart), err)
		h.writeEvent(w, flusher, agui.RunErrorEvent(FormatGatewaydError(err), "RUN_FAILED"))
		return "", nil, false
	}
	log.Printf("[AGUIHandler] run=%s <<< aguiClient.Run OK actualThreadId=%s after %v",
		input.RunID, actualThreadID, time.Since(reqStart))
	return actualThreadID, events, true
}

// syncAgentConfigToGatewayd 将空间级 agent 配置同步到 gatewayd 指定实例。
// 主要解决 gatewayd 重启后复用旧 thread 时 watchdog 回退默认 120s 的问题。
func (h *AGUIHandler) syncAgentConfigToGatewayd(ctx context.Context, aguiClient *client.AGUIClient, workspaceID string, input agui.RunAgentInput, threadID, instanceID string) error {
	if h.agentConfigSvc == nil || aguiClient == nil || workspaceID == "" || threadID == "" || instanceID == "" {
		return nil
	}
	pluginKey := resolveRunPluginKey(h.pluginKey, input)
	if pluginKey == "" {
		return nil
	}
	cfg, err := h.agentConfigSvc.GetWorkspaceConfig(workspaceID, pluginKey)
	if err != nil {
		log.Printf("[AGUIHandler] get workspace agent config failed: %v", err)
		return nil
	}
	req := client.UpdateAgentConfigRequest{
		Model:     cfg.Model,
		ModelType: cfg.ModelSource,
		BaseURL:   cfg.BaseURL,
		APIKey:    cfg.APIKey,
	}
	if cfg.Temperature != nil {
		req.Temperature = cfg.Temperature
	}
	if cfg.AdvancedConfig != nil && cfg.AdvancedConfig.MaxTokens != nil {
		req.MaxTokens = cfg.AdvancedConfig.MaxTokens
	}
	if cfg.Timeout != nil {
		secs := uint64(*cfg.Timeout)
		req.WatchdogTimeoutSecs = &secs
	}
	syncCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := aguiClient.UpdateAgentConfig(syncCtx, threadID, instanceID, req); err != nil {
		log.Printf("[AGUIHandler] sync agent config failed: %v", err)
		return nil
	}
	var watchdogSecs uint64
	if cfg.Timeout != nil {
		watchdogSecs = uint64(*cfg.Timeout)
	}
	log.Printf("[AGUIHandler] synced agent config to gatewayd: threadId=%s instanceId=%s pluginKey=%s watchdog=%ds",
		threadID, instanceID, pluginKey, watchdogSecs)
	return nil
}

// resolveRunPluginKey 与 AGUIClient.Run 内的插件 key 解析逻辑保持一致。
func resolveRunPluginKey(defaultKey string, input agui.RunAgentInput) string {
	if input.AgentKey != "" {
		return input.AgentKey
	}
	if input.AgentPluginKey != "" {
		return input.AgentPluginKey
	}
	if len(input.ForwardedProps) > 0 {
		var forwarded struct {
			AgentPluginKey string `json:"agentPluginKey"`
		}
		if err := json.Unmarshal(input.ForwardedProps, &forwarded); err == nil && forwarded.AgentPluginKey != "" {
			return forwarded.AgentPluginKey
		}
	}
	return defaultKey
}

// migrateThreadIfNeeded 在 gatewayd 返回的 threadId 与请求不一致时，
// 将旧 session 的消息迁移到新 session，并复制会话标题。
// 保留旧 session 不删除，避免前端在 RUN_STARTED 更新 threadId 前查询旧 session 时得到 404。
func (h *AGUIHandler) migrateThreadIfNeeded(ctx context.Context, runID, oldThreadID, newThreadID string) {
	if oldThreadID == newThreadID {
		return
	}
	log.Printf("[AGUIHandler] run=%s threadID changed: %q -> %q, migrating messages", runID, oldThreadID, newThreadID)
	if err := h.messages.MigrateMessages(ctx, oldThreadID, newThreadID); err != nil {
		log.Printf("[AGUIHandler] run=%s migrate messages failed: %v", runID, err)
	}
	if oldSess, err := h.sessions.Get(ctx, oldThreadID); err == nil && oldSess.Title != "" {
		_ = h.sessions.UpdateTitle(ctx, newThreadID, oldSess.Title)
	}
}

// writeEvent 将事件写入前端 SSE 流并追加到 buffer（若启用）。
// 返回错误，调用方可据此决定是否继续或仅记录日志。
func (s *agentRunStream) writeEvent(ev agui.Event) error {
	if s.h.buffer != nil {
		if err := s.h.buffer.Append(s.bgCtx, s.sessionID, ev); err != nil {
			log.Printf("[AGUIHandler] run=%s buffer append failed: %v", s.input.RunID, err)
		}
	}
	data, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", data); err != nil {
		return fmt.Errorf("write event: %w", err)
	}
	s.flusher.Flush()
	return nil
}

// bufferEvent 仅将事件追加到 buffer，用于断连恢复路径。
func (s *agentRunStream) bufferEvent(ev agui.Event) {
	if s.h.buffer == nil {
		return
	}
	if err := s.h.buffer.Append(s.bgCtx, s.sessionID, ev); err != nil {
		log.Printf("[AGUIHandler] run=%s buffer append failed: %v", s.input.RunID, err)
	}
}

// checkpointRun 将当前 run 级累加器序列化后保存到 buffer，
// 防止服务器崩溃导致未持久化的消息丢失。生产环境切换 Redis 后可跨重启恢复。
func (s *agentRunStream) checkpointRun() {
	if s.h.buffer == nil || s.sessionID == "" || s.input.RunID == "" {
		return
	}
	s.state.bufMu.Lock()
	state, err := json.Marshal(s.state.runParts)
	s.state.bufMu.Unlock()
	if err != nil {
		log.Printf("[AGUIHandler] checkpoint marshal failed: %v", err)
		return
	}
	if err := s.h.buffer.SaveRunState(s.bgCtx, s.sessionID, s.input.RunID, state); err != nil {
		log.Printf("[AGUIHandler] checkpoint save failed: %v", err)
	}
}

// persistRunAssistant 将一次 run 累积的所有部件合并为一条消息入库，
// 然后清除 buffer 中的 checkpoint。在 RUN_FINISHED / RUN_ERROR / 超时 / 断连时调用。
func (s *agentRunStream) persistRunAssistant() {
	s.state.bufMu.Lock()
	parts := s.state.runParts
	text := s.state.runTextBuilder.String()
	msgID := s.state.runMessageID
	s.state.runParts = nil
	s.state.runTextBuilder.Reset()
	s.state.runMessageID = ""
	s.state.bufMu.Unlock()

	if s.sessionID == "" || (len(parts) == 0 && text == "") {
		return
	}
	if msgID == "" {
		msgID = idutil.GenerateID()
	}
	metadata := map[string]any{}
	if len(parts) > 0 {
		metadata["contentParts"] = parts
	}
	if s.intentCommand != "" {
		cardType := strings.TrimPrefix(s.intentCommand, "/")
		cardType = strings.ReplaceAll(cardType, "-", "_")
		metadata["cardType"] = cardType
	}
	msg := chat.Message{
		ID:        msgID,
		SessionID: s.sessionID,
		Role:      "assistant",
		Type:      "text",
		Content:   text,
		Metadata:  metadata,
		Timestamp: time.Now(),
	}
	if err := s.h.messages.Append(s.bgCtx, s.sessionID, msg); err != nil {
		log.Printf("[AGUIHandler] save assistant message failed: %v", err)
	} else {
		log.Printf("[AGUIHandler] saved assistant message id=%s parts=%d textLen=%d", msgID, len(parts), len(text))
	}
	if s.h.buffer != nil && s.sessionID != "" && s.input.RunID != "" {
		_ = s.h.buffer.ClearRunState(s.bgCtx, s.sessionID, s.input.RunID)
	}
}

// flushPendingState 将未闭合的 tool-call / text-message 状态强制结束。
// writeToClient 为 true 时同时写入前端 SSE，false 时仅追加到 buffer。
func (s *agentRunStream) flushPendingState(writeToClient bool) {
	now := float64(time.Now().UnixMilli()) / 1000
	// 为仍在 pending（未收到 END）的工具调用补发 END + RESULT
	for _, id := range s.state.pendingToolCallIDs {
		endEv := agui.Event{
			Type:       agui.EventToolCallEnd,
			ToolCallID: id,
			Timestamp:  now,
		}
		resultEv := agui.Event{
			Type:       agui.EventToolCallResult,
			ToolCallID: id,
			Content:    "",
			Timestamp:  now,
		}
		if writeToClient {
			if err := s.writeEvent(endEv); err != nil {
				log.Printf("[AGUIHandler] run=%s flush tool-call-end failed: %v", s.input.RunID, err)
			}
			if err := s.writeEvent(resultEv); err != nil {
				log.Printf("[AGUIHandler] run=%s flush tool-call-result failed: %v", s.input.RunID, err)
			}
		} else {
			s.bufferEvent(endEv)
			s.bufferEvent(resultEv)
		}
	}
	s.state.pendingToolCallIDs = s.state.pendingToolCallIDs[:0]
	s.state.activeToolCallCount = 0

	// 为已收到 END 但未收到 RESULT 的工具调用补发合成 RESULT
	for _, id := range s.state.endedToolCallIDs {
		resultEv := agui.Event{
			Type:       agui.EventToolCallResult,
			ToolCallID: id,
			Content:    "",
			Timestamp:  now,
		}
		if writeToClient {
			if err := s.writeEvent(resultEv); err != nil {
				log.Printf("[AGUIHandler] run=%s flush tool-call-result (ended) failed: %v", s.input.RunID, err)
			}
		} else {
			s.bufferEvent(resultEv)
		}
		// 同时更新 runParts 中的 Result 字段
		s.state.bufMu.Lock()
		for i := len(s.state.runParts) - 1; i >= 0; i-- {
			if s.state.runParts[i].Type == "tool-call" && s.state.runParts[i].ToolCallID == id {
				s.state.runParts[i].Result = ""
				break
			}
		}
		s.state.bufMu.Unlock()
	}
	s.state.endedToolCallIDs = s.state.endedToolCallIDs[:0]

	if s.state.activeTextMessageID != "" {
		ev := agui.Event{
			Type:      agui.EventTextMessageEnd,
			MessageID: s.state.activeTextMessageID,
			Timestamp: now,
		}
		if writeToClient {
			if err := s.writeEvent(ev); err != nil {
				log.Printf("[AGUIHandler] run=%s flush text-message-end failed: %v", s.input.RunID, err)
			}
		} else {
			s.bufferEvent(ev)
		}
		s.state.activeTextMessageID = ""
	}
}

// completeRun 在事件流正常结束（channel 关闭）时调用：
// 刷新未闭合状态、发送合成 RUN_FINISHED、持久化助手消息并更新会话。
func (s *agentRunStream) completeRun() {
	s.finishTimer.Stop()
	s.maxTimer.Stop()
	s.flushPendingState(true)
	if err := s.writeEvent(agui.RunFinishedEvent(s.actualThread, s.input.RunID)); err != nil {
		log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", s.input.RunID, err)
	}
	s.persistRunAssistant()
	s.h.finalizeSession(s.bgCtx, s.sessionID, s.input.Messages)
}

// processEvent 更新一次 gatewayd 事件对应的 run 状态，并返回需要继续传播的事件列表。
// 在断连恢复路径中，调用方仍可使用返回列表，但选择仅追加到 buffer 而非发送给前端。
func (s *agentRunStream) processEvent(ev agui.Event) []agui.Event {
	switch ev.Type {
	case agui.EventTextMessageStart:
		s.state.activeTextMessageID = ev.MessageID
		s.state.bufMu.Lock()
		if s.state.runMessageID == "" {
			s.state.runMessageID = ev.MessageID
		}
		s.state.bufMu.Unlock()
	case agui.EventTextMessageContent:
		if ev.Delta == "" {
			return []agui.Event{}
		}
		s.state.bufMu.Lock()
		// 用 messageId 区分不同文本块：仅当最后一个 text 部件的 messageId 与当前一致时追加，
		// 否则新建部件，避免多个文本块的 delta 在 runParts 中合并错乱（影响断连恢复）。
		msgID := ev.MessageID
		if msgID == "" {
			msgID = s.state.activeTextMessageID
		}
		shouldAppend := false
		if len(s.state.runParts) > 0 {
			last := s.state.runParts[len(s.state.runParts)-1]
			if last.Type == "text" {
				if msgID == "" {
					shouldAppend = true
				} else {
					shouldAppend = last.MessageID == msgID
				}
			}
		}
		if shouldAppend {
			s.state.runParts[len(s.state.runParts)-1].Text += ev.Delta
		} else {
			s.state.runParts = append(s.state.runParts, contentPart{Type: "text", Text: ev.Delta, MessageID: msgID})
		}
		s.state.runTextBuilder.WriteString(ev.Delta)
		s.state.bufMu.Unlock()
		s.checkpointRun()
	case agui.EventTextMessageEnd:
		s.state.activeTextMessageID = ""
	case agui.EventThinkingTextMessageContent:
		if ev.Delta == "" {
			return []agui.Event{}
		}
		s.state.bufMu.Lock()
		// 上一段思考已结束（Done）时另起一段，避免多个思考阶段被合并成一段。
		shouldAppend := false
		if len(s.state.runParts) > 0 {
			last := s.state.runParts[len(s.state.runParts)-1]
			shouldAppend = last.Type == "reasoning" && !last.Done
		}
		if shouldAppend {
			s.state.runParts[len(s.state.runParts)-1].Text += ev.Delta
		} else {
			s.state.runParts = append(s.state.runParts, contentPart{Type: "reasoning", Text: ev.Delta})
		}
		s.state.bufMu.Unlock()
		s.checkpointRun()
	case agui.EventThinkingEnd:
		s.state.bufMu.Lock()
		for i := len(s.state.runParts) - 1; i >= 0; i-- {
			if s.state.runParts[i].Type == "reasoning" {
				s.state.runParts[i].Done = true
				break
			}
		}
		s.state.bufMu.Unlock()
		s.checkpointRun()
	case agui.EventToolCallStart:
		s.state.activeToolCallCount++
		s.state.pendingToolCallIDs = append(s.state.pendingToolCallIDs, ev.ToolCallID)
		s.state.bufMu.Lock()
		s.state.runParts = append(s.state.runParts, contentPart{
			Type:       "tool-call",
			ToolCallID: ev.ToolCallID,
			ToolName:   ev.ToolCallName,
		})
		s.state.bufMu.Unlock()
		s.checkpointRun()
	case agui.EventToolCallArgs:
		if ev.Delta != "" {
			s.state.bufMu.Lock()
			for i := len(s.state.runParts) - 1; i >= 0; i-- {
				if s.state.runParts[i].Type == "tool-call" && s.state.runParts[i].ToolCallID == ev.ToolCallID {
					s.state.runParts[i].ArgsText += ev.Delta
					break
				}
			}
			s.state.bufMu.Unlock()
			s.checkpointRun()
		}
	case agui.EventToolCallEnd:
		// gatewayd 已按 AG-UI 协议在 RESULT 之前发送 END，后端仅跟踪活跃数量，
		// 不再重映射 ID（每个工具调用使用 gatewayd 原始 ID，避免并行调用错配）。
		if removeToolCallID(&s.state.pendingToolCallIDs, ev.ToolCallID) {
			if s.state.activeToolCallCount > 0 {
				s.state.activeToolCallCount--
			}
			// 记录到 endedToolCallIDs，等 RESULT 到达后移除；
			// 若 RESULT 最终未到达，flushPendingState 会补发合成 RESULT。
			s.state.endedToolCallIDs = append(s.state.endedToolCallIDs, ev.ToolCallID)
		}
	case agui.EventToolCallResult:
		// 若 END 已到达则 ID 已从 pending 移除；若 END 未到达（兼容旧版 gatewayd），此处移除并递减。
		if removeToolCallID(&s.state.pendingToolCallIDs, ev.ToolCallID) {
			if s.state.activeToolCallCount > 0 {
				s.state.activeToolCallCount--
			}
		}
		// 从 endedToolCallIDs 移除（RESULT 已到达，无需补发）
		removeToolCallID(&s.state.endedToolCallIDs, ev.ToolCallID)
		if ev.ToolCallID != "" {
			s.state.bufMu.Lock()
			for i := len(s.state.runParts) - 1; i >= 0; i-- {
				if s.state.runParts[i].Type == "tool-call" && s.state.runParts[i].ToolCallID == ev.ToolCallID {
					s.state.runParts[i].Result = ev.Content
					break
				}
			}
			s.state.bufMu.Unlock()
			s.checkpointRun()
		}
	}
	return []agui.Event{ev}
}

// emitProtoFallbackMarker 在 /proto-make run 完成且 agent 未输出 [[PROJECT:...]] 标记时，
// 扫描本次 run 新建的原型产物目录，合成标记文本事件发给前端并计入持久化，
// 确保前端一定会渲染原型预览卡片。
func (s *agentRunStream) emitProtoFallbackMarker() {
	if s.intentCommand != "/proto-make" {
		return
	}
	s.state.bufMu.Lock()
	hasMarker := strings.Contains(s.state.runTextBuilder.String(), "[[PROJECT:")
	s.state.bufMu.Unlock()
	if hasMarker {
		return
	}
	projects := scanRecentPrototypeProjects(s.bgCtx, s.workspacePath, s.reqStart)
	if len(projects) == 0 {
		log.Printf("[AGUIHandler] run=%s proto-make fallback: no recent project dir found under %s", s.input.RunID, s.workspacePath)
		return
	}
	marker := buildProtoProjectMarker(projects)
	msgID := s.state.runMessageID
	if msgID == "" {
		msgID = idutil.GenerateID()
	}
	fallbackEv := agui.Event{
		Type:      agui.EventTextMessageContent,
		MessageID: msgID,
		Delta:     marker,
		Timestamp: float64(time.Now().UnixMilli()) / 1000,
	}
	for _, e := range s.processEvent(fallbackEv) {
		if err := s.writeEvent(e); err != nil {
			log.Printf("[AGUIHandler] run=%s write proto fallback marker failed: %v", s.input.RunID, err)
		}
	}
	log.Printf("[AGUIHandler] run=%s proto-make fallback appended %d project markers", s.input.RunID, len(projects))
}

// run 消费 gatewayd 事件流并转发为前端 SSE 事件。
// 处理：首事件进度反馈、RUN_FINISHED/RUN_ERROR 终态、前端断连后台缓冲、
// finish/max 超时兜底与心跳保活。gatewayd 在 /sessions/{id}/chat 中会先发送 RUN_STARTED，
// 这里不再重复发送，避免前端收到重复的 run 开始事件。
func (s *agentRunStream) run(r *http.Request, events <-chan agui.Event) {
	firstEventSeen := false
	firstContentSeen := false
	feedbackEmitted := false
	frontendDone := false
	heartbeatTicker := time.NewTicker(sseHeartbeatInterval)
	defer heartbeatTicker.Stop()
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				log.Printf("[AGUIHandler] run=%s event stream closed, total elapsed=%v totalEvents=%d",
					s.input.RunID, time.Since(s.reqStart), s.state.eventCount)
				s.completeRun()
				return
			}
			s.state.eventCount++
			if !firstEventSeen {
				firstEventSeen = true
				log.Printf("[AGUIHandler] run=%s first SSE event from gatewayd after %v: type=%s threadId=%s",
					s.input.RunID, time.Since(s.reqStart), ev.Type, ev.ThreadID)
				s.maxTimer.Reset(maxRunDuration)
				if !feedbackEmitted {
					feedbackEmitted = true
					if err := emitLongTaskFeedback(s.slashCommand, s.input.RunID, s.sessionID, s.writeEvent); err != nil {
						log.Printf("[AGUIHandler] run=%s emit long task feedback failed: %v", s.input.RunID, err)
					}
				}
			}
			switch ev.Type {
			case agui.EventThinkingStart:
				log.Printf("[AGUIHandler] run=%s THINKING_START after %v", s.input.RunID, time.Since(s.reqStart))
			case agui.EventTextMessageStart:
				log.Printf("[AGUIHandler] run=%s TEXT_MESSAGE_START (TTFT) after %v", s.input.RunID, time.Since(s.reqStart))
				s.state.firstResponseSeen = true
			case agui.EventTextMessageContent:
				if !firstContentSeen {
					firstContentSeen = true
					log.Printf("[AGUIHandler] run=%s first TEXT_MESSAGE_CONTENT after %v", s.input.RunID, time.Since(s.reqStart))
				}
			case agui.EventToolCallStart:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_START id=%s tool=%s after %v", s.input.RunID, ev.ToolCallID, ev.ToolCallName, time.Since(s.reqStart))
				s.state.firstResponseSeen = true
			case agui.EventToolCallResult:
				log.Printf("[AGUIHandler] run=%s TOOL_CALL_RESULT id=%s tool=%s result=%.200s after %v", s.input.RunID, ev.ToolCallID, ev.ToolCallName, ev.Content, time.Since(s.reqStart))
			case agui.EventRunStarted:
				log.Printf("[AGUIHandler] run=%s RUN_STARTED threadId=%s after %v", s.input.RunID, ev.ThreadID, time.Since(s.reqStart))
			case agui.EventRunFinished:
				log.Printf("[AGUIHandler] run=%s RUN_FINISHED threadId=%s after %v", s.input.RunID, ev.ThreadID, time.Since(s.reqStart))
				s.finishTimer.Stop()
				s.maxTimer.Stop()
				s.flushPendingState(true)
				// /proto-make 兜底：确保 agent 未输出工程标记时仍渲染原型预览卡片
				s.emitProtoFallbackMarker()
				if err := s.writeEvent(ev); err != nil {
					log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", s.input.RunID, err)
				}
				s.persistRunAssistant()
				s.h.finalizeSession(s.bgCtx, s.sessionID, s.input.Messages)
				return
			case agui.EventCustom:
				log.Printf("[AGUIHandler] run=%s CUSTOM name=%s value=%s after %v", s.input.RunID, ev.Name, string(ev.Value), time.Since(s.reqStart))
			case agui.EventRunError:
				log.Printf("[AGUIHandler] run=%s RUN_ERROR after %v: %s", s.input.RunID, time.Since(s.reqStart), ev.Message)
				s.finishTimer.Stop()
				s.maxTimer.Stop()
				s.flushPendingState(true)
				if err := s.writeEvent(ev); err != nil {
					log.Printf("[AGUIHandler] run=%s write RUN_ERROR failed: %v", s.input.RunID, err)
				}
				s.persistRunAssistant()
				s.h.finalizeSession(s.bgCtx, s.sessionID, s.input.Messages)
				return
			}
			toEmit := s.processEvent(ev)
			for _, e := range toEmit {
				if err := s.writeEvent(e); err != nil {
					log.Printf("[AGUIHandler] run=%s write event failed: %v", s.input.RunID, err)
				}
			}
			if s.state.firstResponseSeen {
				if s.state.activeToolCallCount == 0 {
					s.finishTimer.Reset(finishWait)
				} else {
					s.finishTimer.Stop()
				}
			}
		case <-r.Context().Done():
			if frontendDone {
				continue
			}
			frontendDone = true
			log.Printf("[AGUIHandler] run=%s frontend disconnected, continuing buffering in background", s.input.RunID)

			// 前端断连后继续从 gatewayd 读取事件并缓冲，直到 stream 结束。
			s.finishTimer.Stop()
			s.maxTimer.Stop()
			for ev := range events {
				toEmit := s.processEvent(ev)
				for _, e := range toEmit {
					s.bufferEvent(e)
				}
			}
			// 缓冲最终合成事件并持久化。
			s.flushPendingState(false)
			s.bufferEvent(agui.RunFinishedEvent(s.actualThread, s.input.RunID))
			s.persistRunAssistant()
			s.h.finalizeSession(s.bgCtx, s.sessionID, s.input.Messages)
			return
		case <-s.finishTimer.C:
			log.Printf("[AGUIHandler] run=%s finish timer fired, total elapsed=%v", s.input.RunID, time.Since(s.reqStart))
			if s.state.activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				for _, ev := range []agui.Event{
					{
						Type:      agui.EventTextMessageContent,
						MessageID: s.state.activeTextMessageID,
						Delta:     "\n\n（模型响应超时或中断，请检查模型配置、网络或账户余额后重试。）",
						Timestamp: ts,
					},
					{
						Type:      agui.EventTextMessageEnd,
						MessageID: s.state.activeTextMessageID,
						Timestamp: ts,
					},
				} {
					if err := s.writeEvent(ev); err != nil {
						log.Printf("[AGUIHandler] run=%s write timeout text event failed: %v", s.input.RunID, err)
					}
				}
				s.state.activeTextMessageID = ""
			}
			s.flushPendingState(true)
			if err := s.writeEvent(agui.RunFinishedEvent(s.actualThread, s.input.RunID)); err != nil {
				log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", s.input.RunID, err)
			}
			s.persistRunAssistant()
			s.h.finalizeSession(s.bgCtx, s.sessionID, s.input.Messages)
			return
		case <-s.maxTimer.C:
			log.Printf("[AGUIHandler] run=%s max run duration reached, total elapsed=%v", s.input.RunID, time.Since(s.reqStart))
			if s.state.activeTextMessageID != "" {
				ts := float64(time.Now().UnixMilli()) / 1000
				for _, ev := range []agui.Event{
					{
						Type:      agui.EventTextMessageContent,
						MessageID: s.state.activeTextMessageID,
						Delta:     "\n\n（模型运行超过最大时长，已自动结束。）",
						Timestamp: ts,
					},
					{
						Type:      agui.EventTextMessageEnd,
						MessageID: s.state.activeTextMessageID,
						Timestamp: ts,
					},
				} {
					if err := s.writeEvent(ev); err != nil {
						log.Printf("[AGUIHandler] run=%s write timeout text event failed: %v", s.input.RunID, err)
					}
				}
				s.state.activeTextMessageID = ""
			}
			s.flushPendingState(true)
			if err := s.writeEvent(agui.RunFinishedEvent(s.actualThread, s.input.RunID)); err != nil {
				log.Printf("[AGUIHandler] run=%s write RUN_FINISHED failed: %v", s.input.RunID, err)
			}
			s.persistRunAssistant()
			s.h.finalizeSession(s.bgCtx, s.sessionID, s.input.Messages)
			return
		case <-heartbeatTicker.C:
			// 前端断连后不再发送心跳（仅缓冲事件，无需保活）。
			if frontendDone {
				continue
			}
			// SSE 注释（: heartbeat）会被 EventSource 解析器忽略，不影响 AG-UI 事件流。
			if _, err := fmt.Fprintf(s.w, ": heartbeat\n\n"); err != nil {
				log.Printf("[AGUIHandler] run=%s write heartbeat failed: %v", s.input.RunID, err)
			} else {
				s.flusher.Flush()
			}
		}
	}
}
