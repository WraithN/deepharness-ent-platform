// Package service - token_manager.go 实现飞书 tenant_access_token 的线程安全管理。
//
// FeishuTokenManager 封装了 token 的获取、缓存与自动刷新逻辑，
// 供 FeishuReplier / FeishuCardKitManager / GroupHistoryFetcher 共享，
// 避免各自维护 token 状态时因读取未持锁而导致的数据竞争。
//
// 使用方式：
//
//	tm := NewFeishuTokenManager(appID, appSecret, apiBaseURL)
//	token, err := tm.GetToken(ctx) // 线程安全，token 未过期时直接返回缓存
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// tokenRefreshLeadTime 是 token 过期前的提前刷新时间，避免边界过期。
// 飞书 token 有效期约 2 小时，提前 5 分钟刷新留出安全余量。
const tokenRefreshLeadTime = 5 * time.Minute

// tokenHTTPTimeout 是刷新 tenant_access_token 的单次请求超时。
const tokenHTTPTimeout = 15 * time.Second

// feishuTokenEndpoint 是获取 tenant_access_token 的 API 路径。
const feishuTokenEndpoint = "/auth/v3/tenant_access_token/internal"

// FeishuTokenManager 管理飞书 tenant_access_token，线程安全。
// 多个飞书客户端（Replier/CardKit/GroupHistory）可共享同一实例，
// 避免重复刷新与并发数据竞争。
type FeishuTokenManager struct {
	mu         sync.Mutex
	token      string
	tokenExp   time.Time
	appID      string
	appSecret  string
	apiBaseURL string
	httpClient *http.Client
}

// NewFeishuTokenManager 创建飞书 token 管理器。
// mock 模式下传空字符串即可（实例不会被调用）。
func NewFeishuTokenManager(appID, appSecret, apiBaseURL string) *FeishuTokenManager {
	return &FeishuTokenManager{
		appID:      appID,
		appSecret:  appSecret,
		apiBaseURL: apiBaseURL,
		httpClient: &http.Client{Timeout: tokenHTTPTimeout},
	}
}

// GetToken 返回有效的 tenant_access_token，必要时刷新（线程安全）。
//
// 刷新期间持锁，避免并发调用触发重复刷新（thundering herd）；
// token 未过期时仅做一次锁内时间检查即返回，开销极低。
// 调用方拿到的 token 是不可变的字符串快照，可安全地在锁外使用。
func (m *FeishuTokenManager) GetToken(ctx context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 缓存命中：token 非空且未接近过期，直接返回
	if m.token != "" && time.Now().Before(m.tokenExp) {
		return m.token, nil
	}

	token, exp, err := m.refreshToken(ctx)
	if err != nil {
		return "", err
	}
	m.token = token
	m.tokenExp = exp
	return m.token, nil
}

// refreshToken 调用飞书 API 获取新的 tenant_access_token。
// 调用方应已持有 m.mu（GetToken 内部调用）。
func (m *FeishuTokenManager) refreshToken(ctx context.Context) (token string, exp time.Time, err error) {
	body, _ := json.Marshal(map[string]string{
		"app_id":     m.appID,
		"app_secret": m.appSecret,
	})
	url := m.apiBaseURL + feishuTokenEndpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("request token: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            int    `json:"expire"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", time.Time{}, fmt.Errorf("decode token response: %w", err)
	}
	if result.Code != 0 {
		return "", time.Time{}, fmt.Errorf("feishu token error code=%d msg=%s", result.Code, result.Msg)
	}

	exp = time.Now().Add(time.Duration(result.Expire)*time.Second - tokenRefreshLeadTime)
	return result.TenantAccessToken, exp, nil
}
