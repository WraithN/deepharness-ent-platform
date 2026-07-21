// Package service 实现 Agent 运行时模块的业务逻辑与数据访问。
package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime/object"
	"github.com/lib/pq"
)

// AgentRuntimeService 定义 Agent 运行时模块的服务接口。
type AgentRuntimeService interface {
	// ReportStatus 接收外部 gatewayd / agent-stub 上报的状态并写入数据库（upsert）。
	ReportStatus(runtimeID string, req object.ReportStatusRequest) (object.AgentRuntime, error)
	// List 查询运行时列表，支持按租户、空间、成员、智能体类型过滤，并返回分页结果。
	List(filter object.ListRuntimesFilter) (object.ListRuntimesResult, error)
	// Get 根据 runtimeID 查询单个运行时详情。
	Get(runtimeID string) (object.AgentRuntime, error)
}

// DBAgentRuntimeService 是基于 PostgreSQL 的 AgentRuntimeService 实现。
type DBAgentRuntimeService struct {
	db            *sql.DB
	workspaceRoot string
}

// NewDBAgentRuntimeService 创建基于 PostgreSQL 的 Agent 运行时服务。
// workspaceRoot 用于在 gatewayd 未上报 work_directory 时，按 ${workspace_root}/${workspace_id}/${user_id} 计算默认工作目录。
func NewDBAgentRuntimeService(db *sql.DB, workspaceRoot string) *DBAgentRuntimeService {
	svc := &DBAgentRuntimeService{db: db, workspaceRoot: workspaceRoot}
	// 服务初始化时自动建表，避免开发/测试环境因未执行迁移脚本而缺少表。
	_ = svc.ensureTable()
	return svc
}

