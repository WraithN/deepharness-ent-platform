package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// DBWorkspaceService 是基于 PostgreSQL 的 WorkspaceService 实现。
type DBWorkspaceService struct {
	db            *sql.DB
	workspaceRoot string
}

// NewDBWorkspaceService 创建 PostgreSQL 实现的工作空间服务。
// workspaceRoot 用于在创建工作空间和用户登录时创建对应目录。
func NewDBWorkspaceService(db *sql.DB, workspaceRoot string) *DBWorkspaceService {
	return &DBWorkspaceService{db: db, workspaceRoot: workspaceRoot}
}

// CreateWorkspace 创建新工作空间，并将所有者加入成员表。
func (s *DBWorkspaceService) CreateWorkspace(tenantID, name, description, ownerUserID string, policy AgentPolicy) (workspace.Workspace, error) {
	// 确保 slice 不为 nil，避免 pq.Array(nil) 插入 NULL 违反 NOT NULL 约束
	if policy.LockedAgentKeys == nil {
		policy.LockedAgentKeys = []string{}
	}
	if policy.AllowedAgentKeys == nil {
		policy.AllowedAgentKeys = []string{}
	}
	now := time.Now().UTC()
	ws := workspace.Workspace{
		ID:                  strings.ReplaceAll(uuid.New().String(), "-", ""),
		TenantID:            tenantID,
		Name:                name,
		Description:         description,
		AgentConfigLocked:   policy.AgentConfigLocked,
		LockedAgentKeys:     policy.LockedAgentKeys,
		AllowedAgentKeys:    policy.AllowedAgentKeys,
		DefaultAgentConfigs: policy.DefaultAgentConfigs,
		CreatedAt:           now,
		UpdatedAt:           now,
	}

	defaultConfigsJSON, err := json.Marshal(policy.DefaultAgentConfigs)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("marshal default agent configs failed: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	// 生成租户内自增的展示 ID（w1, w2...）
	displayID, err := s.nextWorkspaceDisplayIDTx(tx, tenantID)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("generate workspace display id failed: %w", err)
	}
	ws.DisplayID = displayID

	_, err = tx.Exec(`
		INSERT INTO workspaces (id, display_id, tenant_id, name, description, agent_config_locked, locked_agent_keys, allowed_agent_keys, default_agent_configs, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, ws.ID, ws.DisplayID, ws.TenantID, ws.Name, ws.Description,
		policy.AgentConfigLocked,
		pq.Array(policy.LockedAgentKeys),
		pq.Array(policy.AllowedAgentKeys),
		defaultConfigsJSON,
		ws.CreatedAt, ws.UpdatedAt)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("insert workspace failed: %w", err)
	}

	_, err = tx.Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, display_id, role, sub_role, joined_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, ws.ID, ownerUserID, "u1", MemberRoleSpaceAdmin, MemberSubRoleDeveloper, now)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("insert workspace member failed: %w", err)
	}

	if err := SeedBuiltinPromptCategories(tx, ws.ID); err != nil {
		return workspace.Workspace{}, fmt.Errorf("seed builtin prompt categories failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return workspace.Workspace{}, fmt.Errorf("commit failed: %w", err)
	}

	// 创建工作空间根目录 WORKSPACE_ROOT/{workspace_id}
	if s.workspaceRoot != "" {
		wsDir := filepath.Join(s.workspaceRoot, ws.ID)
		if err := os.MkdirAll(wsDir, 0o755); err != nil {
			log.Printf("[Workspace] create workspace dir %s failed: %v", wsDir, err)
		}
	}

	return ws, nil
}

// EnsureUserWorkspaceDirs 确保用户在工作空间下的 projects、files 与 products 目录存在。
// 目录结构：WORKSPACE_ROOT/{workspaceID}/{userID}/{projects,files,products/{docs,prototypes}}
// os.MkdirAll 是幂等操作，天然并发安全。
func (s *DBWorkspaceService) EnsureUserWorkspaceDirs(ctx context.Context, workspaceID, userID string) error {
	if s.workspaceRoot == "" {
		return errors.New("workspace root not configured")
	}
	if workspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if userID == "" {
		return errors.New("userID is required")
	}
	base := filepath.Join(s.workspaceRoot, workspaceID, userID)
	dirs := []string{
		filepath.Join(base, "projects"),
		filepath.Join(base, "files"),
		filepath.Join(base, "products", "docs"),
		filepath.Join(base, "products", "prototypes"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fmt.Errorf("create dir %s: %w", d, err)
		}
	}
	return nil
}

// scanWorkspace 从数据库行解析工作空间，包括智能体策略字段。
func scanWorkspace(row *sql.Row) (workspace.Workspace, error) {
	var ws workspace.Workspace
	var desc sql.NullString
	var defaultConfigs []byte
	var lockedKeys pq.StringArray
	var allowedKeys pq.StringArray
	err := row.Scan(
		&ws.ID, &ws.DisplayID, &ws.TenantID, &ws.Name, &desc,
		&ws.AgentConfigLocked, &lockedKeys, &allowedKeys, &defaultConfigs,
		&ws.CreatedAt, &ws.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.Workspace{}, errors.New("workspace not found")
	}
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("scan workspace failed: %w", err)
	}
	ws.Description = sqlutil.ScanNullString(desc)
	ws.LockedAgentKeys = []string(lockedKeys)
	ws.AllowedAgentKeys = []string(allowedKeys)
	if len(defaultConfigs) > 0 {
		if err := json.Unmarshal(defaultConfigs, &ws.DefaultAgentConfigs); err != nil {
			return workspace.Workspace{}, fmt.Errorf("unmarshal default agent configs failed: %w", err)
		}
	}
	return ws, nil
}

// scanWorkspaceRows 从 rows 游标解析工作空间。
func scanWorkspaceRows(rows *sql.Rows) (workspace.Workspace, error) {
	var ws workspace.Workspace
	var desc sql.NullString
	var defaultConfigs []byte
	var lockedKeys pq.StringArray
	var allowedKeys pq.StringArray
	if err := rows.Scan(
		&ws.ID, &ws.DisplayID, &ws.TenantID, &ws.Name, &desc,
		&ws.AgentConfigLocked, &lockedKeys, &allowedKeys, &defaultConfigs,
		&ws.CreatedAt, &ws.UpdatedAt,
	); err != nil {
		return workspace.Workspace{}, fmt.Errorf("scan workspace failed: %w", err)
	}
	ws.Description = sqlutil.ScanNullString(desc)
	ws.LockedAgentKeys = []string(lockedKeys)
	ws.AllowedAgentKeys = []string(allowedKeys)
	if len(defaultConfigs) > 0 {
		if err := json.Unmarshal(defaultConfigs, &ws.DefaultAgentConfigs); err != nil {
			return workspace.Workspace{}, fmt.Errorf("unmarshal default agent configs failed: %w", err)
		}
	}
	return ws, nil
}

// GetWorkspace 按 ID 查询工作空间，智能体策略从租户表继承。
func (s *DBWorkspaceService) GetWorkspace(id string) (workspace.Workspace, error) {
	return scanWorkspace(s.db.QueryRow(`
		SELECT w.id, w.display_id, w.tenant_id, w.name, w.description,
		       t.agent_config_locked, t.locked_agent_keys, t.allowed_agent_keys, t.default_agent_configs,
		       w.created_at, w.updated_at
		FROM workspaces w
		JOIN tenants t ON t.id = w.tenant_id
		WHERE w.id = $1
	`, id))
}

// ListWorkspaces 返回工作空间列表，支持按租户过滤和服务端分页。
func (s *DBWorkspaceService) ListWorkspaces(tenantID string, page, pageSize int) (common.PaginatedList[workspace.Workspace], error) {
	page = common.NormalizePage(page)
	pageSize = common.NormalizePageSize(pageSize, 10, 100)

	whereClause := ""
	var args []any
	if tenantID != "" {
		whereClause = "WHERE w.tenant_id = $1"
		args = append(args, tenantID)
	}

	countQuery := "SELECT COUNT(*) FROM workspaces w " + whereClause
	var total int
	if err := s.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return common.PaginatedList[workspace.Workspace]{}, fmt.Errorf("count workspaces failed: %w", err)
	}

	query := "SELECT w.id, w.display_id, w.tenant_id, w.name, w.description, t.agent_config_locked, t.locked_agent_keys, t.allowed_agent_keys, t.default_agent_configs, w.created_at, w.updated_at FROM workspaces w JOIN tenants t ON t.id = w.tenant_id " + whereClause + " ORDER BY w.created_at DESC LIMIT $" + fmt.Sprintf("%d", len(args)+1) + " OFFSET $" + fmt.Sprintf("%d", len(args)+2)
	pageArgs := append(args, pageSize, common.Offset(page, pageSize))

	rows, err := s.db.Query(query, pageArgs...)
	if err != nil {
		return common.PaginatedList[workspace.Workspace]{}, fmt.Errorf("list workspaces failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Workspace, 0)
	for rows.Next() {
		ws, err := scanWorkspaceRows(rows)
		if err != nil {
			return common.PaginatedList[workspace.Workspace]{}, err
		}
		result = append(result, ws)
	}
	if err := rows.Err(); err != nil {
		return common.PaginatedList[workspace.Workspace]{}, fmt.Errorf("iterate workspaces failed: %w", err)
	}

	return common.PaginatedList[workspace.Workspace]{
		List:     result,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// UpdateWorkspace 更新工作空间名称、描述与智能体策略。
func (s *DBWorkspaceService) UpdateWorkspace(id, name, description string, policy AgentPolicy) (workspace.Workspace, error) {
	if id == "" {
		return workspace.Workspace{}, errors.New("workspace id is required")
	}
	if name == "" {
		return workspace.Workspace{}, errors.New("name is required")
	}

	defaultConfigsJSON, err := json.Marshal(policy.DefaultAgentConfigs)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("marshal default agent configs failed: %w", err)
	}

	res, err := s.db.Exec(`
		UPDATE workspaces
		SET name = $1, description = $2,
		    agent_config_locked = $4,
		    locked_agent_keys = $5,
		    allowed_agent_keys = $6,
		    default_agent_configs = $7,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $3
	`, name, sqlutil.NullString(description), id,
		policy.AgentConfigLocked,
		pq.Array(policy.LockedAgentKeys),
		pq.Array(policy.AllowedAgentKeys),
		defaultConfigsJSON)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("update workspace failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return workspace.Workspace{}, errors.New("workspace not found")
	}
	return s.GetWorkspace(id)
}

// DeleteWorkspace 删除工作空间及其成员关系。
func (s *DBWorkspaceService) DeleteWorkspace(id string) error {
	if id == "" {
		return errors.New("workspace id is required")
	}
	if err := s.workspaceExists(id); err != nil {
		return err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM workspace_members WHERE workspace_id = $1`, id); err != nil {
		return fmt.Errorf("delete workspace members failed: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM workspaces WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete workspace failed: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit failed: %w", err)
	}
	return nil
}

