package nodes

import (
	"fmt"
	"log"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/google/uuid"
)

// CodeWriteNode 代码编写节点基类（AI 节点）
// 封装"调用 gatewayd 执行 /code -> 消费事件 -> 持久化会话/消息"的通用流程。
type CodeWriteNode struct {
	core.BaseNode
	BuildPrompt        func(fc *core.FlowContext) string
	SessionTitlePrefix string
	SessionContextExtra map[string]any
	AfterComplete      func(fc *core.FlowContext) error
}

func (n *CodeWriteNode) Processor(fc *core.FlowContext) error {
	deps := n.Deps

	prompt := n.BuildPrompt(fc)
	log.Printf("[CodeWriteNode:%s] prompt length=%d", n.Name(), len(prompt))

	sessionID := uuid.New().String()
	fc.SessionID = sessionID

	fc.UpdateStageFull(n.Name(), processobject.UpdateStageRequest{
		Status:    processobject.StageStatusInProgress,
		SessionID: sessionID,
		Prompt:    prompt,
	})

	now := time.Now()
	sessionCtx := map[string]any{
		"workitemId":   fc.WorkitemID,
		"orchestrated": true,
	}
	for k, v := range n.SessionContextExtra {
		sessionCtx[k] = v
	}
	if err := deps.Sessions.Create(fc.Ctx, chat.Session{
		ID:            sessionID,
		WorkspaceID:   fc.WorkspaceID,
		WorkspacePath: fc.WorkspacePath,
		UserID:        fc.UserID,
		AgentID:       deps.GatewaydAgentID,
		AgentType:     "chat",
		Title:         fmt.Sprintf("%s %s", n.SessionTitlePrefix, fc.WorkitemTitle),
		Context:       sessionCtx,
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		fc.FailStagef(deps, n.Name(), "%s会话持久化失败: %v", n.SessionTitlePrefix, err)
		return err
	}

	if err := deps.Messages.Append(fc.Ctx, sessionID, chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "user",
		Content:   prompt,
		Timestamp: now,
	}); err != nil {
		log.Printf("[CodeWriteNode:%s] persist user message failed: %v", n.Name(), err)
	}

	threadID, events, err := deps.AGUIClient.Run(fc.Ctx, core.BuildRunInput("", prompt, fc.WorkspacePath))
	if err != nil {
		fc.FailStagef(deps, n.Name(), "%s启动失败: %v", n.SessionTitlePrefix, err)
		return err
	}
	fc.ThreadID = threadID
	log.Printf("[CodeWriteNode:%s] started, threadID=%s", n.Name(), threadID)

	result := core.ConsumeEvents(events)
	log.Printf("[CodeWriteNode:%s] completed, response length=%d", n.Name(), len(result.Text))

	if err := deps.Messages.Append(fc.Ctx, sessionID, chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "assistant",
		Content:   result.Text,
		Timestamp: time.Now(),
	}); err != nil {
		log.Printf("[CodeWriteNode:%s] persist assistant message failed: %v", n.Name(), err)
	}

	if result.Error != nil {
		fc.FailStagef(deps, n.Name(), "%s失败: %v", n.SessionTitlePrefix, result.Error)
		return result.Error
	}
	return nil
}

func (n *CodeWriteNode) Output(fc *core.FlowContext) error {
	if n.AfterComplete != nil {
		return n.AfterComplete(fc)
	}
	fc.UpdateStage(n.Name(), processobject.StageStatusCompleted)
	return nil
}
