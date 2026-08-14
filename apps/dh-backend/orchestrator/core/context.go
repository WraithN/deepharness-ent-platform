package core

import (
	"context"
	"fmt"
	"log"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	notificationservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
)

// FlowDeps 流程共享依赖
type FlowDeps struct {
	NotificationSvc notificationservice.NotificationService
	WorkItemSvc     service.WorkItemService
	AGUIClient      *client.AGUIClient
	Sessions        chat.SessionStore
	Messages        chat.MessageStore
	WorkspaceRoot   string
	GatewaydAgentID string
}

// FlowContext 在节点间传递的上下文数据
type FlowContext struct {
	Ctx context.Context

	ProcessID   string
	WorkspaceID string
	TenantID    string
	UserID      string
	UserName    string

	WorkitemID    string
	WorkitemTitle string
	WorkitemDesc  string
	RepositoryID  string
	ProjectName   string
	DocPath       string

	WorkspacePath string

	SessionID    string
	ThreadID     string
	DevSessionID string
	DevThreadID  string

	CodePrompt        string
	CodeResult        string
	ReviewPrompt      string
	ReviewResult      string
	ReviewDecision    string // AI 代码评审结论："pass" / "reject"
	ReviewRejectCount int    // AI 代码评审不通过次数（用于限制最多自动重试 maxReviewRetries 次）
	DeveloperPrompt   string

	ApprovalResult string

	AuditApprovalResult string

	NeedArchDesign        bool
	RequirementEvalResult string

	ArchDesignResult  string
	AIEvalResult      string
	AIEvalDecision    string // AI 方案评估结论："pass" / "reject"
	AIEvalRejectCount int    // AI 方案评估不通过次数（用于限制最多自动重试 maxAIEvalRetries 次）

	// 自动化测试流程数据
	TestPlanResult            string
	TestCaseResult            string
	TestExecResult            string
	TestDefectResult          string
	TestPlanReviewResult      string // "pass" / "reject"
	TestCaseReviewResult      string
	TestAdmissionReviewResult string

	// 产品流程数据
	BrainstormResult           string
	BreakdownResult            string // 功能拆解清单
	ResearchResult             string
	DraftResult                string
	AIDraftReviewResult        string // AI 草案复核报告文本
	ProductAIDraftReviewResult string // "pass" / "reject"
	AIDraftReviewRejectCount   int    // AI 草案复核不通过次数（用于限制最多自动重试 maxAIDraftReviewRetries 次）
	PRDResult                  string
	ProtoResult                string
	ProductReviewResult        string // "pass" / "reject"
	ProductProtoReviewResult   string // "pass" / "reject"
	ProductFinalReviewResult   string // "pass" / "reject"
	AIGatewayResult            string // AI 并行决策器决策文本
	NeedProto                  bool   // 是否需要原型

	PausedNode     string
	NotificationID string
}

func (fc *FlowContext) UpdateStage(stageName, status string) {
	processSvc := process.GetService()
	if processSvc == nil || fc.ProcessID == "" {
		return
	}
	_, err := processSvc.UpdateStage(fc.Ctx, fc.ProcessID, stageName, processobject.UpdateStageRequest{
		Status: status,
	})
	if err != nil {
		log.Printf("[Flow] update stage %s to %s failed: %v", stageName, status, err)
	}
}

func (fc *FlowContext) UpdateStageFull(stageName string, req processobject.UpdateStageRequest) {
	processSvc := process.GetService()
	if processSvc == nil || fc.ProcessID == "" {
		return
	}
	_, err := processSvc.UpdateStage(fc.Ctx, fc.ProcessID, stageName, req)
	if err != nil {
		log.Printf("[Flow] update stage %s failed: %v", stageName, err)
	}
}

func (fc *FlowContext) CreateProcess(proc *processobject.Process) *processobject.Process {
	processSvc := process.GetService()
	if processSvc == nil {
		return proc
	}
	created, err := processSvc.Create(fc.Ctx, processobject.CreateProcessRequest{
		WorkspaceID:   proc.WorkspaceID,
		WorkitemID:    proc.WorkitemID,
		Title:         proc.Title,
		SourceDocPath: proc.SourceDocPath,
		Type:          proc.Type,
		Stages:        proc.Stages,
	})
	if err != nil {
		log.Printf("[Flow] create process failed: %v", err)
		return proc
	}
	log.Printf("[Flow] process created: %s, stages=%d", created.ID, len(created.Stages))
	return &created
}

func (d *FlowDeps) NotifyFailed(userID, workspaceID, tenantID, workitemID, errMsg string) {
	_, _ = d.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      userID,
		TenantID:    tenantID,
		WorkspaceID: workspaceID,
		Type:        notificationobject.TypeAIDevFailed,
		Title:       "AI托管开发失败",
		Body:        errMsg,
		Data: map[string]any{
			"workitemId": workitemID,
			"error":      errMsg,
		},
	})
}

func (fc *FlowContext) FailStage(deps *FlowDeps, stageName, errMsg string) {
	fc.UpdateStage(stageName, processobject.StageStatusFailed)
	deps.NotifyFailed(fc.UserID, fc.WorkspaceID, fc.TenantID, fc.WorkitemID, errMsg)
}

func (fc *FlowContext) FailStagef(deps *FlowDeps, stageName, format string, args ...any) {
	fc.FailStage(deps, stageName, fmt.Sprintf(format, args...))
}
