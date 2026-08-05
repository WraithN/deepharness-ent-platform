package directhost

import (
	"context"
	"fmt"
	"sync"
	"time"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// ProviderName 供给器类型名称。
const ProviderName = "direct-host"

// 默认端口递增步长与每主机最大用户数。
const (
	defaultPortStep        = 10
	defaultMaxUsersPerHost = 5
)

// Manager 是 direct-host 模式的统一管理器，同时实现 AgentProvisioner 和 ContainerPool 接口。
//
// 支持同一台主机上运行多个 personal-stub + gatewayd 进程：
//   - 每台主机有 maxUsersPerHost 个"槽位"
//   - 每个槽位对应一组唯一端口（agent/admin/stub），按 portStep 递增
//   - 槽位 0 使用基础端口，槽位 i 使用 base + i * portStep
//
// 示例（agentBase=2345, adminBase=2346, stubBase=8090, step=10）：
//
//	槽位 0: agent=2345, admin=2346, stub=8090
//	槽位 1: agent=2355, admin=2356, stub=8100
//	槽位 2: agent=2365, admin=2366, stub=8110
type Manager struct {
	mu     sync.Mutex
	hosts  []*hostState
	ports  portConfig
	nextID int
}

// portConfig 端口分配配置。
type portConfig struct {
	agentBase int
	adminBase int
	stubBase  int
	step      int
}

// hostState 单台主机的槽位状态。
type hostState struct {
	host  string
	slots []*slotState
}

// slotState 单个槽位的运行时状态。
type slotState struct {
	instanceID  string
	userID      string
	workspaceID string
	status      agent.InstanceStatus
	assignedAt  time.Time
	agentPort   int
	adminPort   int
	stubPort    int
}

// Config direct-host 管理器的配置参数。
type Config struct {
	Hosts          []string
	AgentPort      int
	AdminPort      int
	StubPort       int
	PortStep       int
	MaxUsersPerHost int
}

// NewManager 创建 direct-host 管理器。
func NewManager(cfg Config) *Manager {
	hosts := cfg.Hosts
	if len(hosts) == 0 {
		hosts = []string{"127.0.0.1"}
	}

	step := cfg.PortStep
	if step <= 0 {
		step = defaultPortStep
	}

	maxPerHost := cfg.MaxUsersPerHost
	if maxPerHost <= 0 {
		maxPerHost = defaultMaxUsersPerHost
	}

	agentBase := cfg.AgentPort
	if agentBase == 0 {
		agentBase = agent.DefaultAgentPort
	}
	adminBase := cfg.AdminPort
	if adminBase == 0 {
		adminBase = agent.DefaultAdminPort
	}
	stubBase := cfg.StubPort
	if stubBase == 0 {
		stubBase = agent.DefaultStubPort
	}

	pc := portConfig{
		agentBase: agentBase,
		adminBase: adminBase,
		stubBase:  stubBase,
		step:      step,
	}

	hostList := make([]*hostState, len(hosts))
	for i, h := range hosts {
		slots := make([]*slotState, maxPerHost)
		for j := range slots {
			slots[j] = &slotState{
				status:    agent.InstanceStatusUnbound,
				agentPort: agentBase + j*step,
				adminPort: adminBase + j*step,
				stubPort:  stubBase + j*step,
			}
		}
		hostList[i] = &hostState{host: h, slots: slots}
	}

	return &Manager{
		hosts: hostList,
		ports: pc,
	}
}

// NewManagerFromConfig 从 ProvisionerConfig 创建管理器。
func NewManagerFromConfig(cfg config.DirectHostConfig) *Manager {
	return NewManager(Config{
		Hosts:           cfg.Hosts,
		AgentPort:       cfg.AgentPort,
		AdminPort:       cfg.AdminPort,
		StubPort:        cfg.StubPort,
		PortStep:        cfg.PortStep,
		MaxUsersPerHost: cfg.MaxUsersPerHost,
	})
}

// Name 返回供给器类型名称。
func (m *Manager) Name() string {
	return ProviderName
}

// --- ContainerPool 接口实现 ---

// Acquire 为用户分配容器（槽位）。
// 已分配 -> 直接返回；未分配 -> 找空闲槽位；全满 -> ErrPoolExhausted。
func (m *Manager) Acquire(_ context.Context, userID string) (*agent.ContainerInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 已有分配
	if slot := m.findSlotByUserLocked(userID); slot != nil {
		return m.slotToContainerInfo(slot), nil
	}

	// 找空闲槽位
	slot := m.findFreeSlotLocked()
	if slot == nil {
		return nil, agent.ErrPoolExhausted
	}

	slot.userID = userID
	slot.status = agent.InstanceStatusActive
	slot.instanceID = m.generateInstanceID()
	slot.assignedAt = time.Now()
	return m.slotToContainerInfo(slot), nil
}

// GetByUser 查找用户已分配的容器。
func (m *Manager) GetByUser(_ context.Context, userID string) (*agent.ContainerInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByUserLocked(userID)
	if slot == nil {
		return nil, nil
	}
	return m.slotToContainerInfo(slot), nil
}

// Release 释放用户的容器回池。
func (m *Manager) Release(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByUserLocked(userID)
	if slot == nil {
		return nil
	}
	m.resetSlot(slot)
	return nil
}

// PoolStatus 返回容器池状态摘要。
// 注意：此方法不直接实现 ContainerPool 接口（因 AgentProvisioner 和 ContainerPool
// 都有名为 Status 的方法但签名不同），通过 PoolAdapter 适配。
func (m *Manager) PoolStatus(_ context.Context) (agent.PoolStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var available, assigned, total int
	for _, h := range m.hosts {
		for _, s := range h.slots {
			total++
			if s.status == agent.InstanceStatusUnbound {
				available++
			} else {
				assigned++
			}
		}
	}
	return agent.PoolStatus{
		Available: available,
		Assigned:  assigned,
		Total:     total,
		Max:       total,
		Min:       0,
	}, nil
}

// --- AgentProvisioner 接口实现 ---

// Provision 为用户分配 Agent 实例。
func (m *Manager) Provision(_ context.Context, req agent.ProvisionRequest) (agent.ProvisionResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 已有实例
	if slot := m.findSlotByUserLocked(req.UserID); slot != nil {
		switch slot.status {
		case agent.InstanceStatusActive:
			return agent.ProvisionResult{Instance: m.slotToAgentInstance(slot), Stage: "ready"}, nil
		case agent.InstanceStatusSleeping:
			slot.status = agent.InstanceStatusActive
			return agent.ProvisionResult{Instance: m.slotToAgentInstance(slot), Stage: "waking", EstimatedSec: 1}, nil
		}
	}

	// 找空闲槽位
	slot := m.findFreeSlotLocked()
	if slot == nil {
		return agent.ProvisionResult{}, agent.ErrPoolExhausted
	}

	slot.userID = req.UserID
	slot.workspaceID = req.WorkspaceID
	slot.status = agent.InstanceStatusActive
	slot.instanceID = m.generateInstanceID()
	slot.assignedAt = time.Now()

	return agent.ProvisionResult{
		Instance:     m.slotToAgentInstance(slot),
		Stage:        "creating",
		EstimatedSec: 2,
	}, nil
}

// Sleep 将实例标记为休眠。
func (m *Manager) Sleep(_ context.Context, instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return fmt.Errorf("instance %s not found", instanceID)
	}
	slot.status = agent.InstanceStatusSleeping
	return nil
}

