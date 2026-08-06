package nodes

import (
	"fmt"
	"log"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

// AiEvalNode 智能评估（AI 节点）
type AiEvalNode struct {
	core.BaseNode
}

func (n *AiEvalNode) Input(fc *core.FlowContext) error {
	prompt := prompts.BuildAIEvalPrompt(fc.ArchDesignResult, fc.WorkitemTitle, fc.WorkitemDesc)
	fc.UpdateStageFull(processobject.StageAIEval, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		SessionID:    fc.SessionID,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleAIEval,
		InputDesc:    "架构设计方案",
		OutputDesc:   "智能评估报告",
		Prompt:       prompt,
	})
	return nil
}

func (n *AiEvalNode) Processor(fc *core.FlowContext) error {
	deps := n.Deps
	prompt := prompts.BuildAIEvalPrompt(fc.ArchDesignResult, fc.WorkitemTitle, fc.WorkitemDesc)

	_, events, err := deps.AGUIClient.Run(fc.Ctx, core.BuildRunInput(fc.ThreadID, prompt, fc.WorkspacePath))
	if err != nil {
		fc.FailStagef(deps, processobject.StageAIEval, "智能评估启动失败: %v", err)
		return err
	}
	log.Printf("[AiEvalNode] AI eval started")

	result := core.ConsumeEvents(events)
	fc.AIEvalResult = result.Text
	log.Printf("[AiEvalNode] AI eval completed, response length=%d", len(result.Text))

	now := time.Now()
	deps.Messages.Append(fc.Ctx, fc.SessionID, chat.Message{
		ID:        idutil.GenerateID(),
		SessionID: fc.SessionID,
		Role:      "user",
		Content:   prompt,
		Timestamp: now,
	})
	deps.Messages.Append(fc.Ctx, fc.SessionID, chat.Message{
		ID:        idutil.GenerateID(),
		SessionID: fc.SessionID,
		Role:      "assistant",
		Content:   result.Text,
		Timestamp: time.Now(),
	})

	if result.Error != nil {
		fc.FailStagef(deps, processobject.StageAIEval, "智能评估失败: %v", result.Error)
		return result.Error
	}
	return nil
}

func (n *AiEvalNode) Output(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageAIEval, processobject.UpdateStageRequest{
		Status:     processobject.StageStatusCompleted,
		OutputDesc: "智能评估报告",
		Prompt:     fc.AIEvalResult,
	})
	return nil
}

// HumanAuditNode 人工审核（人工节点，条件分支）
type HumanAuditNode struct {
	core.BaseNode
}

func (n *HumanAuditNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageHumanAudit, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "智能评估报告",
		OutputDesc:   "待审核人员审批架构设计方案",
		Prompt:       fc.AIEvalResult,
	})
	return nil
}

func (n *HumanAuditNode) Processor(fc *core.FlowContext) error {
	existing, _ := n.Deps.NotificationSvc.ListByTypeAndData(fc.Ctx, fc.TenantID, notificationobject.TypeHumanAuditRequired, "workitemId", fc.WorkitemID)
	for _, notif := range existing {
		if notif.ActionStatus == notificationobject.ActionPending {
			log.Printf("[HumanAuditNode] workitem %s already has pending human_audit notification, skip", fc.WorkitemID)
			return core.ErrPauseFlow
		}
	}

	aiEvalSummary := fc.AIEvalResult
	if len(aiEvalSummary) > 500 {
		aiEvalSummary = aiEvalSummary[:500] + "..."
	}
	body := fmt.Sprintf("需求「%s」的架构设计已完成 AI 智能评估，请审核。审批通过则进入开发，审批不通过将重新进行架构设计。\n\n---\nAI 评估报告：\n%s", fc.WorkitemTitle, aiEvalSummary)

	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeHumanAuditRequired,
		Title:       fmt.Sprintf("架构设计审核: %s", fc.WorkitemTitle),
		Body:        body,
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeHumanAuditRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"sessionId":        fc.SessionID,
			"threadId":         fc.ThreadID,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
			"archDesignResult": fc.ArchDesignResult,
			"aiEvalResult":     fc.AIEvalResult,
		},
	})
	if err != nil {
		log.Printf("[HumanAuditNode] create notification failed: %v", err)
	}

	return core.ErrPauseFlow
}

func (n *HumanAuditNode) Output(fc *core.FlowContext) error {
	var outputDesc string
	if fc.AuditApprovalResult == "pass" {
		outputDesc = fmt.Sprintf("%s审核通过，进入需求开发", fc.UserName)
	} else {
		outputDesc = fmt.Sprintf("%s审核不通过，需重新进行架构设计", fc.UserName)
	}
	fc.UpdateStageFull(processobject.StageHumanAudit, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "智能评估报告",
		OutputDesc:   outputDesc,
		Prompt:       fc.AIEvalResult,
	})
	return nil
}

func (n *HumanAuditNode) NextNode(fc *core.FlowContext) string {
	if fc.AuditApprovalResult == "pass" {
		return processobject.StageDevelopment
	}
	return processobject.StageArchDesign
}
