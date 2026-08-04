package nodes

import (
	"fmt"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)

// NewDevelopmentNode 创建需求开发节点
func NewDevelopmentNode(deps *core.FlowDeps) *DevelopmentNode {
	return &DevelopmentNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode:           core.NewBaseNode(processobject.StageDevelopment, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
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
					docInfo += "【架构设计方案（AI 生成，请严格以此为蓝图进行开发）】\n" + fc.ArchDesignResult
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
		inputDesc = "架构设计方案"
	}
	fc.UpdateStageFull(processobject.StageDevelopment, processobject.UpdateStageRequest{
		Status:         processobject.StageStatusInProgress,
		OperatorType:   processobject.OperatorTypeAI,
		OperatorName:   fc.UserName,
		AgentRole:      processobject.AgentRoleDevelopment,
		InputDesc:      inputDesc,
		ExtraInputDesc: "开发提示词",
		OutputDesc:     "工程代码",
	})
	return nil
}

// NewCodeOptimizeNode 创建代码优化节点
func NewCodeOptimizeNode(deps *core.FlowDeps) *CodeOptimizeNode {
	return &CodeOptimizeNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode:           core.NewBaseNode(processobject.StageCodeOptimize, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildOptimizePrompt(fc.ReviewResult, fc.DeveloperPrompt)
			},
			SessionTitlePrefix: "[AI优化]",
			SessionContextExtra: map[string]any{
				"optimize": true,
			},
			AfterComplete: func(fc *core.FlowContext) error {
				fc.UpdateStage(processobject.StageCodeOptimize, processobject.StageStatusCompleted)
				deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
					UserID:      fc.UserID,
					TenantID:    fc.TenantID,
					WorkspaceID: fc.WorkspaceID,
					Type:        notificationobject.TypeAIDevCompleted,
					Title:       fmt.Sprintf("AI开发完成: %s", fc.WorkitemTitle),
					Body:        fmt.Sprintf("需求「%s」的 AI 托管开发、评审与代码优化已全部完成，点击查看详情。", fc.WorkitemTitle),
					ActionType:  notificationobject.ActionViewReview,
					ActionURL:   fmt.Sprintf("/dev-workspace?tab=review&session=%s", fc.SessionID),
					Data: map[string]any{
						"workitemId":  fc.WorkitemID,
						"sessionId":   fc.SessionID,
						"projectPath": fmt.Sprintf("%s/dev-jobs", fc.WorkspacePath),
					},
				})
				return nil
			},
		},
	}
}

type CodeOptimizeNode struct {
	CodeWriteNode
}

func (n *CodeOptimizeNode) Input(fc *core.FlowContext) error {
	req := processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeAI,
		OperatorName: fc.UserName,
		AgentRole:    processobject.AgentRoleCodeOptimize,
		InputDesc:    "代码评审报告",
		OutputDesc:   "优化后的代码变更",
	}
	if fc.DeveloperPrompt != "" {
		req.ExtraInputDesc = "开发人员优化指示"
		req.ExtraInput = fc.DeveloperPrompt
	}
	fc.UpdateStageFull(processobject.StageCodeOptimize, req)
	return nil
}

func (n *CodeOptimizeNode) NextNode(fc *core.FlowContext) string {
	return processobject.StageReview
}

// DevCompleteNode 开发结束（人工节点）
type DevCompleteNode struct {
	core.BaseNode
}

func (n *DevCompleteNode) Input(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageDevComplete, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusInProgress,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "代码分支",
		OutputDesc:   "代码分支",
	})
	return nil
}

func (n *DevCompleteNode) Processor(fc *core.FlowContext) error {
	return nil
}

func (n *DevCompleteNode) Output(fc *core.FlowContext) error {
	fc.UpdateStageFull(processobject.StageDevComplete, processobject.UpdateStageRequest{
		Status:       processobject.StageStatusCompleted,
		OperatorType: processobject.OperatorTypeHuman,
		OperatorName: fc.UserName,
		OperatorID:   fc.UserID,
		InputDesc:    "代码分支",
		OutputDesc:   "代码分支",
	})
	return nil
}
