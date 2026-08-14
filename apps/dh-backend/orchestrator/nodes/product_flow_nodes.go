package nodes

import (
	"fmt"
	"log"
	"strings"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)

// AI 决策输出标记常量
const (
	aiDecisionPass     = "pass"
	aiDecisionReject   = "reject"
	needProtoTrueMark  = "NEED_PROTO: true"
	needProtoFalseMark = "NEED_PROTO: false"
)

// maxAIDraftReviewRetries 是 AI 草案复核的最大自动重试次数。
// AI 判定不通过时自动重新生成草案并再次复核；达到上限后暂停，交由用户人工通过/拒绝。
const maxAIDraftReviewRetries = 2

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
// 需求头脑风暴（数据复用节点）：复用发起流程时的头脑风暴文档，不实际发起 AI 头脑风暴
// ============================================================

// NewProductBrainstormNode 创建需求头脑风暴节点。
// 复用发起流程时传入的源文档（docPath）作为头脑风暴数据，不再调用 /grill-me 发起多轮提问。
func NewProductBrainstormNode(deps *core.FlowDeps) *ProductBrainstormNode {
	return &ProductBrainstormNode{
		BaseNode: core.NewBaseNode(processobject.StageProductBrainstorm, core.NodeTypeAI, deps),
	}
}

type ProductBrainstormNode struct {
	core.BaseNode
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

func (n *ProductBrainstormNode) Processor(fc *core.FlowContext) error {
	// 复用发起流程时的头脑风暴文档内容作为拆解输入；无 docPath 时降级用需求描述。
	if fc.DocPath == "" {
		fc.BrainstormResult = fc.WorkitemDesc
		return nil
	}
	sc := stubclient.FromContext(fc.Ctx)
	if sc == nil {
		return fmt.Errorf("stubclient not available")
	}
	content, err := sc.ReadFile(fc.Ctx, fc.DocPath)
	if err != nil {
		return fmt.Errorf("read brainstorm doc: %w", err)
	}
	fc.BrainstormResult = content
	return nil
}

func (n *ProductBrainstormNode) Output(fc *core.FlowContext) error {
	// 交付物为头脑风暴文件标记，前端据此渲染文件卡片（而非会话内容）。
	prompt := fc.BrainstormResult
	if fc.DocPath != "" {
		prompt = fmt.Sprintf("[[FILE:%s]]", fc.DocPath)
	}
	fc.UpdateStageFull(processobject.StageProductBrainstorm, processobject.UpdateStageRequest{
		Status:     processobject.StageStatusCompleted,
		OutputDesc: "结构化需求要点",
		Prompt:     prompt,
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
				return prompts.BuildProductResearchPrompt(fc.WorkitemTitle, fc.BreakdownResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[产品调研]",
			AfterComplete: func(fc *core.FlowContext) error {
				// ResearchResult 保留完整会话内容供下一节点（方案草案）使用；
				// 交付物 Prompt 仅存最终文件标记，前端据此渲染文件卡片而非会话内容。
				fc.ResearchResult = core.FetchLastAssistantMessage(fc, deps.Messages)
				prompt := fc.ResearchResult
				if marker := core.ExtractLastFileMarker(fc.ResearchResult); marker != "" {
					prompt = marker
				}
				fc.UpdateStageFull(processobject.StageProductResearch, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: "需求价值分析、技术与业务风险、备选方案对比",
					Prompt:     prompt,
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
		InputDesc:    "需求拆解清单",
		OutputDesc:   "需求价值分析、技术与业务风险、备选方案对比",
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
				OutputDesc: "需求方案草案",
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
		InputDesc:    "调研结论（含拆解与脑暴）",
		OutputDesc:   "需求方案草案",
	})
	return nil
}

// ============================================================
// AI 草案复核（AI JUDGE 节点）：自动判定 pass/reject
// ============================================================

// ============================================================
// AI 草案复核（混合节点）：AI 自动判定 + 2 次重试 + 人工通过/拒绝
// ============================================================

// NewProductAIDraftReviewNode 创建 AI 草案复核节点。
// AI 自动生成复核建议并判定 pass/reject：pass 进入方案自主复核；reject 自动重新生成草案并再次复核，
// 最多自动重试 maxAIDraftReviewRetries 次；达到上限后暂停，交由用户人工通过/拒绝。
func NewProductAIDraftReviewNode(deps *core.FlowDeps) *ProductAIDraftReviewNode {
	return &ProductAIDraftReviewNode{
		BaseNode: core.NewBaseNode(processobject.StageProductAIDraftReview, core.NodeTypeAI, deps),
	}
}

type ProductAIDraftReviewNode struct {
	core.BaseNode
}

func (n *ProductAIDraftReviewNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		InputDesc:    "初步业务方案",
		OutputDesc:   "复核建议（结论、质量评分、整改意见）",
	})
	return nil
}

func (n *ProductAIDraftReviewNode) Processor(fc *core.FlowContext) error {
	deps := n.Deps
	// 1. AI 生成复核建议
	prompt := prompts.BuildProductAIDraftReviewPrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
	log.Printf("[ProductAIDraftReviewNode] AI review prompt length=%d", len(prompt))
	fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
		Status:      processobject.StageStatusInProgress,
		Prompt:      prompt,
		InputPrompt: prompt,
		// RetryCount 记录当前是第几次复核（第 1 次为 1），供前端展示「第 N 次复核」。
		RetryCount: fc.AIDraftReviewRejectCount + 1,
	})
	text, err := runAIGeneration(deps, fc, prompt, "[AI草案复核]")
	if err != nil {
		fc.FailStagef(deps, n.Name(), "AI 草案复核失败: %v", err)
		return err
	}

	// 2. 提取复核建议正文，并 AI 判定 pass/reject（仅作为默认结论，最终以人工决策为准）
	reviewSummary := core.ExtractReviewSection(text)
	fc.AIDraftReviewResult = reviewSummary
	fc.ProductAIDraftReviewResult = parseDraftReviewDecision(reviewSummary)

	// 把复核建议写入 stage.prompt，供前端建议卡片展示（暂停等待人工决策时也能看到）。
	fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
		SessionID: fc.SessionID,
		Prompt:    reviewSummary,
	})

	// 3. reject 且达到自动重试上限 → 发送通知，暂停等人工通过/拒绝
	if fc.ProductAIDraftReviewResult == aiDecisionReject && fc.AIDraftReviewRejectCount+1 >= maxAIDraftReviewRetries {
		if err := n.sendDecisionNotification(fc); err != nil {
			log.Printf("[ProductAIDraftReviewNode] send decision notification failed: %v", err)
		}
		return core.ErrPauseFlow
	}
	return nil
}

