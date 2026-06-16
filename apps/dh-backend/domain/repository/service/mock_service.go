package service

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"github.com/google/uuid"
)

const mockLocalPathPrefix = "/tmp/mock-"

// MockRepositoryService 是 RepositoryService 的内存 mock，不执行真实 clone。
type MockRepositoryService struct {
	mu    sync.RWMutex
	repos map[string]repository.Repository
	byWS  map[string][]string
}

// NewMockRepositoryService 创建 MockRepositoryService。
func NewMockRepositoryService() *MockRepositoryService {
	return &MockRepositoryService{
		repos: make(map[string]repository.Repository),
		byWS:  make(map[string][]string),
	}
}

func (s *MockRepositoryService) List(workspaceID string) ([]repository.Repository, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := s.byWS[workspaceID]
	result := make([]repository.Repository, 0, len(ids))
	for _, id := range ids {
		result = append(result, s.repos[id])
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

func (s *MockRepositoryService) Get(workspaceID, repoID string) (repository.Repository, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	r, ok := s.repos[repoID]
	if !ok || r.WorkspaceID != workspaceID {
		return repository.Repository{}, errors.New("repository not found")
	}
	return r, nil
}

func (s *MockRepositoryService) Create(workspaceID string, req CreateRepositoryRequest) (repository.Repository, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	r := repository.Repository{
		ID:            uuid.New().String(),
		WorkspaceID:   workspaceID,
		Name:          req.Name,
		URL:           req.URL,
		Type:          repository.RepoType(req.Type),
		DefaultBranch: req.DefaultBranch,
		SSHKey:        req.SSHKey,
		LocalPath:     mockLocalPathPrefix + workspaceID + "-" + req.Name,
		CloneStatus:   repository.CloneStatusPending,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	s.repos[r.ID] = r
	s.byWS[workspaceID] = append(s.byWS[workspaceID], r.ID)
	return r, nil
}

func (s *MockRepositoryService) Update(workspaceID, repoID string, req UpdateRepositoryRequest) (repository.Repository, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.repos[repoID]
	if !ok || r.WorkspaceID != workspaceID {
		return repository.Repository{}, errors.New("repository not found")
	}
	if req.Name != "" {
		r.Name = req.Name
	}
	if req.URL != "" {
		r.URL = req.URL
	}
	if req.Type != "" {
		r.Type = repository.RepoType(req.Type)
	}
	if req.DefaultBranch != "" {
		r.DefaultBranch = req.DefaultBranch
	}
	if req.SSHKey != "" {
		r.SSHKey = req.SSHKey
	}
	r.UpdatedAt = time.Now().UTC()
	s.repos[repoID] = r
	return r, nil
}

func (s *MockRepositoryService) Delete(workspaceID, repoID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.repos[repoID]
	if !ok || r.WorkspaceID != workspaceID {
		return errors.New("repository not found")
	}
	delete(s.repos, repoID)
	ids := s.byWS[workspaceID]
	for i, id := range ids {
		if id == repoID {
			s.byWS[workspaceID] = append(ids[:i], ids[i+1:]...)
			break
		}
	}
	return nil
}

func (s *MockRepositoryService) Sync(workspaceID, repoID string) error {
	_, err := s.Get(workspaceID, repoID)
	return err
}
