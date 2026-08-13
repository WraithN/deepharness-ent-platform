package nodes

import (
	"fmt"
	"log"
	"strings"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)

// AI 决策输出标记常量
const (
	aiDecisionPass      = "pass"
	aiDecisionReject    = "reject"
	needProtoTrueMark   = "NEED_PROTO: true"
	needProtoFalseMark  = "NEED_PROTO: false"
	draftReviewPassMark = "pass"
)

// ============================================================
// 产品需求受理（人工 ACTION 节点）：创建产品流程实例
// ============================================================

type ProductRequirementNode struct {
	core.BaseNode
}

func (n *ProductRequirementNode) Input(fc *core.FlowContext) error {
	if fc.ProcessID != "" {
		return nil
	}
	proc := processobject.NewProductProcess(fc.WorkspaceID, fc.WorkitemID, fc.WorkitemTitle, fc.DocPath)
	created := fc.CreateProcess(proc)
	fc.ProcessID = created.ID
	return nil
}

func (n *ProductRequirementNode) Processor(fc *core.FlowContext) error {
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeProductReviewRequired,
		Title:       fmt.Sprintf("产品流程已受理: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的产品 AI 托管流程已启动，正在为您进行需求头脑风暴、方案调研与方案草案输出。", fc.WorkitemTitle),
		ActionType:  notificationobject.ActionViewReview,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"workitemId":    fc.WorkitemID,
			"workitemTitle": fc.WorkitemTitle,
			"processId":     fc.ProcessID,
			"workspacePath": fc.WorkspacePath,
			"workspaceId":   fc.WorkspaceID,
			"tenantId":      fc.TenantID,
			"userName":      fc.UserName,
		},
	})
	if err != nil {
		log.Printf("[ProductRequirementNode] create notification failed: %v", err)
	}
	return nil
}

func (n *ProductRequirementNode) Output(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductBrainstorm, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    fmt.Sprintf("需求「%s」", fc.WorkitemTitle),
		OutputDesc:   "确认进入 AI 产品托管流程",
	})
	return nil
}

// ============================================================
// 需求头脑风暴（AI ACTION 节点）
// ============================================================

func NewProductBrainstormNode(deps *core.FlowDeps) *ProductBrainstormNode {
	return &ProductBrainstormNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductBrainstorm, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductBrainstormPrompt(fc.WorkitemTitle, fc.WorkitemDesc, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[产品头脑风暴]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.BrainstormResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageProductBrainstorm, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "结构化需求要点",
					Prompt:     fc.BrainstormResult,
				})
				return nil
			},
		},
	}
}

type ProductBrainstormNode struct {
	CodeWriteNode
}

func (n *ProductBrainstormNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductBrainstorm, processobject.UpdateStageRequest{
		Status:         processobject.StageStatusInProgress,
		OperatorType:   processobject.OperatorTypeAI,
		OperatorName:   fc.UserName,
		AgentRole:      processobject.AgentRoleProduct,
		InputDesc:      fmt.Sprintf("需求「%s」", fc.WorkitemTitle),
		ExtraInputDesc: "业务背景",
		OutputDesc:     "结构化需求要点",
	})
	return nil
}

// ============================================================
// 需求拆解（AI ACTION 节点）：功能拆解清单与模块关系图
// ============================================================

func NewProductBreakdownNode(deps *core.FlowDeps) *ProductBreakdownNode {
	return &ProductBreakdownNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductBreakdown, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductBreakdownPrompt(fc.WorkitemTitle, fc.BrainstormResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[需求拆解]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.BreakdownResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageProductBreakdown, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "功能拆解清单、模块关系图",
					Prompt:     fc.BreakdownResult,
				})
				return nil
			},
		},
	}
}

type ProductBreakdownNode struct {
	CodeWriteNode
}

func (n *ProductBreakdownNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductBreakdown, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "结构化需求要点",
		OutputDesc:   "功能拆解清单、模块关系图",
	})
	return nil
}

// ============================================================
// 方案调研与选型（AI ACTION 节点）
// ============================================================

func NewProductResearchNode(deps *core.FlowDeps) *ProductResearchNode {
	return &ProductResearchNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductResearch, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductResearchPrompt(fc.WorkitemTitle, fc.BrainstormResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[产品调研]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.ResearchResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageProductResearch, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "业务方案、技术约束、备选方案对比",
					Prompt:     fc.ResearchResult,
				})
				return nil
			},
		},
	}
}

type ProductResearchNode struct {
	CodeWriteNode
}

func (n *ProductResearchNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductResearch, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "结构化需求要点",
		OutputDesc:   "业务方案、技术约束、备选方案对比",
	})
	return nil
}

