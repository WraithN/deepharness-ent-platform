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

// AgentProvisioner 是 Agent 实例生命周期的统一抽象。
// 开源版使用 K8sNativeProvider，企业版使用 EnterpriseDevOpsProvider。
type AgentProvisioner interface {
	Provision(ctx context.Context, req ProvisionRequest) (ProvisionResult, error)

	Sleep(ctx context.Context, instanceID string) error

	Wake(ctx context.Context, instanceID string) (AgentInstance, error)

	Destroy(ctx context.Context, instanceID string) error

	Status(ctx context.Context, instanceID string) (InstanceStatus, error)

	FindByUser(ctx context.Context, workspaceID, userID string) (*AgentInstance, error)

	WarmPoolEnsure(ctx context.Context, min int) error

	WarmPoolStatus(ctx context.Context) (WarmPoolStatus, error)
}
