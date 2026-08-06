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

// NewArchDesignNode 创建架构设计节点
func NewArchDesignNode(deps *core.FlowDeps) *ArchDesignNode {
	return &ArchDesignNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageArchDesign, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildArchDesignPrompt(fc.WorkitemTitle, fc.WorkitemDesc, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[架构设计]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.ArchDesignResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStage(processobject.StageArchDesign, processobject.StageStatusCompleted)
				return nil
			},
		},
	}
}

type ArchDesignNode struct {
	CodeWriteNode
}

func (n *ArchDesignNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageArchDesign, processobject.UpdateStageRequest{
		Status:         processobject.StageStatusInProgress,
		OperatorType:   processobject.OperatorTypeAI,
		OperatorName:   fc.UserName,
		AgentRole:      processobject.AgentRoleDevelopment,
		InputDesc:      "需求评估结果",
		ExtraInputDesc: "需求描述",
		OutputDesc:     "架构设计方案",
	})
	return nil
}

// ReviewNode 智能评审（AI 节点）
type ReviewNode struct {
	core.BaseNode
}

func (n *ReviewNode) Input(fc *core.FlowContext) error {
	fc.ReviewPrompt = prompts.BuildReviewPrompt(fc.WorkspacePath, fc.WorkitemTitle)
	log.Printf("[ReviewNode] /review prompt length=%d", len(fc.ReviewPrompt))

	fc.UpdateStageFull(processobject.StageReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		SessionID:    fc.DevSessionID,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleReview,
		InputDesc:    "工程代码变更",
		OutputDesc:   "评审报告",
		Prompt:       fc.ReviewPrompt,
	})
	return nil
}

func (n *ReviewNode) Processor(fc *core.FlowContext) error {
	deps := n.Deps

	_, reviewEvents, err := deps.AGUIClient.Run(fc.Ctx, core.BuildRunInput(fc.DevThreadID, fc.ReviewPrompt, fc.WorkspacePath))
	if err != nil {
		fc.FailStagef(deps, processobject.StageReview, "评审启动失败: %v", err)
		return err
	}
	log.Printf("[ReviewNode] /review started")

	result := core.ConsumeEvents(reviewEvents)
	fc.ReviewResult = result.Text
	log.Printf("[ReviewNode] /review completed, response length=%d", len(result.Text))

	now := time.Now()
	deps.Messages.Append(fc.Ctx, fc.DevSessionID, chat.Message{
		ID:        idutil.GenerateID(),
		SessionID: fc.DevSessionID,
		Role:      "user",
		Content:   fc.ReviewPrompt,
		Timestamp: now,
	})
	deps.Messages.Append(fc.Ctx, fc.DevSessionID, chat.Message{
		ID:        idutil.GenerateID(),
		SessionID: fc.DevSessionID,
		Role:      "assistant",
		Content:   result.Text,
		Timestamp: time.Now(),
	})

	if result.Error != nil {
		fc.FailStagef(deps, processobject.StageReview, "评审失败: %v", result.Error)
		return result.Error
	}
	return nil
}

func (n *ReviewNode) Output(fc *core.FlowContext) error {
	fc.UpdateStage(processobject.StageReview, processobject.StageStatusCompleted)
	return nil
}

// HumanReviewNode 人工复审（人工节点，条件分支）
type HumanReviewNode struct {
	core.BaseNode
}

func (n *HumanReviewNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageHumanReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "代码评审报告",
		OutputDesc:   "待开发人员审批评审报告并提供优化指示",
		Prompt:       fc.ReviewResult,
	})
	return nil
}

func (n *HumanReviewNode) Processor(fc *core.FlowContext) error {
	existing, _ := n.Deps.NotificationSvc.ListByTypeAndData(fc.Ctx, fc.TenantID, notificationobject.TypeHumanReviewRequired, "workitemId", fc.WorkitemID)
	for _, notif := range existing {
		if notif.ActionStatus == notificationobject.ActionPending {
			log.Printf("[HumanReviewNode] workitem %s already has pending human_review notification, skip", fc.WorkitemID)
			return core.ErrPauseFlow
		}
	}

	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeHumanReviewRequired,
		Title:       fmt.Sprintf("代码复审待审批: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的代码评审已完成，请查看评审报告。审批通过则完成开发，审批不通过将进行代码优化后重新评审。", fc.WorkitemTitle),
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeHumanReviewRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"sessionId":        fc.DevSessionID,
			"threadId":         fc.DevThreadID,
			"reviewReport":     fc.ReviewResult,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
		},
	})
	if err != nil {
		log.Printf("[HumanReviewNode] create notification failed: %v", err)
	}

	return core.ErrPauseFlow
}

func (n *HumanReviewNode) Output(fc *core.FlowContext) error {
	var outputDesc string
	if fc.ApprovalResult == "pass" {
		outputDesc = fmt.Sprintf("%s审批通过，开发完成", fc.UserName)
	} else {
		outputDesc = fmt.Sprintf("%s审批不通过，需进行代码优化", fc.UserName)
	}
	fc.UpdateStageFull(processobject.StageHumanReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "代码评审报告",
		OutputDesc:   outputDesc,
		Prompt:       fc.ReviewResult,
	})
	return nil
}

func (n *HumanReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ApprovalResult == "pass" {
		return processobject.StageDevComplete
	}
	return processobject.StageCodeOptimize
}