func (n *ProductAIDraftReviewNode) Output(fc *core.FlowContext) error {
	outputDesc := "复核通过，进入方案自主复核"
	if fc.ProductAIDraftReviewResult == aiDecisionReject {
		outputDesc = "复核不通过，返回方案草案"
	}
	fc.UpdateStageFull(processobject.StageProductAIDraftReview, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleProduct,
		OutputDesc:   outputDesc,
		Prompt:       fc.AIDraftReviewResult,
		ExtraInput:   fc.DraftResult,
	})
	return nil
}

func (n *ProductAIDraftReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ProductAIDraftReviewResult == aiDecisionPass {
		return processobject.StageProductReview
	}
	fc.AIDraftReviewRejectCount++
	return processobject.StageProductDraft
}

// sendDecisionNotification 发送 AI 草案复核人工通过/拒绝的通知。
func (n *ProductAIDraftReviewNode) sendDecisionNotification(fc *core.FlowContext) error {
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeProductAIDraftReviewRequired,
		Title:       fmt.Sprintf("AI 草案复核: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的 AI 草案复核 %d 次未通过，请人工确认通过或拒绝。", fc.WorkitemTitle, fc.AIDraftReviewRejectCount+1),
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeProductAIDraftReviewRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
			"reviewResult":     fc.AIDraftReviewResult,
			"draftResult":      fc.DraftResult,
		},
	})
	return err
}

// parseDraftReviewDecision 从复核建议正文里解析 pass/reject 决策。
// 只检查「复核结论」标记后的短文本，避免思考过程/问题列表里引用 "pass/reject" 模板示例
// 导致全文搜索 "reject" 误判。未找到标记或解析失败时默认 pass（交人工兜底）。
func parseDraftReviewDecision(report string) string {
	lower := strings.ToLower(report)
	idx := strings.Index(lower, "复核结论")
	if idx < 0 {
		return aiDecisionPass
	}
	end := idx + 40
	if end > len(lower) {
		end = len(lower)
	}
	if strings.Contains(lower[idx:end], aiDecisionReject) {
		return aiDecisionReject
	}
	return aiDecisionPass
}

