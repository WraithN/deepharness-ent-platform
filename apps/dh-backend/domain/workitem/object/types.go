package object

import (
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// WorkItem 复用 SDK 中的工作项领域模型。
type WorkItem = workitem.WorkItem

// CreateWorkItemRequest 创建工单的请求参数。
type CreateWorkItemRequest struct {
	TenantID    string            `json:"tenantId"`
	ProjectID   string            `json:"projectId"`
	Type        workitem.Type     `json:"type"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Status      workitem.Status   `json:"status"`
	Priority    workitem.Priority `json:"priority"`
	AssigneeID  string            `json:"assigneeId"`
	Reporter    string            `json:"reporter"`
	Source      workitem.Source   `json:"source"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}
