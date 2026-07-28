// Package service - identity.go 实现飞书用户身份校验与权限分级。
//
// 白名单用户（admin_user_ids）拥有完整编码能力（编码/原型/需求/总结）；
// 其他已绑定用户仅限问答与群聊总结；未绑定用户使用兜底账号（权限视配置而定）。
package service

import (
	"log"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
)

// IdentityResolver 解析飞书用户身份与权限。
type IdentityResolver struct {
	adminUserIDs    map[string]bool
	botUserID       string
	defaultWorkspace string
}

// NewIdentityResolver 创建身份解析器。
func NewIdentityResolver(adminUserIDs []string, botUserID, defaultWorkspace string) *IdentityResolver {
	m := make(map[string]bool, len(adminUserIDs))
	for _, id := range adminUserIDs {
		if id != "" {
			m[id] = true
		}
	}
	return &IdentityResolver{
		adminUserIDs:     m,
		botUserID:        botUserID,
		defaultWorkspace: defaultWorkspace,
	}
}

// IdentityResult 是身份解析的结果。
type IdentityResult struct {
	UserID      string
	WorkspaceID string
	Permission  object.PermissionLevel
}

// Resolve 根据 open_id 和绑定关系解析用户身份与权限。
// boundUserID/boundWorkspace 来自 feishu_users 绑定表，为空时使用兜底配置。
func (r *IdentityResolver) Resolve(openID string, boundUserID, boundWorkspace string) IdentityResult {
	// 白名单用户直接授予完整权限
	if r.adminUserIDs[openID] {
		uid := boundUserID
		if uid == "" {
			uid = r.botUserID
		}
		ws := boundWorkspace
		if ws == "" {
			ws = r.defaultWorkspace
		}
		return IdentityResult{UserID: uid, WorkspaceID: ws, Permission: object.PermFull}
	}

	// 已绑定用户：基础权限（问答+总结）
	if boundUserID != "" {
		ws := boundWorkspace
		if ws == "" {
			ws = r.defaultWorkspace
		}
		return IdentityResult{UserID: boundUserID, WorkspaceID: ws, Permission: object.PermBasic}
	}

	// 未绑定：使用兜底账号，基础权限
	log.Printf("[Feishu] user not bound openId=%s, falling back to bot user=%s", openID, r.botUserID)
	return IdentityResult{
		UserID:      r.botUserID,
		WorkspaceID: r.defaultWorkspace,
		Permission:  object.PermBasic,
	}
}

// HasPermission 检查权限等级是否允许执行指定意图。
func HasPermission(perm object.PermissionLevel, intent object.Intent) bool {
	if perm == object.PermFull {
		return true
	}
	// PermBasic: 仅允许问答与群聊总结
	switch intent {
	case object.IntentChat, object.IntentGroupSummary:
		return true
	default:
		return false
	}
}
