package service

import (
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

// SSHKeyResolver 按用户 ID 解析其 Git SSH 私钥（来源：user_profiles.ssh_key）。
// 仓库克隆/拉取时统一使用当前操作用户的 SSH Key，不再逐仓库配置。
type SSHKeyResolver interface {
	ResolveSSHKey(userID string) (string, error)
}

// RepositoryService 定义仓库领域服务接口。
// Create/Update/Sync 接收 userID 用于解析操作者的 SSH Key。
type RepositoryService interface {
	List(workspaceID string) ([]repository.Repository, error)
	Get(workspaceID, repoID string) (repository.Repository, error)
	Create(workspaceID, userID string, req CreateRepositoryRequest) (repository.Repository, error)
	Update(workspaceID, repoID, userID string, req UpdateRepositoryRequest) (repository.Repository, error)
	Delete(workspaceID, repoID string) error
	Sync(workspaceID, repoID, userID string) error
	Scan(workspaceID string) ([]ScannedRepository, error)
	GetDetails(workspaceID, repoID string) (*RepositoryDetails, error)
	GetFileTree(workspaceID, repoID, branch string) ([]FileNode, error)
	GetFileContent(workspaceID, repoID, branch, path string) (*FileContent, error)
	SaveFileContent(workspaceID, repoID, path, content string) error
	GitCommit(workspaceID, repoID, message string) (string, error)
	GitStatus(workspaceID, repoID string) (string, error)
	GetBranches(workspaceID, repoID string) ([]BranchInfo, error)
	RefreshBranches(workspaceID, repoID string) ([]BranchInfo, error)
	SwitchBranch(workspaceID, repoID, branchName string) error

	// 用户级仓库操作 —— 将工作空间配置的仓库同步到用户自己的 projects 目录下。
	// ListUserRepos 返回工作空间下所有配置仓库在用户 projects 目录中的同步状态。
	ListUserRepos(workspaceID, userID string) ([]UserRepoStatus, error)
	// SyncUserRepo 将指定仓库克隆到用户 projects 目录，异步执行。
	SyncUserRepo(workspaceID, repoID, userID string) error
}

// CreateRepositoryRequest 创建仓库请求。仓库名称由 URL 解析，SSH Key 由用户 Profile 提供。
type CreateRepositoryRequest struct {
	URL           string `json:"url"`
	Type          string `json:"type"`
	DefaultBranch string `json:"defaultBranch"`
}

// UpdateRepositoryRequest 更新仓库请求。
type UpdateRepositoryRequest struct {
	URL           string `json:"url,omitempty"`
	Type          string `json:"type,omitempty"`
	DefaultBranch string `json:"defaultBranch,omitempty"`
}

// ParseRepoName 从仓库 URL 解析仓库名称（取最后一段路径并去除 .git 后缀）。
// 支持格式：https://host/org/repo.git / git@host:org/repo.git / ssh://git@host/org/repo
func ParseRepoName(rawURL string) string {
	u := strings.TrimSuffix(rawURL, ".git")
	u = strings.TrimRight(u, "/")
	if u == "" {
		return ""
	}
	// 优先按 / 分割取末段（覆盖 https 与 scp-like 含路径的场景）
	if idx := strings.LastIndex(u, "/"); idx >= 0 {
		return u[idx+1:]
	}
	// 兜底：纯 scp-like git@host:repo（无组织路径）
	if idx := strings.LastIndex(u, ":"); idx >= 0 {
		return u[idx+1:]
	}
	return u
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

// UserRepoStatus 表示一个配置仓库在用户 projects 目录中的同步状态。
type UserRepoStatus struct {
	RepositoryID  string `json:"repositoryId"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	Type          string `json:"type"`
	DefaultBranch string `json:"defaultBranch"`
	Synced        bool   `json:"synced"`
	SyncStatus    string `json:"syncStatus"`
	Progress      int    `json:"progress"`
	ErrorMessage  string `json:"errorMessage,omitempty"`
}

// STATE_SYNCING / STATE_SYNCED / STATE_FAILED 为用户仓库同步状态常量。
const (
	STATE_SYNCING = "syncing"
	STATE_SYNCED  = "synced"
	STATE_FAILED  = "failed"
)
