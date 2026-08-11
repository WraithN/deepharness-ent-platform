package service

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// WorkItemFilter 定义工作项列表的查询条件。
type WorkItemFilter struct {
	WorkspaceID string
	ProjectID   string
	TenantID    string
	Type        workitem.Type
	Status      workitem.Status
	AssigneeID  string
}

// WorkItemService 定义 workitem 模块的服务接口。
type WorkItemService interface {
	ListWorkItems(filter WorkItemFilter) ([]object.WorkItem, error)
	GetWorkItem(id string) (object.WorkItem, error)
	CreateWorkItem(item object.CreateWorkItemRequest) (object.WorkItem, error)
	UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error)
	UpdateWorkItemAssignee(id string, assigneeID string) (object.WorkItem, error)
	// ValidateAssigneeTenant 校验待指派用户与指定租户是否一致，不一致则返回错误。
	ValidateAssigneeTenant(assigneeID string, tenantID string) error
	CountWorkItems(projectID string, status workitem.Status, days int) (int, error)
	CountWorkItemsPrevPeriod(projectID string, status workitem.Status, days int) (int, error)

	// 需求-文档关联管理
	ListDocLinks(workitemID string) ([]object.WorkItemDocLink, error)
	CreateDocLink(workitemID string, req object.CreateDocLinkRequest) (object.WorkItemDocLink, error)
	DeleteDocLink(workitemID, productSpaceItemID string) error

	// 需求级产品设计版本
	CreateDesignVersion(workitemID, workspaceID, userID, changeSummary string) (object.DesignVersion, error)
	ListDesignVersions(workitemID string) ([]object.DesignVersion, error)

	// ListRequirementsWithDesignItems 按工作空间查询包含文档或原型关联的需求列表，
	// 每个需求聚合其最新的一篇文档与最新的一个原型（若存在）。
	ListRequirementsWithDesignItems(workspaceID string) ([]object.RequirementWithDesignItems, error)

	// 需求开发提交记录
	// RecordCommit 幂等记录一条需求开发提交（workitem_id+commit_hash 唯一，重复忽略）。
	RecordCommit(ctx context.Context, req RecordCommitRequest) error
	// ListCommits 按需求 ID 查询开发提交列表，按提交时间倒序。
	ListCommits(workitemID string) ([]WorkItemCommit, error)
}
