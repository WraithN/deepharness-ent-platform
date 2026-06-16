package service

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

// RepositoryService 定义仓库领域服务接口。
type RepositoryService interface {
	List(workspaceID string) ([]repository.Repository, error)
	Get(workspaceID, repoID string) (repository.Repository, error)
	Create(workspaceID string, req CreateRepositoryRequest) (repository.Repository, error)
	Update(workspaceID, repoID string, req UpdateRepositoryRequest) (repository.Repository, error)
	Delete(workspaceID, repoID string) error
	Sync(workspaceID, repoID string) error
}

// CreateRepositoryRequest 创建仓库请求。
type CreateRepositoryRequest struct {
	Name          string `json:"name"`
	URL           string `json:"url"`
	Type          string `json:"type"`
	DefaultBranch string `json:"defaultBranch"`
	SSHKey        string `json:"sshKey"`
}

// UpdateRepositoryRequest 更新仓库请求。
type UpdateRepositoryRequest struct {
	Name          string `json:"name,omitempty"`
	URL           string `json:"url,omitempty"`
	Type          string `json:"type,omitempty"`
	DefaultBranch string `json:"defaultBranch,omitempty"`
	SSHKey        string `json:"sshKey,omitempty"`
}
