package object

import "time"

// 通知类型常量
const (
	TypeWorkitemAssigned            = "workitem_assigned"
	TypeAIDevStarted                = "ai_dev_started"
	TypeAIDevCompleted              = "ai_dev_completed"
	TypeAIDevFailed                 = "ai_dev_failed"
	TypeHumanReviewRequired         = "human_review_required"
	TypeRequirementEvalRequired     = "requirement_eval_required"
	TypeHumanAuditRequired          = "human_audit_required"
	TypeAIEvalReviewRequired        = "ai_eval_review_required"
	TypeCodeReviewDecisionRequired  = "code_review_decision_required"
	TypeTestPlanReviewRequired      = "test_plan_review_required"
	TypeTestCaseReviewRequired      = "test_case_review_required"
	TypeTestAdmissionReviewRequired = "test_admission_review_required"

	// 产品流程通知类型
	TypeProductReviewRequired        = "product_review_required"
	TypeProductProtoReviewRequired   = "product_proto_review_required"
	TypeProductFinalReviewRequired   = "product_final_review_required"
	TypeProductAIDraftReviewRequired = "product_ai_draft_review_required"
)

// 操作类型常量
const (
	ActionApproveAIDev        = "approve_ai_dev"
	ActionRejectAIDev         = "reject_ai_dev"
	ActionViewReview          = "view_review"
	ActionApproveCodeOptimize = "approve_code_optimize"
)

// 操作状态常量
const (
	ActionPending   = "pending"
	ActionApproved  = "approved"
	ActionRejected  = "rejected"
	ActionCompleted = "completed"
)

// Notification 通知实体
type Notification struct {
	ID           string         `json:"id"`
	UserID       string         `json:"userId"`
	TenantID     string         `json:"tenantId"`
	WorkspaceID  string         `json:"workspaceId"`
	Type         string         `json:"type"`
	Title        string         `json:"title"`
	Body         string         `json:"body"`
	Data         map[string]any `json:"data,omitempty"`
	Read         bool           `json:"read"`
	ActionType   string         `json:"actionType,omitempty"`
	ActionStatus string         `json:"actionStatus,omitempty"`
	ActionURL    string         `json:"actionUrl,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

// CreateNotificationRequest 创建通知请求
type CreateNotificationRequest struct {
	UserID      string         `json:"userId"`
	TenantID    string         `json:"tenantId"`
	WorkspaceID string         `json:"workspaceId"`
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Body        string         `json:"body"`
	Data        map[string]any `json:"data,omitempty"`
	ActionType  string         `json:"actionType,omitempty"`
	ActionURL   string         `json:"actionUrl,omitempty"`
}

// ActionNotificationRequest 通知操作请求
type ActionNotificationRequest struct {
	Action       string `json:"action"`       // approve / reject
	WorkspaceID  string `json:"workspaceId"`  // 选择的目标工作空间（开发在此空间进行）
	RepositoryID string `json:"repositoryId"` // 选择的 git 仓库 ID（可选）
	ProjectName  string `json:"projectName"`  // 自定义工程名（无仓库时填写）
	Prompt       string `json:"prompt"`       // 开发人员的优化提示词（代码复审审批时使用）
	Approved     *bool  `json:"approved"`     // 人工复审结果：true=通过, false=需优化（nil=非复审场景）
	Reason       string `json:"reason"`       // 驳回原因（审核不通过时必填）
}
