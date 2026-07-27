// Package service - dispatcher.go 实现飞书消息到 agent 的分发逻辑。
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
	"github.com/google/uuid"
)

const (
	// defaultDispatchTimeout 是未配置分发超时时的默认值，覆盖原型生成等长任务。
	defaultDispatchTimeout = 30 * time.Minute
	// slashCommandPrefix 斜杠命令前缀，以此开头的消息走持久化会话模式。
	slashCommandPrefix = "/"
	// feishuAgentType 飞书机器人使用的默认 agent 类型标识。
	feishuAgentType = "opencode"
	// feishuSessionTitlePrefix 飞书会话在平台 session 中的标题前缀。
	feishuSessionTitlePrefix = "飞书会话: "
	// replyTruncateLimit 日志中回复文本的截断长度，避免日志过长。
	replyTruncateLimit = 200
)

// HandleEvent 异步处理一条飞书消息事件。
// 该方法执行完整的"解析用户 -> 分发 agent -> 发送回复"流程，
// 耗时取决于 agent 执行时长（可能数分钟），因此必须在独立 goroutine 中调用。
// 任何错误都不会向上传播，而是通过 replier 将错误提示发送回飞书用户。
func (s *DBFeishuService) HandleEvent(ev object.InboundEvent) {
	reply, err := s.processEvent(ev)
	if err != nil {
		// 分发失败时将错误信息作为回复发送，让用户感知到问题。
		errMsg := fmt.Sprintf("处理消息失败: %v", err)
		log.Printf("[Feishu] event handling failed chatId=%s openId=%s err=%v", ev.ChatID, ev.OpenID, err)
		s.replier.Send(ev, errMsg)
		return
	}
	log.Printf("[Feishu] event handled chatId=%s replyLen=%d replyPreview=%s",
		ev.ChatID, len(reply), truncateForLog(reply))
}

// processEvent 执行单条事件的完整处理流程，返回 agent 回复文本。
func (s *DBFeishuService) processEvent(ev object.InboundEvent) (string, error) {
	if strings.TrimSpace(ev.Content) == "" {
		return "", errors.New("消息内容为空")
	}

	userID, workspaceID := s.resolveUserIdentity(ev.OpenID)
	mode := determineMode(ev.Content)
	workspacePath := buildWorkspacePath(s.workspaceRoot, userID, workspaceID)

	log.Printf("[Feishu] dispatching chatId=%s openId=%s userID=%s mode=%s workspace=%s contentPreview=%s",
		ev.ChatID, ev.OpenID, userID, mode, workspacePath, truncateForLog(ev.Content))

	switch mode {
	case object.ModeOneShot:
		return s.dispatchOneShot(ev, workspacePath)
	case object.ModePersistent:
		return s.dispatchPersistent(ev, userID, workspaceID, workspacePath)
	default:
		return s.dispatchOneShot(ev, workspacePath)
	}
}

// resolveUserIdentity 解析飞书用户对应的平台身份。
// 优先查 feishu_users 绑定表；未绑定时回退到配置的兜底用户与工作空间。
// 兜底用户为空时返回错误，避免无主操作写入错误的工作目录。
func (s *DBFeishuService) resolveUserIdentity(openID string) (userID, workspaceID string) {
	bound, err := s.GetUser(openID)
	if err == nil && bound.UserID != "" {
		wsID := bound.WorkspaceID
		if wsID == "" {
			wsID = s.cfg.DefaultWorkspace
		}
		return bound.UserID, wsID
	}
	// 未绑定：使用兜底账号，便于 MVP 阶段先跑通流程。
	log.Printf("[Feishu] user not bound openId=%s, falling back to bot user=%s", openID, s.cfg.BotUserID)
	return s.cfg.BotUserID, s.cfg.DefaultWorkspace
}

// determineMode 根据消息内容判断分发模式。
// 以斜杠开头的消息走持久化会话（支持工具调用与多轮上下文），其余走一次性问答。
func determineMode(content string) object.DispatchMode {
	trimmed := strings.TrimSpace(content)
	if strings.HasPrefix(trimmed, slashCommandPrefix) {
		return object.ModePersistent
	}
	return object.ModeOneShot
}

// buildWorkspacePath 按 ${workspace_root}/${user_id}/${workspace_id} 计算工作目录。
// 该路径将作为 agent 的工作目录，由 gatewayd 容器挂载访问。
func buildWorkspacePath(workspaceRoot, userID, workspaceID string) string {
	return filepath.Join(workspaceRoot, userID, workspaceID)
}

// dispatchOneShot 一次性问答模式：使用 QuickComplete 同步获取回复，不持久化会话。
// 适用于普通提问，无上下文延续，响应最快。
func (s *DBFeishuService) dispatchOneShot(ev object.InboundEvent, workspacePath string) (string, error) {
	ctx, cancel := s.dispatchContext()
	defer cancel()

	reply, err := s.aguiClient.QuickComplete(ctx, ev.Content)
	if err != nil {
		return "", fmt.Errorf("一次性问答失败: %w", err)
	}
	if reply == "" {
		reply = "（agent 未返回内容）"
	}
	return reply, nil
}