// ListMine 返回指定用户加入的工作空间及其成员关系。
// 用于登录后确定当前用户的可用空间与空间内权限/职能角色。
func (s *DBWorkspaceService) ListMine(userID string) ([]MineWorkspace, error) {
	rows, err := s.db.Query(`
		SELECT w.id, w.display_id, w.tenant_id, w.name, w.description,
		       t.agent_config_locked, t.locked_agent_keys, t.allowed_agent_keys, t.default_agent_configs,
		       w.created_at, w.updated_at,
		       m.role, COALESCE(m.sub_role, '')
		FROM workspaces w
		JOIN tenants t ON t.id = w.tenant_id
		JOIN workspace_members m ON m.workspace_id = w.id
		WHERE m.user_id = $1
		ORDER BY w.created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list mine workspaces failed: %w", err)
	}
	defer rows.Close()

	result := make([]MineWorkspace, 0)
	for rows.Next() {
		var mw MineWorkspace
		var desc sql.NullString
		var defaultConfigs []byte
		var lockedKeys pq.StringArray
		var allowedKeys pq.StringArray
		if err := rows.Scan(
			&mw.ID, &mw.DisplayID, &mw.TenantID, &mw.Name, &desc,
			&mw.AgentConfigLocked, &lockedKeys, &allowedKeys, &defaultConfigs,
			&mw.CreatedAt, &mw.UpdatedAt,
			&mw.Role, &mw.SubRole,
		); err != nil {
			return nil, fmt.Errorf("scan mine workspace failed: %w", err)
		}
		mw.Description = sqlutil.ScanNullString(desc)
		mw.LockedAgentKeys = []string(lockedKeys)
		mw.AllowedAgentKeys = []string(allowedKeys)
		if len(defaultConfigs) > 0 {
			if err := json.Unmarshal(defaultConfigs, &mw.DefaultAgentConfigs); err != nil {
				return nil, fmt.Errorf("unmarshal default agent configs failed: %w", err)
			}
		}
		result = append(result, mw)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate mine workspaces failed: %w", err)
	}
	return result, nil
}

// AddMember 向工作空间添加成员，并分配该空间内唯一的展示 ID（u + 自增序号）。
func (s *DBWorkspaceService) AddMember(workspaceID, userID, role, subRole string) error {
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
	`, workspaceID, userID, displayID, role, sqlutil.NullString(subRole), time.Now().UTC())
	if err != nil {
		return fmt.Errorf("add member failed: %w", err)
	}
	return nil
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

// nextWorkspaceDisplayIDTx 在事务中生成租户内自增的空间展示 ID（w1, w2...）。
// 按当前租户下已有工作空间的最大序号递增，确保并发创建时序号不冲突。
func (s *DBWorkspaceService) nextWorkspaceDisplayIDTx(tx *sql.Tx, tenantID string) (string, error) {
	var maxSeq int
	err := tx.QueryRow(`
		SELECT COALESCE(MAX(CAST(SUBSTRING(display_id FROM 2) AS INTEGER)), 0)
		FROM workspaces
		WHERE tenant_id = $1 AND display_id ~ '^w[0-9]+$'
	`, tenantID).Scan(&maxSeq)
	if err != nil {
		return "", fmt.Errorf("query max workspace display id failed: %w", err)
	}
	return fmt.Sprintf("w%d", maxSeq+1), nil
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
		var name, email, subRole, platformRole sql.NullString
		if err := rows.Scan(&m.WorkspaceID, &m.UserID, &m.DisplayID, &name, &email, &m.Role, &subRole, &platformRole, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("scan member failed: %w", err)
		}
		m.Name = sqlutil.ScanNullString(name)
		m.Email = sqlutil.ScanNullString(email)
		m.SubRole = sqlutil.ScanNullString(subRole)
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
		return "", fmt.Errorf("%w", ErrMemberNotFound)
	}
	if err != nil {
		return "", fmt.Errorf("get member role failed: %w", err)
	}
	return role, nil
}

