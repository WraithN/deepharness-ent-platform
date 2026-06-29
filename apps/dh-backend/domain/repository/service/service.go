package service

import (
	"time"

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
	Scan(workspaceID string) ([]ScannedRepository, error)
	GetDetails(workspaceID, repoID string) (*RepositoryDetails, error)
	GetFileTree(workspaceID, repoID, branch string) ([]FileNode, error)
	GetFileContent(workspaceID, repoID, branch, path string) (*FileContent, error)
	SaveFileContent(workspaceID, repoID, path, content string) error
	GitCommit(workspaceID, repoID, message string) (string, error)
	GitStatus(workspaceID, repoID string) (string, error)
	GetBranches(workspaceID, repoID string) ([]BranchInfo, error)
	SwitchBranch(workspaceID, repoID, branchName string) error
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

// ScannedRepository 扫描发现的本地仓库。
type ScannedRepository struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	URL          string `json:"url"`
	CurrentBranch string `json:"currentBranch"`
	LastCommit   string `json:"lastCommit"`
	LastCommitMessage string `json:"lastCommitMessage"`
	LastCommitTime *time.Time `json:"lastCommitTime,omitempty"`
	IsCloned     bool   `json:"isCloned"`
}

// CommitStats 提交统计信息。
type CommitStats struct {
	TotalCommits int       `json:"totalCommits"`
	LastWeek     int       `json:"lastWeek"`
	LastMonth    int       `json:"lastMonth"`
	LastCommit   *time.Time `json:"lastCommit,omitempty"`
	FirstCommit  *time.Time `json:"firstCommit,omitempty"`
}

// BranchInfo 分支信息。
type BranchInfo struct {
	Name         string    `json:"name"`
	IsCurrent    bool      `json:"isCurrent"`
	IsRemote     bool      `json:"isRemote"`
	LastCommit   string    `json:"lastCommit"`
	LastCommitTime *time.Time `json:"lastCommitTime,omitempty"`
	Ahead        int       `json:"ahead"`
	Behind       int       `json:"behind"`
}

// RepositoryDetails 仓库详细信息。
type RepositoryDetails struct {
	Repository   repository.Repository `json:"repository"`
	CommitStats  CommitStats           `json:"commitStats"`
	Branches     []BranchInfo          `json:"branches"`
	Contributors []string              `json:"contributors"`
	FileCount    int                   `json:"fileCount"`
	SizeBytes    int64                 `json:"sizeBytes"`
	Language     string                `json:"language"`
}

// FileNode 文件树节点。
type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Type     string     `json:"type"` // "file" or "folder"
	Children []FileNode `json:"children,omitempty"`
}

// FileContent 文件内容。
type FileContent struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	Language string `json:"language"`
	Encoding string `json:"encoding"`
	Size     int64  `json:"size"`
}
