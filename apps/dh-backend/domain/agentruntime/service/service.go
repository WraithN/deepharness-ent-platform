// Package service 实现 Agent 运行时模块的业务逻辑与数据访问。
package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	_ "github.com/lib/pq" // PostgreSQL driver，通过 database/sql 隐式注册

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// defaultPageSize 是 List 接口未指定分页大小时的默认值。
const defaultPageSize = 10

// staleCheckInterval 是过期检测的扫描间隔。
const staleCheckInterval = 30 * time.Second

// staleThreshold 是判定运行时已下线的心跳超时阈值。
// 超过此阈值未上报的运行时将被自动标记为 stopped。
const staleThreshold = 2 * time.Minute

// statusAliasMap 将外部上报方（如 gatewayd）使用的非标准状态值映射到平台统一的 RuntimeStatus。
// 不同版本的 gatewayd 可能发送 online/offline/ok 等值，需要在此归一化。
var statusAliasMap = map[string]object.RuntimeStatus{
	"online":    object.RuntimeStatusRunning,
	"offline":   object.RuntimeStatusStopped,
	"ok":        object.RuntimeStatusRunning,
	"down":      object.RuntimeStatusStopped,
	"healthy":   object.RuntimeStatusRunning,
	"unhealthy": object.RuntimeStatusError,
	"idle":      object.RuntimeStatusRunning,
}

// normalizeStatus 将外部上报的状态值归一化为平台统一的 RuntimeStatus。
// 已知的标准状态值原样返回，未知值也原样返回（避免静默丢弃信息）。
func normalizeStatus(s object.RuntimeStatus) object.RuntimeStatus {
	mapped, ok := statusAliasMap[string(s)]
	if ok {
		return mapped
	}
	return s
}

// AgentRuntimeService 定义 Agent 运行时模块的服务接口。
type AgentRuntimeService interface {
	// ReportStatus 接收外部 gatewayd / personal-stub 上报的状态并写入数据库（upsert）。
	ReportStatus(runtimeID string, req object.ReportStatusRequest) (object.AgentRuntime, error)
	// List 查询运行时列表，支持按租户、空间、成员、智能体类型过滤，并返回分页结果。
	List(filter object.ListRuntimesFilter) (object.ListRuntimesResult, error)
	// Get 根据 runtimeID 查询单个运行时详情。
	Get(runtimeID string) (object.AgentRuntime, error)
	// MarkStaleRuntimes 扫描 reported_at 超过过期阈值的运行时，将其状态标记为 stopped。
	// 返回被标记的记录数。
	MarkStaleRuntimes() (int64, error)
}

// DBAgentRuntimeService 是基于 PostgreSQL 的 AgentRuntimeService 实现。
type DBAgentRuntimeService struct {
	db            *sql.DB
	workspaceRoot string
}

