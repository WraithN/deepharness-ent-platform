// Package pathutil 提供 dh-backend 内部使用的路径校验工具。
//
// 核心路径拼接逻辑已收口到 packages/go-sdk/common/workspacepath 包，
// 本包保留为向后兼容的薄封装，避免大量调用点一次性迁移。
package pathutil

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
)

// ValidateID 校验 ID 不含路径遍历字符（/、\、..），防止通过 ID 拼接路径时逃逸到目标目录之外。
func ValidateID(id string) error {
	return workspacepath.ValidateID(id)
}

// ResolveWorkspaceRoot 根据 workspaceRoot、userID、workspaceID 拼接用户工作区根目录。
// 返回路径格式：{workspaceRoot}/{userID}/{workspaceID}
// 调用方可继续用 filepath.Join 追加角色子目录，或使用 workspacepath.RolePath / JobPath。
func ResolveWorkspaceRoot(workspaceRoot, userID, workspaceID string) (string, error) {
	return workspacepath.ResolveWorkspacePath(workspaceRoot, userID, workspaceID)
}
