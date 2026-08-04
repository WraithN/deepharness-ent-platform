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

// clientContextKey 是 context 中 per-user stubclient 的键类型。
type clientContextKey struct{}

// WithClient 将 stubclient 注入 context，供下游 service 层通过 FromContext 取用。
func WithClient(ctx context.Context, c *Client) context.Context {
	return context.WithValue(ctx, clientContextKey{}, c)
}

// FromContext 从 context 中取出 per-user stubclient。
// 若 context 中无客户端（非 HTTP 请求路径，如后台任务），降级到 Default()。
// 这是 stubclient.Default() 的上下文感知替代：
// 所有 service 层调用应使用 stubclient.FromContext(ctx) 替代 stubclient.Default()。
func FromContext(ctx context.Context) *Client {
	if c, ok := ctx.Value(clientContextKey{}).(*Client); ok && c != nil {
		return c
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

// WalkEntry 是 WalkDir 返回的单个条目。
type WalkEntry struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// WalkDir 通过 personal-stub 递归遍历目录，返回所有文件/子目录的扁平列表。
// 等价于 GET /api/v1/files/walk?path=...
func (c *Client) WalkDir(ctx context.Context, path string) ([]WalkEntry, error) {
	u := fmt.Sprintf("/api/v1/files/walk?path=%s", url.QueryEscape(path))
	resp, err := c.do(ctx, http.MethodGet, u)
	if err != nil {
		return nil, fmt.Errorf("stubclient WalkDir: %w", err)
	}
	if err := checkResponseError(resp); err != nil {
		return nil, err
	}
	var result struct {
		Entries []WalkEntry `json:"entries"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return nil, fmt.Errorf("stubclient WalkDir: decode response: %w", err)
	}
	return result.Entries, nil
}

// Glob 通过 personal-stub 执行 glob 模式匹配。
// 等价于 GET /api/v1/files/glob?pattern=...
func (c *Client) Glob(ctx context.Context, pattern string) ([]string, error) {
	u := fmt.Sprintf("/api/v1/files/glob?pattern=%s", url.QueryEscape(pattern))
	resp, err := c.do(ctx, http.MethodGet, u)
	if err != nil {
		return nil, fmt.Errorf("stubclient Glob: %w", err)
	}
	if err := checkResponseError(resp); err != nil {
		return nil, err
	}
	var result struct {
		Matches []string `json:"matches"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return nil, fmt.Errorf("stubclient Glob: decode response: %w", err)
	}
	return result.Matches, nil
}

// FileInfoResult 是 FileInfo 的返回结果。
type FileInfoResult struct {
	Exists   bool   `json:"exists"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	ModTime  string `json:"modTime"`
	BaseName string `json:"baseName"`
}

// FileInfo 通过 personal-stub 获取文件/目录详细信息。
// 等价于 GET /api/v1/files/info?path=...
func (c *Client) FileInfo(ctx context.Context, path string) (*FileInfoResult, error) {
	u := fmt.Sprintf("/api/v1/files/info?path=%s", url.QueryEscape(path))
	resp, err := c.do(ctx, http.MethodGet, u)
	if err != nil {
		return nil, fmt.Errorf("stubclient FileInfo: %w", err)
	}
	if err := checkResponseError(resp); err != nil {
		return nil, err
	}
	var result FileInfoResult
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return nil, fmt.Errorf("stubclient FileInfo: decode response: %w", err)
	}
	return &result, nil
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

// NpmInstallResult 是 npm install 的返回结果。
type NpmInstallResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
}

// NpmInstall 通过 personal-stub 在指定目录执行 npm install。
// 等价于 POST /api/v1/projects/npm-install  body: {"path": "..."}
// 架构合规：dh-backend 不直接 exec npm，委托 personal-stub 执行。
func (c *Client) NpmInstall(ctx context.Context, dir string) (*NpmInstallResult, error) {
	body, _ := json.Marshal(map[string]string{"path": dir})
	resp, err := c.doWithBody(ctx, http.MethodPost, "/api/v1/projects/npm-install", body)
	if err != nil {
		return nil, fmt.Errorf("stubclient NpmInstall: %w", err)
	}
	var result NpmInstallResult
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return nil, fmt.Errorf("stubclient NpmInstall: decode response: %w", err)
	}
	if !result.Success {
		return &result, fmt.Errorf("npm install failed: %s", result.Output)
	}
	return &result, nil
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