// GetMemberSubRole 返回指定用户在工作空间中的职能子角色。
func (s *DBWorkspaceService) GetMemberSubRole(ctx context.Context, workspaceID, userID string) (string, error) {
	var subRole sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT sub_role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&subRole)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("%w", ErrMemberNotFound)
	}
	if err != nil {
		return "", fmt.Errorf("get member sub role failed: %w", err)
	}
	return sqlutil.ScanNullString(subRole), nil
}

// UpdateMemberRole 更新工作空间成员的角色与职能。
func (s *DBWorkspaceService) UpdateMemberRole(workspaceID, userID, role, subRole string) error {
	res, err := s.db.Exec(`
		UPDATE workspace_members SET role = $1, sub_role = $2
		WHERE workspace_id = $3 AND user_id = $4
	`, role, sqlutil.NullString(subRole), workspaceID, userID)
	if err != nil {
		return fmt.Errorf("update member role failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return errors.New("member not found")
	}
	return nil
}

// AddMemberByEmail 通过邮箱向工作空间添加成员。
func (s *DBWorkspaceService) AddMemberByEmail(workspaceID, email, role, subRole string) error {
	var userID string
	err := s.db.QueryRow(`SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("user not found")
	}
	if err != nil {
		return fmt.Errorf("resolve user by email failed: %w", err)
	}
	return s.AddMember(workspaceID, userID, role, subRole)
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
		return errors.New("member not found")
	}

	return tx.Commit()
}

// SetWorkitemProject 设置工作空间的工作项项目，使用 workspace_id 作为唯一键进行 upsert。
func (s *DBWorkspaceService) SetWorkitemProject(workspaceID string, req WorkitemProjectRequest) (workspace.WorkitemProject, error) {
	now := time.Now().UTC()

	tx, err := s.db.Begin()
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if err := workspaceExistsTx(tx, workspaceID); err != nil {
		return workspace.WorkitemProject{}, err
	}

	_, err = tx.Exec(`
		INSERT INTO workitem_projects (id, workspace_id, platform, external_key, name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id) DO UPDATE SET
			platform = EXCLUDED.platform,
			external_key = EXCLUDED.external_key,
			name = EXCLUDED.name,
			updated_at = EXCLUDED.updated_at
	`, uuid.New().String(), workspaceID, req.Platform, req.ExternalKey, req.Name, now, now)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("set workitem project failed: %w", err)
	}

	wp, err := getWorkitemProjectTx(tx, workspaceID)
	if err != nil {
		return workspace.WorkitemProject{}, err
	}

	if err := tx.Commit(); err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("commit failed: %w", err)
	}
	return wp, nil
}

// GetWorkitemProject 获取工作空间的工作项项目。
func (s *DBWorkspaceService) GetWorkitemProject(workspaceID string) (workspace.WorkitemProject, error) {
	var wp workspace.WorkitemProject
	var config sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, platform, external_key, name, config, created_at, updated_at
		FROM workitem_projects WHERE workspace_id = $1
	`, workspaceID).Scan(&wp.ID, &wp.WorkspaceID, &wp.Platform, &wp.ExternalKey, &wp.Name, &config, &wp.CreatedAt, &wp.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.WorkitemProject{}, errors.New("workitem project not found")
	}
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("get workitem project failed: %w", err)
	}
	wp.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("unmarshal workitem project config failed: %w", err)
	}
	return wp, nil
}

