package core

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
	workitemtracker "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/workitem-tracker"
)

// Service 工作项核心业务
type Service struct {
	trackers map[string]workitemtracker.Tracker
}

func NewService() *Service {
	return &Service{trackers: make(map[string]workitemtracker.Tracker)}
}

func (s *Service) RegisterTracker(name string, t workitemtracker.Tracker) {
	s.trackers[name] = t
}

func (s *Service) List(ctx context.Context, trackerName, projectKey string) ([]workitem.WorkItem, error) {
	t, ok := s.trackers[trackerName]
	if !ok {
		return nil, nil
	}
	return t.List(ctx, projectKey)
}
