package service

import (
	"context"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/store"
	"github.com/google/uuid"
)

// ProcessService 流程服务接口
type ProcessService interface {
	Create(ctx context.Context, req object.CreateProcessRequest) (object.Process, error)
	GetByID(ctx context.Context, id string) (object.Process, error)
	ListByWorkspace(ctx context.Context, workspaceID string) ([]object.Process, error)
	UpdateStage(ctx context.Context, processID string, stageName string, req object.UpdateStageRequest) (object.Process, error)
}

// ProcessServiceImpl 流程服务实现
type ProcessServiceImpl struct {
	store store.ProcessStore
}

// NewProcessService 创建流程服务
func NewProcessService(s store.ProcessStore) *ProcessServiceImpl {
	return &ProcessServiceImpl{store: s}
}

func (s *ProcessServiceImpl) Create(_ context.Context, req object.CreateProcessRequest) (object.Process, error) {
	now := time.Now()
	p := object.Process{
		ID:          uuid.New().String(),
		WorkspaceID: req.WorkspaceID,
		WorkitemID:  req.WorkitemID,
		Title:       req.Title,
		Type:        req.Type,
		Stages:      req.Stages,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.store.Create(context.Background(), p); err != nil {
		return object.Process{}, err
	}
	return p, nil
}

func (s *ProcessServiceImpl) GetByID(_ context.Context, id string) (object.Process, error) {
	return s.store.GetByID(context.Background(), id)
}

func (s *ProcessServiceImpl) ListByWorkspace(_ context.Context, workspaceID string) ([]object.Process, error) {
	list, err := s.store.ListByWorkspace(context.Background(), workspaceID)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []object.Process{}
	}
	return list, nil
}

func (s *ProcessServiceImpl) UpdateStage(_ context.Context, processID string, stageName string, req object.UpdateStageRequest) (object.Process, error) {
	p, err := s.store.GetByID(context.Background(), processID)
	if err != nil {
		return object.Process{}, err
	}

	now := time.Now()
	updated := false
	for i := range p.Stages {
		if p.Stages[i].Name == stageName {
			p.Stages[i].Status = req.Status
			if req.SessionID != "" {
				p.Stages[i].SessionID = req.SessionID
			}
			if req.Error != "" {
				p.Stages[i].Error = req.Error
			}
			if req.Status == object.StageStatusInProgress && p.Stages[i].StartedAt == nil {
				p.Stages[i].StartedAt = &now
			}
			if req.Status == object.StageStatusCompleted || req.Status == object.StageStatusFailed {
				p.Stages[i].CompletedAt = &now
			}
			updated = true
			break
		}
	}
	if !updated {
		return object.Process{}, nil
	}

	p.UpdatedAt = now
	if err := s.store.Update(context.Background(), processID, p); err != nil {
		return object.Process{}, err
	}
	return p, nil
}
