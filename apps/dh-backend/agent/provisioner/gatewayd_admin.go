package provisioner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	containerHealthPath  = "/api/v1/container/health"
	containerBindPath    = "/api/v1/container/bind"
	containerUnbindPath  = "/api/v1/container/unbind"
	containerSleepPath   = "/api/v1/container/sleep"
	containerWakePath    = "/api/v1/container/wake"
	containerHTTPTimeout = 10 * time.Second
)

// HealthResponse personal-stub /api/v1/container/health 响应。
type HealthResponse struct {
	Status string `json:"status"`
}

// BindRequest personal-stub /api/v1/container/bind 请求体。
type BindRequest struct {
	WorkspaceID   string   `json:"workspaceId"`
	UserID        string   `json:"userId"`
	WorkspacePath string   `json:"workspacePath"`
	Roles         []string `json:"roles"`
	AgentType     string   `json:"agentType"`
}

// ContainerAdminClient 封装对 personal-stub 容器管理 API（:8090）的 HTTP 调用。
// personal-stub 内部代理到同容器 gatewayd admin API。
type ContainerAdminClient struct {
	httpClient *http.Client
}

// NewContainerAdminClient 创建新的容器管理客户端。
func NewContainerAdminClient() *ContainerAdminClient {
	return &ContainerAdminClient{
		httpClient: &http.Client{
			Timeout: containerHTTPTimeout,
		},
	}
}

// Health 检查容器健康状态（personal-stub + gatewayd 组合状态）。
func (c *ContainerAdminClient) Health(ctx context.Context, containerURL string) (*HealthResponse, error) {
	url := containerURL + containerHealthPath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create health request failed: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("health request to %s failed: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("health request to %s returned status %d", url, resp.StatusCode)
	}

	var hr HealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&hr); err != nil {
		return nil, fmt.Errorf("decode health response failed: %w", err)
	}
	return &hr, nil
}

// Bind 通知容器绑定用户上下文。
func (c *ContainerAdminClient) Bind(ctx context.Context, containerURL string, req BindRequest) error {
	return c.postJSON(ctx, containerURL+containerBindPath, req)
}

// Unbind 通知容器解绑用户上下文。
func (c *ContainerAdminClient) Unbind(ctx context.Context, containerURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, containerURL+containerUnbindPath, nil)
	if err != nil {
		return fmt.Errorf("create unbind request failed: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("unbind request to %s failed: %w", containerURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("unbind returned status %d", resp.StatusCode)
	}
	return nil
}

// Sleep 通知容器进入休眠状态。
func (c *ContainerAdminClient) Sleep(ctx context.Context, containerURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, containerURL+containerSleepPath, nil)
	if err != nil {
		return fmt.Errorf("create sleep request failed: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("sleep request to %s failed: %w", containerURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("sleep returned status %d", resp.StatusCode)
	}
	return nil
}

// Wake 通知容器从休眠中唤醒。
func (c *ContainerAdminClient) Wake(ctx context.Context, containerURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, containerURL+containerWakePath, nil)
	if err != nil {
		return fmt.Errorf("create wake request failed: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("wake request to %s failed: %w", containerURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("wake returned status %d", resp.StatusCode)
	}
	return nil
}

func (c *ContainerAdminClient) postJSON(ctx context.Context, url string, body interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body failed: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request to %s failed: %w", url, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request to %s failed: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("request to %s returned status %d: %s", url, resp.StatusCode, string(bodyBytes))
	}
	return nil
}