// ============================================================
// 方案草案输出（AI ACTION 节点）
// ============================================================

func NewProductDraftNode(deps *core.FlowDeps) *ProductDraftNode {
	return &ProductDraftNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductDraft, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductDraftPrompt(fc.WorkitemTitle, fc.ResearchResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[方案草案]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.DraftResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageProductDraft, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "初步业务方案",
					Prompt:     fc.DraftResult,
				})
				return nil
			},
		},
	}
}

type ProductDraftNode struct {
	CodeWriteNode
}

func (n *ProductDraftNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductDraft, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "调研结论",
		OutputDesc:   "初步业务方案",
	})
	return nil
}

// ============================================================
// AI 草案复核（AI JUDGE 节点）：自动判定 pass/reject
// ============================================================

func NewProductAIDraftReviewNode(deps *core.FlowDeps) *ProductAIDraftReviewNode {
	return &ProductAIDraftReviewNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductAIDraftReview, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductAIDraftReviewPrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[AI草案复核]",
			AfterComplete: func(fc *core.FlowContext) error {
				report := core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.AIDraftReviewResult = report
				// 解析决策：默认 pass（解析失败时交人工兜底）
				fc.ProductAIDraftReviewResult = aiDecisionPass
				if strings.Contains(strings.ToLower(report), aiDecisionReject) {
					fc.ProductAIDraftReviewResult = aiDecisionReject
				}
				outputDesc := "AI 复核通过，进入人工复核"
				if fc.ProductAIDraftReviewResult == aiDecisionReject {
					outputDesc = "AI 复核不通过，返回方案草案"
				}
				fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: outputDesc,
					Prompt:     report,
				})
				return nil
			},
		},
	}
}

type ProductAIDraftReviewNode struct {
	CodeWriteNode
}

func (n *ProductAIDraftReviewNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "初步业务方案",
		OutputDesc:   "AI 复核报告（含 pass/reject）",
	})
	return nil
}

func (n *ProductAIDraftReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductAIDraftReviewResult == aiDecisionPass {
		return processobject.StageProductReview
	}
	return processobject.StageProductDraft
}

// ============================================================
// 方案自主复核（人工 JUDGE 节点）
// ============================================================

type ProductReviewNode struct {
	core.BaseNode
}

func (n *ProductReviewNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "初步业务方案",
		OutputDesc:   "待复核方案",
		Prompt:       fc.DraftResult,
	})
	return nil
}

func (n *ProductReviewNode) Processor(fc *core.FlowContext) error {
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeProductReviewRequired,
		Title:       fmt.Sprintf("方案自主复核: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的业务方案草案已生成，请复核。通过则进入 PRD 生成，不通过将返回重新输出方案。", fc.WorkitemTitle),
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeProductReviewRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
			"draftResult":      fc.DraftResult,
		},
	})
	if err != nil {
		log.Printf("[ProductReviewNode] create notification failed: %v", err)
	}
	return core.ErrPauseFlow
}

func (n *ProductReviewNode) Output(fc *core.FlowContext) error {
	outputDesc := "复核通过，进入 PRD 生成"
	if fc.ProductReviewResult != "pass" {
		outputDesc = "复核不通过，返回方案草案输出"
	}
	fc.UpdateStageFull(processobject.StageProductReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		OutputDesc:   outputDesc,
	})
	return nil
}

func (n *ProductReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductReviewResult == "pass" {
		return processobject.StageProductPRDWrite
	}
	return processobject.StageProductDraft
}

// ============================================================
// AI 网关（AI GATEWAY 节点）：决策是否需要原型
// ============================================================

func NewProductAIGatewayNode(deps *core.FlowDeps) *ProductAIGatewayNode {
	return &ProductAIGatewayNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductAIGateway, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductAIGatewayPrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[AI网关决策]",
			AfterComplete: func(fc *core.FlowContext) error {
				decision := core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.AIGatewayResult = decision
				// 解析决策：默认需要原型（解析失败时保守走完整流程）
				fc.NeedProto = true
				if strings.Contains(decision, needProtoFalseMark) {
					fc.NeedProto = false
				}
				outputDesc := "决策：生成原型 + PRD（并行）"
				if !fc.NeedProto {
					outputDesc = "决策：仅生成 PRD（跳过原型）"
				}
				fc.UpdateStageFull(processobject.StageProductAIGateway, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: outputDesc,
					Prompt:     decision,
				})
				return nil
			},
		},
	}
}

type ProductAIGatewayNode struct {
	CodeWriteNode
}

func (n *ProductAIGatewayNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductAIGateway, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "方案复核通过结论",
		OutputDesc:   "决策结论（输出路径）",
	})
	return nil
}

