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
	ParentID    string            `json:"parentId"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}

// WorkItemDocLink 表示需求与产品空间条目（文档/原型）之间的关联映射。
type WorkItemDocLink struct {
	ID                 string    `json:"id"`
	WorkItemID         string    `json:"workitemId"`
	ProductSpaceItemID string    `json:"productSpaceItemId"`
	WorkspaceID        string    `json:"workspaceId"`
	ItemType           string    `json:"itemType"` // doc | prototype
	CreatedAt          time.Time `json:"createdAt"`
}

// CreateDocLinkRequest 创建需求-文档关联的请求体。
type CreateDocLinkRequest struct {
	ProductSpaceItemID string `json:"productSpaceItemId"`
	WorkspaceID        string `json:"workspaceId"`
	ItemType           string `json:"itemType"` // doc | prototype
}

// DesignVersionItem 表示一个产品设计版本包含的单个条目（文档或原型）。
type DesignVersionItem struct {
	ID                   string    `json:"id"`
	DesignVersionID      string    `json:"designVersionId"`
	ProductSpaceItemID   string    `json:"productSpaceItemId"`
	ProductDocVersionID  int       `json:"productDocVersionId"`
	ItemType             string    `json:"itemType"` // doc | prototype
	CreatedAt            time.Time `json:"createdAt"`
}

// DesignVersion 表示一个需求级的产品设计版本快照。
type DesignVersion struct {
	ID             string              `json:"id"`
	WorkItemID     string              `json:"workitemId"`
	WorkspaceID    string              `json:"workspaceId"`
	UserID         string              `json:"userId"`
	VersionNumber  int                 `json:"versionNumber"`
	ChangeSummary  string              `json:"changeSummary"`
	CreatedBy      string              `json:"createdBy"`
	CreatedAt      time.Time           `json:"createdAt"`
	Items          []DesignVersionItem `json:"items,omitempty"`
}

// CreateDesignVersionRequest 创建设计版本的请求体。
type CreateDesignVersionRequest struct {
	WorkItemID    string `json:"workitemId"`
	WorkspaceID   string `json:"workspaceId"`
	UserID        string `json:"userId"`
	ChangeSummary string `json:"changeSummary"`
}

// ListDesignVersionsResponse 查询需求设计版本列表的响应。
type ListDesignVersionsResponse struct {
	Versions []DesignVersion `json:"versions"`
}

// LinkedProductSpaceItem 表示需求关联的单个产品空间条目（文档或原型）。
type LinkedProductSpaceItem struct {
	ID             string    `json:"id"`
	Type           string    `json:"type"` // doc | prototype
	Title          string    `json:"title"`
	RelativePath   string    `json:"relativePath"`
	Status         string    `json:"status"`
	CurrentVersion int       `json:"currentVersion"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// RequirementWithDesignItems 按需求聚合其关联的文档与原型，
// 供智能会话「设计」按钮下拉菜单按需求名分组展示。
type RequirementWithDesignItems struct {
	WorkitemID    string                    `json:"workitemId"`
	WorkitemTitle string                    `json:"workitemTitle"`
	Status        string                    `json:"status"`
	UpdatedAt     time.Time                 `json:"updatedAt"`
	Doc           *LinkedProductSpaceItem   `json:"doc,omitempty"`
	Prototype     *LinkedProductSpaceItem   `json:"prototype,omitempty"`
}
