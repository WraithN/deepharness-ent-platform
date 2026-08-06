package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
)

// gatewaydDiscoveryTimeout 是调用 personal-stub health 端点发现 gatewayd 端口的超时时间。
const gatewaydDiscoveryTimeout = 10 * time.Second

// discoverGatewaydPorts 通过 personal-stub health 端点发现 gatewayd 的 agent/admin 端口。
// 1:N 模式下，personal-stub 按需为每个用户启动 gatewayd 实例并分配端口，
// dh-backend 通过此调用发现实际端口并更新 ContainerInfo。
//
// 1:1 模式下，端口由 directhost Manager 预分配并传递给 personal-stub，
// ContainerInfo 中的端口已是正确的，此函数不会修改 ContainerInfo。
//
// 若 personal-stub 不可达或返回错误，保持原有 ContainerInfo 不变（降级处理）。
func discoverGatewaydPorts(ctx context.Context, container *agent.ContainerInfo, userID string) *agent.ContainerInfo {
	if container == nil {
		return container
	}

	// 构建 health 端点 URL，附带 user_id 参数触发 1:N 模式下的懒启动。
	healthURL := fmt.Sprintf("%s/api/v1/container/health?user_id=%s",
		container.PersonalStubURL(), userID)

	httpClient := &http.Client{Timeout: gatewaydDiscoveryTimeout}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return container
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		// personal-stub 不可达，保持原有端口（1:1 模式下端口正确，1:N 模式下降级）。
		return container
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return container
	}

	var healthResp struct {
		AgentPort int    `json:"agentPort"`
		AdminPort int    `json:"adminPort"`
		UserID    string `json:"userId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&healthResp); err != nil {
		return container
	}

	// 仅在 health 响应包含有效端口时更新 ContainerInfo。
	if healthResp.AgentPort > 0 && healthResp.AdminPort > 0 {
		if healthResp.AgentPort != container.AgentPort || healthResp.AdminPort != container.AdminPort {
			log.Printf("[container-pool] discovered gatewayd ports for user=%s: agent=%d admin=%d (was agent=%d admin=%d)",
				userID, healthResp.AgentPort, healthResp.AdminPort, container.AgentPort, container.AdminPort)
		}
		return &agent.ContainerInfo{
			Host:      container.Host,
			AgentPort: healthResp.AgentPort,
			AdminPort: healthResp.AdminPort,
			StubPort:  container.StubPort,
			UserID:    container.UserID,
		}
	}

	return container
}
