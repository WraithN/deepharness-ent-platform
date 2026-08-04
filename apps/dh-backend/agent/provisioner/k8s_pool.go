package provisioner

import (
	"context"
	"fmt"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// K8sContainerPool 基于 K8s AgentProvisioner 的容器池实现。
// 将 AgentProvisioner 接口适配为 ContainerPool 接口。
type K8sContainerPool struct {
	provisioner agent.AgentProvisioner
	cfg         config.ProvisionerConfig
}

// NewK8sContainerPool 创建 K8s 容器池。
// prov 是已初始化的 AgentProvisioner（K8s 模式）。
func NewK8sContainerPool(cfg config.ProvisionerConfig, prov agent.AgentProvisioner) (*K8sContainerPool, error) {
	if prov == nil {
		return nil, fmt.Errorf("provisioner is nil")
	}
	return &K8sContainerPool{
		provisioner: prov,
		cfg:         cfg,
	}, nil
}

// Acquire 为用户分配容器（委托给 AgentProvisioner.Provision）。
func (p *K8sContainerPool) Acquire(ctx context.Context, userID string) (*ContainerInfo, error) {
	result, err := p.provisioner.Provision(ctx, agent.ProvisionRequest{
		UserID: userID,
	})
	if err != nil {
		return nil, err
	}
	return &ContainerInfo{
		Host:      extractHostFromURL(result.Instance.AdminURL),
		AgentPort: p.cfg.AgentPort,
		AdminPort: p.cfg.AdminPort,
		StubPort:  p.cfg.StubPort,
		UserID:    userID,
	}, nil
}

// GetByUser 查找用户已分配的容器。
func (p *K8sContainerPool) GetByUser(ctx context.Context, userID string) (*ContainerInfo, error) {
	inst, err := p.provisioner.FindByUser(ctx, "", userID)
	if err != nil || inst == nil {
		return nil, err
	}
	return &ContainerInfo{
		Host:      extractHostFromURL(inst.AdminURL),
		AgentPort: p.cfg.AgentPort,
		AdminPort: p.cfg.AdminPort,
		StubPort:  p.cfg.StubPort,
		UserID:    userID,
	}, nil
}

// Release 释放用户的容器（委托给 AgentProvisioner.Sleep）。
func (p *K8sContainerPool) Release(ctx context.Context, userID string) error {
	inst, err := p.provisioner.FindByUser(ctx, "", userID)
	if err != nil || inst == nil {
		return nil
	}
	return p.provisioner.Sleep(ctx, inst.InstanceID)
}

// Status 返回池状态。
func (p *K8sContainerPool) Status(ctx context.Context) (PoolStatus, error) {
	wps, err := p.provisioner.WarmPoolStatus(ctx)
	if err != nil {
		return PoolStatus{}, err
	}
	return PoolStatus{
		Available: wps.Available,
		Total:     wps.Total,
		Max:       wps.Max,
		Min:       wps.Min,
	}, nil
}

// extractHostFromURL 从 "http://host:port" 中提取 host。
func extractHostFromURL(rawURL string) string {
	// 去掉 "http://" 前缀
	if len(rawURL) > 7 && rawURL[:7] == "http://" {
		rawURL = rawURL[7:]
	}
	// 去掉端口部分
	for i := 0; i < len(rawURL); i++ {
		if rawURL[i] == ':' {
			return rawURL[:i]
		}
	}
	return rawURL
}