// ListAgents 返回工作空间下的 Agent 列表。
func (s *DBWorkspaceService) ListAgents(workspaceID string) ([]agent.Agent, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at
		FROM agents WHERE workspace_id = $1 ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list agents failed: %w", err)
	}
	defer rows.Close()

	result := make([]agent.Agent, 0)
	for rows.Next() {
		var a agent.Agent
		var role, description, createdBy sql.NullString
		var config sql.NullString
		if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.Name, &role, &description, &config, &a.IsDefault, &createdBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan agent failed: %w", err)
		}
		a.Role = sqlutil.ScanNullString(role)
		a.Description = sqlutil.ScanNullString(description)
		a.CreatedByUserID = sqlutil.ScanNullString(createdBy)
		a.Config, err = sqlutil.UnmarshalConfig(config)
		if err != nil {
			return nil, fmt.Errorf("unmarshal agent config failed: %w", err)
		}
		result = append(result, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agents failed: %w", err)
	}
	return result, nil
}

// CreateAgent 在工作空间下创建 Agent，必要时清空原有默认 Agent。
func (s *DBWorkspaceService) CreateAgent(workspaceID string, req AgentRequest) (agent.Agent, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return agent.Agent{}, err
	}

	now := time.Now().UTC()
	a := agent.Agent{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Role:        req.Role,
		Description: req.Description,
		Config:      req.Config,
		IsDefault:   req.IsDefault,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	configStr, err := sqlutil.MarshalConfig(req.Config)
	if err != nil {
		return agent.Agent{}, fmt.Errorf("marshal agent config failed: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return agent.Agent{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.Exec(`UPDATE agents SET is_default = false WHERE workspace_id = $1`, workspaceID); err != nil {
			return agent.Agent{}, fmt.Errorf("clear default agent failed: %w", err)
		}
	}

	_, err = tx.Exec(`
		INSERT INTO agents (id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, a.ID, a.WorkspaceID, a.Name, a.Role, a.Description, configStr, a.IsDefault, a.CreatedByUserID, a.CreatedAt, a.UpdatedAt)
	if err != nil {
		return agent.Agent{}, fmt.Errorf("insert agent failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return agent.Agent{}, fmt.Errorf("commit failed: %w", err)
	}
	return a, nil
}

// GetDefaultAgent 返回工作空间的默认 Agent。
func (s *DBWorkspaceService) GetDefaultAgent(workspaceID string) (agent.Agent, error) {
	var a agent.Agent
	var role, description, createdBy sql.NullString
	var config sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at
		FROM agents WHERE workspace_id = $1 AND is_default = true
	`, workspaceID).Scan(&a.ID, &a.WorkspaceID, &a.Name, &role, &description, &config, &a.IsDefault, &createdBy, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return agent.Agent{}, errors.New("default agent not found")
	}
	if err != nil {
		return agent.Agent{}, fmt.Errorf("get default agent failed: %w", err)
	}
	a.Role = sqlutil.ScanNullString(role)
	a.Description = sqlutil.ScanNullString(description)
	a.CreatedByUserID = sqlutil.ScanNullString(createdBy)
	a.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return agent.Agent{}, fmt.Errorf("unmarshal default agent config failed: %w", err)
	}
	return a, nil
}

