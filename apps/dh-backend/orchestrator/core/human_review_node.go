package core

import (
	"fmt"
	"log"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
)

// HumanReviewConfig 人工复核节点的可配置参数。
// 封装 Input → 发送通知+暂停 → 等待人工操作 → Output → NextNode 的标准流程。
type HumanReviewConfig struct {
	StageName string

	InputDesc  string
	OutputDesc string
	PassDesc   string
	FailDesc   string

	NotifType     string
	NotifTitleFmt string
	NotifBodyFmt  string
	ActionType    string

	PromptGetter func(fc *FlowContext) string
	ResultGetter func(fc *FlowContext) string
	ExtraData    func(fc *FlowContext) map[string]any

	// PreProcessor 在去重检查之后、发送通知之前执行的可选钩子。
	// 用于在通知前准备数据（如 RequirementEvalNode 的 AI 复杂度预评估）。
	// 返回非 nil error 时流程中止，不再发送通知。
	PreProcessor func(fc *FlowContext) error

	// InputDescBuilder 覆盖 Input/Output 阶段的 InputDesc；为 nil 时使用 InputDesc 字面量。
	InputDescBuilder func(fc *FlowContext) string

	// OutputDescBuilder 覆盖 Output 阶段的 OutputDesc；为 nil 时按 pass/fail 使用 PassDesc/FailDesc。
	OutputDescBuilder func(fc *FlowContext) string

	PassNodeName string
	FailNodeName string

	// ResultMap 多结果路由映射（如 3-way routing），key 为 ResultGetter 返回值，value 为下一阶段名。
	// 当 ResultMap 不为 nil 时，NextNode 优先使用 ResultMap 查表，不再走简单的 pass/fail 二分。
	ResultMap map[string]string

	DedupCheckType string

	BodyBuilder func(fc *FlowContext) string
}

// HumanReviewNode 人工复核节点（统一基类）。
// 实现 Node 接口的 Input / Processor / Output / NextNode。
// 具体节点通过 HumanReviewConfig 配置差异实现。
type HumanReviewNode struct {
	BaseNode
	Cfg HumanReviewConfig
}

// NewHumanReviewNode 创建人工复核节点。
func NewHumanReviewNode(deps *FlowDeps, cfg HumanReviewConfig) *HumanReviewNode {
	return &HumanReviewNode{
		BaseNode: NewBaseNode(cfg.StageName, NodeTypeHuman, deps),
		Cfg:      cfg,
	}
}

func (n *HumanReviewNode) Input(fc *FlowContext) error {
	prompt := ""
	if n.Cfg.PromptGetter != nil {
		prompt = n.Cfg.PromptGetter(fc)
	}
	fc.UpdateStageFull(n.Cfg.StageName, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    n.inputDesc(fc),
		OutputDesc:   n.Cfg.OutputDesc,
		Prompt:       prompt,
	})
	return nil
}

func (n *HumanReviewNode) Processor(fc *FlowContext) error {
	if n.Cfg.DedupCheckType != "" {
		existing, _ := n.Deps.NotificationSvc.ListByTypeAndData(
			fc.Ctx, fc.TenantID, n.Cfg.DedupCheckType, "workitemId", fc.WorkitemID,
		)
		for _, notif := range existing {
			if notif.ActionStatus == notificationobject.ActionPending {
				log.Printf("[%s] workitem %s already has pending notification, skip", n.Cfg.StageName, fc.WorkitemID)
				return ErrPauseFlow
			}
		}
	}

	if n.Cfg.PreProcessor != nil {
		if err := n.Cfg.PreProcessor(fc); err != nil {
			return err
		}
	}

	data := map[string]any{
		"notificationType": n.Cfg.NotifType,
		"workitemId":       fc.WorkitemID,
		"workitemTitle":    fc.WorkitemTitle,
		"processId":        fc.ProcessID,
		"workspacePath":    fc.WorkspacePath,
		"workspaceId":      fc.WorkspaceID,
		"tenantId":         fc.TenantID,
		"userName":         fc.UserName,
	}

	if n.Cfg.ExtraData != nil {
		for k, v := range n.Cfg.ExtraData(fc) {
			data[k] = v
		}
	}

	title := fmt.Sprintf(n.Cfg.NotifTitleFmt, fc.WorkitemTitle)
	body := n.buildBody(fc)

	actionType := n.Cfg.ActionType
	if actionType == "" {
		actionType = notificationobject.ActionApproveCodeOptimize
	}
	actionURL := fmt.Sprintf("/process/%s", fc.ProcessID)

	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        n.Cfg.NotifType,
		Title:       title,
		Body:        body,
		ActionType:  actionType,
		ActionURL:   actionURL,
		Data:        data,
	})
	if err != nil {
		log.Printf("[%s] create notification failed: %v", n.Cfg.StageName, err)
	}

	return ErrPauseFlow
}

func (n *HumanReviewNode) buildBody(fc *FlowContext) string {
	if n.Cfg.BodyBuilder != nil {
		return n.Cfg.BodyBuilder(fc)
	}
	return fmt.Sprintf(n.Cfg.NotifBodyFmt, fc.WorkitemTitle)
}

func (n *HumanReviewNode) Output(fc *FlowContext) error {
	fc.UpdateStageFull(n.Cfg.StageName, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    n.inputDesc(fc),
		OutputDesc:   n.outputDesc(fc),
		Prompt:       n.prompt(fc),
	})
	return nil
}

// inputDesc 返回 Input/Output 阶段的输入描述，优先使用 InputDescBuilder。
func (n *HumanReviewNode) inputDesc(fc *FlowContext) string {
	if n.Cfg.InputDescBuilder != nil {
		return n.Cfg.InputDescBuilder(fc)
	}
	return n.Cfg.InputDesc
}

// outputDesc 返回 Output 阶段的结果描述，优先使用 OutputDescBuilder，其次按 pass/fail 二分。
func (n *HumanReviewNode) outputDesc(fc *FlowContext) string {
	if n.Cfg.OutputDescBuilder != nil {
		return n.Cfg.OutputDescBuilder(fc)
	}
	if n.Cfg.ResultGetter != nil && n.Cfg.ResultGetter(fc) != "pass" {
		return n.Cfg.FailDesc
	}
	return n.Cfg.PassDesc
}

// prompt 返回当前阶段的 Prompt 内容；未配置 PromptGetter 时为空。
func (n *HumanReviewNode) prompt(fc *FlowContext) string {
	if n.Cfg.PromptGetter != nil {
		return n.Cfg.PromptGetter(fc)
	}
	return ""
}

func (n *HumanReviewNode) NextNode(fc *FlowContext) string {
	if n.Cfg.ResultGetter == nil {
		return n.Cfg.FailNodeName
	}
	result := n.Cfg.ResultGetter(fc)

	if n.Cfg.ResultMap != nil {
		if next, ok := n.Cfg.ResultMap[result]; ok {
			return next
		}
		// 未命中 ResultMap 时回退到 pass/fail 二分
		if result == "pass" {
			return n.Cfg.PassNodeName
		}
		return n.Cfg.FailNodeName
	}

	if result == "pass" {
		return n.Cfg.PassNodeName
	}
	return n.Cfg.FailNodeName
}
