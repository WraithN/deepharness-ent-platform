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

func (s *MockRepositoryService) Scan(workspaceID string) ([]ScannedRepository, error) {
	repos, err := s.List(workspaceID)
	if err != nil {
		return nil, err
	}

	result := make([]ScannedRepository, 0, len(repos))
	now := time.Now().UTC()
	for _, r := range repos {
		result = append(result, ScannedRepository{
			Name:              r.Name,
			Path:              r.LocalPath,
			URL:               r.URL,
			CurrentBranch:     r.DefaultBranch,
			LastCommit:        "abc123def",
			LastCommitMessage: "Mock commit message",
			LastCommitTime:    &now,
			IsCloned:          true,
		})
	}

	return result, nil
}

func (s *MockRepositoryService) GetDetails(workspaceID, repoID string) (*RepositoryDetails, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	return &RepositoryDetails{
		Repository: repo,
		CommitStats: CommitStats{
			TotalCommits: 125,
			LastWeek:     12,
			LastMonth:    45,
			LastCommit:   &now,
			FirstCommit:  &now,
		},
		Branches: []BranchInfo{
			{Name: "main", IsCurrent: true, LastCommit: "abc123def", LastCommitTime: &now},
			{Name: "develop", IsCurrent: false, LastCommit: "def456abc", LastCommitTime: &now},
		},
		Contributors: []string{"Developer 1", "Developer 2"},
		FileCount:    42,
		SizeBytes:    1024 * 1024 * 5,
		Language:     "TypeScript",
	}, nil
}

func (s *MockRepositoryService) GetFileTree(workspaceID, repoID, branch string) ([]FileNode, error) {
	return []FileNode{
		{
			Name: "src",
			Path: "src",
			Type: "folder",
			Children: []FileNode{
				{Name: "main.go", Path: "src/main.go", Type: "file"},
				{Name: "utils", Path: "src/utils", Type: "folder", Children: []FileNode{
					{Name: "helper.go", Path: "src/utils/helper.go", Type: "file"},
				}},
			},
		},
		{Name: "go.mod", Path: "go.mod", Type: "file"},
		{Name: "README.md", Path: "README.md", Type: "file"},
	}, nil
}

func (s *MockRepositoryService) GetFileContent(workspaceID, repoID, branch, path string) (*FileContent, error) {
	return &FileContent{
		Path:     path,
		Name:     path,
		Content:  "// Mock file content\npackage main\n\nfunc main() {\n\tprintln(\"Hello World\")\n}",
		Language: "go",
		Encoding: "utf-8",
		Size:     1024,
	}, nil
}

func (s *MockRepositoryService) GetBranches(workspaceID, repoID string) ([]BranchInfo, error) {
	now := time.Now().UTC()
	return []BranchInfo{
		{Name: "main", IsCurrent: true, IsRemote: false, LastCommit: "abc123def", LastCommitTime: &now},
		{Name: "develop", IsCurrent: false, IsRemote: false, LastCommit: "def456abc", LastCommitTime: &now},
		{Name: "feature/test", IsCurrent: false, IsRemote: true, LastCommit: "ghi789jkl", LastCommitTime: &now},
	}, nil
}

func (s *MockRepositoryService) SwitchBranch(workspaceID, repoID, branchName string) error {
	return nil
}

func (s *MockRepositoryService) SaveFileContent(workspaceID, repoID, path, content string) error {
	return nil
}

func (s *MockRepositoryService) GitCommit(workspaceID, repoID, message string) (string, error) {
	return "mock-commit-hash", nil
}

func (s *MockRepositoryService) GitStatus(workspaceID, repoID string) (string, error) {
	return "", nil
}
