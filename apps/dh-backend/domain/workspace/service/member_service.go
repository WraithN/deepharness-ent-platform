package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// subRoleSeparator 用于在同一列中分隔多个职能子角色。
const subRoleSeparator = ","

// formatSubRoles 将多个子角色序列化为逗号分隔字符串；空列表返回空字符串。
func formatSubRoles(roles []string) string {
	seen := make(map[string]bool)
	var out []string
	for _, r := range roles {
		r = strings.TrimSpace(r)
		if r == "" || seen[r] {
			continue
		}
		seen[r] = true
		out = append(out, r)
	}
	return strings.Join(out, subRoleSeparator)
}

// parseSubRoles 将逗号分隔字符串解析为子角色列表。
func parseSubRoles(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, subRoleSeparator)
	seen := make(map[string]bool)
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// AddMember 向工作空间添加成员，并分配该空间内唯一的展示 ID（u + 自增序号）。
func (s *DBWorkspaceService) AddMember(workspaceID, userID, role string, subRoles []string) error {
	if err := s.workspaceExists(workspaceID); err != nil {
		return err
	}

	displayID, err := s.nextMemberDisplayID(workspaceID)
	if err != nil {
		return fmt.Errorf("generate display id failed: %w", err)
	}

	_, err = s.db.Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, display_id, role, sub_role, joined_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, workspaceID, userID, displayID, role, sqlutil.NullString(formatSubRoles(subRoles)), time.Now().UTC())
	if err != nil {
		return fmt.Errorf("add member failed: %w", err)
	}
	return nil
}

// AddMemberByEmail 通过邮箱向工作空间添加成员。
func (s *DBWorkspaceService) AddMemberByEmail(workspaceID, email, role string, subRoles []string) error {
	var userID string
	err := s.db.QueryRow(`SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return common.NotFoundErrorf("user not found")
	}
	if err != nil {
		return fmt.Errorf("resolve user by email failed: %w", err)
	}
	return s.AddMember(workspaceID, userID, role, subRoles)
}

// ListMembers 返回工作空间成员列表，并关联 users 表获取姓名与邮箱。
func (s *DBWorkspaceService) ListMembers(workspaceID string) ([]workspace.Member, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT m.workspace_id, m.user_id, m.display_id, COALESCE(u.name, ''), COALESCE(u.email, ''),
			m.role, m.sub_role, COALESCE(u.platform_role, ''), m.joined_at
		FROM workspace_members m
		LEFT JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1
		ORDER BY m.joined_at ASC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list members failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Member, 0)
	for rows.Next() {
		var m workspace.Member
		var name, email, subRoles, platformRole, displayID sql.NullString
		if err := rows.Scan(&m.WorkspaceID, &m.UserID, &displayID, &name, &email, &m.Role, &subRoles, &platformRole, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("scan member failed: %w", err)
		}
		m.DisplayID = sqlutil.ScanNullString(displayID)
		m.Name = sqlutil.ScanNullString(name)
		m.Email = sqlutil.ScanNullString(email)
		m.SubRoles = parseSubRoles(sqlutil.ScanNullString(subRoles))
		m.PlatformRole = sqlutil.ScanNullString(platformRole)
		if m.PlatformRole == "" {
			m.PlatformRole = string(identity.PlatformRoleUser)
		}
		result = append(result, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate members failed: %w", err)
	}
	return result, nil
}

// GetMemberRole 返回指定用户在工作空间中的角色。
func (s *DBWorkspaceService) GetMemberRole(workspaceID, userID string) (string, error) {
	var role string
	err := s.db.QueryRow(`
		SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("%w", common.ErrMemberNotFound)
	}
	if err != nil {
		return "", fmt.Errorf("get member role failed: %w", err)
	}
	return role, nil
}

// GetMemberSubRoles 返回指定用户在工作空间中的职能子角色列表。
func (s *DBWorkspaceService) GetMemberSubRoles(ctx context.Context, workspaceID, userID string) ([]string, error) {
	var subRoles sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT sub_role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&subRoles)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w", common.ErrMemberNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("get member sub roles failed: %w", err)
	}
	return parseSubRoles(sqlutil.ScanNullString(subRoles)), nil
}

// UpdateMemberRole 更新工作空间成员的角色与职能。
func (s *DBWorkspaceService) UpdateMemberRole(workspaceID, userID, role string, subRoles []string) error {
	res, err := s.db.Exec(`
		UPDATE workspace_members SET role = $1, sub_role = $2
		WHERE workspace_id = $3 AND user_id = $4
	`, role, sqlutil.NullString(formatSubRoles(subRoles)), workspaceID, userID)
	if err != nil {
		return fmt.Errorf("update member role failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return common.NotFoundErrorf("member not found")
	}
	return nil
}

// RemoveMember 移除工作空间成员，并可选将相关资产转移给指定成员。
func (s *DBWorkspaceService) RemoveMember(workspaceID, userID, assetAssigneeID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if assetAssigneeID != "" {
		// 转移产品文档及其版本归属
		if _, err := tx.Exec(`UPDATE product_docs SET created_by = $1 WHERE workspace_id = $2 AND created_by = $3`, assetAssigneeID, workspaceID, userID); err != nil {
			return fmt.Errorf("transfer product docs failed: %w", err)
		}
		if _, err := tx.Exec(`UPDATE product_doc_versions SET created_by = $1 WHERE doc_id IN (SELECT id FROM product_docs WHERE workspace_id = $2) AND created_by = $3`, assetAssigneeID, workspaceID, userID); err != nil {
			return fmt.Errorf("transfer product doc versions failed: %w", err)
		}
		// 转移工作项负责人与报告人
		if _, err := tx.Exec(`UPDATE workitems SET assignee_id = $1 WHERE project_id IN (SELECT id FROM workitem_projects WHERE workspace_id = $2) AND assignee_id = $3`, assetAssigneeID, workspaceID, userID); err != nil {
			return fmt.Errorf("transfer workitems assignee failed: %w", err)
		}
		if _, err := tx.Exec(`UPDATE workitems SET reporter = $1 WHERE project_id IN (SELECT id FROM workitem_projects WHERE workspace_id = $2) AND reporter = $3`, assetAssigneeID, workspaceID, userID); err != nil {
			return fmt.Errorf("transfer workitems reporter failed: %w", err)
		}
	}

	res, err := tx.Exec(`
		DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID)
	if err != nil {
		return fmt.Errorf("remove member failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return common.NotFoundErrorf("member not found")
	}

	return tx.Commit()
}

// nextMemberDisplayID 返回当前工作空间下一个展示 ID，格式为 u1, u2...，按现有最大序号递增。
func (s *DBWorkspaceService) nextMemberDisplayID(workspaceID string) (string, error) {
	var maxSeq int
	err := s.db.QueryRow(`
		SELECT COALESCE(MAX(CAST(SUBSTRING(display_id FROM 2) AS INTEGER)), 0)
		FROM workspace_members
		WHERE workspace_id = $1
	`, workspaceID).Scan(&maxSeq)
	if err != nil {
		return "", fmt.Errorf("query max display id failed: %w", err)
	}
	return fmt.Sprintf("u%d", maxSeq+1), nil
}
