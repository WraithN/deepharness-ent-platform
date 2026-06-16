package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
	"github.com/google/uuid"
)

// 成员角色常量。
const (
	MemberRoleAdmin = "admin"
	MemberRoleUser  = "user"

	MemberSubRoleDeveloper = "developer"
	MemberSubRoleTester    = "tester"
	MemberSubRolePM        = "pm"
	MemberSubRoleDesigner  = "designer"
)

// DBWorkspaceService 是基于 MySQL 的 WorkspaceService 实现。
type DBWorkspaceService struct {
	db *sql.DB
}

// NewDBWorkspaceService 创建 MySQL 实现的工作空间服务。
func NewDBWorkspaceService(db *sql.DB) *DBWorkspaceService {
	return &DBWorkspaceService{db: db}
}

// CreateWorkspace 创建新工作空间，并将所有者加入成员表。
func (s *DBWorkspaceService) CreateWorkspace(tenantID, name, description, ownerUserID string) (workspace.Workspace, error) {
	now := time.Now().UTC()
	ws := workspace.Workspace{
		ID:          uuid.New().String(),
		TenantID:    tenantID,
		Name:        name,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO workspaces (id, tenant_id, name, description, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, ws.ID, ws.TenantID, ws.Name, ws.Description, ws.CreatedAt, ws.UpdatedAt)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("insert workspace failed: %w", err)
	}

	_, err = tx.Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, role, sub_role, joined_at)
		VALUES ($1, $2, $3, $4, $5)
	`, ws.ID, ownerUserID, MemberRoleAdmin, MemberSubRolePM, now)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("insert workspace member failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return workspace.Workspace{}, fmt.Errorf("commit failed: %w", err)
	}
	return ws, nil
}

// GetWorkspace 按 ID 查询工作空间。
func (s *DBWorkspaceService) GetWorkspace(id string) (workspace.Workspace, error) {
	var ws workspace.Workspace
	var desc sql.NullString
	err := s.db.QueryRow(`
		SELECT id, tenant_id, name, description, created_at, updated_at
		FROM workspaces WHERE id = $1
	`, id).Scan(&ws.ID, &ws.TenantID, &ws.Name, &desc, &ws.CreatedAt, &ws.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.Workspace{}, errors.New("workspace not found")
	}
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("get workspace failed: %w", err)
	}
	ws.Description = sqlutil.ScanNullString(desc)
	return ws, nil
}

// ListWorkspaces 返回工作空间列表，支持按租户过滤。
func (s *DBWorkspaceService) ListWorkspaces(tenantID string) ([]workspace.Workspace, error) {
	query := `SELECT id, tenant_id, name, description, created_at, updated_at FROM workspaces`
	var args []any
	if tenantID != "" {
		query += ` WHERE tenant_id = $1`
		args = append(args, tenantID)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list workspaces failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Workspace, 0)
	for rows.Next() {
		var ws workspace.Workspace
		var desc sql.NullString
		if err := rows.Scan(&ws.ID, &ws.TenantID, &ws.Name, &desc, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace failed: %w", err)
		}
		ws.Description = sqlutil.ScanNullString(desc)
		result = append(result, ws)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspaces failed: %w", err)
	}
	return result, nil
}

// AddMember 向工作空间添加成员。
func (s *DBWorkspaceService) AddMember(workspaceID, userID, role, subRole string) error {
	if err := s.workspaceExists(workspaceID); err != nil {
		return err
	}
	_, err := s.db.Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, role, sub_role, joined_at)
		VALUES ($1, $2, $3, $4, $5)
	`, workspaceID, userID, role, sqlutil.NullString(subRole), time.Now().UTC())
	if err != nil {
		return fmt.Errorf("add member failed: %w", err)
	}
	return nil
}

// ListMembers 返回工作空间成员列表。
func (s *DBWorkspaceService) ListMembers(workspaceID string) ([]workspace.Member, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(`
		SELECT workspace_id, user_id, role, sub_role, joined_at
		FROM workspace_members WHERE workspace_id = $1
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list members failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Member, 0)
	for rows.Next() {
		var m workspace.Member
		var subRole sql.NullString
		if err := rows.Scan(&m.WorkspaceID, &m.UserID, &m.Role, &subRole, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("scan member failed: %w", err)
		}
		m.SubRole = sqlutil.ScanNullString(subRole)
		result = append(result, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate members failed: %w", err)
	}
	return result, nil
}

// RemoveMember 移除工作空间成员。
func (s *DBWorkspaceService) RemoveMember(workspaceID, userID string) error {
	res, err := s.db.Exec(`
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
	return nil
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