// ListStandards 返回工作空间下的规范列表，支持按仓库过滤。
func (s *DBWorkspaceService) ListStandards(workspaceID string, repoID string) ([]workspace.Standard, error) {
	query := `SELECT id, workspace_id, repository_id, type, name, content, created_at, updated_at FROM workspace_standards WHERE workspace_id = $1`
	var args []any
	args = append(args, workspaceID)
	if repoID != "" {
		query += ` AND repository_id = $2`
		args = append(args, repoID)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list standards failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Standard, 0)
	for rows.Next() {
		var st workspace.Standard
		var standardRepoID sql.NullString
		if err := rows.Scan(&st.ID, &st.WorkspaceID, &standardRepoID, &st.Type, &st.Name, &st.Content, &st.CreatedAt, &st.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan standard failed: %w", err)
		}
		st.RepositoryID = sqlutil.ScanNullString(standardRepoID)
		result = append(result, st)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate standards failed: %w", err)
	}
	return result, nil
}

// SaveStandard 保存规范，若提供 ID 则更新，否则新增。
func (s *DBWorkspaceService) SaveStandard(workspaceID string, req StandardRequest) (workspace.Standard, error) {
	now := time.Now().UTC()
	if req.ID != "" {
		return s.updateStandard(workspaceID, req, now)
	}

	if err := s.workspaceExists(workspaceID); err != nil {
		return workspace.Standard{}, err
	}

	st := workspace.Standard{
		ID:           uuid.New().String(),
		WorkspaceID:  workspaceID,
		RepositoryID: req.RepositoryID,
		Type:         req.Type,
		Name:         req.Name,
		Content:      req.Content,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	_, err := s.db.Exec(`
		INSERT INTO workspace_standards (id, workspace_id, repository_id, type, name, content, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, st.ID, st.WorkspaceID, st.RepositoryID, st.Type, st.Name, st.Content, st.CreatedAt, st.UpdatedAt)
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("insert standard failed: %w", err)
	}
	return st, nil
}

// updateStandard 在事务中更新规范并读取最新值返回。
func (s *DBWorkspaceService) updateStandard(workspaceID string, req StandardRequest, now time.Time) (workspace.Standard, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if err := workspaceExistsTx(tx, workspaceID); err != nil {
		return workspace.Standard{}, err
	}

	res, err := tx.Exec(`
		UPDATE workspace_standards
		SET repository_id = $1, type = $2, name = $3, content = $4, updated_at = $5
		WHERE id = $6 AND workspace_id = $7
	`, sqlutil.NullString(req.RepositoryID), req.Type, req.Name, req.Content, now, req.ID, workspaceID)
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("update standard failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return workspace.Standard{}, errors.New("standard not found")
	}

	st, err := getStandardTx(tx, req.ID)
	if err != nil {
		return workspace.Standard{}, err
	}

	if err := tx.Commit(); err != nil {
		return workspace.Standard{}, fmt.Errorf("commit failed: %w", err)
	}
	return st, nil
}

// DeleteStandard 删除工作空间下的规范。
func (s *DBWorkspaceService) DeleteStandard(workspaceID, standardID string) error {
	res, err := s.db.Exec(`
		DELETE FROM workspace_standards WHERE id = $1 AND workspace_id = $2
	`, standardID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete standard failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return errors.New("standard not found")
	}
	return nil
}

// GetCICD 获取工作空间的 CI/CD 配置。
func (s *DBWorkspaceService) GetCICD(workspaceID string) (workspace.CICD, error) {
	var c workspace.CICD
	var config sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, trigger_branches, webhook_url, script, config, created_at, updated_at
		FROM workspace_cicd WHERE workspace_id = $1
	`, workspaceID).Scan(&c.ID, &c.WorkspaceID, &c.TriggerBranches, &c.WebhookURL, &c.Script, &config, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.CICD{}, errors.New("cicd not found")
	}
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("get cicd failed: %w", err)
	}
	c.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("unmarshal cicd config failed: %w", err)
	}
	return c, nil
}