// ============================================================
// PRD初稿生成（AI ACTION 节点）
// ============================================================

func NewProductPRDWriteNode(deps *core.FlowDeps) *ProductPRDWriteNode {
	return &ProductPRDWriteNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductPRDWrite, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductPRDWritePrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[PRD生成]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.PRDResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageProductPRDWrite, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "结构化 PRD 文档",
					Prompt:     fc.PRDResult,
				})
				return nil
			},
		},
	}
}

type ProductPRDWriteNode struct {
	CodeWriteNode
}

func (n *ProductPRDWriteNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductPRDWrite, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "定稿方案",
		OutputDesc:   "结构化 PRD 文档",
	})
	return nil
}

// ============================================================
// 原型生成（AI ACTION 节点）
// ============================================================

func NewProductProtoMakeNode(deps *core.FlowDeps) *ProductProtoMakeNode {
	return &ProductProtoMakeNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductProtoMake, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductProtoMakePrompt(fc.WorkitemTitle, fc.PRDResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[原型生成]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.ProtoResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				fc.UpdateStageFull(processobject.StageProductProtoMake, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "UI 交互原型",
					Prompt:     fc.ProtoResult,
				})
				return nil
			},
		},
	}
}

type ProductProtoMakeNode struct {
	CodeWriteNode
}

func (n *ProductProtoMakeNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductProtoMake, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "结构化 PRD 文档",
		OutputDesc:   "UI 交互原型",
	})
	return nil
}

// ============================================================
// 原型交互复核（人工 JUDGE 节点）：产品经理复核原型
// ============================================================

type ProductProtoReviewNode struct {
	core.BaseNode
}

func (n *ProductProtoReviewNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductProtoReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "UI 交互原型 + 结构化 PRD",
		OutputDesc:   "待复核原型",
		Prompt:       fc.ProtoResult,
	})
	return nil
}

func (n *ProductProtoReviewNode) Processor(fc *core.FlowContext) error {
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeProductProtoReviewRequired,
		Title:       fmt.Sprintf("原型交互复核: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的原型已生成，请进行交互复核。通过则进入需求评审，不通过将返回 PRD 初稿生成节点修订。", fc.WorkitemTitle),
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeProductProtoReviewRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
			"prdResult":        fc.PRDResult,
			"protoResult":      fc.ProtoResult,
		},
	})
	if err != nil {
		log.Printf("[ProductProtoReviewNode] create notification failed: %v", err)
	}
	return core.ErrPauseFlow
}

func (n *ProductProtoReviewNode) Output(fc *core.FlowContext) error {
	outputDesc := "复核通过，进入需求评审"
	if fc.ProductProtoReviewResult != "pass" {
		outputDesc = "复核不通过，返回 PRD 初稿生成节点"
	}
	fc.UpdateStageFull(processobject.StageProductProtoReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		OutputDesc:   outputDesc,
	})
	return nil
}

func (n *ProductProtoReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductProtoReviewResult == "pass" {
		return processobject.StageProductFinalReview
	}
	return processobject.StageProductPRDWrite
}

// ============================================================
// 需求评审（人工 ACTION 结束节点）
// ============================================================

type ProductFinalReviewNode struct {
	core.BaseNode
}

func (n *ProductFinalReviewNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductFinalReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "通过复查的 PRD + 原型",
		OutputDesc:   "待最终需求评审",
		Prompt:       fc.PRDResult,
	})
	return nil
}

func (n *ProductFinalReviewNode) Processor(fc *core.FlowContext) error {
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeProductFinalReviewRequired,
		Title:       fmt.Sprintf("需求评审: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的 PRD 与原型已准备就绪，请进行最终需求评审。通过后流程结束，可一键启动 AI 开发。", fc.WorkitemTitle),
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeProductFinalReviewRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
			"prdResult":        fc.PRDResult,
			"protoResult":      fc.ProtoResult,
		},
	})
	if err != nil {
		log.Printf("[ProductFinalReviewNode] create notification failed: %v", err)
	}
	return core.ErrPauseFlow
}

func (n *ProductFinalReviewNode) Output(fc *core.FlowContext) error {
	outputDesc := "需求定稿，可一键启动 AI 开发"
	if fc.ProductFinalReviewResult != "pass" {
		outputDesc = "需求评审驳回，返回 PRD 初稿生成节点"
	}
	fc.UpdateStageFull(processobject.StageProductFinalReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		OutputDesc:   outputDesc,
	})
	return nil
}

func (n *ProductFinalReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductFinalReviewResult == "pass" {
		return "" // 流程结束
	}
	return processobject.StageProductPRDWrite
}
