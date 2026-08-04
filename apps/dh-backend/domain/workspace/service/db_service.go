package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
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

// CreateWorkspace 创建新工作空间，并将所有者加入成员表；若指定 sourceWorkspaceID，则继承源空间的智能体配置。
func (s *DBWorkspaceService) CreateWorkspace(tenantID, name, description, ownerUserID, subRole, sourceWorkspaceID string, policy object.AgentPolicy) (workspace.Workspace, error) {
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

	if subRole == "" {
		subRole = object.MemberSubRoleDeveloper
	}

	_, err = tx.Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, display_id, role, sub_role, joined_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, ws.ID, ownerUserID, "u1", object.MemberRoleSpaceAdmin, subRole, now)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("insert workspace member failed: %w", err)
	}

	// 若指定了源工作空间，则继承其智能体配置（workspace_agent_configs）。
	if sourceWorkspaceID != "" {
		if err := s.copyWorkspaceAgentConfigsTx(tx, ws.ID, sourceWorkspaceID, tenantID); err != nil {
			return workspace.Workspace{}, fmt.Errorf("copy workspace agent configs failed: %w", err)
		}
	}

	if err := SeedBuiltinPromptCategories(tx, ws.ID); err != nil {
		return workspace.Workspace{}, fmt.Errorf("seed builtin prompt categories failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return workspace.Workspace{}, fmt.Errorf("commit failed: %w", err)
	}

	// 工作空间目录在用户加入时由 EnsureUserWorkspaceDirs 创建（{workspaceRoot}/{userID}/{workspaceID}），
	// 此处无需提前创建 workspace 级目录。

	return ws, nil
}

// copyWorkspaceAgentConfigsTx 将源工作空间的智能体配置复制到目标工作空间，
// 并校验源空间必须与目标空间属于同一租户。
func (s *DBWorkspaceService) copyWorkspaceAgentConfigsTx(tx *sql.Tx, targetWorkspaceID, sourceWorkspaceID, tenantID string) error {
	var sourceTenantID string
	err := tx.QueryRow(`SELECT tenant_id FROM workspaces WHERE id = $1`, sourceWorkspaceID).Scan(&sourceTenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return common.NotFoundErrorf("source workspace not found")
	}
	if err != nil {
		return fmt.Errorf("query source workspace failed: %w", err)
	}
	if sourceTenantID != tenantID {
		return errors.New("source workspace does not belong to the same tenant")
	}

	rows, err := tx.Query(`
		SELECT agent_key, enabled, is_default, model, model_source, base_url, api_key,
		       temperature, max_tokens, context_window, advanced_config
		FROM workspace_agent_configs
		WHERE workspace_id = $1
	`, sourceWorkspaceID)
	if err != nil {
		return fmt.Errorf("query source workspace agent configs failed: %w", err)
	}
	defer rows.Close()

	now := time.Now().UTC()
	for rows.Next() {
		var agentKey, modelSource string
		var enabled, isDefault bool
		var model, baseURL, apiKey sql.NullString
		var temperature sql.NullFloat64
		var maxTokens, contextWindow sql.NullInt32
		var advancedConfig sql.NullString
		if err := rows.Scan(&agentKey, &enabled, &isDefault, &model, &modelSource, &baseURL, &apiKey,
			&temperature, &maxTokens, &contextWindow, &advancedConfig); err != nil {
			return fmt.Errorf("scan source workspace agent config failed: %w", err)
		}
		if _, err := tx.Exec(`
			INSERT INTO workspace_agent_configs (
				id, workspace_id, agent_key, enabled, is_default, model, model_source, base_url, api_key,
				temperature, max_tokens, context_window, advanced_config, created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
		`, strings.ReplaceAll(uuid.New().String(), "-", ""), targetWorkspaceID, agentKey, enabled, isDefault,
			model, modelSource, baseURL, apiKey, temperature, maxTokens, contextWindow, advancedConfig, now); err != nil {
			return fmt.Errorf("insert copied workspace agent config failed: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate source workspace agent configs failed: %w", err)
	}
	return nil
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

// EnsureUserWorkspaceDirs 确保用户工作空间下的角色目录与通用目录存在。
// 目录结构：WORKSPACE_ROOT/{userID}/{workspaceID}/{dev-jobs,pm-jobs,uidesigner-jobs,tester-jobs,files}
// 其中 pm-jobs 下还会创建 docs、prototypes 子目录。
// 目录列表由 workspacepath.EnsureDirs 统一生成，通过 personal-stub 创建。
func (s *DBWorkspaceService) EnsureUserWorkspaceDirs(ctx context.Context, workspaceID, userID string) error {
	if s.workspaceRoot == "" {
		return errors.New("workspace root not configured")
	}
	base, err := workspacepath.ResolveWorkspacePath(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return fmt.Errorf("resolve workspace path failed: %w", err)
	}
	dirs := workspacepath.EnsureDirs(base, nil)
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return errors.New("personal-stub client not initialized")
	}
	for _, d := range dirs {
		if err := sc.MkdirAll(context.Background(), d); err != nil {
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
		return workspace.Workspace{}, common.NotFoundErrorf("workspace not found")
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
func (s *DBWorkspaceService) UpdateWorkspace(id, name, description string, policy object.AgentPolicy) (workspace.Workspace, error) {
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
		return workspace.Workspace{}, common.NotFoundErrorf("workspace not found")
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
func (s *DBWorkspaceService) ListMine(userID string) ([]object.MineWorkspace, error) {
	rows, err := s.db.Query(`
		SELECT w.id, w.display_id, w.tenant_id, w.name, w.description,
		       t.agent_config_locked, t.locked_agent_keys, t.allowed_agent_keys, t.default_agent_configs,
		       w.created_at, w.updated_at,
		       m.role, COALESCE(m.sub_role, ''),
		       t.name AS tenant_name
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

	result := make([]object.MineWorkspace, 0)
	for rows.Next() {
		var mw object.MineWorkspace
		var desc sql.NullString
		var defaultConfigs []byte
		var lockedKeys pq.StringArray
		var allowedKeys pq.StringArray
		var tenantName sql.NullString
		if err := rows.Scan(
			&mw.ID, &mw.DisplayID, &mw.TenantID, &mw.Name, &desc,
			&mw.AgentConfigLocked, &lockedKeys, &allowedKeys, &defaultConfigs,
			&mw.CreatedAt, &mw.UpdatedAt,
			&mw.Role, &mw.SubRole,
			&tenantName,
		); err != nil {
			return nil, fmt.Errorf("scan mine workspace failed: %w", err)
		}
		mw.Description = sqlutil.ScanNullString(desc)
		mw.LockedAgentKeys = []string(lockedKeys)
		mw.AllowedAgentKeys = []string(allowedKeys)
		mw.TenantName = sqlutil.ScanNullString(tenantName)
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

// workspaceExists 校验工作空间是否存在。
func (s *DBWorkspaceService) workspaceExists(workspaceID string) error {
	var id string
	err := s.db.QueryRow(`SELECT id FROM workspaces WHERE id = $1`, workspaceID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return common.NotFoundErrorf("workspace not found")
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
		return common.NotFoundErrorf("workspace not found")
	}
	if err != nil {
		return fmt.Errorf("check workspace exists failed: %w", err)
	}
	return nil
}
