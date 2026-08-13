package orchestrator

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	notificationservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/flows"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
)

// ErrProductFlowInProgress 表示同一工作项与源文档已存在进行中的产品流程，
// 用于阻止重复发起，避免并发产生多份流程记录。
var ErrProductFlowInProgress = errors.New("product flow already in progress")

// Orchestrator 流程编排器
type Orchestrator struct {
	deps *core.FlowDeps
	mu   sync.Mutex
}

func NewOrchestrator(
	notificationSvc notificationservice.NotificationService,
	workItemSvc service.WorkItemService,
	aguiClient *client.AGUIClient,
	sessions chat.SessionStore,
	messages chat.MessageStore,
	workspaceRoot string,
	gatewaydAgentID string,
) *Orchestrator {
	return &Orchestrator{
		deps: &core.FlowDeps{
			NotificationSvc: notificationSvc,
			WorkItemSvc:     workItemSvc,
			AGUIClient:      aguiClient,
			Sessions:        sessions,
			Messages:        messages,
			WorkspaceRoot:   workspaceRoot,
			GatewaydAgentID: gatewaydAgentID,
		},
	}
}

func (o *Orchestrator) OnWorkitemAssigned(ctx context.Context, workitemID, workspaceID, tenantID, assigneeID, assigneeName, title, description string) {
	if assigneeID == "" {
		return
	}
	existing, _ := o.deps.NotificationSvc.ListByTypeAndData(ctx, tenantID, notificationobject.TypeWorkitemAssigned, "workitemId", workitemID)
	for _, n := range existing {
		if n.ActionStatus == notificationobject.ActionPending {
			log.Printf("[Orchestrator] workitem %s already has pending assignment notification, skip", workitemID)
			return
		}
	}

	body := fmt.Sprintf("需求「%s」已分配给您，是否进行 AI 托管开发？", title)
	if description != "" {
		desc := description
		if len(desc) > 200 {
			desc = desc[:200] + "..."
		}
		body = fmt.Sprintf("需求「%s」已分配给您。\n\n描述: %s\n\n是否进行 AI 托管开发？", title, desc)
	}

	_, err := o.deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      assigneeID,
		TenantID:    tenantID,
		WorkspaceID: workspaceID,
		Type:        notificationobject.TypeWorkitemAssigned,
		Title:       fmt.Sprintf("需求分配: %s", title),
		Body:        body,
		ActionType:  notificationobject.ActionApproveAIDev,
		Data: map[string]any{
			"workitemId":    workitemID,
			"workitemTitle": title,
			"workitemDesc":  description,
			"assigneeId":    assigneeID,
			"assigneeName":  assigneeName,
			"workspaceId":   workspaceID,
		},
	})
	if err != nil {
		log.Printf("[Orchestrator] create assignment notification failed: %v", err)
	} else {
		log.Printf("[Orchestrator] assignment notification sent to user %s for workitem %s", assigneeID, workitemID)
	}
}

func (o *Orchestrator) OnApproveAIDev(ctx context.Context, notificationID, userID, userName, workitemID, repositoryID, projectName, targetWorkspaceID string) {
	item, err := o.deps.WorkItemSvc.GetWorkItem(workitemID)
	if err != nil {
		log.Printf("[Orchestrator] get workitem %s failed: %v", workitemID, err)
		o.deps.NotifyFailed(userID, "", item.TenantID, workitemID, fmt.Sprintf("获取需求失败: %v", err))
		return
	}

	workspaceID := targetWorkspaceID
	if workspaceID == "" {
		workspaceID = item.WorkspaceID
	}

	o.deps.NotificationSvc.Create(notificationobject.CreateNotificationRequest{
		UserID:      userID,
		TenantID:    item.TenantID,
		WorkspaceID: workspaceID,
		Type:        notificationobject.TypeAIDevStarted,
		Title:       fmt.Sprintf("AI开发已启动: %s", item.Title),
		Body:        fmt.Sprintf("正在对需求「%s」进行 AI 托管开发，完成后将自动进行代码评审。", item.Title),
		Data: map[string]any{
			"workitemId": workitemID,
		},
	})

	workspacePath, err := pathutil.ResolveWorkspaceRoot(o.deps.WorkspaceRoot, userID, workspaceID)
	if err != nil {
		log.Printf("[Orchestrator] resolve workspace path failed: %v", err)
		o.deps.NotifyFailed(userID, "", item.TenantID, workitemID, fmt.Sprintf("解析工作区路径失败: %v", err))
		return
	}
	fc := &core.FlowContext{
		Ctx:            ctx,
		WorkspaceID:    workspaceID,
		TenantID:       item.TenantID,
		UserID:         userID,
		UserName:       userName,
		WorkitemID:     workitemID,
		WorkitemTitle:  item.Title,
		WorkitemDesc:   item.Description,
		RepositoryID:   repositoryID,
		ProjectName:    projectName,
		WorkspacePath:  workspacePath,
		NotificationID: notificationID,
	}

	safego.Go("orchestrator-flow", func() {
		flow := flows.NewReqDevAndReviewFlowLoop(o.deps)
		if err := flow.Run(fc); err != nil {
			log.Printf("[Orchestrator] flow paused or failed: %v", err)
		}
	})
}

