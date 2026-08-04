package provisioner

import (
	"context"
	"fmt"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner/k8s"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner/mock"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// adminClientAdapter 将 provisioner.GatewaydAdminClient 适配为 k8s.AdminClient 接口，
// 消除 provisioner <-> k8s 包之间的循环依赖。
type adminClientAdapter struct {
	inner *GatewaydAdminClient
}

func (a *adminClientAdapter) Health(ctx context.Context, adminURL string) (*k8s.HealthResponse, error) {
	hr, err := a.inner.Health(ctx, adminURL)
	if err != nil {
		return nil, err
	}
	return &k8s.HealthResponse{Status: hr.Status}, nil
}

func (a *adminClientAdapter) Bind(ctx context.Context, adminURL string, req k8s.BindRequest) error {
	return a.inner.Bind(ctx, adminURL, BindRequest{
		WorkspaceID:   req.WorkspaceID,
		UserID:        req.UserID,
		WorkspacePath: req.WorkspacePath,
		Roles:         req.Roles,
		AgentType:     req.AgentType,
	})
}

func (a *adminClientAdapter) Sleep(ctx context.Context, adminURL string) error {
	return a.inner.Sleep(ctx, adminURL)
}

func (a *adminClientAdapter) Wake(ctx context.Context, adminURL string) error {
	return a.inner.Wake(ctx, adminURL)
}

// NewProvisioner 根据配置创建对应类型的 AgentProvisioner 实现。
func NewProvisioner(cfg config.ProvisionerConfig) (agent.AgentProvisioner, error) {
	switch cfg.Type {
	case config.ProvisionerTypeMock, "":
		adminURL := fmt.Sprintf("http://localhost:%d", cfg.AdminPort)
		agentURL := fmt.Sprintf("http://localhost:%d", cfg.AgentPort)
		return mock.New(mock.Config{
			AdminURL:      adminURL,
			AgentURL:      agentURL,
			WarmPoolMin:   cfg.WarmPoolMin,
			SimulateDelay: 0,
		}), nil

	case config.ProvisionerTypeK8s:
		return k8s.New(cfg, &adminClientAdapter{inner: NewGatewaydAdminClient()})

	default:
		return nil, fmt.Errorf("unknown provisioner type: %s", cfg.Type)
	}
}
