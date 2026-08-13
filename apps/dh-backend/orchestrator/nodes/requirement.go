package nodes

import (
	"fmt"
	"log"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/prompts"
)

// requirementDescTruncateLen 需求评估通知正文中需求描述的最大长度（字节截断）。
const requirementDescTruncateLen = 200

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

// NewRequirementEvalNode 创建需求评估人工节点（条件分支）。
// 迁移为 core.HumanReviewNode：通知前通过 PreProcessor 执行 AI 复杂度预评估，
// 评审结果由 fc.NeedArchDesign 决定路由（复杂走架构设计，简单直接开发）。
func NewRequirementEvalNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageRequirementEval,
		OutputDesc: "评估需求复杂度，决定是否需要架构设计",
		PassDesc:   "需求较复杂，需要进行架构设计",
		FailDesc:   "需求较简单，直接进入开发",

		NotifType:     notificationobject.TypeRequirementEvalRequired,
		NotifTitleFmt: "需求评估: %s",

		InputDescBuilder: func(fc *core.FlowContext) string {
			return fmt.Sprintf("需求「%s」", fc.WorkitemTitle)
		},
		// NeedArchDesign 为 bool：映射为 pass（需要架构设计）/ reject（直接开发）。
		// 基类 NextNode/Output 均以 ResultGetter=="pass" 判定，故 pass 对应 StageArchDesign。
		ResultGetter: func(fc *core.FlowContext) string {
			if fc.NeedArchDesign {
				return "pass"
			}
			return "reject"
		},
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"workitemDesc":          fc.WorkitemDesc,
				"requirementEvalResult": fc.RequirementEvalResult,
			}
		},
		PassNodeName: processobject.StageArchDesign,
		FailNodeName: processobject.StageDevelopment,

		DedupCheckType: notificationobject.TypeRequirementEvalRequired,
		PreProcessor: func(fc *core.FlowContext) error {
			return evalRequirementComplexity(deps, fc)
		},
		BodyBuilder: buildRequirementEvalBody,
	})
}

// evalRequirementComplexity 通知前预评估：调用 AI 判断需求复杂度，结果写入 fc.RequirementEvalResult。
// AI 调用失败不阻断流程（沿用旧行为），仅记录日志。
func evalRequirementComplexity(deps *core.FlowDeps, fc *core.FlowContext) error {
	prompt := prompts.BuildRequirementEvalPrompt(fc.WorkitemTitle, fc.WorkitemDesc)
	log.Printf("[RequirementEvalNode] AI eval prompt length=%d", len(prompt))

	_, events, err := deps.AGUIClient.Run(fc.Ctx, core.BuildRunInput("", prompt, fc.WorkspacePath))
	if err != nil {
		log.Printf("[RequirementEvalNode] AI eval Run failed: %v", err)
		return nil
	}

	result := core.ConsumeEvents(events)
	if result.Error != nil {
		log.Printf("[RequirementEvalNode] AI eval error: %v", result.Error)
	}

	if result.Text == "" {
		log.Printf("[RequirementEvalNode] AI eval returned empty text")
		return nil
	}

	fc.RequirementEvalResult = result.Text
	log.Printf("[RequirementEvalNode] AI eval result length=%d", len(result.Text))
	return nil
}

// buildRequirementEvalBody 构造需求评估通知正文：需求描述（超长截断）+ 可选 AI 评估参考。
func buildRequirementEvalBody(fc *core.FlowContext) string {
	desc := fc.WorkitemDesc
	if len(desc) > requirementDescTruncateLen {
		desc = desc[:requirementDescTruncateLen] + "..."
	}
	body := fmt.Sprintf("需求「%s」已受理，请评估是否需要架构设计。\n\n描述: %s", fc.WorkitemTitle, desc)
	if fc.RequirementEvalResult != "" {
		body += fmt.Sprintf("\n\n---\nAI 评估参考：\n%s", fc.RequirementEvalResult)
	}
	return body
}
