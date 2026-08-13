package store

import (
	"context"
	"fmt"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
)

// MemoryProcessStore 内存实现的流程存储
type MemoryProcessStore struct {
	mu    sync.RWMutex
	items map[string]object.Process
}

// NewMemoryProcessStore 创建内存存储实例
func NewMemoryProcessStore() *MemoryProcessStore {
	return &MemoryProcessStore{items: make(map[string]object.Process)}
}

func (s *MemoryProcessStore) Create(_ context.Context, p object.Process) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[p.ID] = p
	return nil
}

func (s *MemoryProcessStore) GetByID(_ context.Context, id string) (object.Process, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.items[id]
	if !ok {
		return object.Process{}, fmt.Errorf("process not found: %s", id)
	}
	return p, nil
}

func (s *MemoryProcessStore) ListByWorkspace(_ context.Context, workspaceID string) ([]object.Process, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []object.Process
	for _, p := range s.items {
		if p.WorkspaceID == workspaceID {
			result = append(result, p)
		}
	}
	return result, nil
}

func (s *MemoryProcessStore) ListByWorkitemAndDoc(_ context.Context, workitemID, sourceDocPath string) ([]object.Process, error) {
	if sourceDocPath == "" {
		return nil, nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []object.Process
	for _, p := range s.items {
		if p.WorkitemID == workitemID && p.SourceDocPath == sourceDocPath {
			result = append(result, p)
		}
	}
	return result, nil
}

func (s *MemoryProcessStore) Update(_ context.Context, id string, p object.Process) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.items[id]; !ok {
		return fmt.Errorf("process not found: %s", id)
	}
	s.items[id] = p
	return nil
}
