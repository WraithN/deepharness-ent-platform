package service

import (
	"context"
	"errors"
	"log"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
)

// ── 用户级仓库操作 ──

// userProjectPath 构建用户 dev-jobs 目录下某个仓库的本地路径。
// 路径格式：WORKSPACE_ROOT/{userID}/{workspaceID}/dev-jobs/{repoName}
func (s *DBRepositoryService) userProjectPath(workspaceID, userID, repoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	base, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(repoName)
	return filepath.Join(base, workspacepath.DirDevJobs, safeName)
}

// resolveUserLocalPath 返回当前用户应使用的仓库本地路径。
//
// 工作空间级仓库在 DB 中记录的是创建者目录（{root}/{creatorID}/{ws}/dev-jobs/{name}）。
// 当当前操作用户不是创建者时，应使用其自己的用户目录，避免多用户互相看到/修改同一份本地代码。
// 如果当前用户就是创建者，则继续使用 DB 中记录的 local_path。
func (s *DBRepositoryService) resolveUserLocalPath(repo repository.Repository, userID string) string {
	if userID == "" || repo.LocalPath == "" {
		return repo.LocalPath
	}
	creatorID := extractCreatorUserIDFromLocalPath(repo.LocalPath)
	if creatorID != "" && creatorID == userID {
		return repo.LocalPath
	}
	return s.userProjectPath(repo.WorkspaceID, userID, repo.Name)
}

// extractCreatorUserIDFromLocalPath 从仓库 local_path 中解析创建者 userID。
// 路径格式：{root}/{creatorID}/{workspaceID}/dev-jobs/{repoName}。
func extractCreatorUserIDFromLocalPath(localPath string) string {
	if localPath == "" {
		return ""
	}
	parts := strings.Split(filepath.ToSlash(localPath), "/")
	// 倒数第三段必须是 dev-jobs，倒数第四段即为创建者 userID。
	if len(parts) >= 4 && parts[len(parts)-3] == workspacepath.DirDevJobs {
		return parts[len(parts)-4]
	}
	return ""
}

// userSyncLockPath 构建用户仓库同步锁文件的路径。
// 路径格式：WORKSPACE_ROOT/{userID}/{workspaceID}/dev-jobs/{repoName}.clone.lock
func (s *DBRepositoryService) userSyncLockPath(workspaceID, userID, repoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	base, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(repoName)
	return filepath.Join(base, workspacepath.DirDevJobs, safeName+".clone.lock")
}

// hasSyncLock 检查是否存在同步锁文件（表示正在同步中）。
func (s *DBRepositoryService) hasSyncLock(ctx context.Context, workspaceID, userID, repoName string) bool {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return false
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	ok, err := sc.FileExists(ctx, lockPath)
	if err != nil || !ok {
		return false
	}
	return true
}

// writeSyncLock 通过 personal-stub 写入同步锁文件，内容为进度百分比。
// 架构合规：dh-backend 不直接写共享目录，委托 personal-stub 执行。
func (s *DBRepositoryService) writeSyncLock(ctx context.Context, workspaceID, userID, repoName string, progress int) error {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return errors.New("workspace root is not configured")
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	return sc.WriteFile(ctx, lockPath, strconv.Itoa(progress))
}

// deleteSyncLock 通过 personal-stub 删除同步锁文件（同步完成或失败后清理）。
func (s *DBRepositoryService) deleteSyncLock(ctx context.Context, workspaceID, userID, repoName string) {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return
	}
	if ok, err := sc.FileExists(ctx, lockPath); err != nil || !ok {
		return // 锁文件不存在，无需删除
	}
	if err := sc.DeleteFile(ctx, lockPath); err != nil {
		log.Printf("[Repository] deleteSyncLock failed for %s: %v", repoName, err)
	}
}

// readSyncProgress 读取同步锁文件中的进度值，文件不存在时返回 0。
func (s *DBRepositoryService) readSyncProgress(ctx context.Context, workspaceID, userID, repoName string) int {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return 0
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return 0
	}
	data, err := sc.ReadFile(ctx, lockPath)
	if err != nil {
		return 0
	}
	v, err := strconv.Atoi(strings.TrimSpace(data))
	if err != nil {
		return 0
	}
	return v
}

// userSyncErrorPath 构建同步错误文件的路径。
func (s *DBRepositoryService) userSyncErrorPath(workspaceID, userID, repoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	base, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(repoName)
	return filepath.Join(base, workspacepath.DirDevJobs, safeName+".clone.error")
}

// writeSyncError 通过 personal-stub 写入同步错误信息到 .clone.error 文件。
// 架构合规：dh-backend 不直接写共享目录，委托 personal-stub 执行。
func (s *DBRepositoryService) writeSyncError(ctx context.Context, workspaceID, userID, repoName, errMsg string) {
	errPath := s.userSyncErrorPath(workspaceID, userID, repoName)
	if errPath == "" {
		return
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return
	}
	if err := sc.WriteFile(ctx, errPath, errMsg); err != nil {
		log.Printf("[Repository] writeSyncError failed for %s: %v", repoName, err)
	}
}

// readSyncError 读取同步错误文件的内容，文件不存在时返回空串。
func (s *DBRepositoryService) readSyncError(ctx context.Context, workspaceID, userID, repoName string) string {
	errPath := s.userSyncErrorPath(workspaceID, userID, repoName)
	if errPath == "" {
		return ""
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return ""
	}
	data, err := sc.ReadFile(ctx, errPath)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(data)
}

// deleteSyncError 通过 personal-stub 删除同步错误文件（重新同步时清理）。
func (s *DBRepositoryService) deleteSyncError(ctx context.Context, workspaceID, userID, repoName string) {
	errPath := s.userSyncErrorPath(workspaceID, userID, repoName)
	if errPath == "" {
		return
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return
	}
	if ok, err := sc.FileExists(ctx, errPath); err != nil || !ok {
		return // 错误文件不存在，无需删除
	}
	if err := sc.DeleteFile(ctx, errPath); err != nil {
		log.Printf("[Repository] deleteSyncError failed for %s: %v", repoName, err)
	}
}

// isUserRepoSynced 检查用户 dev-jobs 目录下仓库是否已同步完成。
// 优先检查锁文件（正在同步中返回 false），然后 fallback 到 .git 目录检查。
func (s *DBRepositoryService) isUserRepoSynced(ctx context.Context, workspaceID, userID, repoName string) bool {
	if s.hasSyncLock(ctx, workspaceID, userID, repoName) {
		return false
	}
	p := s.userProjectPath(workspaceID, userID, repoName)
	if p == "" {
		return false
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	ok, err := sc.FileExists(ctx, filepath.Join(p, ".git"))
	return err == nil && ok
}
