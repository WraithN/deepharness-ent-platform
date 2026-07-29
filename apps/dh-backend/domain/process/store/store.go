package store

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
)

// ProcessStore 流程存储接口
type ProcessStore interface {
	Create(ctx context.Context, p object.Process) error
	GetByID(ctx context.Context, id string) (object.Process, error)
	ListByWorkspace(ctx context.Context, workspaceID string) ([]object.Process, error)
	Update(ctx context.Context, id string, p object.Process) error
}
