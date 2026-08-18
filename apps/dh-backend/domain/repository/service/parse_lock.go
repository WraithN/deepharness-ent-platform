package service

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
)

// 解析锁文件名后缀（与 .clone.lock 区分）。
const parseLockSuffix = ".parse.lock"

// parseLockFieldCount 是锁文件的字段行数：第一行 sessionID，第二行启动时间戳（Unix 秒）。
const parseLockFieldCount = 2

// parseLockPath 返回架构库目录下的解析锁文件路径。
// 格式：{root}/{userID}/{workspaceID}/dev-jobs/{archRepoName}.parse.lock
func (s *DBRepositoryService) parseLockPath(workspaceID, userID, archRepoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	base, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(archRepoName)
	return filepath.Join(base, workspacepath.DirDevJobs, safeName+parseLockSuffix)
}

// HasParseLock 检查解析锁是否存在。
func (s *DBRepositoryService) HasParseLock(ctx context.Context, workspaceID, userID, archRepoName string) bool {
	p := s.parseLockPath(workspaceID, userID, archRepoName)
	if p == "" {
		return false
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	ok, err := sc.FileExists(ctx, p)
	return err == nil && ok
}

// WriteParseLock 写入解析锁，内容为 sessionID + 启动时间。
func (s *DBRepositoryService) WriteParseLock(ctx context.Context, workspaceID, userID, archRepoName, sessionID string) error {
	p := s.parseLockPath(workspaceID, userID, archRepoName)
	if p == "" {
		return fmt.Errorf("workspace root is not configured")
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return fmt.Errorf("personal-stub client not initialized")
	}
	content := fmt.Sprintf("%s\n%d", sessionID, time.Now().UTC().Unix())
	return sc.WriteFile(ctx, p, content)
}

// ReadParseLock 读取解析锁内容，返回 sessionID 与启动时间（供 status 轮询做 TTL 死锁检测）。
func (s *DBRepositoryService) ReadParseLock(ctx context.Context, workspaceID, userID, archRepoName string) (string, time.Time, error) {
	p := s.parseLockPath(workspaceID, userID, archRepoName)
	if p == "" {
		return "", time.Time{}, fmt.Errorf("workspace root is not configured")
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return "", time.Time{}, fmt.Errorf("personal-stub client not initialized")
	}
	content, err := sc.ReadFile(ctx, p)
	if err != nil {
		return "", time.Time{}, err
	}
	return parseParseLockContent(content)
}

// parseParseLockContent 解析锁文件内容，格式为 `sessionID\n<unix秒>`（见 WriteParseLock）。
func parseParseLockContent(content string) (string, time.Time, error) {
	lines := strings.SplitN(strings.TrimSpace(content), "\n", parseLockFieldCount)
	if len(lines) != parseLockFieldCount {
		return "", time.Time{}, fmt.Errorf("invalid parse lock content: expect %d lines", parseLockFieldCount)
	}
	secs, err := strconv.ParseInt(strings.TrimSpace(lines[1]), 10, 64)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("invalid parse lock timestamp: %w", err)
	}
	return strings.TrimSpace(lines[0]), time.Unix(secs, 0), nil
}

// DeleteParseLock 删除解析锁。
func (s *DBRepositoryService) DeleteParseLock(ctx context.Context, workspaceID, userID, archRepoName string) {
	p := s.parseLockPath(workspaceID, userID, archRepoName)
	if p == "" {
		return
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return
	}
	if ok, err := sc.FileExists(ctx, p); err != nil || !ok {
		return
	}
	_ = sc.DeleteFile(ctx, p)
}
