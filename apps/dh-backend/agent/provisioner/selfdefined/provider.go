package selfdefined

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
)

// ProviderName 供给器类型名称。
const ProviderName = "self-defined"

// API 路径常量。
const (
	pathProvision      = "/provision"
	pathSleep          = "/sleep"
	pathWake           = "/wake"
	pathDestroy        = "/destroy"
	pathStatus         = "/status"
	pathFindByUser     = "/find-by-user"
	pathWarmPoolEnsure = "/warm-pool/ensure"
	pathWarmPoolStatus = "/warm-pool/status"
)

// Config self-defined 供给器的配置参数。
type Config struct {
	Endpoint string        // 外部供给器 API 基地址
	Token    string        // Bearer Token 认证
	Timeout  time.Duration // HTTP 调用超时
}

// Provider 通过 HTTP API 对接自定义外部供给器。
// 所有 AgentProvisioner 方法均转换为 HTTP 调用，由外部服务实现具体逻辑。
type Provider struct {
	cfg    Config
	client *http.Client
}

// New 创建 self-defined Provider。
func New(cfg Config) (*Provider, error) {
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("self-defined provisioner requires endpoint")
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &Provider{
		cfg: cfg,
		client: &http.Client{
			Timeout: timeout,
		},
	}, nil
}

// Name 返回供给器类型名称。
func (p *Provider) Name() string {
	return ProviderName
}

// Provision 调用外部供给器为用户分配 Agent 实例。
func (p *Provider) Provision(ctx context.Context, req agent.ProvisionRequest) (agent.ProvisionResult, error) {
	var result agent.ProvisionResult
	if err := p.postJSON(ctx, pathProvision, req, &result); err != nil {
		return agent.ProvisionResult{}, fmt.Errorf("provision failed: %w", err)
	}
	return result, nil
}

// Sleep 调用外部供给器休眠实例。
func (p *Provider) Sleep(ctx context.Context, instanceID string) error {
	params := url.Values{paramInstanceID: {instanceID}}
	return p.postNoBody(ctx, pathSleep, params)
}

// Wake 调用外部供给器唤醒实例。
func (p *Provider) Wake(ctx context.Context, instanceID string) (agent.AgentInstance, error) {
	params := url.Values{paramInstanceID: {instanceID}}
	var inst agent.AgentInstance
	if err := p.postWithParams(ctx, pathWake, params, &inst); err != nil {
		return agent.AgentInstance{}, fmt.Errorf("wake failed: %w", err)
	}
	return inst, nil
}

// Destroy 调用外部供给器销毁实例。
func (p *Provider) Destroy(ctx context.Context, instanceID string) error {
	params := url.Values{paramInstanceID: {instanceID}}
	return p.deleteWithParams(ctx, pathDestroy, params)
}

// Status 调用外部供给器查询实例状态。
func (p *Provider) Status(ctx context.Context, instanceID string) (agent.InstanceStatus, error) {
	params := url.Values{paramInstanceID: {instanceID}}
	var resp struct {
		Status agent.InstanceStatus `json:"status"`
	}
	if err := p.getWithParams(ctx, pathStatus, params, &resp); err != nil {
		return "", fmt.Errorf("status failed: %w", err)
	}
	return resp.Status, nil
}

// FindByUser 调用外部供给器按用户查找实例。
func (p *Provider) FindByUser(ctx context.Context, workspaceID, userID string) (*agent.AgentInstance, error) {
	params := url.Values{
		paramWorkspaceID: {workspaceID},
		paramUserID:      {userID},
	}
	var inst agent.AgentInstance
	if err := p.getWithParams(ctx, pathFindByUser, params, &inst); err != nil {
		return nil, fmt.Errorf("find-by-user failed: %w", err)
	}
	if inst.InstanceID == "" {
		return nil, nil
	}
	return &inst, nil
}

// WarmPoolEnsure 调用外部供给器确保暖池最低数量。
func (p *Provider) WarmPoolEnsure(ctx context.Context, min int) error {
	params := url.Values{paramMin: {fmt.Sprintf("%d", min)}}
	return p.postNoBody(ctx, pathWarmPoolEnsure, params)
}

// WarmPoolStatus 调用外部供给器查询暖池状态。
func (p *Provider) WarmPoolStatus(ctx context.Context) (agent.WarmPoolStatus, error) {
	var status agent.WarmPoolStatus
	if err := p.getWithParams(ctx, pathWarmPoolStatus, nil, &status); err != nil {
		return agent.WarmPoolStatus{}, fmt.Errorf("warm-pool-status failed: %w", err)
	}
	return status, nil
}

// --- 内部 HTTP 工具方法 ---

// 请求参数 key 常量。
const (
	paramInstanceID  = "instanceId"
	paramWorkspaceID = "workspaceId"
	paramUserID      = "userId"
	paramMin         = "min"
)

func (p *Provider) newRequest(ctx context.Context, method, path string, params url.Values, body io.Reader) (*http.Request, error) {
	u := p.cfg.Endpoint + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return nil, err
	}
	if p.cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+p.cfg.Token)
	}
	return req, nil
}

func (p *Provider) postJSON(ctx context.Context, path string, body interface{}, out interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body failed: %w", err)
	}
	req, err := p.newRequest(ctx, http.MethodPost, path, nil, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return p.doRequest(req, out)
}

func (p *Provider) postWithParams(ctx context.Context, path string, params url.Values, out interface{}) error {
	req, err := p.newRequest(ctx, http.MethodPost, path, params, nil)
	if err != nil {
		return err
	}
	return p.doRequest(req, out)
}

func (p *Provider) postNoBody(ctx context.Context, path string, params url.Values) error {
	return p.postWithParams(ctx, path, params, nil)
}

func (p *Provider) getWithParams(ctx context.Context, path string, params url.Values, out interface{}) error {
	req, err := p.newRequest(ctx, http.MethodGet, path, params, nil)
	if err != nil {
		return err
	}
	return p.doRequest(req, out)
}

func (p *Provider) deleteWithParams(ctx context.Context, path string, params url.Values) error {
	req, err := p.newRequest(ctx, http.MethodDelete, path, params, nil)
	if err != nil {
		return err
	}
	return p.doRequest(req, nil)
}

func (p *Provider) doRequest(req *http.Request, out interface{}) error {
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("request to %s failed: %w", req.URL.String(), err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("request to %s returned status %d: %s", req.URL.String(), resp.StatusCode, string(bodyBytes))
	}

	if out == nil {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode response from %s failed: %w", req.URL.String(), err)
	}
	return nil
}
