package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/gitutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

// ErrNoChangesToCommit 表示 git 工作区无变更，无需提交。
// 业务层可通过 errors.Is(err, service.ErrNoChangesToCommit) 识别该状态，避免字符串匹配。
var ErrNoChangesToCommit = errors.New("no changes to commit")

// GetBranches 获取仓库分支列表。
// GetBranches 返回仓库分支列表。优先从缓存读取（不触发 git fetch），
// 缓存未命中时执行 git fetch 并缓存结果。
func (s *DBRepositoryService) GetBranches(workspaceID, repoID, userID string) ([]object.BranchInfo, error) {
	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()
	// 优先从缓存读取，避免每次页面加载都触发 git fetch。
	if s.branchCache != nil {
		if branches, ok := s.branchCache.Get(ctx, repoID); ok {
			return branches, nil
		}
	}
	return s.fetchAndCacheBranches(ctx, workspaceID, repoID, userID)
}

// RefreshBranches 强制从 git 远端刷新分支列表并更新缓存。
func (s *DBRepositoryService) RefreshBranches(workspaceID, repoID, userID string) ([]object.BranchInfo, error) {
	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()
	return s.fetchAndCacheBranches(ctx, workspaceID, repoID, userID)
}

// fetchAndCacheBranches 执行 git fetch + branch 解析，并将结果写入缓存。
func (s *DBRepositoryService) fetchAndCacheBranches(ctx context.Context, workspaceID, repoID, userID string) ([]object.BranchInfo, error) {
	branches, err := s.fetchBranchesFromGit(ctx, workspaceID, repoID, userID)
	if err != nil {
		return nil, err
	}
	if s.branchCache != nil {
		_ = s.branchCache.Set(ctx, repoID, branches)
	}
	return branches, nil
}

// fetchBranchesFromGit 执行 git fetch origin 并解析分支列表。
func (s *DBRepositoryService) fetchBranchesFromGit(ctx context.Context, workspaceID, repoID, userID string) ([]object.BranchInfo, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	localPath := s.resolveUserLocalPath(repo, userID)
	if localPath == "" {
		log.Printf("[Repository] user local path empty for repo %s user=%s (status=%s, error=%s), returning fallback branches",
			repoID, userID, repo.CloneStatus, repo.ErrorMessage)
		return s.fallbackBranches(repo), nil
	}

	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return s.fallbackBranches(repo), nil
	}
	if ok, err := sc.FileExists(ctx, localPath); err != nil || !ok {
		// 用户目录尚未同步，触发异步克隆并返回默认分支作为降级。
		log.Printf("[Repository] user local path missing for repo %s user=%s (path=%s), triggering sync", repoID, userID, localPath)
		if syncErr := s.SyncUserRepo(repo.WorkspaceID, repo.ID, userID); syncErr != nil {
			log.Printf("[Repository] trigger SyncUserRepo failed: %v", syncErr)
		}
		return s.fallbackBranches(repo), nil
	}

	// Fetch latest from remote first
	_, _ = gitutil.Exec(ctx, localPath, "fetch", "origin")

	currentBranch, err := gitutil.Exec(ctx, localPath, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return nil, fmt.Errorf("failed to get current branch: %w", err)
	}
	currentBranch = strings.TrimSpace(currentBranch)

	// List all local and remote branches
	// 使用逗号分隔，避免分号被 personal-stub 的 gitShellUnsafeChars 校验拒绝
	branchesOut, err := gitutil.Exec(ctx, localPath, "branch", "-av", "--format=%(refname:short),%(objectname),%(committerdate:iso8601)")
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %w", err)
	}

	seenBranches := make(map[string]bool)
	var branches []object.BranchInfo
	for _, line := range strings.Split(branchesOut, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Split(line, ",")
		if len(parts) >= 2 {
			branchName := parts[0]
			// Skip HEAD references (origin/HEAD) and remote dir itself (origin)
			if branchName == "HEAD" || branchName == "origin" || strings.HasPrefix(branchName, "origin/HEAD") {
				continue
			}
			// Remove origin/ prefix for display
			displayName := strings.TrimPrefix(branchName, "origin/")
			if seenBranches[displayName] {
				continue
			}
			seenBranches[displayName] = true

			bi := object.BranchInfo{
				Name:       displayName,
				IsRemote:   strings.HasPrefix(branchName, "origin/"),
				IsCurrent:  displayName == currentBranch,
				LastCommit: parts[1],
			}
			if len(parts) >= 3 && parts[2] != "" {
				if t, err := time.Parse("2006-01-02 15:04:05 -0700", parts[2]); err == nil {
					bi.LastCommitTime = &t
				}
			}
			branches = append(branches, bi)
		}
	}

	return branches, nil
}

