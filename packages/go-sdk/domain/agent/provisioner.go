package agent

import (
	"context"
	"time"
)

// InstanceStatus Agent 实例当前生命周期阶段。
type InstanceStatus string

const (
	InstanceStatusCreating  InstanceStatus = "creating"
	InstanceStatusActive    InstanceStatus = "active"
	InstanceStatusSleeping  InstanceStatus = "sleeping"
	InstanceStatusUnbound   InstanceStatus = "unbound"
	InstanceStatusError     InstanceStatus = "error"
)

// ProvisionRequest 携带用户上下文，用于绑定 Agent 实例。
type ProvisionRequest struct {
	WorkspaceID string
	UserID      string
	Roles       []string
	AgentType   string
}

// AgentInstance 表示一个已分配的 Agent 实例。
type AgentInstance struct {
	InstanceID string         `json:"instanceId"`
	AdminURL   string         `json:"adminUrl"`
	AgentURL   string         `json:"agentUrl"`
	Status     InstanceStatus `json:"status"`
	AssignedAt time.Time      `json:"assignedAt"`
}

// ProvisionResult 包含 provisioning 结果和状态。
type ProvisionResult struct {
	Instance     AgentInstance `json:"instance"`
	Stage        string        `json:"stage"`
	EstimatedSec int           `json:"estimatedSec"`
}

// WarmPoolStatus 暖池状态。
type WarmPoolStatus struct {
	Available int `json:"available"`
	Total     int `json:"total"`
	Min       int `json:"min"`
	Max       int `json:"max"`
}

// AgentProvisioner 是 Agent 实例生命周期的统一抽象（基类接口）。
// 三种实现均继承此接口：
//   - direct-host：本地开发，固定主机列表模拟容器分配
//   - k8s：Kubernetes 原生 Pod 管理
//   - self-defined：通过 HTTP API 对接自定义外部供给器
//
// 所有实现必须返回正确的 Name() 以便日志与可观测性识别。
type AgentProvisioner interface {
	// Name 返回供给器类型名称（如 "direct-host" / "k8s" / "self-defined"）。
	Name() string

	// Provision 为用户分配 Agent 实例。
	// 优先级：已绑定且活跃 > 已绑定且休眠 > 暖池分配 > 冷启动创建。
	Provision(ctx context.Context, req ProvisionRequest) (ProvisionResult, error)

	// Sleep 将实例标记为休眠，释放部分资源。
	Sleep(ctx context.Context, instanceID string) error

	// Wake 将实例从休眠中唤醒，恢复为活跃状态。
	Wake(ctx context.Context, instanceID string) (AgentInstance, error)

	// Destroy 销毁实例，释放所有资源。
	Destroy(ctx context.Context, instanceID string) error

	// Status 查询实例当前生命周期阶段。
	Status(ctx context.Context, instanceID string) (InstanceStatus, error)

	// FindByUser 按 workspaceID + userID 查找已绑定的实例。
	FindByUser(ctx context.Context, workspaceID, userID string) (*AgentInstance, error)

	// WarmPoolEnsure 确保暖池中至少有 min 个可用实例。
	WarmPoolEnsure(ctx context.Context, min int) error

	// WarmPoolStatus 查询暖池状态。
	WarmPoolStatus(ctx context.Context) (WarmPoolStatus, error)
}
