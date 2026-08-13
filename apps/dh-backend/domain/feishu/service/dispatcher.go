// Package service - dispatcher.go 实现飞书消息到 agent 的分发逻辑。
//
// 分发流程：
//  1. 解析意图（编码/原型/需求/群总结/问答）
//  2. 解析身份与权限（白名单/普通用户）
//  3. 权限校验（普通用户仅限问答+总结）
//  4. 路由到对应分发方法（流式 CardKit 或 batch 降级）
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
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
	// cardPlaceholder 创建卡片时的初始占位文案。
	cardPlaceholder = "正在连接 AI 编码平台..."
)

// HandleEvent 异步处理一条飞书消息事件。
// 该方法执行完整的"解析意图 -> 身份校验 -> 分发 agent -> 流式输出"流程，
// 耗时取决于 agent 执行时长（可能数分钟），因此必须在独立 goroutine 中调用。
// 任何错误都不会向上传播，而是通过卡片/replier 将错误提示发送回飞书用户。
func (s *DBFeishuService) HandleEvent(ev object.InboundEvent) {
	reply, err := s.processEvent(ev)
	if err != nil {
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

	// 1. 查绑定关系
	boundUserID, boundWorkspace := s.lookupBinding(ev.OpenID)

	// 2. 解析身份与权限
	identity := s.identity.Resolve(ev.OpenID, boundUserID, boundWorkspace)

	// 3. 解析意图
	intent := ParseIntent(ev.Content)

	// 4. 权限校验
	if !HasPermission(identity.Permission, intent) {
		msg := "您没有使用编码功能的权限，仅支持问答和群聊总结。如需编码权限请联系管理员。"
		s.replier.Send(ev, msg)
		return msg, nil
	}

	// 5. 计算工作目录
	workspacePath, err := buildWorkspacePath(s.workspaceRoot, identity.UserID, identity.WorkspaceID)
	if err != nil {
		return "", fmt.Errorf("resolve workspace path failed: %w", err)
	}

	log.Printf("[Feishu] dispatching chatId=%s openId=%s userID=%s intent=%s perm=%s workspace=%s contentPreview=%s",
		ev.ChatID, ev.OpenID, identity.UserID, intent, identity.Permission, workspacePath, truncateForLog(ev.Content))

	// 6. 路由分发
	prompt := StripPrefix(ev.Content, intent)

	switch intent {
	case object.IntentCoding, object.IntentPrototype, object.IntentRequirement:
		return s.dispatchStreaming(ev, prompt, workspacePath, identity, true)
	case object.IntentGroupSummary:
		return s.dispatchGroupSummary(ev, workspacePath, identity)
	default:
		return s.dispatchStreaming(ev, ev.Content, workspacePath, identity, false)
	}
}

// lookupBinding 查询飞书用户绑定关系，返回 userID 和 workspaceID（未绑定时为空）。
func (s *DBFeishuService) lookupBinding(openID string) (userID, workspaceID string) {
	bound, err := s.GetUser(openID)
	if err != nil || bound.UserID == "" {
		return "", ""
	}
	return bound.UserID, bound.WorkspaceID
}

// dispatchStreaming 流式分发：agent SSE 事件 -> CardKit 流式卡片。
// persistent=true 时复用 session（多轮上下文 + 持久化），false 时一次性问答。
// CardKit 创建失败时降级为 batch 模式（replier.Send）。
func (s *DBFeishuService) dispatchStreaming(ev object.InboundEvent, prompt, workspacePath string, identity IdentityResult, persistent bool) (string, error) {
	ctx, cancel := s.dispatchContext()
	defer cancel()

	// 创建 CardKit 流式卡片
	card, cardErr := s.cardKit.CreateStreamingCard(ctx, ev.ChatID, cardPlaceholder)
	if cardErr != nil {
		log.Printf("[Feishu] CardKit create failed, fallback to batch: %v", cardErr)
		return s.dispatchBatch(ev, prompt, workspacePath, identity, persistent)
	}

	// 启动 agent run
	actualThreadID, events, runErr := s.startAgentRun(ctx, ev, prompt, workspacePath, persistent)
	if runErr != nil {
		card.Finalize(ctx, fmt.Sprintf("❌ 连接 AI 平台失败: %v", runErr), nil)
		return "", fmt.Errorf("agent run failed: %w", runErr)
	}

	// 流式消费事件，更新卡片
	textBuilder := &strings.Builder{}
	for sseEv := range events {
		switch sseEv.Type {
		case agui.EventTextMessageContent:
			textBuilder.WriteString(sseEv.Delta)
			_ = card.AppendAndFlush(ctx, sseEv.Delta)
		case agui.EventToolCallStart:
			_ = card.UpdateStatus(ctx, fmt.Sprintf("🔧 执行工具: %s", sseEv.ToolCallName))
		case agui.EventToolCallResult:
			_ = card.UpdateStatus(ctx, "✅ 工具执行完成")
		case agui.EventRunFinished:
			text := textBuilder.String()
			if text == "" {
				text = "（agent 未返回内容）"
			}
			buttons := buildDefaultButtons(text)
			_ = card.Finalize(ctx, text, buttons)
			if persistent {
				s.persistAndMapSession(actualThreadID, ev, identity, prompt, text)
			}
			log.Printf("[Feishu] streaming done chatId=%s threadId=%s replyLen=%d", ev.ChatID, actualThreadID, len(text))
			return text, nil
		case agui.EventRunError:
			_ = card.Finalize(ctx, fmt.Sprintf("❌ 执行失败: %s", sseEv.Message), nil)
			return "", fmt.Errorf("agent error: %s", sseEv.Message)
		}
	}

	// 流结束但未收到 RUN_FINISHED（异常）
	text := textBuilder.String()
	_ = card.Finalize(ctx, text, nil)
	if persistent {
		s.persistAndMapSession(actualThreadID, ev, identity, prompt, text)
	}
	return text, nil
}

// dispatchGroupSummary 场景2：拉取群历史 -> LLM 总结 -> 流式卡片。
func (s *DBFeishuService) dispatchGroupSummary(ev object.InboundEvent, workspacePath string, identity IdentityResult) (string, error) {
	ctx, cancel := s.dispatchContext()
	defer cancel()

	// 拉取群历史消息（mock 模式下 fetcher 为 nil，跳过）
	var prompt string
	if s.groupHistory != nil {
		messages, err := s.groupHistory.FetchMessages(ctx, ev.ChatID, GroupHistoryDefaultLimit, GroupHistoryDefaultDuration)
		if err != nil {
			log.Printf("[Feishu] group history fetch failed chatId=%s: %v", ev.ChatID, err)
			s.replier.Send(ev, fmt.Sprintf("拉取群历史消息失败: %v", err))
			return "", err
		}
		prompt = BuildSummaryPrompt(messages, object.IntentGroupSummary, ev.Content)
	} else {
		// mock 模式：无群历史，直接用用户消息
		prompt = fmt.Sprintf("请总结以下内容：\n%s", ev.Content)
	}

	// 创建 CardKit 流式卡片
	card, cardErr := s.cardKit.CreateStreamingCard(ctx, ev.ChatID, "正在生成群聊总结...")
	if cardErr != nil {
		log.Printf("[Feishu] CardKit create failed, fallback to batch: %v", cardErr)
		reply, err := s.aguiClient.QuickComplete(ctx, prompt, "", workspacePath)
		if err != nil {
			return "", fmt.Errorf("group summary failed: %w", err)
		}
		s.replier.Send(ev, reply)
		return reply, nil
	}

	// 一次性问答（群总结不需要多轮上下文）
	input := buildRunInput("", prompt, workspacePath)
	actualThreadID, events, err := s.aguiClient.Run(ctx, input)
	if err != nil {
		card.Finalize(ctx, fmt.Sprintf("❌ 连接 AI 平台失败: %v", err), nil)
		return "", fmt.Errorf("agent run failed: %w", err)
	}

	textBuilder := &strings.Builder{}
	for sseEv := range events {
		switch sseEv.Type {
		case agui.EventTextMessageContent:
			textBuilder.WriteString(sseEv.Delta)
			_ = card.AppendAndFlush(ctx, sseEv.Delta)
		case agui.EventRunFinished:
			text := textBuilder.String()
			if text == "" {
				text = "（agent 未返回内容）"
			}
			_ = card.Finalize(ctx, text, nil)
			log.Printf("[Feishu] group summary done chatId=%s threadId=%s replyLen=%d", ev.ChatID, actualThreadID, len(text))
			return text, nil
		case agui.EventRunError:
			card.Finalize(ctx, fmt.Sprintf("❌ 执行失败: %s", sseEv.Message), nil)
			return "", fmt.Errorf("agent error: %s", sseEv.Message)
		}
	}
	text := textBuilder.String()
	card.Finalize(ctx, text, nil)
	return text, nil
}

// dispatchBatch 是 CardKit 不可用时的降级路径：收集全部文本后一次性发送。
func (s *DBFeishuService) dispatchBatch(ev object.InboundEvent, prompt, workspacePath string, identity IdentityResult, persistent bool) (string, error) {
	if persistent {
		return s.dispatchPersistent(ev, identity.UserID, identity.WorkspaceID, workspacePath, prompt)
	}
	return s.dispatchOneShot(ev, prompt, workspacePath)
}

// startAgentRun 根据是否持久化模式启动 agent run。
// persistent=true 时复用已有 session（thread），false 时创建新 thread。
func (s *DBFeishuService) startAgentRun(ctx context.Context, ev object.InboundEvent, prompt, workspacePath string, persistent bool) (string, <-chan agui.Event, error) {
	threadID := ""
	if persistent {
		existing, err := s.getChatSession(ev.ChatID)
		if err == nil && existing.SessionID != "" {
			threadID = existing.SessionID
		}
	}
	input := buildRunInput(threadID, prompt, workspacePath)
	return s.aguiClient.Run(ctx, input)
}

// persistAndMapSession 持久化会话并更新飞书 chat_id 映射。
func (s *DBFeishuService) persistAndMapSession(threadID string, ev object.InboundEvent, identity IdentityResult, userContent, assistantReply string) {
	if perr := s.persistRun(threadID, ev, identity.UserID, identity.WorkspaceID, "", userContent, assistantReply); perr != nil {
		log.Printf("[Feishu] persist run failed (non-fatal) threadId=%s err=%v", threadID, perr)
	}
	if uerr := s.upsertChatSession(object.FeishuChatSession{
		ChatID:      ev.ChatID,
		SessionID:   threadID,
		UserID:      identity.UserID,
		WorkspaceID: identity.WorkspaceID,
		Mode:        object.ModePersistent,
		ChatType:    ev.ChatType,
	}); uerr != nil {
		log.Printf("[Feishu] upsert chat session mapping failed (non-fatal) chatId=%s err=%v", ev.ChatID, uerr)
	}
}

// buildWorkspacePath 按 ${workspace_root}/${user_id}/${workspace_id} 计算工作目录。
func buildWorkspacePath(workspaceRoot, userID, workspaceID string) (string, error) {
	return pathutil.ResolveWorkspaceRoot(workspaceRoot, userID, workspaceID)
}

// dispatchOneShot 一次性问答模式（batch 降级路径）：使用 QuickComplete 同步获取回复。
func (s *DBFeishuService) dispatchOneShot(ev object.InboundEvent, prompt, workspacePath string) (string, error) {
	ctx, cancel := s.dispatchContext()
	defer cancel()
	reply, err := s.aguiClient.QuickComplete(ctx, prompt, "", workspacePath)
	if err != nil {
		return "", fmt.Errorf("一次性问答失败: %w", err)
	}
	if reply == "" {
		reply = "（agent 未返回内容）"
	}
	s.replier.Send(ev, reply)
	return reply, nil
}

// dispatchPersistent 持久化会话模式（batch 降级路径）。
func (s *DBFeishuService) dispatchPersistent(ev object.InboundEvent, userID, workspaceID, workspacePath, prompt string) (string, error) {
	ctx, cancel := s.dispatchContext()
	defer cancel()

	existing, lookupErr := s.getChatSession(ev.ChatID)
	threadID := ""
	if lookupErr == nil {
		threadID = existing.SessionID
	}

	input := buildRunInput(threadID, prompt, workspacePath)
	actualThreadID, events, err := s.aguiClient.Run(ctx, input)
	if err != nil {
		return "", fmt.Errorf("agent 运行失败: %w", err)
	}

	reply, eventCount := consumeEvents(events)
	if reply == "" {
		reply = "（agent 未返回内容）"
	}

	if perr := s.persistRun(actualThreadID, ev, userID, workspaceID, workspacePath, prompt, reply); perr != nil {
		log.Printf("[Feishu] persist run failed (non-fatal) threadId=%s err=%v", actualThreadID, perr)
	}
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

	log.Printf("[Feishu] persistent batch dispatch done chatId=%s threadId=%s events=%d replyLen=%d",
		ev.ChatID, actualThreadID, eventCount, len(reply))
	s.replier.Send(ev, reply)
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
func buildRunInput(threadID, content, workspacePath string) agui.RunAgentInput {
	return agui.RunAgentInput{
		ThreadID:       threadID,
		RunID:          idutil.GenerateID(),
		Messages:       []agui.Message{agui.UserMessage("", content)},
		State:          json.RawMessage(`{}`),
		Tools:          []agui.Tool{},
		Context:        []agui.ContextItem{},
		ForwardedProps: json.RawMessage(`{}`),
		Workspace:      workspacePath,
	}
}

// consumeEvents 消费 AG-UI 事件流，累积文本增量并返回完整回复（batch 降级路径用）。
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

// buildDefaultButtons 构建卡片终态的默认操作按钮。
func buildDefaultButtons(content string) []object.CardButton {
	return []object.CardButton{
		{Text: "复制全部", Action: "copy", Data: content},
		{Text: "重新生成", Action: "regenerate", Data: ""},
	}
}

// persistRun 将本次对话持久化到平台 session 与 message 存储。
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
	if err := s.sessions.Create(context.Background(), sess); err != nil {
		// session 已存在属于幂等场景，允许继续；其它错误才返回。
		if !errors.Is(err, common.ErrAlreadyExists) {
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
		ID:        idutil.GenerateID(),
		SessionID: sessionID,
		Role:      role,
		Type:      "text",
		Content:   content,
		Timestamp: time.Now(),
	}
	return s.messages.Append(context.Background(), sessionID, msg)
}

// truncateForLog 截断文本用于日志输出。
func truncateForLog(s string) string {
	if len(s) <= replyTruncateLimit {
		return s
	}
	return s[:replyTruncateLimit] + "..."
}