// fallbackBranches 在本地仓库不可用时返回降级分支列表（仅默认分支）。
func (s *DBRepositoryService) fallbackBranches(repo repository.Repository) []object.BranchInfo {
	branchName := repo.DefaultBranch
	if branchName == "" {
		branchName = "main"
	}
	return []object.BranchInfo{
		{Name: branchName, IsCurrent: true},
	}
}

// ensureLocalPath 检查当前用户应使用的仓库本地目录是否存在。
// 若不存在则触发用户级同步，返回 error 表示目录当前不可用，调用方应降级或等待同步完成。
func (s *DBRepositoryService) ensureLocalPath(ctx context.Context, repo repository.Repository, userID string) error {
	localPath := s.resolveUserLocalPath(repo, userID)
	if localPath == "" {
		return fmt.Errorf("repository not cloned yet")
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil
	}
	if ok, err := sc.FileExists(ctx, localPath); err != nil || !ok {
		log.Printf("[Repository] user local path missing for repo %s user=%s (path=%s), triggering sync", repo.ID, userID, localPath)
		// 触发用户级同步；创建者目录缺失时同样复用 SyncUserRepo，它会走用户目录。
		if syncErr := s.SyncUserRepo(repo.WorkspaceID, repo.ID, userID); syncErr != nil {
			log.Printf("[Repository] trigger SyncUserRepo failed: %v", syncErr)
		}
		return fmt.Errorf("repository local path missing, syncing in background")
	}
	return nil
}

// SwitchBranch 切换分支并拉取最新代码。
func (s *DBRepositoryService) SwitchBranch(workspaceID, repoID, branchName, userID string) error {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()

	if err := s.ensureLocalPath(ctx, repo, userID); err != nil {
		return err
	}

	localPath := s.resolveUserLocalPath(repo, userID)

	// Fetch latest from remote
	_, _ = gitutil.Exec(ctx, localPath, "fetch", "origin")

	// Check if branch exists locally
	localBranchExists := false
	if branchesOut, err := gitutil.Exec(ctx, localPath, "branch", "--list", branchName); err == nil {
		localBranchExists = strings.TrimSpace(branchesOut) != ""
	}

	var checkoutErr error
	if localBranchExists {
		// Branch exists locally, just checkout
		_, checkoutErr = gitutil.Exec(ctx, localPath, "checkout", branchName)
	} else {
		// Branch doesn't exist locally, checkout tracking branch from remote
		_, checkoutErr = gitutil.Exec(ctx, localPath, "checkout", "-t", "origin/"+branchName)
	}
	if checkoutErr != nil {
		return fmt.Errorf("failed to checkout branch %s: %w", branchName, checkoutErr)
	}

	// Pull latest changes
	if _, err := gitutil.Exec(ctx, localPath, "pull"); err != nil {
		// Pull may fail if no remote tracking configured, but checkout succeeded
		log.Printf("[Repository] pull failed (non-critical): %v", err)
	}

	// Update default_branch in database
	_, err = s.db.Exec(`
		UPDATE repositories 
		SET default_branch = $1, updated_at = $2
		WHERE id = $3
	`, branchName, time.Now().UTC(), repoID)
	if err != nil {
		log.Printf("[Repository] failed to update default branch: %v", err)
	}

	return nil
}

// GitCommit 提交更改到 git
func (s *DBRepositoryService) GitCommit(workspaceID, repoID, message, userID string) (string, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return "", err
	}

	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()

	if err := s.ensureLocalPath(ctx, repo, userID); err != nil {
		return "", err
	}

	localPath := s.resolveUserLocalPath(repo, userID)

	// Add all changes
	if _, err := gitutil.Exec(ctx, localPath, "add", "."); err != nil {
		return "", fmt.Errorf("failed to add changes: %w", err)
	}

	// Commit
	commitMsg := message
	if commitMsg == "" {
		commitMsg = "Update files via web interface"
	}
	if _, err := gitutil.Exec(ctx, localPath, "commit", "-m", commitMsg); err != nil {
		// git 返回 "nothing to commit" 时使用类型化错误，避免调用方做字符串匹配。
		if strings.Contains(err.Error(), "nothing to commit") {
			return "", ErrNoChangesToCommit
		}
		return "", fmt.Errorf("failed to commit: %w", err)
	}

	// Get commit hash
	hash, err := gitutil.Exec(ctx, localPath, "rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("failed to get commit hash: %w", err)
	}

	return strings.TrimSpace(hash), nil
}

// GitStatus 获取 git 状态（未提交的更改）
func (s *DBRepositoryService) GitStatus(workspaceID, repoID, userID string) (string, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return "", err
	}

	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()

	if err := s.ensureLocalPath(ctx, repo, userID); err != nil {
		return "", err
	}

	localPath := s.resolveUserLocalPath(repo, userID)

	status, err := gitutil.Exec(ctx, localPath, "status", "--porcelain")
	if err != nil {
		return "", fmt.Errorf("failed to get status: %w", err)
	}

	return strings.TrimSpace(status), nil
}
