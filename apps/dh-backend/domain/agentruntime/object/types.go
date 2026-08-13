// Package object 定义 Agent 运行时模块的领域模型。
package object

import "time"

// RuntimeStatus 表示运行时的整体状态。
type RuntimeStatus string

const (
	RuntimeStatusRunning         RuntimeStatus = "running"
	RuntimeStatusError           RuntimeStatus = "error"
	RuntimeStatusStopped         RuntimeStatus = "stopped"
	RuntimeStatusResourceWarning RuntimeStatus = "resource_warning"
	// RuntimeStatusInitializing 表示运行时正在初始化（如安装 comet skill）。
	RuntimeStatusInitializing RuntimeStatus = "initializing"
)

// AgentInstanceStatus 表示某个智能体实例的状态。
type AgentInstanceStatus string

const (
	AgentInstanceStatusRunning AgentInstanceStatus = "running"
	AgentInstanceStatusError   AgentInstanceStatus = "error"
	AgentInstanceStatusIdle    AgentInstanceStatus = "idle"
)

// AgentInstance 是运行时内部的一个智能体实例。
// 注意：该结构体同时用于数据库存储与 JSON 响应，保持 camelCase 以兼容前端类型。
type AgentInstance struct {
	Type       string              `json:"type"`
	Name       string              `json:"name"`
	Status     AgentInstanceStatus `json:"status"`
	CallsToday int64               `json:"callsToday"`
	Version    string              `json:"version"`
	LastActive string              `json:"lastActive"`
}

// AgentRuntime 是上报的运行时记录，也是管理后台展示的对象。
type AgentRuntime struct {
	RuntimeID       string          `json:"runtimeId"`
	TenantID        string          `json:"tenantId"`
	TenantName      string          `json:"tenantName"`
	WorkspaceID     string          `json:"workspaceId"`
	WorkspaceName   string          `json:"workspaceName"`
	UserID          string          `json:"userId"`
	UserName        string          `json:"userName"`
	UserDisplayName string          `json:"userDisplayName"`
	Status          RuntimeStatus   `json:"status"`
	UptimeSeconds   int64           `json:"uptimeSeconds"`
	CpuPercent      float64         `json:"cpuPercent"`
	MemPercent      float64         `json:"memPercent"`
	SandboxSpec     string          `json:"sandboxSpec"`
	Agents          []AgentInstance `json:"agents"`
	// InstalledAgents 是已安装（CLI 可用）但未必正在运行的智能体类型列表。
	// 仅包含 opencode / claude-code / codex 三种 gatewayd 支持的类型。
	InstalledAgents []string        `json:"installedAgents"`
	// Sessions7d 是近 7 日会话总数，由 gatewayd 从本地 SQLite 统计上报。
	Sessions7d int64                 `json:"sessions7d"`
	// Sessions1d 是近 1 日会话总数，由 gatewayd 从本地 SQLite 统计上报。
	Sessions1d int64                 `json:"sessions1d"`
	// LastActiveAt 是最近一次会话活跃时间，由 gatewayd 上报。无会话时为零值。
	LastActiveAt time.Time            `json:"lastActiveAt"`
	// WorkspacePath 是 gatewayd 实际使用的工作目录，格式为 ${workspace_root}/${user_id}/${workspace_id}。
	// 由 gatewayd 通过状态上报接口回传，供 platform 后端统一文件路径与指令模板使用。
	WorkspacePath string          `json:"workspacePath"`
	GatewaydURL   string          `json:"gatewaydUrl"`
	// IP 是容器/主机的主网卡 IP 地址，由 personal-stub 采集并随状态上报。
	IP            string          `json:"ip"`
	// InitStatus 是运行时初始化状态信息（如"正在安装 SDD 支持"），为空表示无初始化在途。
	InitStatus    string          `json:"initStatus"`
	ReportedAt      time.Time       `json:"reportedAt"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

// ReportStatusAgentInstance 是上报请求体中的智能体实例，字段采用 snake_case。
type ReportStatusAgentInstance struct {
	Type       string              `json:"type"`
	Name       string              `json:"name"`
	Status     AgentInstanceStatus `json:"status"`
	CallsToday int64               `json:"calls_today"`
	Version    string              `json:"version"`
	LastActive string              `json:"last_active"`
}

// ReportStatusRequest 是外部 gatewayd / personal-stub 上报状态时使用的请求体。
// 字段采用 snake_case，方便外部（如 Python/Rust gatewayd）直接序列化。
// 租户信息由服务端根据 workspace_id 反查得到，名称由服务端自动查询填充，
// 上报方只需传 workspace_id、user_id 等业务 ID。
type ReportStatusRequest struct {
	WorkspaceID   string                      `json:"workspace_id"`
	UserID        string                      `json:"user_id"`
	Status        RuntimeStatus               `json:"status"`
	UptimeSeconds int64                       `json:"uptime_seconds"`
	CpuPercent    float64                     `json:"cpu_percent"`
	MemPercent    float64                     `json:"mem_percent"`
	SandboxSpec   string                      `json:"sandbox_spec"`
	Agents        []ReportStatusAgentInstance `json:"agents"`
	// InstalledAgents 是已安装（CLI 可用）的智能体类型列表，由 gatewayd 上报。
	InstalledAgents []string    `json:"installed_agents,omitempty"`
	// Sessions7d 是近 7 日会话总数，由 gatewayd 从本地 SQLite 统计上报。
	Sessions7d int64          `json:"sessions_7d,omitempty"`
	// Sessions1d 是近 1 日会话总数，由 gatewayd 从本地 SQLite 统计上报。
	Sessions1d int64          `json:"sessions_1d,omitempty"`
	// LastActiveAt 是最近一次会话活跃时间（RFC3339），由 gatewayd 上报。无会话时不传。
	LastActiveAt *time.Time   `json:"last_active_at,omitempty"`
	// WorkspacePath 是 gatewayd 实际使用的工作目录，格式为 ${workspace_root}/${user_id}/${workspace_id}。
	// 若上报方未提供，服务端会根据 workspace.root 配置自动计算。
	WorkspacePath string        `json:"workspace_path,omitempty"`
	GatewaydURL   string        `json:"gatewayd_url,omitempty"`
	// IP 是容器/主机的主网卡 IP 地址，由 personal-stub 采集并随状态上报。
	IP            string        `json:"ip,omitempty"`
	// InitStatus 是运行时初始化状态信息（如"正在安装 SDD 支持"），由 personal-stub 上报。
	// 为空表示无初始化在途。上报空值会清除已有的初始化状态。
	InitStatus    string        `json:"init_status,omitempty"`
	ReportedAt    *time.Time    `json:"reported_at,omitempty"`
}

// ListRuntimesFilter 是管理后台查询运行时列表的过滤条件。
type ListRuntimesFilter struct {
	TenantID    string
	WorkspaceID string
	UserID      string
	AgentType   string
	Page        int
	PageSize    int
}

// ListRuntimesResult 是运行时列表的分页返回结果。
type ListRuntimesResult struct {
	List     []AgentRuntime `json:"list"`
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
}
