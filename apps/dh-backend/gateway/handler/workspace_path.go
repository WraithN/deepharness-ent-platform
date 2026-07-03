package handler

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"

	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
)

// ensureWorkspaceDir 保证 gatewayd 工作目录存在；创建失败仅记录日志，不阻塞会话创建。
func ensureWorkspaceDir(path string) {
	if path == "" {
		return
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		log.Printf("[ensureWorkspaceDir] failed to create workspace dir %s: %v", path, err)
	}
}

// resolveWorkspacePath 根据 workspace 成员、配置根目录拼接 gatewayd 工作目录。
// 多成员时取 joined_at 最早的成员；无成员时回退到 "default"。
// workspaceRoot 由 config.yaml 的 workspace.root 提供，为空时返回错误。
func resolveWorkspacePath(workspaceID, workspaceRoot string, workspaceService workspaceservice.WorkspaceService) (string, error) {
	if workspaceRoot == "" {
		return "", fmt.Errorf("workspace root is not configured")
	}

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

	return filepath.Clean(filepath.Join(workspaceRoot, workspaceID, userID)), nil
}
