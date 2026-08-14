package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
)

// ListUserRepos 列出工作空间下所有配置仓库在用户 projects 目录中的同步状态。
// ctx 应携带 per-user stubclient（由 containerMW 注入），确保文件检查与用户容器一致。
func (s *DBRepositoryService) ListUserRepos(ctx context.Context, workspaceID, userID string) ([]object.UserRepoStatus, error) {
	repos, err := s.List(workspaceID)
	if err != nil {
		return nil, err
	}
	result := make([]object.UserRepoStatus, 0, len(repos))
	for _, r := range repos {
		syncing := s.hasSyncLock(ctx, workspaceID, userID, r.Name)
		synced := s.isUserRepoSynced(ctx, workspaceID, userID, r.Name)
		status := object.UserRepoStatus{
			RepositoryID:  r.ID,
			Name:          r.Name,
			URL:           r.URL,
			Type:          string(r.Type),
			DefaultBranch: r.DefaultBranch,
			Synced:        synced,
		}
		if syncing {
			status.SyncStatus = object.STATE_SYNCING
			status.Progress = s.readSyncProgress(ctx, workspaceID, userID, r.Name)
		} else if synced {
			status.SyncStatus = object.STATE_SYNCED
		} else if errMsg := s.readSyncError(ctx, workspaceID, userID, r.Name); errMsg != "" {
			status.SyncStatus = object.STATE_FAILED
			status.ErrorMessage = errMsg
		}
		result = append(result, status)
	}
	return result, nil
}

// SyncUserRepo 将指定仓库异步克隆到用户 projects 目录。
// SSH Key 取自当前用户的 Profile，若未配置则返回错误提示。
// ctx 应携带 per-user stubclient（由 containerMW 注入），确保同步写入与 ArchGraph 检查
// 指向同一个 personal-stub 实例，避免"同步一直没效果"的问题。
func (s *DBRepositoryService) SyncUserRepo(ctx context.Context, workspaceID, repoID, userID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	// 仅 SSH URL 需要私钥；HTTPS/git:// 无需
	sshKey := ""
	if gitrepo.IsSSHURL(r.URL) {
		var keyErr error
		sshKey, keyErr = s.resolveSSHKey(userID)
		if keyErr != nil {
			return fmt.Errorf("SSH 密钥校验失败: %w", keyErr)
		}
	}

	// 文件系统已就绪（.git 存在且无同步锁）时直接返回，但需修正 DB CloneStatus 可能
	// 滞后于文件系统的情况：仓库级同步 syncRepository 在某些失败路径会残留 .git 却将
	// CloneStatus 置为 failed/pending/cloning（典型场景：空仓库 initEmptyRepo 后 fetch
	// 失败，.git 已由 PlainInit 创建但整体 clone 返回错误）。若不修正，isArchRepoCloned
	// 因 CloneStatus != cloned 始终返回 false，架构看板无法出现，表现为"同步架构库一直不生效"。
	if s.isUserRepoSynced(ctx, workspaceID, userID, r.Name) {
		s.markClonedIfStale(r, "SyncUserRepo")
		return nil
	}
	// 如果正在同步中（锁文件存在），直接返回
	if s.hasSyncLock(ctx, workspaceID, userID, r.Name) {
		return nil
	}

	dest := s.userProjectPath(workspaceID, userID, r.Name)
	if dest == "" {
		return errors.New("workspace root is not configured")
	}

	// 写入锁文件，标记同步开始
	if err := s.writeSyncLock(ctx, workspaceID, userID, r.Name, 0); err != nil {
		log.Printf("[Repository] SyncUserRepo writeSyncLock failed for %s: %v", r.Name, err)
		return err
	}

	safego.Go("repo-sync-user", func() {
		// 异步 goroutine 不能使用请求 context（请求结束后 ctx 取消），
		// 但必须复用请求 context 中的 per-user stubclient，否则会降级到 defaultClient，
		// 导致同步写入与 ArchGraph 检查指向不同的 personal-stub 实例。
		bgCtx := stubclient.WithClient(context.Background(), stubclient.FromContext(ctx))
		defer s.deleteSyncLock(bgCtx, workspaceID, userID, r.Name)

		// 清理上次同步残留的错误信息
		s.deleteSyncError(bgCtx, workspaceID, userID, r.Name)

		// 架构合规：通过 stubclient 在共享目录创建父目录，不直接操作文件系统
		sc := stubclient.FromContext(bgCtx)
		if sc == nil {
			s.writeSyncError(bgCtx, workspaceID, userID, r.Name, "personal-stub client not initialized")
			return
		}
		if err := sc.MkdirAll(bgCtx, filepath.Dir(dest)); err != nil {
			s.writeSyncError(bgCtx, workspaceID, userID, r.Name, fmt.Sprintf("创建项目目录失败: %v", err))
			log.Printf("[Repository] create user project dir %s failed: %v", dest, err)
			return
		}
		if ok, err := sc.FileExists(bgCtx, dest); err == nil && ok {
			_ = sc.RemoveDir(bgCtx, dest)
		}
		// 架构合规：传 nil 进度回调使 Clone 使用 go-git 纯 Go 库，不 exec git 命令。
		// 进度锁文件已在同步开始时写入 0%，用户可看到"同步中"状态。
		if err := s.gitClient.Clone(r.URL, dest, sshKey, r.DefaultBranch, nil); err != nil {
			s.writeSyncError(bgCtx, workspaceID, userID, r.Name, fmt.Sprintf("克隆仓库失败: %v", err))
			log.Printf("[Repository] user repo sync failed for %s: %v", r.Name, err)
			return
		}
		now := time.Now().UTC()
		s.updateStatusAndSyncTime(r.ID, repository.CloneStatusCloned, &now)
		log.Printf("[Repository] user repo sync completed: %s -> %s", r.Name, dest)
	})

	return nil
}

// markClonedIfStale 在文件系统已就绪但 DB CloneStatus 非 cloned 时，将 DB 修正为 cloned。
// 用于消除"文件系统 .git 存在但 DB CloneStatus 滞后"的不一致，使 isArchRepoCloned 能通过。
// trigger 仅用于日志标识调用来源，便于排查状态被谁修正。
func (s *DBRepositoryService) markClonedIfStale(r repository.Repository, trigger string) {
	if r.CloneStatus == repository.CloneStatusCloned {
		return
	}
	now := time.Now().UTC()
	s.updateStatusAndSyncTime(r.ID, repository.CloneStatusCloned, &now)
	log.Printf("[Repository] %s: reconcile CloneStatus %q -> cloned for %s", trigger, r.CloneStatus, r.Name)
}
