package orchestrator

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"

	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	notificationservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/core"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator/flows"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
)

// ErrProductFlowInProgress 表示同一工作项与源文档已存在进行中的产品流程，
// 用于阻止重复发起，避免并发产生多份流程记录。
var ErrProductFlowInProgress = errors.New("该需求已有进行中的 AI 需求设计流程")

// productAIDraftReviewMaxRetries 是 AI 草案复核的最大自动重试次数（与 nodes 包保持一致）。
// 人工决策恢复流程时，将 rejectCount 置为该值，确保后续 reject 直接人工决策而非再次自动重试。
const productAIDraftReviewMaxRetries = 2

// aiEvalMaxRetries 是 AI 方案评估的最大自动尝试次数（与 nodes 包 maxAIEvalRetries 保持一致）。
// 人工决策恢复流程时，将 rejectCount 置为该值，确保后续 reject 直接人工决策而非再次自动重试。
const aiEvalMaxRetries = 2

// codeReviewMaxRetries 是 AI 代码评审的最大自动尝试次数（与 nodes 包 maxReviewRetries 保持一致）。
// 人工决策恢复流程时，将 rejectCount 置为该值，确保后续 reject 直接人工决策而非再次自动重试。
const codeReviewMaxRetries = 2

// Orchestrator 流程编排器
type Orchestrator struct {
	deps *core.FlowDeps
	mu   sync.Mutex
	// importProcessDeliverable 由 server 层注入，用于需求评审确认后将 PRD/原型导入产品空间并关联需求。
	// 采用回调注入而非直接依赖，避免 orchestrator 包反向依赖 productspace 包。
	importProcessDeliverable func(ctx context.Context, workspaceID, actingUserID, ownerUserID, workitemTitle, deliverableType, path string) error
	// ensureGatewaydRunning 由 server 层注入，用于在流程 AI 节点执行前确保 per-user gatewayd/personal-stub 运行。
	// direct-host 模式下 gatewayd 由 Manager 按需启动，orchestrator 后台任务不经过 containerMW，需显式触发。
	ensureGatewaydRunning func(ctx context.Context, userID string) error
}

// SetProductDeliverableImporter 注入流程交付物导入回调（导入产品空间 + 关联需求）。
func (o *Orchestrator) SetProductDeliverableImporter(f func(ctx context.Context, workspaceID, actingUserID, ownerUserID, workitemTitle, deliverableType, path string) error) {
	o.importProcessDeliverable = f
}

// SetGatewaydEnsurer 注入 gatewayd 就绪回调（direct-host 模式按需启动 per-user gatewayd/personal-stub）。
func (o *Orchestrator) SetGatewaydEnsurer(f func(ctx context.Context, userID string) error) {
	o.ensureGatewaydRunning = f
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

// OnAIEvalDecisionResult 处理 AI 方案评估超限后的人工通过/拒绝（参照 OnAIDraftReviewResult）。
// 由通知 data 恢复会话与方案/评估结果；人工决策后将 rejectCount 置为上限，
// 确保恢复流程后 reject 直接走人工裁决而不再自动重试。
func (o *Orchestrator) OnAIEvalDecisionResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, sessionID, threadID, archDesignResult, aiEvalResult string, approved bool) {
	log.Printf("[Orchestrator] ai eval decision result: approved=%v, workitem %s, user %s", approved, workitemID, userID)

	decision := "reject"
	if approved {
		decision = "pass"
	}

	fc := &core.FlowContext{
		Ctx:              ctx,
		ProcessID:        processID,
		WorkspaceID:      workspaceID,
		TenantID:         tenantID,
		UserID:           userID,
		UserName:         userName,
		WorkitemID:       workitemID,
		WorkitemTitle:    workitemTitle,
		WorkspacePath:    workspacePath,
		SessionID:        sessionID,
		ThreadID:         threadID,
		ArchDesignResult: archDesignResult,
		AIEvalResult:     aiEvalResult,
		AIEvalDecision:   decision,
		NeedArchDesign:   true,
		// 人工决策后，rejectCount 置为上限，确保后续 reject 直接人工决策而非再次自动重试。
		AIEvalRejectCount: aiEvalMaxRetries,
		PausedNode:        processobject.StageAIEval,
		NotificationID:    notificationID,
	}

	flow := flows.NewReqDevAndReviewFlowLoop(o.deps)
	if err := flow.Resume(fc); err != nil {
		log.Printf("[Orchestrator] flow resume failed: %v", err)
	}
}

