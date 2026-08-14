package nodes

import (
	"fmt"
	"log"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

// runAIGeneration 执行一次 AI 生成：创建会话 -> 持久化用户消息 -> 调用 gatewayd -> 消费事件 -> 持久化 assistant 消息。
// 返回 AI 生成的文本。供 CodeWriteNode 与 AI 草案复核节点复用。
// 每次调用都生成新的会话 ID，避免跨节点复用导致会话主键冲突。
func runAIGeneration(deps *core.FlowDeps, fc *core.FlowContext, prompt, sessionTitlePrefix string) (string, error) {
	sessionID := idutil.GenerateID()
	fc.SessionID = sessionID

	now := time.Now()
	sessionCtx := map[string]any{
		"workitemId":   fc.WorkitemID,
		"orchestrated": true,
	}
	if err := deps.Sessions.Create(fc.Ctx, chat.Session{
		ID:            sessionID,
		WorkspaceID:   fc.WorkspaceID,
		WorkspacePath: fc.WorkspacePath,
		UserID:        fc.UserID,
		AgentID:       deps.GatewaydAgentID,
		AgentType:     "chat",
		Title:         fmt.Sprintf("%s %s", sessionTitlePrefix, fc.WorkitemTitle),
		Context:       sessionCtx,
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}

	if err := deps.Messages.Append(fc.Ctx, sessionID, chat.Message{
		ID:        idutil.GenerateID(),
		SessionID: sessionID,
		Role:      "user",
		Content:   prompt,
		Timestamp: now,
	}); err != nil {
		log.Printf("[runAIGeneration] persist user message failed: %v", err)
	}

	threadID, events, err := deps.AGUIClient.Run(fc.Ctx, core.BuildRunInput("", prompt, fc.WorkspacePath))
	if err != nil {
		return "", fmt.Errorf("start run: %w", err)
	}
	fc.ThreadID = threadID

	result := core.ConsumeEvents(events)
	if err := deps.Messages.Append(fc.Ctx, sessionID, chat.Message{
		ID:        idutil.GenerateID(),
		SessionID: sessionID,
		Role:      "assistant",
		Content:   result.Text,
		Timestamp: time.Now(),
	}); err != nil {
		log.Printf("[runAIGeneration] persist assistant message failed: %v", err)
	}

	if result.Error != nil {
		return result.Text, result.Error
	}
	return result.Text, nil
}

// CodeWriteNode 代码编写节点基类（AI 节点）
// 封装"调用 gatewayd 执行 /code -> 消费事件 -> 持久化会话/消息"的通用流程。
type CodeWriteNode struct {
	core.BaseNode
	BuildPrompt         func(fc *core.FlowContext) string
	SessionTitlePrefix  string
	SessionContextExtra map[string]any
	AfterComplete       func(fc *core.FlowContext) error
}

func (n *CodeWriteNode) Processor(fc *core.FlowContext) error {
	deps := n.Deps

	prompt := n.BuildPrompt(fc)
	log.Printf("[CodeWriteNode:%s] prompt length=%d", n.Name(), len(prompt))

	fc.UpdateStageFull(n.Name(), processobject.UpdateStageRequest{
		Status:      processobject.StageStatusInProgress,
		Prompt:      prompt,
		InputPrompt: prompt,
	})

	_, err := runAIGeneration(deps, fc, prompt, n.SessionTitlePrefix)
	if err != nil {
		fc.FailStagef(deps, n.Name(), "%s失败: %v", n.SessionTitlePrefix, err)
		return err
	}

	// AI 生成后把会话 ID 写入阶段，供前端拉取对话详情。
	fc.UpdateStageFull(n.Name(), processobject.UpdateStageRequest{
		SessionID: fc.SessionID,
	})
	return nil
}

func (n *CodeWriteNode) Output(fc *core.FlowContext) error {
	if n.AfterComplete != nil {
		return n.AfterComplete(fc)
	}
	fc.UpdateStage(n.Name(), processobject.StageStatusCompleted)
	return nil
}
