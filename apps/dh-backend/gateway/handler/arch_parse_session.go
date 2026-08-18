package handler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

// 本文件实现架构库解析的「创建会话 + 触发 agent run」能力，
// 即 domain/repository 包 ArchParseSessionCreator 接口的实现（挂在 *AGUIHandler 上，
// Go 接口结构化满足，handler 包无需 import domain/repository，避免循环依赖）。
//
// 复用决策：AgentRun / CreateSession 两个 HTTP handler 深度耦合请求体与 SSE ResponseWriter
// （prepareSSEStream 写响应头、writeEvent 直写 w），无法直接复用；
// 这里复用其内部可拆解的部分：resolveAGUIClient（按用户容器定位 gatewayd）、
// syncAgentConfigToGatewayd（attach 后同步空间级模型/watchdog 配置，经 RunWithOnAttached 的
// onAttached 回调接入，与 executeAgentRun 同款）、saveUserMessages / finalizeSession
//（消息落库与标题生成）、SSE buffer（断线重放）。

// CreateAndRun 创建 agent 会话并以 prompt 为首条用户消息触发 agent run，返回 sessionID。
// 供 POST /workspaces/{id}/arch/parse 调用：整个调用在请求内同步完成会话创建与 run 启动，
// 事件流由后台 goroutine 消费（见 consumeArchParseRun），HTTP 请求结束后 run 继续执行。
func (h *AGUIHandler) CreateAndRun(ctx context.Context, workspaceID, userID, prompt string) (string, error) {
	workspacePath, err := resolveWorkspacePath(ctx, workspaceID, userID, h.workspaceRoot)
	if err != nil {
		return "", fmt.Errorf("resolve workspace path: %w", err)
	}
	input := agui.RunAgentInput{
		RunID:     idutil.GenerateID(),
		Messages:  []agui.Message{agui.UserMessage("", prompt)},
		Workspace: workspacePath,
	}
	// resolveAGUIClient 依赖请求 ctx 中的容器信息定位用户 gatewayd；
	// Run 本身使用 background ctx（与 executeAgentRun 一致），
	// 保证 HTTP 请求返回后 gatewayd 侧的 run 不被取消。
	aguiClient := h.resolveAGUIClient(ctx)
	// 与 executeAgentRun 保持一致（agui_run.go:425-427）：attach 完成后同步空间级
	// agent 配置（模型、watchdog 超时等），防止 gatewayd 回退默认 120s watchdog
	// 杀掉全量解析的长工具调用。解析会话无用户侧 SSE 连接，同步失败仅记日志
	// 不中断 run（syncAgentConfigToGatewayd 内部只记日志并返回 nil，语义对齐）。
	onAttached := func(threadID, instanceID string) error {
		return h.syncAgentConfigToGatewayd(ctx, aguiClient, workspaceID, input, threadID, instanceID)
	}
	sessionID, events, err := aguiClient.RunWithOnAttached(context.Background(), input, onAttached)
	if err != nil {
		return "", fmt.Errorf("start agent run: %w", err)
	}
	// 注意：run 已在 gatewayd 侧启动，此处落库失败会留下无主 run，
	// 仅记录日志并返回错误（调用方不会写解析锁，用户可重试）。
	if err := h.createArchParseSession(ctx, sessionID, workspaceID, userID, workspacePath); err != nil {
		log.Printf("[AGUIHandler] arch-parse run=%s session=%s persist session failed: %v", input.RunID, sessionID, err)
		return "", fmt.Errorf("persist session: %w", err)
	}
	// 持久化首条用户消息并生成会话标题（复用现有逻辑）。
	h.saveUserMessages(ctx, sessionID, input.Messages, nil)
	go h.consumeArchParseRun(sessionID, input, events)
	return sessionID, nil
}

