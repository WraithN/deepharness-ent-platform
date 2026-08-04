package provisioner

import (
	"context"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// MockContainerPool 基于 configured 固定 IP 列表的容器池。
// 用于本地开发/测试环境，无需 K8s。
// 每个 host 代表一个容器实例，包含 gatewayd + personal-stub。
type MockContainerPool struct {
	mu        sync.Mutex
	hosts     []string          // configured 固定 IP 列表
	assigned  map[string]int    // userID -> hosts 索引
	available []int             // 可用 hosts 索引
	ports     mockPorts         // 端口配置
	max       int
	min       int
}

type mockPorts struct {
	agentPort int
	adminPort int
	stubPort  int
}

// NewMockContainerPool 根据 provisioner config 创建 mock 容器池。
func NewMockContainerPool(cfg config.ProvisionerConfig) *MockContainerPool {
	hosts := cfg.MockHosts
	if len(hosts) == 0 {
		// 本地开发默认 localhost
		hosts = []string{"127.0.0.1"}
	}

	max := cfg.WarmPoolMax
	if max <= 0 || max > len(hosts) {
		max = len(hosts)
	}

	min := cfg.WarmPoolMin
	if min > len(hosts) {
		min = len(hosts)
	}

	pool := &MockContainerPool{
		hosts:    hosts,
		assigned: make(map[string]int),
		ports: mockPorts{
			agentPort: cfg.AgentPort,
			adminPort: cfg.AdminPort,
			stubPort:  cfg.StubPort,
		},
		max: max,
		min: min,
	}

	// 所有 host 初始都在可用池中
	for i := range hosts {
		pool.available = append(pool.available, i)
	}

	return pool
}

// Acquire 为用户分配容器。
// 已分配 -> 直接返回；未分配 -> 从可用池取；池空 -> ErrPoolExhausted。
func (p *MockContainerPool) Acquire(_ context.Context, userID string) (*ContainerInfo, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// 已有分配
	if idx, ok := p.assigned[userID]; ok {
		return p.containerAt(idx, userID), nil
	}

	// 从可用池取
	if len(p.available) == 0 {
		return nil, ErrPoolExhausted
	}

	idx := p.available[0]
	p.available = p.available[1:]
	p.assigned[userID] = idx
	return p.containerAt(idx, userID), nil
}

// GetByUser 查找用户已分配的容器。
func (p *MockContainerPool) GetByUser(_ context.Context, userID string) (*ContainerInfo, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	idx, ok := p.assigned[userID]
	if !ok {
		return nil, nil
	}
	return p.containerAt(idx, userID), nil
}

// Release 释放用户的容器回池。
func (p *MockContainerPool) Release(_ context.Context, userID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	idx, ok := p.assigned[userID]
	if !ok {
		return nil
	}
	delete(p.assigned, userID)
	p.available = append(p.available, idx)
	return nil
}

// Status 返回池状态。
func (p *MockContainerPool) Status(_ context.Context) (PoolStatus, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return PoolStatus{
		Available: len(p.available),
		Assigned:  len(p.assigned),
		Total:     len(p.hosts),
		Max:       p.max,
		Min:       p.min,
	}, nil
}

func (p *MockContainerPool) containerAt(idx int, userID string) *ContainerInfo {
	return &ContainerInfo{
		Host:      p.hosts[idx],
		AgentPort: p.ports.agentPort,
		AdminPort: p.ports.adminPort,
		StubPort:  p.ports.stubPort,
		UserID:    userID,
	}
}