func (o *Orchestrator) OnRequirementEvalResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle string, needArch bool) {
	log.Printf("[Orchestrator] requirement eval result: needArch=%v, workitem %s, user %s", needArch, workitemID, userID)

	fc := &core.FlowContext{
		Ctx:            ctx,
		ProcessID:      processID,
		WorkspaceID:    workspaceID,
		TenantID:       tenantID,
		UserID:         userID,
		UserName:       userName,
		WorkitemID:     workitemID,
		WorkitemTitle:  workitemTitle,
		WorkspacePath:  workspacePath,
		NeedArchDesign: needArch,
		PausedNode:     processobject.StageRequirementEval,
		NotificationID: notificationID,
	}

	flow := flows.NewReqDevAndReviewFlowLoop(o.deps)
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] flow resume failed: %v", err)
	}
}

func (o *Orchestrator) OnHumanReviewResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, devSessionID, devThreadID, reviewReport, developerPrompt string, approved bool) {
	log.Printf("[Orchestrator] human review result: approved=%v, workitem %s, user %s", approved, workitemID, userID)

	approvalResult := "reject"
	if approved {
		approvalResult = "pass"
	}

	fc := &core.FlowContext{
		Ctx:             ctx,
		ProcessID:       processID,
		WorkspaceID:     workspaceID,
		TenantID:        tenantID,
		UserID:          userID,
		UserName:        userName,
		WorkitemID:      workitemID,
		WorkitemTitle:   workitemTitle,
		WorkspacePath:   workspacePath,
		DevSessionID:    devSessionID,
		DevThreadID:     devThreadID,
		ReviewResult:    reviewReport,
		DeveloperPrompt: developerPrompt,
		ApprovalResult:  approvalResult,
		PausedNode:      processobject.StageHumanReview,
		NotificationID:  notificationID,
	}

	flow := flows.NewReqDevAndReviewFlowLoop(o.deps)
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] flow resume failed: %v", err)
	}
}

func (o *Orchestrator) OnHumanAuditResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, sessionID, threadID, archDesignResult, aiEvalResult string, approved bool) {
	log.Printf("[Orchestrator] human audit result: approved=%v, workitem %s, user %s", approved, workitemID, userID)

	auditResult := "reject"
	if approved {
		auditResult = "pass"
	}

	fc := &core.FlowContext{
		Ctx:                 ctx,
		ProcessID:           processID,
		WorkspaceID:         workspaceID,
		TenantID:            tenantID,
		UserID:              userID,
		UserName:            userName,
		WorkitemID:          workitemID,
		WorkitemTitle:       workitemTitle,
		WorkspacePath:       workspacePath,
		SessionID:           sessionID,
		ThreadID:            threadID,
		ArchDesignResult:    archDesignResult,
		AIEvalResult:        aiEvalResult,
		AuditApprovalResult: auditResult,
		NeedArchDesign:      true,
		PausedNode:          processobject.StageHumanAudit,
		NotificationID:      notificationID,
	}

	flow := flows.NewReqDevAndReviewFlowLoop(o.deps)
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] flow resume failed: %v", err)
	}
}

