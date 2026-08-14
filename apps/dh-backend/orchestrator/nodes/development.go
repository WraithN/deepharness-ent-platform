package nodes

import (
	"fmt"
	"log"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)

// NewDevelopmentNode 创建 AI 开发节点
// 返修复用：当 fc.ReviewResult 非空（AI 代码评审/人工评审不通过返回）时，
// 改用评审修复提示词（含评审报告与人工修改指示），在原工程上修复而非重新生成。
func NewDevelopmentNode(deps *core.FlowDeps) *DevelopmentNode {
	return &DevelopmentNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageDevelopment, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				// 返修模式：评审不通过返回 AI 开发，携带评审报告与人工修改指示
				if fc.ReviewResult != "" {
					return prompts.BuildOptimizePrompt(fc.ReviewResult, fc.DeveloperPrompt)
				}
				designItems, _ := deps.WorkItemSvc.ListRequirementsWithDesignItems(fc.WorkspaceID)
				var docInfo, protoInfo string
				for _, d := range designItems {
					if d.WorkitemID == fc.WorkitemID {
						if d.Doc != nil {
							docInfo = fmt.Sprintf("文档: %s（路径: %s，版本: v%d）", d.Doc.Title, d.Doc.RelativePath, d.Doc.CurrentVersion)
						}
						if d.Prototype != nil {
							protoInfo = fmt.Sprintf("原型: %s（路径: %s，版本: v%d）", d.Prototype.Title, d.Prototype.RelativePath, d.Prototype.CurrentVersion)
						}
						break
					}
				}
				if fc.ArchDesignResult != "" {
					if docInfo != "" {
						docInfo += "\n\n"
					}
					docInfo += "【方案设计文档（AI 生成，请严格以此为蓝图进行开发）】\n" + fc.ArchDesignResult
				}
				return prompts.BuildCodePrompt(fc.WorkitemTitle, fc.WorkitemDesc, fc.WorkspacePath, fc.RepositoryID, fc.ProjectName, docInfo, protoInfo)
			},
			SessionTitlePrefix: "[AI托管]",
			AfterComplete: func(fc *core.FlowContext) error {
				fc.DevSessionID = fc.SessionID
				fc.DevThreadID = fc.ThreadID
				outputDesc := core.ScanProjectSummary(fc.WorkspacePath)
				if outputDesc == "" {
					outputDesc = "工程代码"
				}
				fc.UpdateStageFull(processobject.StageDevelopment, processobject.UpdateStageRequest{
					Status:     processobject.StageStatusCompleted,
					OutputDesc: outputDesc,
				})
				return nil
			},
		},
	}
}

type DevelopmentNode struct {
	CodeWriteNode
}

func (n *DevelopmentNode) Input(fc *core.FlowContext) error {
	inputDesc := "需求受理确认"
	if fc.NeedArchDesign {
		inputDesc = "方案设计文档"
	}
	req := processobject.UpdateStageRequest{
		Status:         processobject.StageStatusInProgress,
		OperatorType:   processobject.OperatorTypeAI,
		OperatorName:   fc.UserName,
		AgentRole:      processobject.AgentRoleDevelopment,
		InputDesc:      inputDesc,
		ExtraInputDesc: "开发提示词",
		OutputDesc:     "工程代码",
	}
	// 返修模式：展示评审报告来源与人工修改指示
	if fc.ReviewResult != "" {
		req.InputDesc = "代码评审报告（返修）"
		if fc.DeveloperPrompt != "" {
			req.ExtraInputDesc = "人工修改指示"
			req.ExtraInput = fc.DeveloperPrompt
		}
	}
	fc.UpdateStageFull(processobject.StageDevelopment, req)
	return nil
}

// DevCompleteNode 人工介入（人工节点，流程终态）。
// 该节点有两个入口：人工评审通过（开发完成交付）与需求评估不通过（跳过开发直接接管）。
// 通过 fc.PausedNode 区分来源：从需求评估恢复而来时按"转人工介入"展示，否则按"代码分支"展示。
// 从人工评审入口到达时发送"AI 开发完成"通知（原由代码优化节点发出，代码优化节点删除后迁至此处）。
type DevCompleteNode struct {
	core.BaseNode
}

// devCompleteStageDescs 返回人工介入节点按来源区分的输入/交付物描述。
func devCompleteStageDescs(fc *core.FlowContext) (inputDesc, outputDesc string) {
	if fc.PausedNode == processobject.StageRequirementEval {
		return "需求评估不通过结论", "需求评估不通过，转人工介入处理"
	}
	return "代码分支", "代码分支"
}

func (n *DevCompleteNode) Input(fc *core.FlowContext) error {
	inputDesc, outputDesc := devCompleteStageDescs(fc)
	fc.UpdateStageFull(processobject.StageDevComplete, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    inputDesc,
		OutputDesc:   outputDesc,
	})
	return nil
}

func (n *DevCompleteNode) Processor(fc *core.FlowContext) error {
	return nil
}

func (n *DevCompleteNode) Output(fc *core.FlowContext) error {
	inputDesc, outputDesc := devCompleteStageDescs(fc)
	fc.UpdateStageFull(processobject.StageDevComplete, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    inputDesc,
		OutputDesc:   outputDesc,
	})
	n.notifyDevCompleted(fc)
	return nil
}

// notifyDevCompleted 仅在人工评审通过入口（开发完成交付）时发送完成通知；
// 需求评估不通过直接接管的路径未产生代码，不发送。
func (n *DevCompleteNode) notifyDevCompleted(fc *core.FlowContext) {
	if fc.PausedNode != processobject.StageHumanReview {
		return
	}
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeAIDevCompleted,
		Title:       fmt.Sprintf("AI开发完成: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的 AI 托管开发与评审已全部完成，点击查看详情。", fc.WorkitemTitle),
		ActionType:  notificationobject.ActionViewReview,
		ActionURL:   fmt.Sprintf("/dev-workspace?tab=review&session=%s", fc.DevSessionID),
		Data: map[string]any{
			"workitemId":  fc.WorkitemID,
			"sessionId":   fc.DevSessionID,
			"projectPath": fmt.Sprintf("%s/dev-jobs", fc.WorkspacePath),
		},
	})
	if err != nil {
		log.Printf("[DevCompleteNode] send completed notification failed: %v", err)
	}
}