// NewDBAgentRuntimeService 创建基于 PostgreSQL 的 Agent 运行时服务。
// workspaceRoot 用于在 gatewayd 未上报 work_directory 时，按 ${workspace_root}/${user_id}/${workspace_id} 计算默认工作目录。
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
			ip VARCHAR(64) NOT NULL DEFAULT '',
			installed_agents JSONB NOT NULL DEFAULT '[]'::jsonb,
			sessions_7d BIGINT NOT NULL DEFAULT 0,
			sessions_1d BIGINT NOT NULL DEFAULT 0,
			last_active_at TIMESTAMPTZ,
			agents JSONB NOT NULL DEFAULT '[]'::jsonb,
			reported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create agent_runtimes table failed: %w", err)
	}

	// 兼容旧表：若 ip 列不存在则自动添加（ALTER TABLE IF NOT EXISTS 在 PG 11+ 可用）。
	_, _ = s.db.Exec(`ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS ip VARCHAR(64) NOT NULL DEFAULT ''`)
	// 兼容旧表：若 installed_agents 列不存在则自动添加。
	_, _ = s.db.Exec(`ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS installed_agents JSONB NOT NULL DEFAULT '[]'::jsonb`)
	// 兼容旧表：若 sessions_7d / sessions_1d 列不存在则自动添加。
	_, _ = s.db.Exec(`ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS sessions_7d BIGINT NOT NULL DEFAULT 0`)
	_, _ = s.db.Exec(`ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS sessions_1d BIGINT NOT NULL DEFAULT 0`)
	_, _ = s.db.Exec(`ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ`)

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
// 状态值会经过 normalizeStatus 归一化，将 online/offline 等非标准值映射为统一枚举。
func (s *DBAgentRuntimeService) ReportStatus(runtimeID string, req object.ReportStatusRequest) (object.AgentRuntime, error) {
	if runtimeID == "" {
		return object.AgentRuntime{}, errors.New("runtime_id is required")
	}

	// 归一化状态：将 gatewayd 发送的 online/offline 等非标准值映射为统一枚举。
	normalizedStatus := normalizeStatus(req.Status)

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

	installedAgentsJSON, err := json.Marshal(req.InstalledAgents)
	if err != nil {
		return object.AgentRuntime{}, fmt.Errorf("marshal installed_agents failed: %w", err)
	}

	reportedAt := time.Now().UTC()
	if req.ReportedAt != nil {
		reportedAt = *req.ReportedAt
	}

	tenantID, tenantName, workspaceName, userName, userDisplayName := s.resolveRuntimeNames(
		req.WorkspaceID, req.UserID,
	)

	// 若 gatewayd 未上报工作目录，则按 ${workspace_root}/${user_id}/${workspace_id} 计算默认路径。
	workspacePath := req.WorkspacePath
	if workspacePath == "" && s.workspaceRoot != "" && req.WorkspaceID != "" && req.UserID != "" {
		var err error
		workspacePath, err = pathutil.ResolveWorkspaceRoot(s.workspaceRoot, req.UserID, req.WorkspaceID)
		if err != nil {
			return object.AgentRuntime{}, fmt.Errorf("resolve workspace path failed: %w", err)
		}
	}

	var rt object.AgentRuntime
	var returnedAgents []byte
	var returnedInstalledAgents []byte
	var nullLastActive sql.NullTime
	err = s.db.QueryRow(`
		INSERT INTO agent_runtimes (
			runtime_id, tenant_id, tenant_name, workspace_id, workspace_name,
			user_id, user_name, user_display_name, status, uptime_seconds,
			cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, ip, installed_agents, sessions_7d, sessions_1d, last_active_at, agents, reported_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
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
			ip = EXCLUDED.ip,
			installed_agents = EXCLUDED.installed_agents,
			sessions_7d = EXCLUDED.sessions_7d,
			sessions_1d = EXCLUDED.sessions_1d,
			last_active_at = EXCLUDED.last_active_at,
			agents = EXCLUDED.agents,
			reported_at = EXCLUDED.reported_at
		RETURNING
			runtime_id, tenant_id, tenant_name, workspace_id, workspace_name,
			user_id, user_name, user_display_name, status, uptime_seconds,
			cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, ip, installed_agents, sessions_7d, sessions_1d, last_active_at, agents, reported_at,
			created_at, updated_at
	`, runtimeID, tenantID, tenantName, req.WorkspaceID, workspaceName,
		req.UserID, userName, userDisplayName, string(normalizedStatus), req.UptimeSeconds,
		req.CpuPercent, req.MemPercent, req.SandboxSpec, req.GatewaydURL, workspacePath, req.IP, installedAgentsJSON, req.Sessions7d, req.Sessions1d, req.LastActiveAt, agentsJSON, reportedAt,
	).Scan(&rt.RuntimeID, &rt.TenantID, &rt.TenantName, &rt.WorkspaceID, &rt.WorkspaceName,
		&rt.UserID, &rt.UserName, &rt.UserDisplayName, &rt.Status, &rt.UptimeSeconds,
		&rt.CpuPercent, &rt.MemPercent, &rt.SandboxSpec, &rt.GatewaydURL, &rt.WorkspacePath, &rt.IP, &returnedInstalledAgents, &rt.Sessions7d, &rt.Sessions1d, &nullLastActive, &returnedAgents, &rt.ReportedAt,
		&rt.CreatedAt, &rt.UpdatedAt)
	if err != nil {
		return object.AgentRuntime{}, fmt.Errorf("upsert runtime status failed: %w", err)
	}
	if len(returnedAgents) > 0 {
		_ = json.Unmarshal(returnedAgents, &rt.Agents)
	}
	if len(returnedInstalledAgents) > 0 {
		_ = json.Unmarshal(returnedInstalledAgents, &rt.InstalledAgents)
	}
	if nullLastActive.Valid {
		rt.LastActiveAt = nullLastActive.Time
	}
	if rt.Agents == nil {
		rt.Agents = []object.AgentInstance{}
	}
	if rt.InstalledAgents == nil {
		rt.InstalledAgents = []string{}
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
		pageSize = defaultPageSize
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
		       cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, ip, installed_agents, sessions_7d, sessions_1d, last_active_at, agents, reported_at,
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
		// agents 是对象数组 [{"type":"opencode",...}]，installed_agents 是字符串数组 ["opencode"]。
		// 同时检查两列，确保筛选已安装但当前未运行的智能体时也能匹配。
		agentsFilter, _ := json.Marshal([]map[string]string{{"type": filter.AgentType}})
		installedFilter, _ := json.Marshal(filter.AgentType)
		whereSQL += fmt.Sprintf(" AND (agents @> $%d::jsonb OR installed_agents @> $%d::jsonb)", argIdx, argIdx+1)
		args = append(args, string(agentsFilter), string(installedFilter))
		argIdx += 2
	}

	return whereSQL, args
}

