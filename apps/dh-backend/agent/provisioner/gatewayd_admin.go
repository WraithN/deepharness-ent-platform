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
	gatewaydHealthPath  = "/admin/health"
	gatewaydBindPath    = "/admin/bind"
	gatewaydUnbindPath  = "/admin/unbind"
	gatewaydSleepPath   = "/admin/sleep"
	gatewaydWakePath    = "/admin/wake"
	gatewaydHTTPTimeout = 10 * time.Second
)

// HealthResponse gatewayd /admin/health 响应。
type HealthResponse struct {
	Status string `json:"status"`
}

// BindRequest gatewayd /admin/bind 请求体。
type BindRequest struct {
	WorkspaceID   string   `json:"workspaceId"`
	UserID        string   `json:"userId"`
	WorkspacePath string   `json:"workspacePath"`
	Roles         []string `json:"roles"`
	AgentType     string   `json:"agentType"`
}

// GatewaydAdminClient 封装对 gatewayd Admin API（:2346）的 HTTP 调用。
type GatewaydAdminClient struct {
	httpClient *http.Client
}

// NewGatewaydAdminClient 创建新的 admin 客户端。
func NewGatewaydAdminClient() *GatewaydAdminClient {
	return &GatewaydAdminClient{
		httpClient: &http.Client{
			Timeout: gatewaydHTTPTimeout,
		},
	}
}

// Health 检查 gatewayd 实例健康状态。
func (c *GatewaydAdminClient) Health(ctx context.Context, adminURL string) (*HealthResponse, error) {
	url := adminURL + gatewaydHealthPath
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

// Bind 通知 gatewayd 绑定用户上下文。
func (c *GatewaydAdminClient) Bind(ctx context.Context, adminURL string, req BindRequest) error {
	return c.postJSON(ctx, adminURL+gatewaydBindPath, req)
}

// Unbind 通知 gatewayd 解绑用户上下文。
func (c *GatewaydAdminClient) Unbind(ctx context.Context, adminURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, adminURL+gatewaydUnbindPath, nil)
	if err != nil {
		return fmt.Errorf("create unbind request failed: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("unbind request to %s failed: %w", adminURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("unbind returned status %d", resp.StatusCode)
	}
	return nil
}

// Sleep 通知 gatewayd 进入休眠状态。
func (c *GatewaydAdminClient) Sleep(ctx context.Context, adminURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, adminURL+gatewaydSleepPath, nil)
	if err != nil {
		return fmt.Errorf("create sleep request failed: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("sleep request to %s failed: %w", adminURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("sleep returned status %d", resp.StatusCode)
	}
	return nil
}

// Wake 通知 gatewayd 从休眠中唤醒。
func (c *GatewaydAdminClient) Wake(ctx context.Context, adminURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, adminURL+gatewaydWakePath, nil)
	if err != nil {
		return fmt.Errorf("create wake request failed: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("wake request to %s failed: %w", adminURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("wake returned status %d", resp.StatusCode)
	}
	return nil
}

func (c *GatewaydAdminClient) postJSON(ctx context.Context, url string, body interface{}) error {
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
