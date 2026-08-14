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

// NewArchDesignNode 创建方案设计节点
func NewArchDesignNode(deps *core.FlowDeps) *ArchDesignNode {
	return &ArchDesignNode{
		CodeWriteNode: CodeWriteNode{
			BaseNode: core.NewBaseNode(processobject.StageArchDesign, core.NodeTypeAI, deps),
			BuildPrompt: func(fc *core.FlowContext) string {
				return prompts.BuildArchDesignPrompt(fc.WorkitemTitle, fc.WorkitemDesc, fc.WorkspacePath)
			},
			SessionTitlePrefix: "[方案设计]",
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
		OutputDesc:     "方案设计文档",
	})
	return nil
}

// ReviewNode AI 代码评审（混合判断节点）：AI 自动判定 pass/reject。
// pass 进入人工评审；reject 自动返回 AI 开发修改并重新评审，最多自动尝试 maxReviewRetries 次；
// 达到上限后暂停，交由用户人工通过/拒绝（与 AI 方案评估同一模式，参照产品流程 AI 草案复核）。
type ReviewNode struct {
	core.BaseNode
}

// maxReviewRetries 是 AI 代码评审的最大自动尝试次数。reject 且达到上限后暂停流程，转人工裁决。
const maxReviewRetries = 2

// 评审结论窗口长度：只在「评审结论」标记后的短文本窗口内解析 pass/reject，避免正文误判。
const reviewDecisionWindowLen = 40

const (
	reviewDecisionPass   = "pass"
	reviewDecisionReject = "reject"
)

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
		OutputDesc:   "AI 代码评审报告",
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

	// 解析 AI 评审结论（pass/reject），并记录当前是第几次评审（供前端展示「第 N 次评审」）。
	fc.ReviewDecision = parseReviewDecision(result.Text)
	fc.UpdateStageFull(processobject.StageReview, processobject.UpdateStageRequest{
		Status:     processobject.StageStatusInProgress,
		SessionID:  fc.DevSessionID,
		Prompt:     fc.ReviewResult,
		RetryCount: fc.ReviewRejectCount + 1,
		OutputDesc: "AI 代码评审报告",
	})

	// reject 且达到自动尝试上限 → 发送通知，暂停等人工通过/拒绝
	if fc.ReviewDecision == reviewDecisionReject && fc.ReviewRejectCount+1 >= maxReviewRetries {
		if err := n.sendDecisionNotification(fc); err != nil {
			log.Printf("[ReviewNode] send decision notification failed: %v", err)
		}
		return core.ErrPauseFlow
	}
	return nil
}

func (n *ReviewNode) Output(fc *core.FlowContext) error {
	outputDesc := "评审通过，进入人工评审"
	if fc.ReviewDecision == reviewDecisionReject {
		outputDesc = "评审不通过，返回 AI 开发"
	}
	fc.UpdateStageFull(processobject.StageReview, processobject.UpdateStageRequest{
		Status:     processobject.StageStatusCompleted,
		OutputDesc: outputDesc,
		Prompt:     fc.ReviewResult,
	})
	return nil
}

func (n *ReviewNode) NextNode(fc *core.FlowContext) string {
	if fc.ReviewDecision == reviewDecisionReject {
		fc.ReviewRejectCount++
		return processobject.StageDevelopment
	}
	return processobject.StageHumanReview
}

// sendDecisionNotification 发送 AI 代码评审人工通过/拒绝的通知。
// Data 携带 devSessionId/devThreadId/reviewReport，供人工裁决后恢复流程上下文。
func (n *ReviewNode) sendDecisionNotification(fc *core.FlowContext) error {
	_, err := n.Deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      fc.UserID,
		TenantID:    fc.TenantID,
		WorkspaceID: fc.WorkspaceID,
		Type:        notificationobject.TypeCodeReviewDecisionRequired,
		Title:       fmt.Sprintf("AI 代码评审: %s", fc.WorkitemTitle),
		Body:        fmt.Sprintf("需求「%s」的 AI 代码评审 %d 次未通过，请人工确认通过（进入人工评审）或拒绝（返回 AI 开发修改）。", fc.WorkitemTitle, fc.ReviewRejectCount+1),
		ActionType:  notificationobject.ActionApproveCodeOptimize,
		ActionURL:   fmt.Sprintf("/process/%s", fc.ProcessID),
		Data: map[string]any{
			"notificationType": notificationobject.TypeCodeReviewDecisionRequired,
			"workitemId":       fc.WorkitemID,
			"workitemTitle":    fc.WorkitemTitle,
			"processId":        fc.ProcessID,
			"workspacePath":    fc.WorkspacePath,
			"workspaceId":      fc.WorkspaceID,
			"tenantId":         fc.TenantID,
			"userName":         fc.UserName,
			"sessionId":        fc.DevSessionID,
			"threadId":         fc.DevThreadID,
			"reviewReport":     fc.ReviewResult,
		},
	})
	return err
}

// parseReviewDecision 从评审报告正文里解析 pass/reject 决策。
// 只检查「评审结论」标记后的短文本窗口；未找到标记或解析失败时默认 pass（交人工兜底）。
func parseReviewDecision(report string) string {
	lower := strings.ToLower(report)
	idx := strings.Index(lower, "评审结论")
	if idx < 0 {
		return reviewDecisionPass
	}
	end := idx + reviewDecisionWindowLen
	if end > len(lower) {
		end = len(lower)
	}
	if strings.Contains(lower[idx:end], reviewDecisionReject) {
		return reviewDecisionReject
	}
	return reviewDecisionPass
}

// NewHumanReviewNode 创建人工评审节点（条件分支）。
// 迁移为 core.HumanReviewNode：审批通过完成开发（转人工介入交付），不通过返回 AI 开发修改后重新评审。
func NewHumanReviewNode(deps *core.FlowDeps) *core.HumanReviewNode {
	return core.NewHumanReviewNode(deps, core.HumanReviewConfig{
		StageName:  processobject.StageHumanReview,
		InputDesc:  "代码评审报告",
		OutputDesc: "待开发人员审批评审报告并提供修改指示",

		NotifType:     notificationobject.TypeHumanReviewRequired,
		NotifTitleFmt: "代码复审待审批: %s",
		NotifBodyFmt:  "需求「%s」的代码评审已完成，请查看评审报告。审批通过则完成开发，审批不通过将返回 AI 开发修改后重新评审。",

		PromptGetter: func(fc *core.FlowContext) string { return fc.ReviewResult },
		ResultGetter: func(fc *core.FlowContext) string { return fc.ApprovalResult },
		ExtraData: func(fc *core.FlowContext) map[string]any {
			return map[string]any{
				"sessionId":    fc.DevSessionID,
				"threadId":     fc.DevThreadID,
				"reviewReport": fc.ReviewResult,
			}
		},
		OutputDescBuilder: func(fc *core.FlowContext) string {
			if fc.ApprovalResult == "pass" {
				return fmt.Sprintf("%s审批通过，开发完成", fc.UserName)
			}
			return fmt.Sprintf("%s审批不通过，返回 AI 开发修改", fc.UserName)
		},
		PassNodeName: processobject.StageDevComplete,
		FailNodeName: processobject.StageDevelopment,

		DedupCheckType: notificationobject.TypeHumanReviewRequired,
	})
}
