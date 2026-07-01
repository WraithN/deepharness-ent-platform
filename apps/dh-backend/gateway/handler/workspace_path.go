package handler

import (
	"log"
	"path/filepath"
	"sort"

	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
)

const (
	defaultRepositoryRoot = "/home/nan/test"
	// maxWorkspacePathLen 与 agent_sessions.workspace_path 字段长度保持一致。
	maxWorkspacePathLen = 500
)

// sanitizeWorkspacePath 保证路径长度不超过数据库存储上限。
func sanitizeWorkspacePath(path string) string {
	if len(path) <= maxWorkspacePathLen {
		return path
	}
	log.Printf("[sanitizeWorkspacePath] path too long (%d > %d), truncating", len(path), maxWorkspacePathLen)
	return path[:maxWorkspacePathLen]
}

// resolveWorkspacePath 根据 workspace 成员、配置根目录拼接 gatewayd 工作目录。
// 多成员时取 joined_at 最早的成员；无成员时回退到 "default"。
func resolveWorkspacePath(workspaceID, repositoryRoot string, workspaceService workspaceservice.WorkspaceService) string {
	userID := "default"

	if workspaceService != nil && workspaceID != "" {
		members, err := workspaceService.ListMembers(workspaceID)
		if err != nil {
			log.Printf("[resolveWorkspacePath] failed to list members for workspace %s: %v", workspaceID, err)
		} else if len(members) > 0 {
			sort.Slice(members, func(i, j int) bool {
				return members[i].JoinedAt.Before(members[j].JoinedAt)
			})
			userID = members[0].UserID
			if len(members) > 1 {
				log.Printf("[resolveWorkspacePath] workspace %s has %d members, using oldest joined user %s", workspaceID, len(members), userID)
			}
		} else {
			log.Printf("[resolveWorkspacePath] workspace %s has no members, fallback to default", workspaceID)
		}
	}

	if repositoryRoot == "" {
		repositoryRoot = defaultRepositoryRoot
	}

	return filepath.Clean(filepath.Join(repositoryRoot, workspaceID, userID))
}
