package provisioner

import (
	"context"
	"fmt"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner/directhost"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner/k8s"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner/selfdefined"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// adminClientAdapter 将 provisioner.ContainerAdminClient 适配为 k8s.AdminClient 接口，
// 消除 provisioner <-> k8s 包之间的循环依赖。
// 管理面调用通过 personal-stub 代理到 gatewayd。
type adminClientAdapter struct {
	inner *ContainerAdminClient
}

func (a *adminClientAdapter) Health(ctx context.Context, containerURL string) (*k8s.HealthResponse, error) {
	hr, err := a.inner.Health(ctx, containerURL)
	if err != nil {
		return nil, err
	}
	return &k8s.HealthResponse{Status: hr.Status}, nil
}

func (a *adminClientAdapter) Bind(ctx context.Context, containerURL string, req k8s.BindRequest) error {
	return a.inner.Bind(ctx, containerURL, BindRequest{
		WorkspaceID:   req.WorkspaceID,
		UserID:        req.UserID,
		WorkspacePath: req.WorkspacePath,
		Roles:         req.Roles,
		AgentType:     req.AgentType,
	})
}

func (a *adminClientAdapter) Sleep(ctx context.Context, containerURL string) error {
	return a.inner.Sleep(ctx, containerURL)
}

func (a *adminClientAdapter) Wake(ctx context.Context, containerURL string) error {
	return a.inner.Wake(ctx, containerURL)
}

// NewProvisioner 根据配置创建对应类型的 AgentProvisioner 实现。
// 支持三种供给器类型：direct-host（本地开发）、k8s（Kubernetes 原生）、self-defined（HTTP API 对接自定义）。
// 对于 direct-host 模式，返回的 *directhost.Manager 实现 AgentProvisioner；
// NewContainerPool 通过 PoolAdapter 复用同一 Manager 实例实现 ContainerPool。
func NewProvisioner(cfg config.ProvisionerConfig) (agent.AgentProvisioner, error) {
	switch cfg.Type {
	case config.ProvisionerTypeDirectHost, "":
		return directhost.NewManagerFromConfig(cfg.DirectHost), nil

	case config.ProvisionerTypeK8s:
		return k8s.New(cfg, &adminClientAdapter{inner: NewContainerAdminClient()})

	case config.ProvisionerTypeSelfDefined:
		return selfdefined.New(selfdefined.Config{
			Endpoint: cfg.SelfDefined.Endpoint,
			Token:    cfg.SelfDefined.Token,
			Timeout:  cfg.SelfDefined.Timeout,
		})

	default:
		return nil, fmt.Errorf("unknown provisioner type: %s", cfg.Type)
	}
}

// NewContainerPool 根据配置创建对应类型的 ContainerPool。
// direct-host 模式通过 PoolAdapter 复用 NewProvisioner 返回的 *directhost.Manager（同一实例）；
// k8s 和 self-defined 模式通过 AgentProvisioner 委托管理。
func NewContainerPool(cfg config.ProvisionerConfig, prov agent.AgentProvisioner) (agent.ContainerPool, error) {
	switch cfg.Type {
	case config.ProvisionerTypeDirectHost, "":
		m, ok := prov.(*directhost.Manager)
		if !ok {
			return nil, fmt.Errorf("direct-host provisioner is not *directhost.Manager: %T", prov)
		}
		return directhost.NewPoolAdapter(m), nil

	case config.ProvisionerTypeK8s:
		return NewAgentContainerPool(prov, cfg.K8s.StubPort), nil

	case config.ProvisionerTypeSelfDefined:
		return NewAgentContainerPool(prov, cfg.SelfDefined.StubPort), nil

	default:
		return nil, fmt.Errorf("unknown provisioner type: %s", cfg.Type)
	}
}