// OnTestReviewResult 测试流程评审结果回调（通用：方案评审/用例评审/准入评审）
func (o *Orchestrator) OnTestReviewResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, sessionID, threadID, reviewType string, approved bool) {
	log.Printf("[Orchestrator] test review result: type=%s, approved=%v, workitem %s", reviewType, approved, workitemID)

	result := "reject"
	if approved {
		result = "pass"
	}

	fc := &core.FlowContext{
		Ctx:           ctx,
		ProcessID:     processID,
		WorkspaceID:   workspaceID,
		TenantID:      tenantID,
		UserID:        userID,
		UserName:      userName,
		WorkitemID:    workitemID,
		WorkitemTitle: workitemTitle,
		WorkspacePath: workspacePath,
		SessionID:     sessionID,
		ThreadID:      threadID,
	}

	switch reviewType {
	case notificationobject.TypeTestPlanReviewRequired:
		fc.TestPlanReviewResult = result
		fc.PausedNode = processobject.StageTestPlanReview
	case notificationobject.TypeTestCaseReviewRequired:
		fc.TestCaseReviewResult = result
		fc.PausedNode = processobject.StageTestCaseReview
	case notificationobject.TypeTestAdmissionReviewRequired:
		fc.TestAdmissionReviewResult = result
		fc.PausedNode = processobject.StageTestAdmissionReview
	}

	// 根据评审类型选择对应流程：方案/用例评审属于测试资产流程，准入评审属于测试执行流程
	var flow *core.Flow
	switch reviewType {
	case notificationobject.TypeTestPlanReviewRequired, notificationobject.TypeTestCaseReviewRequired:
		flow = flows.NewAutoTestAssetFlow(o.deps)
	case notificationobject.TypeTestAdmissionReviewRequired:
		flow = flows.NewAutoTestExecutionFlow(o.deps)
	default:
		flow = flows.NewAutoTestFlow(o.deps)
	}
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] test flow resume failed: %v", err)
	}
}

// StartAutoTestFlow 启动自动化测试流程（旧版完整链路，保留兼容）
func (o *Orchestrator) StartAutoTestFlow(ctx context.Context, userID, userName, workspaceID, tenantID, workitemID, workitemTitle, workitemDesc, workspacePath string) {
	fc := &core.FlowContext{
		Ctx:           ctx,
		WorkspaceID:   workspaceID,
		TenantID:      tenantID,
		UserID:        userID,
		UserName:      userName,
		WorkitemID:    workitemID,
		WorkitemTitle: workitemTitle,
		WorkitemDesc:  workitemDesc,
		WorkspacePath: workspacePath,
	}

	safego.Go("orchestrator-test-flow", func() {
		flow := flows.NewAutoTestFlow(o.deps)
		if err := flow.Run(fc); err != nil {
			log.Printf("[Orchestrator] test flow paused or failed: %v", err)
		}
	})
}

// StartAutoTestAssetFlow 启动测试资产流程
func (o *Orchestrator) StartAutoTestAssetFlow(ctx context.Context, userID, userName, workspaceID, tenantID, workitemID, workitemTitle, workitemDesc, workspacePath string) {
	fc := &core.FlowContext{
		Ctx:           ctx,
		WorkspaceID:   workspaceID,
		TenantID:      tenantID,
		UserID:        userID,
		UserName:      userName,
		WorkitemID:    workitemID,
		WorkitemTitle: workitemTitle,
		WorkitemDesc:  workitemDesc,
		WorkspacePath: workspacePath,
	}

	safego.Go("orchestrator-test-asset-flow", func() {
		flow := flows.NewAutoTestAssetFlow(o.deps)
		if err := flow.Run(fc); err != nil {
			log.Printf("[Orchestrator] test asset flow paused or failed: %v", err)
		}
	})
}

// StartAutoTestExecutionFlow 启动测试执行流程
func (o *Orchestrator) StartAutoTestExecutionFlow(ctx context.Context, userID, userName, workspaceID, tenantID, workitemID, workitemTitle, workitemDesc, workspacePath string) {
	fc := &core.FlowContext{
		Ctx:           ctx,
		WorkspaceID:   workspaceID,
		TenantID:      tenantID,
		UserID:        userID,
		UserName:      userName,
		WorkitemID:    workitemID,
		WorkitemTitle: workitemTitle,
		WorkitemDesc:  workitemDesc,
		WorkspacePath: workspacePath,
	}

	safego.Go("orchestrator-test-execution-flow", func() {
		flow := flows.NewAutoTestExecutionFlow(o.deps)
		if err := flow.Run(fc); err != nil {
			log.Printf("[Orchestrator] test execution flow paused or failed: %v", err)
		}
	})
}

