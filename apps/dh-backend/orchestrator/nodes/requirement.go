package nodes

import (
	"fmt"
	"log"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)

// RequirementAskForAcceptNode 需求受理（人工节点）
type RequirementAskForAcceptNode struct {
	core.BaseNode
}

func (n *RequirementAskForAcceptNode) Input(fc *core.FlowContext) error {
	proc := processobject.NewAIDevProcess(fc.WorkspaceID, fc.WorkitemID, fc.WorkitemTitle)
	created := fc.CreateProcess(proc)
	fc.ProcessID = created.ID
	return nil
}

func (n *RequirementAskForAcceptNode) Processor(fc *core.FlowContext) error {
	return nil
}

func (n *RequirementAskForAcceptNode) Output(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageRequirement, processobject.UpdateStageRequest{
		Status:         processobject.StageStatusCompleted,
		OperatorType:   processobject.OperatorTypeHuman,
		OperatorName:   fc.UserName,
		OperatorID:     fc.UserID,
		ExtraInputDesc: fmt.Sprintf("需求「%s」", fc.WorkitemTitle),
		OutputDesc:     fmt.Sprintf("受理并确认%s需求，安排AI开发数字分身@%s进行开发", fc.WorkitemTitle, fc.UserName),
	})
	return nil
}

// RequirementEvalNode 需求评估（人工节点，条件分支）
type RequirementEvalNode struct {
	core.BaseNode
}

func (n *RequirementEvalNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageRequirementEval, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    fmt.Sprintf("需求「%s」", fc.WorkitemTitle),
		OutputDesc:   "评估需求复杂度，决定是否需要架构设计",
	})
	return nil
}

func (n *RequirementEvalNode) Processor(fc *core.FlowContext) error {
	existing, _ := n.Deps.NotificationSvc.ListByTypeAndData(fc.Ctx, fc.TenantID, notificationobject.TypeRequirementEvalRequired, "workitemId", fc.WorkitemID)
	for _, notif := range existing {
		if notif.ActionStatus == notificationobject.ActionPending {
			log.Printf("[RequirementEvalNode] workitem %s already has pending requirement_eval notification, skip", fc.WorkitemID)
			return core.ErrPauseFlow
		}
	}

	evalResult := n.runAIEval(fc)

	desc := fc.WorkitemDesc
	if len(desc) > 200 {
		desc = desc[:200] + "..."
	}

	body := fmt.Sprintf("需求「%s」已受理，请评估是否需要架构设计。\n\n描述: %s", fc.WorkitemTitle, desc)
	if evalResult != "" {
		body += fmt.Sprintf("\n\n---\nAI 评估参考：\n%s", evalResult)
	}

	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeRequirementEvalRequired,
		Title:       fmt.Sprintf("需求评估: %s", fc.WorkitemTitle),
		Body:        body,
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType":     notificationobject.TypeRequirementEvalRequired,
			"workitemId":           fc.WorkitemID,
			"workitemTitle":        fc.WorkitemTitle,
			"workitemDesc":         fc.WorkitemDesc,
			"processId":            fc.ProcessID,
			"workspacePath":        fc.WorkspacePath,
			"workspaceId":          fc.WorkspaceID,
			"tenantId":             fc.TenantID,
			"userName":             fc.UserName,
			"requirementEvalResult": evalResult,
		},
	})
	if err != nil {
		log.Printf("[RequirementEvalNode] create notification failed: %v", err)
	}

	return core.ErrPauseFlow
}

func (n *RequirementEvalNode) runAIEval(fc *core.FlowContext) string {
	prompt := prompts.BuildRequirementEvalPrompt(fc.WorkitemTitle, fc.WorkitemDesc)
	log.Printf("[RequirementEvalNode] AI eval prompt length=%d", len(prompt))

	_, events, err := n.Deps.AGUIClient.Run(fc.Ctx, core.BuildRunInput("", prompt, fc.WorkspacePath))
	if err != nil {
		log.Printf("[RequirementEvalNode] AI eval Run failed: %v", err)
		return ""
	}

	result := core.ConsumeEvents(events)
	if result.Error != nil {
		log.Printf("[RequirementEvalNode] AI eval error: %v", result.Error)
	}

	if result.Text == "" {
		log.Printf("[RequirementEvalNode] AI eval returned empty text")
		return ""
	}

	fc.RequirementEvalResult = result.Text
	log.Printf("[RequirementEvalNode] AI eval result length=%d", len(result.Text))
	return result.Text
}

func (n *RequirementEvalNode) Output(fc *core.FlowContext) error {
	var outputDesc string
	if fc.NeedArchDesign {
		outputDesc = "需求较复杂，需要进行架构设计"
	} else {
		outputDesc = "需求较简单，直接进入开发"
	}
	fc.UpdateStageFull(processobject.StageRequirementEval, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		OutputDesc:   outputDesc,
	})
	return nil
}

func (n *RequirementEvalNode) NextNode(fc *core.FlowContext) string {
	if fc.NeedArchDesign {
		return processobject.StageArchDesign
	}
	return processobject.StageDevelopment
}
