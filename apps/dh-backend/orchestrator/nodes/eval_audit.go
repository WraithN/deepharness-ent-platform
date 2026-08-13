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

// aiEvalSummaryTruncateLen 人工审核通知正文中 AI 评估报告的最大长度（字节截断）。
const aiEvalSummaryTruncateLen = 500

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

// NewHumanAuditNode 创建人工审核节点（条件分支）。
// 迁移为 core.HumanReviewNode：审批通过进入开发，不通过重新架构设计。
func NewHumanAuditNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageHumanAudit,
		InputDesc:  "智能评估报告",
		OutputDesc: "待审核人员审批架构设计方案",

		NotifType:     notificationobject.TypeHumanAuditRequired,
		NotifTitleFmt: "架构设计审核: %s",

		PromptGetter: func(fc *core.FlowContext) string { return fc.AIEvalResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.AuditApprovalResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"sessionId":        fc.SessionID,
				"threadId":         fc.ThreadID,
				"archDesignResult": fc.ArchDesignResult,
				"aiEvalResult":     fc.AIEvalResult,
			}
		},
		OutputDescBuilder: func(fc *core.FlowContext) string {
			if fc.AuditApprovalResult == "pass" {
				return fmt.Sprintf("%s审核通过，进入需求开发", fc.UserName)
			}
			return fmt.Sprintf("%s审核不通过，需重新进行架构设计", fc.UserName)
		},
		PassNodeName: processobject.StageDevelopment,
		FailNodeName: processobject.StageArchDesign,

		DedupCheckType: notificationobject.TypeHumanAuditRequired,
		BodyBuilder:    buildHumanAuditBody,
	})
}

// buildHumanAuditBody 构造人工审核通知正文：AI 评估报告（超长截断）附于审核说明之后。
func buildHumanAuditBody(fc *core.FlowContext) string {
	aiEvalSummary := fc.AIEvalResult
	if len(aiEvalSummary) > aiEvalSummaryTruncateLen {
		aiEvalSummary = aiEvalSummary[:aiEvalSummaryTruncateLen] + "..."
	}
	return fmt.Sprintf("需求「%s」的架构设计已完成 AI 智能评估，请审核。审批通过则进入开发，审批不通过将重新进行架构设计。\n\n---\nAI 评估报告：\n%s", fc.WorkitemTitle, aiEvalSummary)
}