// ensureTable 在表不存在时自动创建。
func (s *DBAgentRuntimeService) ensureTable() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS agent_runtimes (
			runtime_id VARCHAR(128) PRIMARY KEY,
			tenant_id VARCHAR(64) NOT NULL,
			tenant_name VARCHAR(255) NOT NULL DEFAULT '',
			workspace_id VARCHAR(64) NOT NULL,
			workspace_name VARCHAR(255) NOT NULL DEFAULT '',
			user_id VARCHAR(64) NOT NULL,
			user_name VARCHAR(255) NOT NULL DEFAULT '',
			user_display_name VARCHAR(255) NOT NULL DEFAULT '',
			status VARCHAR(32) NOT NULL,
			uptime_seconds BIGINT NOT NULL DEFAULT 0,
			cpu_percent REAL NOT NULL DEFAULT 0,
			mem_percent REAL NOT NULL DEFAULT 0,
			sandbox_spec VARCHAR(64) NOT NULL DEFAULT '',
			gatewayd_url VARCHAR(512) NOT NULL DEFAULT '',
			workspace_path VARCHAR(512) NOT NULL DEFAULT '',
			agents JSONB NOT NULL DEFAULT '[]'::jsonb,
			reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create agent_runtimes table failed: %w", err)
	}

	// 更新 updated_at 的触发器。
	_, err = s.db.Exec(`
		CREATE OR REPLACE FUNCTION update_updated_at_column()
		RETURNS TRIGGER AS $$
		BEGIN
			NEW.updated_at = CURRENT_TIMESTAMP;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

		DROP TRIGGER IF EXISTS trigger_agent_runtimes_updated_at ON agent_runtimes;
		CREATE TRIGGER trigger_agent_runtimes_updated_at
		BEFORE UPDATE ON agent_runtimes
		FOR EACH ROW
		EXECUTE FUNCTION update_updated_at_column();
	`)
	if err != nil {
		return fmt.Errorf("create agent_runtimes trigger failed: %w", err)
	}

	// 常用查询索引。
	_, err = s.db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_agent_runtimes_tenant ON agent_runtimes (tenant_id);
		CREATE INDEX IF NOT EXISTS idx_agent_runtimes_workspace ON agent_runtimes (workspace_id);
		CREATE INDEX IF NOT EXISTS idx_agent_runtimes_user ON agent_runtimes (user_id);
		CREATE INDEX IF NOT EXISTS idx_agent_runtimes_status ON agent_runtimes (status);
	`)
	if err != nil {
		return fmt.Errorf("create agent_runtimes indexes failed: %w", err)
	}

	return nil
}

// ReportStatus 接收外部上报的状态，执行 upsert。
// 租户/空间/成员的显示名称由服务端根据上报的 ID 自动查询填充，不依赖上报方传入。
func (s *DBAgentRuntimeService) ReportStatus(runtimeID string, req object.ReportStatusRequest) (object.AgentRuntime, error) {
	if runtimeID == "" {
		return object.AgentRuntime{}, errors.New("runtime_id is required")
	}

	agents := make([]object.AgentInstance, len(req.Agents))
	for i, a := range req.Agents {
		agents[i] = object.AgentInstance{
			Type:       a.Type,
			Name:       a.Name,
			Status:     a.Status,
			CallsToday: a.CallsToday,
			Version:    a.Version,
			LastActive: a.LastActive,
		}
	}

	agentsJSON, err := json.Marshal(agents)
	if err != nil {
		return object.AgentRuntime{}, fmt.Errorf("marshal agents failed: %w", err)
	}

	reportedAt := time.Now().UTC()
	if req.ReportedAt != nil {
		reportedAt = *req.ReportedAt
	}

	tenantID, tenantName, workspaceName, userName, userDisplayName := s.resolveRuntimeNames(
		req.WorkspaceID, req.UserID,
	)

	// 若 gatewayd 未上报工作目录，则按 ${workspace_root}/${workspace_id}/${user_id} 计算默认路径。
	workspacePath := req.WorkspacePath
	if workspacePath == "" && s.workspaceRoot != "" && req.WorkspaceID != "" && req.UserID != "" {
		workspacePath = filepath.Join(s.workspaceRoot, req.WorkspaceID, req.UserID)
	}

	var rt object.AgentRuntime
	var returnedAgents []byte
	err = s.db.QueryRow(`
		INSERT INTO agent_runtimes (
			runtime_id, tenant_id, tenant_name, workspace_id, workspace_name,
			user_id, user_name, user_display_name, status, uptime_seconds,
			cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, agents, reported_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		ON CONFLICT (runtime_id) DO UPDATE SET
			tenant_id = EXCLUDED.tenant_id,
			tenant_name = EXCLUDED.tenant_name,
			workspace_id = EXCLUDED.workspace_id,
			workspace_name = EXCLUDED.workspace_name,
			user_id = EXCLUDED.user_id,
			user_name = EXCLUDED.user_name,
			user_display_name = EXCLUDED.user_display_name,
			status = EXCLUDED.status,
			uptime_seconds = EXCLUDED.uptime_seconds,
			cpu_percent = EXCLUDED.cpu_percent,
			mem_percent = EXCLUDED.mem_percent,
			sandbox_spec = EXCLUDED.sandbox_spec,
			gatewayd_url = EXCLUDED.gatewayd_url,
			workspace_path = EXCLUDED.workspace_path,
			agents = EXCLUDED.agents,
			reported_at = EXCLUDED.reported_at
		RETURNING
			runtime_id, tenant_id, tenant_name, workspace_id, workspace_name,
			user_id, user_name, user_display_name, status, uptime_seconds,
			cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, agents, reported_at,
			created_at, updated_at
	`, runtimeID, tenantID, tenantName, req.WorkspaceID, workspaceName,
		req.UserID, userName, userDisplayName, string(req.Status), req.UptimeSeconds,
		req.CpuPercent, req.MemPercent, req.SandboxSpec, req.GatewaydURL, workspacePath, agentsJSON, reportedAt,
	).Scan(&rt.RuntimeID, &rt.TenantID, &rt.TenantName, &rt.WorkspaceID, &rt.WorkspaceName,
		&rt.UserID, &rt.UserName, &rt.UserDisplayName, &rt.Status, &rt.UptimeSeconds,
		&rt.CpuPercent, &rt.MemPercent, &rt.SandboxSpec, &rt.GatewaydURL, &rt.WorkspacePath, &returnedAgents, &rt.ReportedAt,
		&rt.CreatedAt, &rt.UpdatedAt)
	if err != nil {
		return object.AgentRuntime{}, fmt.Errorf("upsert runtime status failed: %w", err)
	}
	if len(returnedAgents) > 0 {
		_ = json.Unmarshal(returnedAgents, &rt.Agents)
	}

	return rt, nil
}

// resolveRuntimeNames 根据 workspaceId 反查租户信息，并查询空间/用户显示名称。
// 查询失败或记录不存在时返回空字符串，避免阻塞上报流程。
func (s *DBAgentRuntimeService) resolveRuntimeNames(workspaceID, userID string) (tenantID, tenantName, workspaceName, userName, userDisplayName string) {
	if workspaceID != "" {
		_ = s.db.QueryRow("SELECT tenant_id, name FROM workspaces WHERE id = $1", workspaceID).Scan(&tenantID, &workspaceName)
	}
	if tenantID != "" {
		_ = s.db.QueryRow("SELECT name FROM tenants WHERE id = $1", tenantID).Scan(&tenantName)
	}
	if userID != "" {
		_ = s.db.QueryRow("SELECT name FROM users WHERE id = $1", userID).Scan(&userName)
		userDisplayName = userName
	}
	return
}

// List 查询运行时列表，支持分页。
func (s *DBAgentRuntimeService) List(filter object.ListRuntimesFilter) (object.ListRuntimesResult, error) {
	page := filter.Page
	if page <= 0 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize <= 0 {
		pageSize = 10
	}

	whereSQL, args := buildListWhereSQL(filter)

	// 查询总条数
	var total int
	countSQL := "SELECT COUNT(*) FROM agent_runtimes " + whereSQL
	if err := s.db.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return object.ListRuntimesResult{}, fmt.Errorf("count runtimes failed: %w", err)
	}

	// 查询当前页数据
	query := `
		SELECT runtime_id, tenant_id, tenant_name, workspace_id, workspace_name,
		       user_id, user_name, user_display_name, status, uptime_seconds,
		       cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, agents, reported_at,
		       created_at, updated_at
		FROM agent_runtimes
	` + whereSQL + `
		ORDER BY reported_at DESC
		LIMIT $` + fmt.Sprintf("%d", len(args)+1) + ` OFFSET $` + fmt.Sprintf("%d", len(args)+2)

	rows, err := s.db.Query(query, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return object.ListRuntimesResult{}, fmt.Errorf("list runtimes failed: %w", err)
	}
	defer rows.Close()

	list, err := scanRuntimes(rows)
	if err != nil {
		return object.ListRuntimesResult{}, err
	}

	return object.ListRuntimesResult{
		List:     list,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// buildListWhereSQL 根据过滤条件生成 WHERE 子句与参数。
func buildListWhereSQL(filter object.ListRuntimesFilter) (string, []any) {
	whereSQL := "WHERE 1=1"
	var args []any
	argIdx := 1

	if filter.TenantID != "" {
		whereSQL += fmt.Sprintf(" AND tenant_id = $%d", argIdx)
		args = append(args, filter.TenantID)
		argIdx++
	}
	if filter.WorkspaceID != "" {
		whereSQL += fmt.Sprintf(" AND workspace_id = $%d", argIdx)
		args = append(args, filter.WorkspaceID)
		argIdx++
	}
	if filter.UserID != "" {
		whereSQL += fmt.Sprintf(" AND user_id = $%d", argIdx)
		args = append(args, filter.UserID)
		argIdx++
	}
	if filter.AgentType != "" {
		whereSQL += fmt.Sprintf(" AND agents @> $%d::jsonb", argIdx)
		args = append(args, fmt.Sprintf(`[{"type":"%s"}]`, filter.AgentType))
	}

	return whereSQL, args
}

// Get 根据 runtimeID 查询运行时详情。
func (s *DBAgentRuntimeService) Get(runtimeID string) (object.AgentRuntime, error) {
	var rt object.AgentRuntime
	err := s.db.QueryRow(`
		SELECT runtime_id, tenant_id, tenant_name, workspace_id, workspace_name,
		       user_id, user_name, user_display_name, status, uptime_seconds,
		       cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, agents, reported_at,
		       created_at, updated_at
		FROM agent_runtimes
		WHERE runtime_id = $1
	`, runtimeID).Scan(&rt.RuntimeID, &rt.TenantID, &rt.TenantName, &rt.WorkspaceID, &rt.WorkspaceName,
		&rt.UserID, &rt.UserName, &rt.UserDisplayName, &rt.Status, &rt.UptimeSeconds,
		&rt.CpuPercent, &rt.MemPercent, &rt.SandboxSpec, &rt.GatewaydURL, &rt.WorkspacePath, &rt.Agents, &rt.ReportedAt,
		&rt.CreatedAt, &rt.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return object.AgentRuntime{}, errors.New("runtime not found")
		}
		return object.AgentRuntime{}, fmt.Errorf("get runtime failed: %w", err)
	}
	return rt, nil
}

// scanRuntimes 扫描查询结果集并解析 agents JSON 字段。
// 无数据时返回空切片而非 nil，避免前端收到 null 导致 .map() 报错。
func scanRuntimes(rows *sql.Rows) ([]object.AgentRuntime, error) {
	result := make([]object.AgentRuntime, 0)
	for rows.Next() {
		var rt object.AgentRuntime
		var agentsJSON []byte
		err := rows.Scan(&rt.RuntimeID, &rt.TenantID, &rt.TenantName, &rt.WorkspaceID, &rt.WorkspaceName,
			&rt.UserID, &rt.UserName, &rt.UserDisplayName, &rt.Status, &rt.UptimeSeconds,
			&rt.CpuPercent, &rt.MemPercent, &rt.SandboxSpec, &rt.GatewaydURL, &rt.WorkspacePath, &agentsJSON, &rt.ReportedAt,
			&rt.CreatedAt, &rt.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan runtime failed: %w", err)
		}
		if len(agentsJSON) > 0 {
			_ = json.Unmarshal(agentsJSON, &rt.Agents)
		}
		result = append(result, rt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate runtimes failed: %w", err)
	}
	return result, nil
}

// unused imports guard（pq 在 SQL 执行中通过 driver 名隐式使用，保留导入以避免误删）
var _ = pq.FormatTimestamp
