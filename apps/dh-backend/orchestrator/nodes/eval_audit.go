package nodes

import (
	"fmt"
	"log"
	"strings"
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

// maxAIEvalRetries 是 AI 方案评估的最大自动尝试次数（与产品流程 maxAIDraftReviewRetries 模式一致）。
// reject 且达到上限后暂停流程，交由用户人工通过/拒绝。
const maxAIEvalRetries = 2

// aiEvalDecisionWindowLen 解析评估结论时，在「评估结论」标记后检查的最大字符窗口。
const aiEvalDecisionWindowLen = 40

// AiEvalNode AI 方案评估（混合判断节点）：AI 自动判定 pass/reject。
// pass 进入人工审核；reject 自动返回方案设计重新评估，最多自动尝试 maxAIEvalRetries 次；
// 达到上限后暂停，交由用户人工通过/拒绝（参照产品流程 AI 草案复核混合节点模式）。
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
		InputDesc:    "方案设计文档",
		OutputDesc:   "AI 方案评估报告",
		Prompt:       prompt,
	})
	return nil
}

func (n *AiEvalNode) Processor(fc *core.FlowContext) error {
	deps := n.Deps
	prompt := prompts.BuildAIEvalPrompt(fc.ArchDesignResult, fc.WorkitemTitle, fc.WorkitemDesc)

	_, events, err := deps.AGUIClient.Run(fc.Ctx, core.BuildRunInput(fc.ThreadID, prompt, fc.WorkspacePath))
	if err != nil {
		fc.FailStagef(deps, processobject.StageAIEval, "方案评估启动失败: %v", err)
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
		fc.FailStagef(deps, processobject.StageAIEval, "方案评估失败: %v", result.Error)
		return result.Error
	}

	// 解析 AI 评估结论（pass/reject），并记录当前是第几次评估（供前端展示「第 N 次评估」）。
	fc.AIEvalDecision = parseAIEvalDecision(result.Text)
	fc.UpdateStageFull(processobject.StageAIEval, processobject.UpdateStageRequest{
		Status:     processobject.StageStatusInProgress,
		SessionID:  fc.SessionID,
		Prompt:     fc.AIEvalResult,
		RetryCount: fc.AIEvalRejectCount + 1,
	})

	// reject 且达到自动尝试上限 → 发送通知，暂停等人工通过/拒绝
	if fc.AIEvalDecision == aiEvalDecisionReject && fc.AIEvalRejectCount+1 >= maxAIEvalRetries {
		if err := n.sendDecisionNotification(fc); err != nil {
			log.Printf("[AiEvalNode] send decision notification failed: %v", err)
		}
		return core.ErrPauseFlow
	}
	return nil
}

func (n *AiEvalNode) Output(fc *core.FlowContext) error {
	outputDesc := "评估通过，进入人工审核"
	if fc.AIEvalDecision == aiEvalDecisionReject {
		outputDesc = "评估不通过，返回方案设计"
	}
	fc.UpdateStageFull(processobject.StageAIEval, processobject.UpdateStageRequest{
		Status:     processobject.StageStatusCompleted,
		OutputDesc: outputDesc,
		Prompt:     fc.AIEvalResult,
	})
	return nil
}

func (n *AiEvalNode) NextNode(fc *core.FlowContext) string {
	if fc.AIEvalDecision == aiEvalDecisionReject {
		fc.AIEvalRejectCount++
		return processobject.StageArchDesign
	}
	return processobject.StageHumanAudit
}

// sendDecisionNotification 发送 AI 方案评估人工通过/拒绝的通知。
// ExtraData 携带 sessionId/threadId/archDesignResult/aiEvalResult，供人工裁决后恢复流程上下文。
func (n *AiEvalNode) sendDecisionNotification(fc *core.FlowContext) error {
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeAIEvalReviewRequired,
		Title:       fmt.Sprintf("AI 方案评估: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的 AI 方案评估 %d 次未通过，请人工确认通过或拒绝。", fc.WorkitemTitle, fc.AIEvalRejectCount+1),
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeAIEvalReviewRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
			"sessionId":        fc.SessionID,
			"threadId":         fc.ThreadID,
			"archDesignResult": fc.ArchDesignResult,
			"aiEvalResult":     fc.AIEvalResult,
		},
	})
	return err
}

// AI 方案评估结论常量（与产品流程 aiDecisionPass/aiDecisionReject 取值保持一致）。
const (
	aiEvalDecisionPass   = "pass"
	aiEvalDecisionReject = "reject"
)

// parseAIEvalDecision 从评估报告正文里解析 pass/reject 决策。
// 只检查「评估结论」标记后的短文本窗口，避免正文引用 "pass/reject" 模板示例导致误判。
// 未找到标记或解析失败时默认 pass（交人工兜底），与产品流程 parseDraftReviewDecision 同策略。
func parseAIEvalDecision(report string) string {
	lower := strings.ToLower(report)
	idx := strings.Index(lower, "评估结论")
	if idx < 0 {
		return aiEvalDecisionPass
	}
	end := idx + aiEvalDecisionWindowLen
	if end > len(lower) {
		end = len(lower)
	}
	if strings.Contains(lower[idx:end], aiEvalDecisionReject) {
		return aiEvalDecisionReject
	}
	return aiEvalDecisionPass
}

// NewHumanAuditNode 创建人工审核节点（条件分支）。
// 迁移为 core.HumanReviewNode：审批通过进入开发，不通过重新方案设计。
func NewHumanAuditNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageHumanAudit,
		InputDesc:  "AI 方案评估报告",
		OutputDesc: "待审核人员审批方案设计文档",

		NotifType:     notificationobject.TypeHumanAuditRequired,
		NotifTitleFmt: "方案设计审核: %s",

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
			return fmt.Sprintf("%s审核不通过，需重新进行方案设计", fc.UserName)
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
	return fmt.Sprintf("需求「%s」的方案设计已完成 AI 方案评估，请审核。审批通过则进入开发，审批不通过将重新进行方案设计。\n\n---\nAI 评估报告：\n%s", fc.WorkitemTitle, aiEvalSummary)
}