// StartProductFlow 启动产品流程
func (o *Orchestrator) StartProductFlow(ctx context.Context, userID, userName, workspaceID, tenantID, workitemID, workitemTitle, workitemDesc, docPath, workspacePath string) (string, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	processSvc := process.GetService()
	// 并发控制：同一工作项+源文档已有进行中流程时直接拒绝，避免重复发起。
	// 仅在传入了 docPath 时校验，因为源文档路径是匹配活跃流程的关键维度。
	if processSvc != nil && docPath != "" {
		active, err := processSvc.HasInProgress(ctx, workitemID, docPath)
		if err != nil {
			return "", fmt.Errorf("check product flow in progress: %w", err)
		}
		if active != nil {
			return "", ErrProductFlowInProgress
		}
	}

	displayTitle := fmt.Sprintf("需求：%s AI需求设计流程", workitemTitle)
	proc := processobject.NewProductProcess(workspaceID, workitemID, displayTitle, docPath)
	created := proc
	if processSvc != nil {
		var err error
		createdPtr, err := processSvc.Create(ctx, processobject.CreateProcessRequest{
			WorkspaceID:   proc.WorkspaceID,
			WorkitemID:    proc.WorkitemID,
			Title:         proc.Title,
			SourceDocPath: proc.SourceDocPath,
			Type:          proc.Type,
			Stages:        proc.Stages,
		})
		if err != nil {
			return "", fmt.Errorf("create product process: %w", err)
		}
		created = &createdPtr
	}

	fc := &core.FlowContext{
		Ctx:           ctx,
		ProcessID:     created.ID,
		WorkspaceID:   workspaceID,
		TenantID:      tenantID,
		UserID:        userID,
		UserName:      userName,
		WorkitemID:    workitemID,
		WorkitemTitle: workitemTitle,
		WorkitemDesc:  workitemDesc,
		DocPath:       docPath,
		WorkspacePath: workspacePath,
	}

	safego.Go("orchestrator-product-flow", func() {
		flow := flows.NewProductFlow(o.deps)
		if err := flow.Run(fc); err != nil {
			log.Printf("[Orchestrator] product flow paused or failed: %v", err)
		}
	})

	return created.ID, nil
}

func (o *Orchestrator) OnProductReviewResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle string, approved bool) {
	log.Printf("[Orchestrator] product review result: approved=%v, workitem %s, user %s", approved, workitemID, userID)

	reviewResult := "reject"
	if approved {
		reviewResult = "pass"
	}

	fc := &core.FlowContext{
		Ctx:                 ctx,
		ProcessID:           processID,
		WorkspaceID:         workspaceID,
		TenantID:            tenantID,
		UserID:              userID,
		UserName:            userName,
		WorkitemID:          workitemID,
		WorkitemTitle:       workitemTitle,
		WorkspacePath:       workspacePath,
		ProductReviewResult: reviewResult,
		PausedNode:          processobject.StageProductReview,
		NotificationID:      notificationID,
	}

	flow := flows.NewProductFlow(o.deps)
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] product flow resume failed: %v", err)
	}
}

func (o *Orchestrator) OnProductProtoReviewResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle string, approved bool) {
	log.Printf("[Orchestrator] product proto review result: approved=%v, workitem %s, user %s", approved, workitemID, userID)

	protoReviewResult := "reject"
	if approved {
		protoReviewResult = "pass"
	}

	fc := &core.FlowContext{
		Ctx:                      ctx,
		ProcessID:                processID,
		WorkspaceID:              workspaceID,
		TenantID:                 tenantID,
		UserID:                   userID,
		UserName:                 userName,
		WorkitemID:               workitemID,
		WorkitemTitle:            workitemTitle,
		WorkspacePath:            workspacePath,
		ProductProtoReviewResult: protoReviewResult,
		PausedNode:               processobject.StageProductProtoReview,
		NotificationID:           notificationID,
	}

	flow := flows.NewProductFlow(o.deps)
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] product flow resume failed: %v", err)
	}
}

func (o *Orchestrator) OnProductFinalReviewResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle string, approved bool) {
	log.Printf("[Orchestrator] product final review result: approved=%v, workitem %s, user %s", approved, workitemID, userID)

	finalResult := "reject"
	if approved {
		finalResult = "pass"
	}

	fc := &core.FlowContext{
		Ctx:                      ctx,
		ProcessID:                processID,
		WorkspaceID:              workspaceID,
		TenantID:                 tenantID,
		UserID:                   userID,
		UserName:                 userName,
		WorkitemID:               workitemID,
		WorkitemTitle:            workitemTitle,
		WorkspacePath:            workspacePath,
		ProductFinalReviewResult: finalResult,
		PausedNode:               processobject.StageProductFinalReview,
		NotificationID:           notificationID,
	}

	flow := flows.NewProductFlow(o.deps)
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] product flow resume failed: %v", err)
	}
}