// createArchParseSession 写入解析会话记录，使会话出现在用户会话列表中。
func (h *AGUIHandler) createArchParseSession(ctx context.Context, sessionID, workspaceID, userID, workspacePath string) error {
	sess := chat.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		WorkspacePath: workspacePath,
		UserID:        userID,
		AgentID:       defaultSessionAgentID,
		AgentType:     defaultSessionAgentType,
		Context:       map[string]any{sessionCtxKeyPluginKey: h.pluginKey},
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	return h.sessions.Create(ctx, sess)
}

// consumeArchParseRun 在后台消费解析 run 的事件流。
// 必须持续读取事件 channel：AGUIClient 内部 readSSE goroutine 向 channel 写入，
// 无人读取会阻塞该 goroutine 并泄漏 HTTP 连接。
// 每个事件追加到 SSE buffer，前端可通过 replay 端点实时跟踪解析进度；
// 流结束（channel 关闭 / RUN_FINISHED / RUN_ERROR / 超时）时落库 assistant 消息。
func (h *AGUIHandler) consumeArchParseRun(sessionID string, input agui.RunAgentInput, events <-chan agui.Event) {
	// 独立于请求生命周期：HTTP 请求早已返回，事件消费与落库必须继续。
	bgCtx := context.Background()
	var textBuilder strings.Builder
	// 总时长兜底，与前端 SSE 路径的 maxRunDuration 保持一致，
	// 防止 gatewayd 异常不关闭事件流时本 goroutine 永久挂起。
	timer := time.NewTimer(maxRunDuration)
	defer timer.Stop()
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				h.finishArchParseRun(bgCtx, sessionID, input, textBuilder.String(), "")
				return
			}
			h.appendArchParseEvent(bgCtx, sessionID, ev)
			switch ev.Type {
			case agui.EventTextMessageContent:
				textBuilder.WriteString(ev.Delta)
			// RUN_FINISHED / RUN_ERROR 终态：错误日志统一由 finishArchParseRun 记录
			//（errMsg 非空时），避免此处再嵌套一层 if（规则4：嵌套 ≤3 层）。
			case agui.EventRunFinished, agui.EventRunError:
				h.finishArchParseRun(bgCtx, sessionID, input, textBuilder.String(), ev.Message)
				return
			}
		case <-timer.C:
			// 超时详情带入 errMsg，由 finishArchParseRun 统一记错误日志。
			h.finishArchParseRun(bgCtx, sessionID, input, textBuilder.String(), fmt.Sprintf("run timeout after %v", maxRunDuration))
			return
		}
	}
}

// appendArchParseEvent 将事件追加到 SSE buffer，供前端断线重放/实时跟踪解析进度。
func (h *AGUIHandler) appendArchParseEvent(ctx context.Context, sessionID string, ev agui.Event) {
	if h.buffer == nil {
		return
	}
	if err := h.buffer.Append(ctx, sessionID, ev); err != nil {
		log.Printf("[AGUIHandler] arch-parse session=%s buffer append failed: %v", sessionID, err)
	}
}

// finishArchParseRun 在事件流终结时落库 assistant 消息并更新会话活动时间。
// errMsg 非空表示 run 异常结束（RUN_ERROR / 超时）：统一在此记错误日志；
// 无文本产出时落库一条失败说明，避免会话看起来"无响应"。
func (h *AGUIHandler) finishArchParseRun(ctx context.Context, sessionID string, input agui.RunAgentInput, text, errMsg string) {
	if errMsg != "" {
		log.Printf("[AGUIHandler] arch-parse run=%s session=%s finished abnormally: %s", input.RunID, sessionID, errMsg)
	}
	if text == "" && errMsg != "" {
		text = "解析任务未能正常完成：" + errMsg
	}
	if text != "" {
		msg := chat.Message{
			ID:        idutil.GenerateID(),
			SessionID: sessionID,
			Role:      string(agui.RoleAssistant),
			Type:      "text",
			Content:   text,
			Timestamp: time.Now(),
		}
		if err := h.messages.Append(ctx, sessionID, msg); err != nil {
			log.Printf("[AGUIHandler] arch-parse session=%s save assistant message failed: %v", sessionID, err)
		}
	}
	h.finalizeSession(ctx, sessionID, input.Messages)
}
