package object

import "time"

// 通知类型常量
const (
	TypeWorkitemAssigned = "workitem_assigned"
	TypeAIDevStarted     = "ai_dev_started"
	TypeAIDevCompleted   = "ai_dev_completed"
	TypeAIDevFailed      = "ai_dev_failed"
)

// 操作类型常量
const (
	ActionApproveAIDev = "approve_ai_dev"
	ActionRejectAIDev  = "reject_ai_dev"
	ActionViewReview   = "view_review"
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
	ID           string            `json:"id"`
	UserID       string            `json:"userId"`
	WorkspaceID  string            `json:"workspaceId"`
	Type         string            `json:"type"`
	Title        string            `json:"title"`
	Body         string            `json:"body"`
	Data         map[string]any    `json:"data,omitempty"`
	Read         bool              `json:"read"`
	ActionType   string            `json:"actionType,omitempty"`
	ActionStatus string            `json:"actionStatus,omitempty"`
	ActionURL    string            `json:"actionUrl,omitempty"`
	CreatedAt    time.Time         `json:"createdAt"`
	UpdatedAt    time.Time         `json:"updatedAt"`
}

// CreateNotificationRequest 创建通知请求
type CreateNotificationRequest struct {
	UserID       string         `json:"userId"`
	WorkspaceID  string         `json:"workspaceId"`
	Type         string         `json:"type"`
	Title        string         `json:"title"`
	Body         string         `json:"body"`
	Data         map[string]any `json:"data,omitempty"`
	ActionType   string         `json:"actionType,omitempty"`
	ActionURL    string         `json:"actionUrl,omitempty"`
}

// ActionNotificationRequest 通知操作请求
type ActionNotificationRequest struct {
	Action string `json:"action"` // approve / reject
}
