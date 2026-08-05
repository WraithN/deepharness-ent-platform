package provisioner

import (
	"context"
	"strconv"
	"strings"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
)

// agentProvisionerPool 将任意 AgentProvisioner 适配为 ContainerPool 接口。
// 用于 k8s 和 self-defined 模式：容器分配/释放完全委托给 AgentProvisioner，
// 从 AgentInstance 返回的 URL 中提取 host 与端口信息。
type agentProvisionerPool struct {
	prov     agent.AgentProvisioner
	stubPort int
}

// NewAgentContainerPool 创建基于 AgentProvisioner 的通用容器池。
// stubPort 为 personal-stub 端口（与 gatewayd 共部署于同一容器/Pod）。
func NewAgentContainerPool(prov agent.AgentProvisioner, stubPort int) agent.ContainerPool {
	return &agentProvisionerPool{
		prov:     prov,
		stubPort: stubPort,
	}
}

// Acquire 为用户分配容器（委托给 AgentProvisioner.Provision）。
func (p *agentProvisionerPool) Acquire(ctx context.Context, userID string) (*agent.ContainerInfo, error) {
	result, err := p.prov.Provision(ctx, agent.ProvisionRequest{
		UserID: userID,
	})
	if err != nil {
		return nil, err
	}
	return p.toContainerInfo(&result.Instance, userID), nil
}

// GetByUser 查找用户已分配的容器。
func (p *agentProvisionerPool) GetByUser(ctx context.Context, userID string) (*agent.ContainerInfo, error) {
	inst, err := p.prov.FindByUser(ctx, "", userID)
	if err != nil || inst == nil {
		return nil, err
	}
	return p.toContainerInfo(inst, userID), nil
}

// Release 释放用户的容器（委托给 AgentProvisioner.Sleep）。
func (p *agentProvisionerPool) Release(ctx context.Context, userID string) error {
	inst, err := p.prov.FindByUser(ctx, "", userID)
	if err != nil || inst == nil {
		return nil
	}
	return p.prov.Sleep(ctx, inst.InstanceID)
}

// Status 返回池状态。
func (p *agentProvisionerPool) Status(ctx context.Context) (agent.PoolStatus, error) {
	wps, err := p.prov.WarmPoolStatus(ctx)
	if err != nil {
		return agent.PoolStatus{}, err
	}
	return agent.PoolStatus{
		Available: wps.Available,
		Total:     wps.Total,
		Max:       wps.Max,
		Min:       wps.Min,
	}, nil
}

// toContainerInfo 从 AgentInstance 提取 ContainerInfo。
// host 和端口从 AdminURL / AgentURL 中解析。
func (p *agentProvisionerPool) toContainerInfo(inst *agent.AgentInstance, userID string) *agent.ContainerInfo {
	host, adminPort := extractHostAndPort(inst.AdminURL)
	_, agentPort := extractHostAndPort(inst.AgentURL)
	return &agent.ContainerInfo{
		Host:      host,
		AgentPort: agentPort,
		AdminPort: adminPort,
		StubPort:  p.stubPort,
		UserID:    userID,
	}
}

// extractHostAndPort 从 "http://host:port" 或 "host:port" 中提取 host 和 port。
func extractHostAndPort(rawURL string) (string, int) {
	// 去掉 "http://" 或 "https://" 前缀
	for _, scheme := range []string{"http://", "https://"} {
		if strings.HasPrefix(rawURL, scheme) {
			rawURL = rawURL[len(scheme):]
			break
		}
	}
	// 分离 host 和 port
	colonIdx := strings.LastIndex(rawURL, ":")
	if colonIdx < 0 {
		return rawURL, 0
	}
	host := rawURL[:colonIdx]
	port, err := strconv.Atoi(rawURL[colonIdx+1:])
	if err != nil {
		return host, 0
	}
	return host, port
}