// Wake 将实例从休眠唤醒。
func (m *Manager) Wake(_ context.Context, instanceID string) (agent.AgentInstance, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return agent.AgentInstance{}, fmt.Errorf("instance %s not found", instanceID)
	}
	slot.status = agent.InstanceStatusActive
	return m.slotToAgentInstance(slot), nil
}

// Destroy 删除实例（释放槽位）。
func (m *Manager) Destroy(_ context.Context, instanceID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return fmt.Errorf("instance %s not found", instanceID)
	}
	m.resetSlot(slot)
	return nil
}

// Status 查询实例状态。
func (m *Manager) Status(_ context.Context, instanceID string) (agent.InstanceStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	slot := m.findSlotByInstanceIDLocked(instanceID)
	if slot == nil {
		return "", fmt.Errorf("instance %s not found", instanceID)
	}
	return slot.status, nil
}

// FindByUser 按 workspaceID + userID 查找已有实例。
// workspaceID 为空时仅按 userID 匹配。
func (m *Manager) FindByUser(_ context.Context, workspaceID, userID string) (*agent.AgentInstance, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.userID != userID {
				continue
			}
			if workspaceID != "" && s.workspaceID != "" && s.workspaceID != workspaceID {
				continue
			}
			ai := m.slotToAgentInstance(s)
			return &ai, nil
		}
	}
	return nil, nil
}

