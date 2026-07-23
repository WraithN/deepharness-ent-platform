// Package stubclient 提供 dh-backend 调用 personal-stub 的 HTTP 客户端。
// 架构合规：dh-backend 通过此客户端委托 personal-stub 执行文件读写和 git 操作，
// 不直接操作共享目录文件系统，不直接 exec git/npm 命令。
package stubclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client 是 personal-stub 的 HTTP 客户端。
type Client struct {
	baseURL string
	http    *http.Client
}

// stubRequestTimeout 是调用 personal-stub 的默认超时时间。
const stubRequestTimeout = 30 * time.Second

// stubCloneTimeout 是 clone 操作的超时时间（clone 可能耗时较长）。
const stubCloneTimeout = 5 * time.Minute

// New 创建 personal-stub 客户端。
func New(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http: &http.Client{
			Timeout: stubRequestTimeout,
		},
	}
}

// defaultClient 是全局默认客户端，由 server.go 初始化时通过 SetDefault 注入。
var defaultClient *Client

// SetDefault 设置全局默认 personal-stub 客户端。
// 在 server.go 初始化阶段调用，供各 domain service 使用。
func SetDefault(c *Client) {
	defaultClient = c
}

// Default 返回全局默认 personal-stub 客户端。
// 若未初始化则返回 nil，调用方应判空（开发环境可能未配置 personal-stub）。
func Default() *Client {
	return defaultClient
}

// DefaultOrPanic 返回全局默认客户端，未初始化时 panic。
// 仅供确定已初始化的场景使用。
func DefaultOrPanic() *Client {
	if defaultClient == nil {
		panic("stubclient: default client not initialized, call SetDefault first")
	}
	return defaultClient
}

// WriteFile 通过 personal-stub 写入文件内容。
// 等价于 PUT /api/v1/files/content  body: {"path": "...", "content": "..."}
func (c *Client) WriteFile(ctx context.Context, path, content string) error {
	body, _ := json.Marshal(map[string]string{"path": path, "content": content})
	resp, err := c.doWithBody(ctx, http.MethodPut, "/api/v1/files/content", body)
	if err != nil {
		return fmt.Errorf("stubclient WriteFile: %w", err)
	}
	return checkResponseError(resp)
}

// ReadFile 通过 personal-stub 读取文件内容。
// 等价于 GET /api/v1/files/content?path=...
func (c *Client) ReadFile(ctx context.Context, path string) (string, error) {
	u := fmt.Sprintf("/api/v1/files/content?path=%s", url.QueryEscape(path))
	resp, err := c.do(ctx, http.MethodGet, u)
	if err != nil {
		return "", fmt.Errorf("stubclient ReadFile: %w", err)
	}
	if err := checkResponseError(resp); err != nil {
		return "", err
	}
	var result struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return "", fmt.Errorf("stubclient ReadFile: decode response: %w", err)
	}
	return result.Content, nil
}

// DeleteFile 通过 personal-stub 删除文件。
// 等价于 DELETE /api/v1/files/content?path=...
func (c *Client) DeleteFile(ctx context.Context, path string) error {
	u := fmt.Sprintf("/api/v1/files/content?path=%s", url.QueryEscape(path))
	resp, err := c.do(ctx, http.MethodDelete, u)
	if err != nil {
		return fmt.Errorf("stubclient DeleteFile: %w", err)
	}
	return checkResponseError(resp)
}

// MkdirAll 通过 personal-stub 递归创建目录。
// 等价于 POST /api/v1/files/mkdir  body: {"path": "..."}
func (c *Client) MkdirAll(ctx context.Context, path string) error {
	body, _ := json.Marshal(map[string]string{"path": path})
	resp, err := c.doWithBody(ctx, http.MethodPost, "/api/v1/files/mkdir", body)
	if err != nil {
		return fmt.Errorf("stubclient MkdirAll: %w", err)
	}
	return checkResponseError(resp)
}

// RemoveDir 通过 personal-stub 递归删除目录。
// 等价于 DELETE /api/v1/files/dir?path=...
func (c *Client) RemoveDir(ctx context.Context, path string) error {
	u := fmt.Sprintf("/api/v1/files/dir?path=%s", url.QueryEscape(path))
	resp, err := c.do(ctx, http.MethodDelete, u)
	if err != nil {
		return fmt.Errorf("stubclient RemoveDir: %w", err)
	}
	return checkResponseError(resp)
}

