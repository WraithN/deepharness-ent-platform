package provisioner

import (
	"context"
	"log"
	"time"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
)

const (
	statusCheckInterval     = 30 * time.Second
	sleepEvictCheckInterval = 5 * time.Minute
)

// Controller Agent 实例后台控制器：暖池维护 + 空闲休眠 + 驱逐检查。
type Controller struct {
	provisioner agent.AgentProvisioner
	config      config.ProvisionerConfig
	stopCh      chan struct{}
}

// NewController 创建后台控制器。
func NewController(provisioner agent.AgentProvisioner, cfg config.ProvisionerConfig) *Controller {
	return &Controller{
		provisioner: provisioner,
		config:      cfg,
		stopCh:      make(chan struct{}),
	}
}

// Start 启动所有后台维护循环。
func (c *Controller) Start(ctx context.Context) {
	c.startWarmPoolLoop(ctx)
	c.startIdleSleepLoop(ctx)
}

// Stop 停止所有后台循环。
func (c *Controller) Stop() {
	close(c.stopCh)
}

func (c *Controller) startWarmPoolLoop(ctx context.Context) {
	if c.config.WarmPoolMin <= 0 {
		return
	}

	safego.Go("warm-pool-ensure", func() {
		ticker := time.NewTicker(statusCheckInterval)
		defer ticker.Stop()

		if err := c.provisioner.WarmPoolEnsure(ctx, c.config.WarmPoolMin); err != nil {
			log.Printf("[ProController] initial warm pool ensure failed: %v", err)
		}

		for {
			select {
			case <-ticker.C:
				if err := c.provisioner.WarmPoolEnsure(ctx, c.config.WarmPoolMin); err != nil {
					log.Printf("[ProController] warm pool ensure failed: %v", err)
				}
			case <-c.stopCh:
				return
			}
		}
	})
}

func (c *Controller) startIdleSleepLoop(ctx context.Context) {
	if c.config.IdleTimeout <= 0 {
		return
	}

	safego.Go("idle-sleep-check", func() {
		ticker := time.NewTicker(statusCheckInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				c.checkAndSleepIdleInstances(ctx)
			case <-c.stopCh:
				return
			}
		}
	})
}

func (c *Controller) checkAndSleepIdleInstances(ctx context.Context) {
	instances, err := c.provisioner.WarmPoolStatus(ctx)
	if err != nil {
		return
	}
	_ = instances
	// Phase 1-B: 空闲检测需要 SessionStore 提供活跃会话列表，暂不实现。
	// TODO: 集成 SessionStore 的 LastActivityAt 查询。
}