// OnCodeReviewDecisionResult 处理 AI 代码评审超限后的人工通过/拒绝（参照 OnAIEvalDecisionResult）。
// 由通知 data 恢复开发会话与评审报告；人工决策后将 rejectCount 置为上限，
// 确保恢复流程后 reject 直接走人工裁决而不再自动重试。
func (o *Orchestrator) OnCodeReviewDecisionResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, devSessionID, devThreadID, reviewReport string, approved bool) {
	log.Printf("[Orchestrator] code review decision result: approved=%v, workitem %s, user %s", approved, workitemID, userID)

	decision := "reject"
	if approved {
		decision = "pass"
	}

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
		DevSessionID:   devSessionID,
		DevThreadID:    devThreadID,
		ReviewResult:   reviewReport,
		ReviewDecision: decision,
		NeedArchDesign: true,
		// 人工决策后，rejectCount 置为上限，确保后续 reject 直接人工决策而非再次自动重试。
		ReviewRejectCount: codeReviewMaxRetries,
		PausedNode:        processobject.StageReview,
		NotificationID:    notificationID,
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

	// tenantID 兜底：前端未传时从 workitem 查询，避免通知的 tenant_id 为空导致通知中心无法按租户过滤。
	if tenantID == "" {
		if item, err := o.deps.WorkItemSvc.GetWorkItem(workitemID); err == nil {
			tenantID = item.TenantID
		}
	}

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
		// direct-host 模式下确保 per-user gatewayd/personal-stub 就绪（后台任务不经过 containerMW）。
		if o.ensureGatewaydRunning != nil {
			if err := o.ensureGatewaydRunning(fc.Ctx, userID); err != nil {
				log.Printf("[Orchestrator] ensure gatewayd running failed: %v", err)
			}
		}
		flow := flows.NewProductFlow(o.deps)
		if err := flow.Run(fc); err != nil {
			log.Printf("[Orchestrator] product flow paused or failed: %v", err)
		}
	})

	return created.ID, nil
}

// resumeProductFlow 确保 per-user gatewayd 就绪后恢复产品流程。
// direct-host 模式下 gatewayd 由 Manager 按需启动，人工审批回调恢复流程前需显式触发。
func (o *Orchestrator) resumeProductFlow(fc *core.FlowContext) {
	if o.ensureGatewaydRunning != nil {
		if err := o.ensureGatewaydRunning(fc.Ctx, fc.UserID); err != nil {
			log.Printf("[Orchestrator] ensure gatewayd running failed: %v", err)
		}
	}
	o.resumeProductFlow(fc)
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

	o.resumeProductFlow(fc)
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

	o.resumeProductFlow(fc)
}

// OnAIDraftReviewResult 处理 AI 草案复核的人工通过/拒绝结果。
// approved=true 表示通过（进入方案自主复核），approved=false 表示拒绝（返回方案草案）。
func (o *Orchestrator) OnAIDraftReviewResult(ctx context.Context, notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle string, approved bool) {
	log.Printf("[Orchestrator] ai draft review result: approved=%v, workitem %s", approved, workitemID)

	reviewResult := "reject"
	if approved {
		reviewResult = "pass"
	}

	fc := &core.FlowContext{
		Ctx:                        ctx,
		ProcessID:                  processID,
		WorkspaceID:                workspaceID,
		TenantID:                   tenantID,
		UserID:                     userID,
		UserName:                   userName,
		WorkitemID:                 workitemID,
		WorkitemTitle:              workitemTitle,
		WorkspacePath:              workspacePath,
		ProductAIDraftReviewResult: reviewResult,
		// 人工决策后，rejectCount 置为上限，确保后续 reject 直接人工决策而非再次自动重试。
		AIDraftReviewRejectCount: productAIDraftReviewMaxRetries,
		PausedNode:               processobject.StageProductAIDraftReview,
		NotificationID:           notificationID,
	}

	// 从流程已完成阶段恢复中间结果（DraftResult 等），供 Resume 后续节点（方案自主复核）使用。
	if processSvc := process.GetService(); processSvc != nil {
		if proc, err := processSvc.GetByID(ctx, processID); err == nil {
			restoreProductFlowContext(fc, proc)
		}
	}

	o.resumeProductFlow(fc)
}