// SaveCICD 保存工作空间的 CI/CD 配置，按 workspace_id 进行 upsert。
func (s *DBWorkspaceService) SaveCICD(workspaceID string, req CICDRequest) (workspace.CICD, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if err := workspaceExistsTx(tx, workspaceID); err != nil {
		return workspace.CICD{}, err
	}

	now := time.Now().UTC()
	_, err = tx.Exec(`
		INSERT INTO workspace_cicd (id, workspace_id, trigger_branches, webhook_url, script, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id) DO UPDATE SET
			trigger_branches = EXCLUDED.trigger_branches,
			webhook_url = EXCLUDED.webhook_url,
			script = EXCLUDED.script,
			updated_at = EXCLUDED.updated_at
	`, uuid.New().String(), workspaceID, req.TriggerBranches, req.WebhookURL, req.Script, now, now)
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("save cicd failed: %w", err)
	}

	cicd, err := getCICDTx(tx, workspaceID)
	if err != nil {
		return workspace.CICD{}, err
	}

	if err := tx.Commit(); err != nil {
		return workspace.CICD{}, fmt.Errorf("commit failed: %w", err)
	}
	return cicd, nil
}

// workspaceExists 校验工作空间是否存在。
func (s *DBWorkspaceService) workspaceExists(workspaceID string) error {
	var id string
	err := s.db.QueryRow(`SELECT id FROM workspaces WHERE id = $1`, workspaceID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("workspace not found")
	}
	if err != nil {
		return fmt.Errorf("check workspace exists failed: %w", err)
	}
	return nil
}