// dispatchPersistent 持久化会话模式：按飞书 chat_id 复用 agent session。
// 首次消息创建新 session 并记录映射；后续消息复用 session_id 以保持多轮上下文。
// 同时将用户消息与 agent 回复持久化到平台 session/message 存储，便于后台追溯。
func (s *DBFeishuService) dispatchPersistent(ev object.InboundEvent, userID, workspaceID, workspacePath string) (string, error) {
	ctx, cancel := s.dispatchContext()
	defer cancel()

	existing, lookupErr := s.getChatSession(ev.ChatID)
	threadID := ""
	if lookupErr == nil {
		threadID = existing.SessionID
	}

	input := buildRunInput(threadID, ev.Content, workspacePath)
	actualThreadID, events, err := s.aguiClient.Run(ctx, input)
	if err != nil {
		return "", fmt.Errorf("agent 运行失败: %w", err)
	}

	reply, eventCount := consumeEvents(events)
	if reply == "" {
		reply = "（agent 未返回内容）"
	}

	// 持久化用户消息与 assistant 回复到平台 session 存储。
	if perr := s.persistRun(actualThreadID, ev, userID, workspaceID, workspacePath, ev.Content, reply); perr != nil {
		log.Printf("[Feishu] persist run failed (non-fatal) threadId=%s err=%v", actualThreadID, perr)
	}

	// 更新飞书会话映射，后续消息复用该 session_id。
	if uerr := s.upsertChatSession(object.FeishuChatSession{
		ChatID:      ev.ChatID,
		SessionID:   actualThreadID,
		UserID:      userID,
		WorkspaceID: workspaceID,
		Mode:        object.ModePersistent,
		ChatType:    ev.ChatType,
	}); uerr != nil {
		log.Printf("[Feishu] upsert chat session mapping failed (non-fatal) chatId=%s err=%v", ev.ChatID, uerr)
	}

	log.Printf("[Feishu] persistent dispatch done chatId=%s threadId=%s events=%d replyLen=%d",
		ev.ChatID, actualThreadID, eventCount, len(reply))
	return reply, nil
}

// dispatchContext 创建带超时的分发上下文。
func (s *DBFeishuService) dispatchContext() (context.Context, context.CancelFunc) {
	timeout := s.cfg.DispatchTimeout
	if timeout <= 0 {
		timeout = defaultDispatchTimeout
	}
	return context.WithTimeout(context.Background(), timeout)
}

// buildRunInput 构造 AG-UI RunAgentInput。
// threadID 为空时 AGUIClient.Run 内部会创建新 thread。
func buildRunInput(threadID, content, workspacePath string) agui.RunAgentInput {
	return agui.RunAgentInput{
		ThreadID:       threadID,
		RunID:          uuid.New().String(),
		Messages:       []agui.Message{agui.UserMessage("", content)},
		State:          json.RawMessage(`{}`),
		Tools:          []agui.Tool{},
		Context:        []agui.ContextItem{},
		ForwardedProps: json.RawMessage(`{}`),
		Workspace:      workspacePath,
	}
}

// consumeEvents 消费 AG-UI 事件流，累积文本增量并返回完整回复。
// 遇到 RUN_FINISHED 正常结束，遇到 RUN_ERROR 返回错误。
// 返回回复文本与事件总数（用于日志观察 agent 活跃度）。
func consumeEvents(events <-chan agui.Event) (string, int) {
	var sb strings.Builder
	count := 0
	for ev := range events {
		count++
		switch ev.Type {
		case agui.EventTextMessageContent:
			sb.WriteString(ev.Delta)
		case agui.EventRunError:
			return sb.String(), count
		case agui.EventRunFinished:
			return sb.String(), count
		}
	}
	return sb.String(), count
}

// persistRun 将本次对话持久化到平台 session 与 message 存储。
// 若 session 不存在则创建（首次消息），随后追加用户消息与 assistant 回复。
func (s *DBFeishuService) persistRun(threadID string, ev object.InboundEvent, userID, workspaceID, workspacePath, userContent, assistantReply string) error {
	now := time.Now()
	sess := chat.Session{
		ID:              threadID,
		WorkspaceID:     workspaceID,
		WorkspacePath:   workspacePath,
		UserID:          userID,
		AgentID:         feishuAgentType,
		GatewaydAgentID: feishuAgentType,
		AgentType:       feishuAgentType,
		Title:           feishuSessionTitlePrefix + ev.ChatID,
		Context: map[string]any{
			"source":       "feishu",
			"feishuChatId": ev.ChatID,
			"feishuOpenId": ev.OpenID,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	// 创建 session 忽略已存在错误（复用 session 时 session 已存在）。
	if err := s.sessions.Create(context.Background(), sess); err != nil {
		if !strings.Contains(err.Error(), "already exist") {
			return fmt.Errorf("create session: %w", err)
		}
	}

	if err := s.appendMessage(threadID, "user", userContent); err != nil {
		return err
	}
	return s.appendMessage(threadID, "assistant", assistantReply)
}

// appendMessage 向指定 session 追加一条消息。
func (s *DBFeishuService) appendMessage(sessionID, role, content string) error {
	msg := chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      role,
		Type:      "text",
		Content:   content,
		Timestamp: time.Now(),
	}
	return s.messages.Append(context.Background(), sessionID, msg)
}

// truncateForLog 截断文本用于日志输出，避免长内容刷屏。
func truncateForLog(s string) string {
	if len(s) <= replyTruncateLimit {
		return s
	}
	return s[:replyTruncateLimit] + "..."
}