// AiDraftReview 处理 AI 草案复核的人工通过/拒绝（从流程详情页提交，无通知 ID）。
// 内部获取流程信息后复用 OnAIDraftReviewResult 完成决策与流程恢复。
func (o *Orchestrator) AiDraftReview(ctx context.Context, processID, userID, userName string, approved bool) error {
	processSvc := process.GetService()
	if processSvc == nil {
		return errors.New("process service not initialized")
	}
	proc, err := processSvc.GetByID(ctx, processID)
	if err != nil {
		return fmt.Errorf("get process: %w", err)
	}
	workspacePath, err := pathutil.ResolveWorkspaceRoot(o.deps.WorkspaceRoot, userID, proc.WorkspaceID)
	if err != nil {
		return fmt.Errorf("resolve workspace path: %w", err)
	}
	o.OnAIDraftReviewResult(ctx, "", userID, userName, proc.WorkitemID, processID, workspacePath, proc.WorkspaceID, "", proc.Title, approved)
	return nil
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

	o.resumeProductFlow(fc)

	// 需求评审确认通过后，把产出的 PRD 与原型导入产品空间并关联到需求。
	if approved {
		o.importFinalReviewDeliverables(ctx, processID, userID, workitemID)
	}
}

// importFinalReviewDeliverables 将需求评审阶段产出的 PRD（file）与原型（project）导入产品空间。
// 从流程已完成阶段的 Prompt 标记中解析产物绝对路径，逐个调用注入的导入回调。
func (o *Orchestrator) importFinalReviewDeliverables(ctx context.Context, processID, userID, workitemID string) {
	if o.importProcessDeliverable == nil {
		return
	}
	processSvc := process.GetService()
	if processSvc == nil {
		return
	}
	proc, err := processSvc.GetByID(ctx, processID)
	if err != nil {
		log.Printf("[Orchestrator] import final review deliverables: get process failed: %v", err)
		return
	}

	item, err := o.deps.WorkItemSvc.GetWorkItem(workitemID)
	if err != nil {
		log.Printf("[Orchestrator] import final review deliverables: get workitem failed: %v", err)
		return
	}
	ownerUserID := item.AssigneeID
	if ownerUserID == "" {
		ownerUserID = userID
	}

	for _, s := range proc.Stages {
		var deliverableType, path string
		switch s.Name {
		case processobject.StageProductPRDWrite:
			deliverableType = "file"
			path = extractFileMarkerPath(s.Prompt)
		case processobject.StageProductProtoMake:
			deliverableType = "project"
			path = extractFileMarkerPath(s.Prompt)
		}
		if deliverableType == "" || path == "" {
			continue
		}
		if err := o.importProcessDeliverable(ctx, proc.WorkspaceID, userID, ownerUserID, item.Title, deliverableType, path); err != nil {
			log.Printf("[Orchestrator] import deliverable failed: type=%s path=%s err=%v", deliverableType, path, err)
		}
	}
}

// ErrProductFlowRetryUnavailable 表示流程无可重试的失败节点。
var ErrProductFlowRetryUnavailable = errors.New("no failed node to retry")