// workspaceExistsTx 在事务中校验工作空间是否存在。
func workspaceExistsTx(tx *sql.Tx, workspaceID string) error {
	var id string
	err := tx.QueryRow(`SELECT id FROM workspaces WHERE id = $1`, workspaceID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("workspace not found")
	}
	if err != nil {
		return fmt.Errorf("check workspace exists failed: %w", err)
	}
	return nil
}

// getStandardTx 在事务中按 ID 查询规范。
func getStandardTx(tx *sql.Tx, id string) (workspace.Standard, error) {
	var st workspace.Standard
	var repoID sql.NullString
	err := tx.QueryRow(`
		SELECT id, workspace_id, repository_id, type, name, content, created_at, updated_at
		FROM workspace_standards WHERE id = $1
	`, id).Scan(&st.ID, &st.WorkspaceID, &repoID, &st.Type, &st.Name, &st.Content, &st.CreatedAt, &st.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.Standard{}, errors.New("standard not found")
	}
	if err != nil {
		return workspace.Standard{}, fmt.Errorf("get standard failed: %w", err)
	}
	st.RepositoryID = sqlutil.ScanNullString(repoID)
	return st, nil
}

// getWorkitemProjectTx 在事务中获取工作空间的工作项项目。
func getWorkitemProjectTx(tx *sql.Tx, workspaceID string) (workspace.WorkitemProject, error) {
	var wp workspace.WorkitemProject
	var config sql.NullString
	err := tx.QueryRow(`
		SELECT id, workspace_id, platform, external_key, name, config, created_at, updated_at
		FROM workitem_projects WHERE workspace_id = $1
	`, workspaceID).Scan(&wp.ID, &wp.WorkspaceID, &wp.Platform, &wp.ExternalKey, &wp.Name, &config, &wp.CreatedAt, &wp.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.WorkitemProject{}, errors.New("workitem project not found")
	}
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("get workitem project failed: %w", err)
	}
	wp.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("unmarshal workitem project config failed: %w", err)
	}
	return wp, nil
}

// getCICDTx 在事务中获取工作空间的 CI/CD 配置。
func getCICDTx(tx *sql.Tx, workspaceID string) (workspace.CICD, error) {
	var c workspace.CICD
	var config sql.NullString
	err := tx.QueryRow(`
		SELECT id, workspace_id, trigger_branches, webhook_url, script, config, created_at, updated_at
		FROM workspace_cicd WHERE workspace_id = $1
	`, workspaceID).Scan(&c.ID, &c.WorkspaceID, &c.TriggerBranches, &c.WebhookURL, &c.Script, &config, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.CICD{}, errors.New("cicd not found")
	}
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("get cicd failed: %w", err)
	}
	c.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.CICD{}, fmt.Errorf("unmarshal cicd config failed: %w", err)
	}
	return c, nil
}