// Get 根据 runtimeID 查询运行时详情。
func (s *DBAgentRuntimeService) Get(runtimeID string) (object.AgentRuntime, error) {
	var rt object.AgentRuntime
	var agentsJSON []byte
	var installedAgentsJSON []byte
	var nullLastActive sql.NullTime
	err := s.db.QueryRow(`
		SELECT runtime_id, tenant_id, tenant_name, workspace_id, workspace_name,
		       user_id, user_name, user_display_name, status, uptime_seconds,
		       cpu_percent, mem_percent, sandbox_spec, gatewayd_url, workspace_path, ip, installed_agents, sessions_7d, sessions_1d, last_active_at, agents, reported_at,
		       created_at, updated_at
		FROM agent_runtimes
		WHERE runtime_id = $1
	`, runtimeID).Scan(&rt.RuntimeID, &rt.TenantID, &rt.TenantName, &rt.WorkspaceID, &rt.WorkspaceName,
		&rt.UserID, &rt.UserName, &rt.UserDisplayName, &rt.Status, &rt.UptimeSeconds,
		&rt.CpuPercent, &rt.MemPercent, &rt.SandboxSpec, &rt.GatewaydURL, &rt.WorkspacePath, &rt.IP, &installedAgentsJSON, &rt.Sessions7d, &rt.Sessions1d, &nullLastActive, &agentsJSON, &rt.ReportedAt,
		&rt.CreatedAt, &rt.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return object.AgentRuntime{}, common.NotFoundErrorf("runtime not found")
		}
		return object.AgentRuntime{}, fmt.Errorf("get runtime failed: %w", err)
	}
	if len(agentsJSON) > 0 {
		_ = json.Unmarshal(agentsJSON, &rt.Agents)
	}
	if len(installedAgentsJSON) > 0 {
		_ = json.Unmarshal(installedAgentsJSON, &rt.InstalledAgents)
	}
	if nullLastActive.Valid {
		rt.LastActiveAt = nullLastActive.Time
	}
	if rt.Agents == nil {
		rt.Agents = []object.AgentInstance{}
	}
	if rt.InstalledAgents == nil {
		rt.InstalledAgents = []string{}
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
		var installedAgentsJSON []byte
		var nullLastActive sql.NullTime
		err := rows.Scan(&rt.RuntimeID, &rt.TenantID, &rt.TenantName, &rt.WorkspaceID, &rt.WorkspaceName,
			&rt.UserID, &rt.UserName, &rt.UserDisplayName, &rt.Status, &rt.UptimeSeconds,
			&rt.CpuPercent, &rt.MemPercent, &rt.SandboxSpec, &rt.GatewaydURL, &rt.WorkspacePath, &rt.IP, &installedAgentsJSON, &rt.Sessions7d, &rt.Sessions1d, &nullLastActive, &agentsJSON, &rt.ReportedAt,
			&rt.CreatedAt, &rt.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan runtime failed: %w", err)
		}
		if len(agentsJSON) > 0 {
			_ = json.Unmarshal(agentsJSON, &rt.Agents)
		}
		if len(installedAgentsJSON) > 0 {
			_ = json.Unmarshal(installedAgentsJSON, &rt.InstalledAgents)
		}
		if nullLastActive.Valid {
			rt.LastActiveAt = nullLastActive.Time
		}
		if rt.Agents == nil {
			rt.Agents = []object.AgentInstance{}
		}
		if rt.InstalledAgents == nil {
			rt.InstalledAgents = []string{}
		}
		result = append(result, rt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate runtimes failed: %w", err)
	}
	return result, nil
}

// MarkStaleRuntimes 将 reported_at 超过 staleThreshold 且当前状态不是 stopped/error 的运行时标记为 stopped。
// 这确保容器停止上报后，管理后台不会永远显示"运行中"。
func (s *DBAgentRuntimeService) MarkStaleRuntimes() (int64, error) {
	result, err := s.db.Exec(`
		UPDATE agent_runtimes
		SET status = $1
		WHERE reported_at < $2
		  AND status NOT IN ($1, $3)
	`, string(object.RuntimeStatusStopped), time.Now().UTC().Add(-staleThreshold), string(object.RuntimeStatusError))
	if err != nil {
		return 0, fmt.Errorf("mark stale runtimes failed: %w", err)
	}
	rows, _ := result.RowsAffected()
	return rows, nil
}

// StartStaleChecker 启动后台 goroutine，定期扫描并标记过期的运行时。
// 应在服务初始化后调用一次，随服务生命周期常驻。
func (s *DBAgentRuntimeService) StartStaleChecker() {
	go func() {
		ticker := time.NewTicker(staleCheckInterval)
		defer ticker.Stop()
		for range ticker.C {
			n, err := s.MarkStaleRuntimes()
			if err != nil {
				log.Printf("[AgentRuntime] stale check failed: %v", err)
				continue
			}
			if n > 0 {
				log.Printf("[AgentRuntime] marked %d stale runtime(s) as stopped", n)
			}
		}
	}()
}


