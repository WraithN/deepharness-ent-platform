package service

import (
	"context"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
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
	Create(workspaceID, userID string, req object.CreateRepositoryRequest) (repository.Repository, error)
	Update(workspaceID, repoID, userID string, req object.UpdateRepositoryRequest) (repository.Repository, error)
	Delete(workspaceID, repoID string) error
	Sync(workspaceID, repoID, userID string) error
	Scan(workspaceID, userID string) ([]object.ScannedRepository, error)
	GetDetails(workspaceID, repoID, userID string) (*object.RepositoryDetails, error)
	GetFileTree(workspaceID, repoID, branch, userID string) ([]object.FileNode, error)
	GetFileContent(workspaceID, repoID, branch, path, userID string) (*object.FileContent, error)
	SaveFileContent(workspaceID, repoID, path, content, userID string) error
	GitCommit(workspaceID, repoID, message, userID string) (string, error)
	GitStatus(workspaceID, repoID, userID string) (string, error)
	GetBranches(workspaceID, repoID, userID string) ([]object.BranchInfo, error)
	RefreshBranches(workspaceID, repoID, userID string) ([]object.BranchInfo, error)
	SwitchBranch(workspaceID, repoID, branchName, userID string) error
	SetRemoteURL(workspaceID, repoID, userID, url string) error
	Push(workspaceID, repoID, userID string) error
	GetUnpushedCommits(workspaceID, repoID, userID string) (int, error)

	// 用户级仓库操作 —— 将工作空间配置的仓库同步到用户自己的 projects 目录下。
	// ListUserRepos 返回工作空间下所有配置仓库在用户 projects 目录中的同步状态。
	ListUserRepos(ctx context.Context, workspaceID, userID string) ([]object.UserRepoStatus, error)
	// SyncUserRepo 将指定仓库克隆到用户 projects 目录，异步执行。
	SyncUserRepo(ctx context.Context, workspaceID, repoID, userID string) error

	// DevLibKGPath 返回开发库在用户目录下的 knowledge-graph.json 路径。
	DevLibKGPath(ctx context.Context, workspaceID, userID, libKey string) string
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
