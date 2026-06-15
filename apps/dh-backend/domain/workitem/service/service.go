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
	UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error)
}