// ============================================================
// 方案自主复核（人工 JUDGE 节点）
// ============================================================

// NewProductReviewNode 创建方案自主复核人工节点（条件分支）。
// 迁移为 core.HumanReviewNode：通过进入 AI 并行决策器，不通过返回方案草案输出。
func NewProductReviewNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageProductReview,
		InputDesc:  "初步业务方案",
		OutputDesc: "待复核方案",
		PassDesc:   "复核通过，进入 AI 并行决策器",
		FailDesc:   "复核不通过，返回方案草案输出",

		NotifType:     notificationobject.TypeProductReviewRequired,
		NotifTitleFmt: "方案自主复核: %s",
		NotifBodyFmt:  "需求「%s」的业务方案草案已生成，请复核。通过则进入 AI 并行决策器，不通过将返回重新输出方案。",

		PromptGetter: func(fc *core.FlowContext) string { return fc.DraftResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.ProductReviewResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"draftResult":         fc.DraftResult,
				"aiDraftReviewResult": fc.AIDraftReviewResult,
			}
		},
		PassNodeName: processobject.StageProductAIGateway,
		FailNodeName: processobject.StageProductDraft,
	})
}

// ============================================================
// AI 并行决策器（AI GATEWAY 节点）：决策是否需要原型
// ============================================================

func NewProductAIGatewayNode(deps *core.FlowDeps) *ProductAIGatewayNode {
	return &ProductAIGatewayNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageProductAIGateway, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildProductAIGatewayPrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[AI并行决策器]",
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
				return prompts.BuildProductProtoMakePrompt(fc.WorkitemTitle, fc.DraftResult, fc.WorkspacePath)
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
		InputDesc:    "定稿方案",
		OutputDesc:   "UI 交互原型",
	})
	return nil
}

// ============================================================
// 需求设计复核（人工 JUDGE 节点）：产品经理复核 PRD 文档与原型
// ============================================================

// NewProductProtoReviewNode 创建需求设计复核人工节点（条件分支）。
// 迁移为 core.HumanReviewNode：通过进入需求评审，不通过返回方案草案重新构思。
func NewProductProtoReviewNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageProductProtoReview,
		InputDesc:  "PRD 文档 + UI 交互原型",
		OutputDesc: "待复核需求设计",
		PassDesc:   "复核通过，进入需求评审",
		FailDesc:   "复核不通过，返回方案草案",

		NotifType:     notificationobject.TypeProductProtoReviewRequired,
		NotifTitleFmt: "需求设计复核: %s",
		NotifBodyFmt:  "需求「%s」的 PRD 文档与原型已准备就绪，请进行需求设计复核。通过则进入需求评审，不通过将返回方案草案重新构思。",

		PromptGetter: func(fc *core.FlowContext) string { return fc.ProtoResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.ProductProtoReviewResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"prdResult":   fc.PRDResult,
				"protoResult": fc.ProtoResult,
			}
		},
		PassNodeName: processobject.StageProductFinalReview,
		FailNodeName: processobject.StageProductDraft,
	})
}

// ============================================================
// 需求评审（人工 ACTION 结束节点）
// ============================================================

// NewProductFinalReviewNode 创建需求评审人工节点（结束处理节点）。
// 需求评审是处理节点（Action），无驳回分支：用户确认后关联 PRD/原型到产品空间并结束流程。
func NewProductFinalReviewNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageProductFinalReview,
		InputDesc:  "通过复查的 PRD + 原型",
		OutputDesc: "待最终需求评审",
		PassDesc:   "需求定稿，关联 PRD/原型到产品空间",
		FailDesc:   "需求定稿，关联 PRD/原型到产品空间",

		NotifType:     notificationobject.TypeProductFinalReviewRequired,
		NotifTitleFmt: "需求评审: %s",
		NotifBodyFmt:  "需求「%s」的 PRD 与原型已准备就绪，请确认完成需求评审。确认后 PRD 与原型将关联到需求并放入产品空间。",

		PromptGetter: func(fc *core.FlowContext) string { return fc.PRDResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.ProductFinalReviewResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"prdResult":   fc.PRDResult,
				"protoResult": fc.ProtoResult,
			}
		},
		// PassNodeName 留空表示流程结束；需求评审无驳回分支，FailNodeName 同样留空。
		PassNodeName: "",
		FailNodeName: "",
	})
}
