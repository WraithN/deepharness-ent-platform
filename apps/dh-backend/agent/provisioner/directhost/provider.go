package directhost

import (
	"context"
	"fmt"
	"sync"
	"time"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"golang.org/x/exp/rand"
)

// ProviderName 供给器类型名称。
const ProviderName = "direct-host"

// Provider 本地开发供给器，模拟 Agent 实例生命周期，无 K8s 依赖。
// 使用固定主机列表模拟容器分配，适用于本地开发与测试环境。
type Provider struct {
	mu        sync.Mutex
	instances map[string]*directHostInstance
	warmPool  []*directHostInstance
	adminURL  string
	agentURL  string
	nextID    int
	simDelay  time.Duration
}

type directHostInstance struct {
	instanceID  string
	workspaceID string
	userID      string
	status      agent.InstanceStatus
	adminURL    string
	agentURL    string
	assignedAt  time.Time
}

// Config direct-host 供给器的配置参数。
type Config struct {
	AdminURL      string
	AgentURL      string
	WarmPoolMin   int
	SimulateDelay time.Duration
}

// New 创建 direct-host Provider。
func New(cfg Config) *Provider {
	return &Provider{
		instances: make(map[string]*directHostInstance),
		adminURL:  cfg.AdminURL,
		agentURL:  cfg.AgentURL,
		simDelay:  cfg.SimulateDelay,
	}
}

// Name 返回供给器类型名称。
func (p *Provider) Name() string {
	return ProviderName
}

func (p *Provider) provisionDelay() {
	if p.simDelay > 0 {
		jitter := time.Duration(rand.Int63n(int64(p.simDelay / 2)))
		time.Sleep(p.simDelay + jitter)
	}
}

func (p *Provider) nextInstanceID() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.nextID++
	return fmt.Sprintf("direct-host-agent-%d", p.nextID)
}

// Provision 为用户分配 Agent 实例（休眠唤醒 > 暖池分配 > 新建）。
func (p *Provider) Provision(ctx context.Context, req agent.ProvisionRequest) (agent.ProvisionResult, error) {
	p.mu.Lock()

	if existing := p.findByUserLocked(req.WorkspaceID, req.UserID); existing != nil {
		switch existing.status {
		case agent.InstanceStatusActive:
			p.mu.Unlock()
			return agent.ProvisionResult{Instance: p.toAgentInstance(existing), Stage: "ready"}, nil
		case agent.InstanceStatusSleeping:
			existing.status = agent.InstanceStatusActive
			inst := p.toAgentInstance(existing)
			p.mu.Unlock()
			p.provisionDelay()
			return agent.ProvisionResult{Instance: inst, Stage: "waking", EstimatedSec: 1}, nil
		}
	}

	// 尝试从暖池分配
	var inst *directHostInstance
	if len(p.warmPool) > 0 {
		inst = p.warmPool[len(p.warmPool)-1]
		p.warmPool = p.warmPool[:len(p.warmPool)-1]
		inst.workspaceID = req.WorkspaceID
		inst.userID = req.UserID
		inst.status = agent.InstanceStatusActive
		inst.assignedAt = time.Now()
		p.mu.Unlock()
		p.provisionDelay()
		return agent.ProvisionResult{Instance: p.toAgentInstance(inst), Stage: "assigning", EstimatedSec: 2}, nil
	}

	// 冷启动：新建实例
	id := fmt.Sprintf("direct-host-agent-%d", p.nextID+1)
	inst = &directHostInstance{
		instanceID:  id,
		workspaceID: req.WorkspaceID,
		userID:      req.UserID,
		status:      agent.InstanceStatusActive,
		adminURL:    p.adminURL,
		agentURL:    p.agentURL,
		assignedAt:  time.Now(),
	}
	p.nextID++
	p.instances[id] = inst
	p.mu.Unlock()
	p.provisionDelay()
	return agent.ProvisionResult{
		Instance:     p.toAgentInstance(inst),
		Stage:        "creating",
		EstimatedSec: 3,
	}, nil
}

// Sleep 将实例标记为休眠。
func (p *Provider) Sleep(ctx context.Context, instanceID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	inst, ok := p.instances[instanceID]
	if !ok {
		return fmt.Errorf("instance %s not found", instanceID)
	}
	inst.status = agent.InstanceStatusSleeping
	return nil
}

// Wake 将实例从休眠唤醒。
func (p *Provider) Wake(ctx context.Context, instanceID string) (agent.AgentInstance, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	inst, ok := p.instances[instanceID]
	if !ok {
		return agent.AgentInstance{}, fmt.Errorf("instance %s not found", instanceID)
	}
	inst.status = agent.InstanceStatusActive
	p.provisionDelay()
	return p.toAgentInstance(inst), nil
}

// Destroy 删除实例。
func (p *Provider) Destroy(ctx context.Context, instanceID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.instances, instanceID)
	return nil
}

// Status 查询实例状态。
func (p *Provider) Status(ctx context.Context, instanceID string) (agent.InstanceStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	inst, ok := p.instances[instanceID]
	if !ok {
		return "", fmt.Errorf("instance %s not found", instanceID)
	}
	return inst.status, nil
}

// FindByUser 按 workspaceID + userID 查找已有实例。
func (p *Provider) FindByUser(ctx context.Context, workspaceID, userID string) (*agent.AgentInstance, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	inst := p.findByUserLocked(workspaceID, userID)
	if inst == nil {
		return nil, nil
	}
	ai := p.toAgentInstance(inst)
	return &ai, nil
}

func (p *Provider) findByUserLocked(workspaceID, userID string) *directHostInstance {
	for _, inst := range p.instances {
		if inst.workspaceID == workspaceID && inst.userID == userID {
			return inst
		}
	}
	return nil
}

// WarmPoolEnsure 确保暖池中有至少 min 个可用实例。
func (p *Provider) WarmPoolEnsure(ctx context.Context, min int) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	for len(p.warmPool) < min {
		id := fmt.Sprintf("direct-host-pool-%d", p.nextID+1)
		p.nextID++
		inst := &directHostInstance{
			instanceID: id,
			status:     agent.InstanceStatusUnbound,
			adminURL:   p.adminURL,
			agentURL:   p.agentURL,
		}
		p.warmPool = append(p.warmPool, inst)
	}
	return nil
}

// WarmPoolStatus 返回暖池状态。
func (p *Provider) WarmPoolStatus(ctx context.Context) (agent.WarmPoolStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return agent.WarmPoolStatus{
		Available: len(p.warmPool),
		Total:     len(p.warmPool),
		Min:       0,
		Max:       0,
	}, nil
}

func (p *Provider) toAgentInstance(inst *directHostInstance) agent.AgentInstance {
	return agent.AgentInstance{
		InstanceID: inst.instanceID,
		AdminURL:   inst.adminURL,
		AgentURL:   inst.agentURL,
		Status:     inst.status,
		AssignedAt: inst.assignedAt,
	}
}
