package workitemtracker

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// Tracker 工作项跟踪器抽象接口
type Tracker interface {
	List(ctx context.Context, projectKey string) ([]workitem.WorkItem, error)
	Get(ctx context.Context, id string) (*workitem.WorkItem, error)
	Create(ctx context.Context, item *workitem.WorkItem) (*workitem.WorkItem, error)
	Update(ctx context.Context, item *workitem.WorkItem) (*workitem.WorkItem, error)
	Sync(ctx context.Context, projectKey string) error
}