// WarmPoolEnsure direct-host 模式下进程由外部启动，此方法为空操作。
func (m *Manager) WarmPoolEnsure(_ context.Context, min int) error {
	return nil
}

// WarmPoolStatus 返回暖池状态（可用槽位数）。
func (m *Manager) WarmPoolStatus(_ context.Context) (agent.WarmPoolStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var available, total int
	for _, h := range m.hosts {
		for _, s := range h.slots {
			total++
			if s.status == agent.InstanceStatusUnbound {
				available++
			}
		}
	}
	return agent.WarmPoolStatus{
		Available: available,
		Total:     total,
		Min:       0,
		Max:       total,
	}, nil
}

// --- 内部方法 ---

func (m *Manager) findSlotByUserLocked(userID string) *slotState {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.userID == userID && s.status != agent.InstanceStatusUnbound {
				return s
			}
		}
	}
	return nil
}

func (m *Manager) findSlotByInstanceIDLocked(instanceID string) *slotState {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.instanceID == instanceID {
				return s
			}
		}
	}
	return nil
}

func (m *Manager) findFreeSlotLocked() *slotState {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s.status == agent.InstanceStatusUnbound {
				return s
			}
		}
	}
	return nil
}

func (m *Manager) resetSlot(s *slotState) {
	s.instanceID = ""
	s.userID = ""
	s.workspaceID = ""
	s.status = agent.InstanceStatusUnbound
	s.assignedAt = time.Time{}
}

func (m *Manager) generateInstanceID() string {
	m.nextID++
	return fmt.Sprintf("direct-host-agent-%d", m.nextID)
}

func (m *Manager) slotToContainerInfo(s *slotState) *agent.ContainerInfo {
	return &agent.ContainerInfo{
		Host:      m.findHostBySlot(s),
		AgentPort: s.agentPort,
		AdminPort: s.adminPort,
		StubPort:  s.stubPort,
		UserID:    s.userID,
	}
}

func (m *Manager) slotToAgentInstance(s *slotState) agent.AgentInstance {
	host := m.findHostBySlot(s)
	return agent.AgentInstance{
		InstanceID: s.instanceID,
		AdminURL:   fmt.Sprintf("http://%s:%d", host, s.adminPort),
		AgentURL:   fmt.Sprintf("http://%s:%d", host, s.agentPort),
		Status:     s.status,
		AssignedAt: s.assignedAt,
	}
}

func (m *Manager) findHostBySlot(target *slotState) string {
	for _, h := range m.hosts {
		for _, s := range h.slots {
			if s == target {
				return h.host
			}
		}
	}
	return ""
}

// PoolAdapter 将 *Manager 适配为 agent.ContainerPool 接口。
// 由于 AgentProvisioner.Status(ctx, instanceID) 和 ContainerPool.Status(ctx)
// 方法名相同但签名不同，Go 不允许同一类型同时实现两者。
// Manager 直接实现 AgentProvisioner，ContainerPool 通过此适配器委托。
type PoolAdapter struct {
	m *Manager
}

// NewPoolAdapter 创建 ContainerPool 适配器。
func NewPoolAdapter(m *Manager) *PoolAdapter {
	return &PoolAdapter{m: m}
}

// Acquire 为用户分配容器（委托给 Manager）。
func (a *PoolAdapter) Acquire(ctx context.Context, userID string) (*agent.ContainerInfo, error) {
	return a.m.Acquire(ctx, userID)
}

// GetByUser 查找用户已分配的容器（委托给 Manager）。
func (a *PoolAdapter) GetByUser(ctx context.Context, userID string) (*agent.ContainerInfo, error) {
	return a.m.GetByUser(ctx, userID)
}

// Release 释放用户的容器（委托给 Manager）。
func (a *PoolAdapter) Release(ctx context.Context, userID string) error {
	return a.m.Release(ctx, userID)
}

// Status 返回池状态（委托给 Manager.PoolStatus）。
func (a *PoolAdapter) Status(ctx context.Context) (agent.PoolStatus, error) {
	return a.m.PoolStatus(ctx)
}
