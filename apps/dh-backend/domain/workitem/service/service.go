package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// WorkItemFilter 定义工作项列表的查询条件。
type WorkItemFilter struct {
	ProjectID  string
	Type       workitem.Type
	Status     workitem.Status
	AssigneeID string
}

// WorkItemService 定义 workitem 模块的服务接口。
type WorkItemService interface {
	ListWorkItems(filter WorkItemFilter) ([]object.WorkItem, error)
	GetWorkItem(id string) (object.WorkItem, error)
	CreateWorkItem(item object.CreateWorkItemRequest) (object.WorkItem, error)
	UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error)
	UpdateWorkItemAssignee(id string, assigneeID string) (object.WorkItem, error)
	CountWorkItems(projectID string, status workitem.Status, days int) (int, error)
	CountWorkItemsPrevPeriod(projectID string, status workitem.Status, days int) (int, error)

	// 需求-文档关联管理
	ListDocLinks(workitemID string) ([]object.WorkItemDocLink, error)
	CreateDocLink(workitemID string, req object.CreateDocLinkRequest) (object.WorkItemDocLink, error)
	DeleteDocLink(workitemID, productSpaceItemID string) error

	// 需求级产品设计版本
	CreateDesignVersion(workitemID, workspaceID, userID, changeSummary string) (object.DesignVersion, error)
	ListDesignVersions(workitemID string) ([]object.DesignVersion, error)
}