// DirEntry 是目录条目。
type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// ListDir 通过 personal-stub 列出目录条目。
// 等价于 GET /api/v1/files/list?path=...
func (c *Client) ListDir(ctx context.Context, path string) ([]DirEntry, error) {
	u := fmt.Sprintf("/api/v1/files/list?path=%s", url.QueryEscape(path))
	resp, err := c.do(ctx, http.MethodGet, u)
	if err != nil {
		return nil, fmt.Errorf("stubclient ListDir: %w", err)
	}
	if err := checkResponseError(resp); err != nil {
		return nil, err
	}
	var result struct {
		Entries []DirEntry `json:"entries"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return nil, fmt.Errorf("stubclient ListDir: decode response: %w", err)
	}
	return result.Entries, nil
}

// FileExists 通过 personal-stub 检查文件是否存在。
// 等价于 GET /api/v1/files/exists?path=...
func (c *Client) FileExists(ctx context.Context, path string) (bool, error) {
	u := fmt.Sprintf("/api/v1/files/exists?path=%s", url.QueryEscape(path))
	resp, err := c.do(ctx, http.MethodGet, u)
	if err != nil {
		return false, fmt.Errorf("stubclient FileExists: %w", err)
	}
	if err := checkResponseError(resp); err != nil {
		return false, err
	}
	var result struct {
		Exists bool `json:"exists"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return false, fmt.Errorf("stubclient FileExists: decode response: %w", err)
	}
	return result.Exists, nil
}

// GitExecResult 是 git 命令执行结果。
type GitExecResult struct {
	Output string
	Err    error
}

// GitExec 通过 personal-stub 在指定目录执行 git 命令。
// 等价于 POST /api/v1/projects/git-exec  body: {"path": "...", "args": [...]}
// 当 git 命令执行失败（非 HTTP 错误）时，返回 GitExecResult.Err。
func (c *Client) GitExec(ctx context.Context, dir string, args ...string) (string, error) {
	body, _ := json.Marshal(map[string]any{"path": dir, "args": args})
	resp, err := c.doWithBody(ctx, http.MethodPost, "/api/v1/projects/git-exec", body)
	if err != nil {
		return "", fmt.Errorf("stubclient GitExec: %w", err)
	}
	if err := checkResponseError(resp); err != nil {
		return "", err
	}
	var result struct {
		Output string `json:"output"`
		Error  string `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return "", fmt.Errorf("stubclient GitExec: decode response: %w", err)
	}
	if result.Error != "" {
		return result.Output, fmt.Errorf("git %s: %s", strings.Join(args, " "), result.Error)
	}
	return result.Output, nil
}

// CloneRequest 是 git clone 请求参数。
type CloneRequest struct {
	URL    string `json:"url"`
	Path   string `json:"path"`
	SSHKey string `json:"sshKey,omitempty"`
	Branch string `json:"branch,omitempty"`
}

// Clone 通过 personal-stub 克隆远程仓库。
// 等价于 POST /api/v1/projects/clone
func (c *Client) Clone(ctx context.Context, req CloneRequest) error {
	body, _ := json.Marshal(req)
	// clone 可能耗时较长，使用独立 HTTP client
	client := &http.Client{Timeout: stubCloneTimeout}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/projects/clone", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("stubclient Clone: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("stubclient Clone: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("stubclient Clone: HTTP %d: %s", resp.StatusCode, string(raw))
	}
	var result struct {
		Error string `json:"error,omitempty"`
	}
	_ = json.Unmarshal(raw, &result)
	if result.Error != "" {
		return fmt.Errorf("git clone: %s", result.Error)
	}
	return nil
}

// stubResponse 是 personal-stub 的原始 HTTP 响应。
type stubResponse struct {
	StatusCode int
	Body       []byte
}

// do 发送不带 body 的 HTTP 请求。
func (c *Client) do(ctx context.Context, method, path string) (*stubResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return &stubResponse{StatusCode: resp.StatusCode, Body: body}, nil
}

// doWithBody 发送带 body 的 HTTP 请求。
func (c *Client) doWithBody(ctx context.Context, method, path string, body []byte) (*stubResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return &stubResponse{StatusCode: resp.StatusCode, Body: raw}, nil
}

// checkResponseError 检查 HTTP 响应状态码，非 2xx 时返回错误。
func checkResponseError(resp *stubResponse) error {
	if resp.StatusCode >= 400 {
		var errResp struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(resp.Body, &errResp)
		msg := errResp.Error
		if msg == "" {
			msg = errResp.Message
		}
		if msg == "" {
			msg = string(resp.Body)
		}
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, msg)
	}
	return nil
}
