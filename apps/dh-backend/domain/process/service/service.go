package service

import (
	"context"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/store"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

var ALL_AIDEV_STAGES = []string{
	object.StageRequirement,
	object.StageRequirementEval,
	object.StageArchDesign,
	object.StageAIEval,
	object.StageHumanAudit,
	object.StageDevelopment,
	object.StageReview,
	object.StageHumanReview,
	object.StageCodeOptimize,
	object.StageDevComplete,
}

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
		ID:          idutil.GenerateID(),
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
	p, err := s.store.GetByID(context.Background(), id)
	if err != nil {
		return object.Process{}, err
	}
	migrateStages(&p)
	return p, nil
}

func (s *ProcessServiceImpl) ListByWorkspace(_ context.Context, workspaceID string) ([]object.Process, error) {
	list, err := s.store.ListByWorkspace(context.Background(), workspaceID)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []object.Process{}
	}
	for i := range list {
		migrateStages(&list[i])
	}
	return list, nil
}

// migrateStages 为缺少预定义阶段的旧流程数据补全阶段
func migrateStages(p *object.Process) {
	if p.Type != object.ProcessTypeAIDev {
		return
	}
	existing := make(map[string]bool, len(p.Stages))
	for _, s := range p.Stages {
		existing[s.Name] = true
	}
	for _, name := range ALL_AIDEV_STAGES {
		if !existing[name] {
			p.Stages = append(p.Stages, object.ProcessStage{
				Name:   name,
				Label:  object.StageLabels[name],
				Status: object.StageStatusPending,
			})
		}
	}
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
			if req.Prompt != "" {
				p.Stages[i].Prompt = req.Prompt
			}
			if req.Error != "" {
				p.Stages[i].Error = req.Error
			}
			if req.OperatorType != "" {
				p.Stages[i].OperatorType = req.OperatorType
			}
			if req.OperatorName != "" {
				p.Stages[i].OperatorName = req.OperatorName
			}
			if req.OperatorID != "" {
				p.Stages[i].OperatorID = req.OperatorID
			}
			if req.AgentRole != "" {
				p.Stages[i].AgentRole = req.AgentRole
			}
			if req.InputDesc != "" {
				p.Stages[i].InputDesc = req.InputDesc
			}
			if req.ExtraInputDesc != "" {
				p.Stages[i].ExtraInputDesc = req.ExtraInputDesc
			}
			if req.ExtraInput != "" {
				p.Stages[i].ExtraInput = req.ExtraInput
			}
			if req.OutputDesc != "" {
				p.Stages[i].OutputDesc = req.OutputDesc
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
		newStage := object.ProcessStage{
			Name:           stageName,
			Label:          object.StageLabels[stageName],
			Status:         req.Status,
			SessionID:      req.SessionID,
			Prompt:         req.Prompt,
			Error:          req.Error,
			OperatorType:   req.OperatorType,
			OperatorName:   req.OperatorName,
			OperatorID:     req.OperatorID,
			AgentRole:      req.AgentRole,
			InputDesc:      req.InputDesc,
			ExtraInputDesc: req.ExtraInputDesc,
			ExtraInput:     req.ExtraInput,
			OutputDesc:     req.OutputDesc,
		}
		if req.Status == object.StageStatusInProgress {
			newStage.StartedAt = &now
		}
		if req.Status == object.StageStatusCompleted || req.Status == object.StageStatusFailed {
			newStage.CompletedAt = &now
		}
		p.Stages = append(p.Stages, newStage)
		updated = true
	}

	p.UpdatedAt = now
	if err := s.store.Update(context.Background(), processID, p); err != nil {
		return object.Process{}, err
	}
	return p, nil
}
