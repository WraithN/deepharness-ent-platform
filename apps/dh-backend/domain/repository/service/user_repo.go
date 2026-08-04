package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
)

// ListUserRepos 列出工作空间下所有配置仓库在用户 projects 目录中的同步状态。
func (s *DBRepositoryService) ListUserRepos(workspaceID, userID string) ([]object.UserRepoStatus, error) {
	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()
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
func (s *DBRepositoryService) SyncUserRepo(workspaceID, repoID, userID string) error {
	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()
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

	// 如果已经同步完成，直接返回
	if s.isUserRepoSynced(ctx, workspaceID, userID, r.Name) {
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
		// 异步 goroutine 无调用方 context，使用 context.Background() 作为根 context。
		bgCtx := context.Background()
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
		log.Printf("[Repository] user repo sync completed: %s -> %s", r.Name, dest)
	})

	return nil
}
