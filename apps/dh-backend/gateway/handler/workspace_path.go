package handler

import (
	"errors"
	"log"
	"os"
	"path/filepath"
)

// ensureWorkspaceDir 保证 gatewayd 工作目录存在；创建失败返回错误。
func ensureWorkspaceDir(path string) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		log.Printf("[ensureWorkspaceDir] failed to create workspace dir %s: %v", path, err)
		return err
	}
	return nil
}

// resolveWorkspacePath 根据当前登录用户、workspaceID 与配置根目录拼接 gatewayd 工作目录。
// 产品空间与研发空间均要求目录所有者为当前登录用户，因此使用请求上下文中的 userID。
// workspaceRoot 由 config.yaml 的 workspace.root 提供，为空时返回错误。
func resolveWorkspacePath(workspaceID, userID, workspaceRoot string) (string, error) {
	if workspaceID == "" || userID == "" || workspaceRoot == "" {
		return "", errors.New("workspaceID, userID and workspaceRoot are required")
	}

	p := filepath.Join(workspaceRoot, workspaceID, userID)
	if err := ensureWorkspaceDir(p); err != nil {
		return "", err
	}
	return p, nil
}