// RetryProductFlow 重试产品流程的失败节点。
// 从流程中找到 status=failed 的阶段，恢复其前置中间结果后，从该节点重新执行 Flow。
func (o *Orchestrator) RetryProductFlow(ctx context.Context, processID, userID, userName string) error {
	processSvc := process.GetService()
	if processSvc == nil {
		return errors.New("process service not initialized")
	}
	proc, err := processSvc.GetByID(ctx, processID)
	if err != nil {
		return fmt.Errorf("get process: %w", err)
	}

	// 找到第一个失败的阶段（按流程定义顺序）。
	failedStage := findFailedStage(proc)
	if failedStage == "" {
		return ErrProductFlowRetryUnavailable
	}
	// 并行分支节点（PRD 生成/原型生成）位于 ParallelNode 内部，不在 Flow.Nodes 顶层，
	// 重试时需映射回父 ParallelNode，从并行分叉重新执行。
	retryNode := failedStage
	if parent, ok := productParallelBranchParent[failedStage]; ok {
		retryNode = parent
	}

	workspacePath, err := pathutil.ResolveWorkspaceRoot(o.deps.WorkspaceRoot, userID, proc.WorkspaceID)
	if err != nil {
		return fmt.Errorf("resolve workspace path: %w", err)
	}

	// tenantID 兜底：从 workitem 查询，避免通知的 tenant_id 为空导致通知中心无法按租户过滤。
	tenantID := ""
	if item, err := o.deps.WorkItemSvc.GetWorkItem(proc.WorkitemID); err == nil {
		tenantID = item.TenantID
	}

	fc := &core.FlowContext{
		Ctx:           ctx,
		ProcessID:     proc.ID,
		WorkspaceID:   proc.WorkspaceID,
		TenantID:      tenantID,
		UserID:        userID,
		UserName:      userName,
		WorkitemID:    proc.WorkitemID,
		WorkitemTitle: proc.Title,
		DocPath:       proc.SourceDocPath,
		WorkspacePath: workspacePath,
	}
	restoreProductFlowContext(fc, proc)

	safego.Go("orchestrator-product-retry", func() {
		// direct-host 模式下确保 per-user gatewayd/personal-stub 就绪。
		if o.ensureGatewaydRunning != nil {
			if err := o.ensureGatewaydRunning(fc.Ctx, userID); err != nil {
				log.Printf("[Orchestrator] ensure gatewayd running failed: %v", err)
			}
		}
		flow := flows.NewProductFlow(o.deps)
		if err := flow.Retry(fc, retryNode); err != nil {
			log.Printf("[Orchestrator] product flow retry failed: %v", err)
		}
	})
	return nil
}

// productParallelBranchParent 将并行分支阶段映射到其父 ParallelNode 名称。
var productParallelBranchParent = map[string]string{
	processobject.StageProductPRDWrite:  flows.StageProductParallelFork,
	processobject.StageProductProtoMake: flows.StageProductParallelFork,
}

// findFailedStage 返回流程中第一个失败阶段的名称，无失败阶段时返回空串。
func findFailedStage(proc processobject.Process) string {
	for _, s := range proc.Stages {
		if s.Status == processobject.StageStatusFailed {
			return s.Name
		}
	}
	return ""
}

// restoreProductFlowContext 从流程已完成的阶段 Prompt 恢复中间结果到 FlowContext，
// 供失败节点重试时复用前置节点产物，避免重试节点之前的产物丢失。
func restoreProductFlowContext(fc *core.FlowContext, proc processobject.Process) {
	sc := stubclient.FromContext(fc.Ctx)
	for _, s := range proc.Stages {
		if s.Status != processobject.StageStatusCompleted {
			continue
		}
		prompt := s.Prompt
		switch s.Name {
		case processobject.StageProductBrainstorm:
			// 头脑风暴阶段 Prompt 为文件标记时，重新读取文件内容作为拆解输入。
			if path := extractFileMarkerPath(prompt); path != "" && sc != nil {
				if content, err := sc.ReadFile(fc.Ctx, path); err == nil {
					fc.BrainstormResult = content
					continue
				}
			}
			fc.BrainstormResult = prompt
		case processobject.StageProductBreakdown:
			fc.BreakdownResult = prompt
		case processobject.StageProductResearch:
			fc.ResearchResult = prompt
		case processobject.StageProductDraft:
			fc.DraftResult = prompt
		case processobject.StageProductAIDraftReview:
			fc.AIDraftReviewResult = prompt
			if strings.Contains(strings.ToLower(prompt), "reject") {
				fc.ProductAIDraftReviewResult = "reject"
			} else {
				fc.ProductAIDraftReviewResult = "pass"
			}
		case processobject.StageProductAIGateway:
			fc.AIGatewayResult = prompt
			fc.NeedProto = !strings.Contains(prompt, "NEED_PROTO: false")
		case processobject.StageProductPRDWrite:
			fc.PRDResult = prompt
		case processobject.StageProductProtoMake:
			fc.ProtoResult = prompt
		}
	}
}

// extractFileMarkerPath 从 "[[FILE:path]]" 标记中提取文件路径，非标记时返回空串。
func extractFileMarkerPath(prompt string) string {
	const prefix = "[[FILE:"
	const suffix = "]]"
	idx := strings.Index(prompt, prefix)
	if idx < 0 {
		return ""
	}
	rest := prompt[idx+len(prefix):]
	end := strings.Index(rest, suffix)
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(rest[:end])
}
