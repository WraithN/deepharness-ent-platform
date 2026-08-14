package service

import (
	"context"
	"sync"
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
	object.StageDevComplete,
}

// ProcessService 流程服务接口
type ProcessService interface {
	Create(ctx context.Context, req object.CreateProcessRequest) (object.Process, error)
	GetByID(ctx context.Context, id string) (object.Process, error)
	ListByWorkspace(ctx context.Context, workspaceID string) ([]object.Process, error)
	ListByWorkitemAndDoc(ctx context.Context, workitemID, sourceDocPath string) ([]object.Process, error)
	HasInProgress(ctx context.Context, workitemID, sourceDocPath string) (*object.Process, error)
	UpdateStage(ctx context.Context, processID string, stageName string, req object.UpdateStageRequest) (object.Process, error)
	TerminateProcess(ctx context.Context, id string) (object.Process, error)
}

// ProcessServiceImpl 流程服务实现
type ProcessServiceImpl struct {
	store store.ProcessStore
	mu    sync.Mutex // 保护 Create/UpdateStage 的 read-modify-write，防止并行分支并发更新丢失
}

// NewProcessService 创建流程服务
func NewProcessService(s store.ProcessStore) *ProcessServiceImpl {
	return &ProcessServiceImpl{store: s}
}

func (s *ProcessServiceImpl) Create(_ context.Context, req object.CreateProcessRequest) (object.Process, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	p := object.Process{
		ID:            idutil.GenerateID(),
		WorkspaceID:   req.WorkspaceID,
		WorkitemID:    req.WorkitemID,
		Title:         req.Title,
		SourceDocPath: req.SourceDocPath,
		Type:          req.Type,
		Stages:        req.Stages,
		CreatedAt:     now,
		UpdatedAt:     now,
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
	removeObsoleteStages(&p)
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
		removeObsoleteStages(&list[i])
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

// obsoleteProductStageNames 是已从产品流程定义中移除的废弃阶段，
// 存量流程数据的 stages 中可能残留这些阶段，读取时自动清理（幂等）。
var obsoleteProductStageNames = map[string]bool{
	"product_ai_draft_review_fail": true,
}

// removeObsoleteStages 移除产品流程中已废弃的阶段（如 AI 草案复核失败节点）。
// 只清理内存中的阶段，不写回数据库；每次读取都会清理，确保前端不再展示废弃节点。
func removeObsoleteStages(p *object.Process) {
	if p.Type != object.ProcessTypeProduct {
		return
	}
	filtered := make([]object.ProcessStage, 0, len(p.Stages))
	for _, s := range p.Stages {
		if obsoleteProductStageNames[s.Name] {
			continue
		}
		filtered = append(filtered, s)
	}
	p.Stages = filtered
}

func (s *ProcessServiceImpl) ListByWorkitemAndDoc(_ context.Context, workitemID, sourceDocPath string) ([]object.Process, error) {
	return s.store.ListByWorkitemAndDoc(context.Background(), workitemID, sourceDocPath)
}

func (s *ProcessServiceImpl) HasInProgress(_ context.Context, workitemID, sourceDocPath string) (*object.Process, error) {
	list, err := s.store.ListByWorkitemAndDoc(context.Background(), workitemID, sourceDocPath)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if hasActiveStage(&list[i]) {
			return &list[i], nil
		}
	}
	return nil, nil
}

func hasActiveStage(p *object.Process) bool {
	for _, s := range p.Stages {
		if s.Status == object.StageStatusPending || s.Status == object.StageStatusInProgress {
			return true
		}
	}
	return false
}

// TerminateProcess 将流程中所有 pending/in_progress 阶段标记为 terminated，
// 用于取消进行中的流程（如重新发起前先取消旧流程）。
func (s *ProcessServiceImpl) TerminateProcess(_ context.Context, id string) (object.Process, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.store.GetByID(context.Background(), id)
	if err != nil {
		return object.Process{}, err
	}
	now := time.Now()
	for i := range p.Stages {
		if p.Stages[i].Status == object.StageStatusPending || p.Stages[i].Status == object.StageStatusInProgress {
			p.Stages[i].Status = object.StageStatusTerminated
			p.Stages[i].CompletedAt = &now
		}
	}
	p.UpdatedAt = now
	if err := s.store.Update(context.Background(), id, p); err != nil {
		return object.Process{}, err
	}
	return p, nil
}

func (s *ProcessServiceImpl) UpdateStage(_ context.Context, processID string, stageName string, req object.UpdateStageRequest) (object.Process, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
			if req.InputPrompt != "" {
				p.Stages[i].InputPrompt = req.InputPrompt
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
			if req.RetryCount > 0 {
				p.Stages[i].RetryCount = req.RetryCount
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
			InputPrompt:    req.InputPrompt,
			Error:          req.Error,
			OperatorType:   req.OperatorType,
			OperatorName:   req.OperatorName,
			OperatorID:     req.OperatorID,
			AgentRole:      req.AgentRole,
			InputDesc:      req.InputDesc,
			ExtraInputDesc: req.ExtraInputDesc,
			ExtraInput:     req.ExtraInput,
			OutputDesc:     req.OutputDesc,
			RetryCount:     req.RetryCount,
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
