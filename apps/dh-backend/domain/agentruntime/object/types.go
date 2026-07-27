// Package object 定义 Agent 运行时模块的领域模型。
package object

import "time"

// RuntimeStatus 表示运行时的整体状态。
type RuntimeStatus string

const (
	RuntimeStatusRunning        RuntimeStatus = "running"
	RuntimeStatusError          RuntimeStatus = "error"
	RuntimeStatusStopped        RuntimeStatus = "stopped"
	RuntimeStatusResourceWarning RuntimeStatus = "resource_warning"
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
	// WorkspacePath 是 gatewayd 实际使用的工作目录，格式为 ${workspace_root}/${user_id}/${workspace_id}。
	// 由 gatewayd 通过状态上报接口回传，供 platform 后端统一文件路径与指令模板使用。
	WorkspacePath string          `json:"workspacePath"`
	GatewaydURL   string          `json:"gatewaydUrl"`
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
	// WorkspacePath 是 gatewayd 实际使用的工作目录，格式为 ${workspace_root}/${user_id}/${workspace_id}。
	// 若上报方未提供，服务端会根据 workspace.root 配置自动计算。
	WorkspacePath string        `json:"workspace_path,omitempty"`
	GatewaydURL   string        `json:"gatewayd_url,omitempty"`
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
