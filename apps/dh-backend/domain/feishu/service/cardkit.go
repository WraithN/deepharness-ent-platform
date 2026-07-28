// Package service - cardkit.go 实现飞书 CardKit 流式卡片管理器。
//
// 流式卡片生命周期：
//  1. CreateStreamingCard: 在指定会话创建初始卡片（placeholder），返回卡片句柄
//  2. AppendAndFlush: 追加增量文本，按节流间隔更新卡片内容
//  3. UpdateStatus: 更新状态行（如"🔧 执行工具: bash"），不修改正文
//  4. Finalize: 终态化卡片（全文 + 操作按钮），之后不再更新
//
// Mock 模式下所有操作输出到日志，便于本地验证流式效果。
// 真实模式调用飞书 Open API：POST /im/v1/messages 创建，PATCH /im/v1/messages/{id} 更新。
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
)

// cardThrottleInterval 是流式卡片更新的最小间隔，防止超限。
// 飞书消息更新 API 限频约 5 次/10秒/消息，500ms 间隔（2 次/秒）在安全范围内。
const cardThrottleInterval = 500 * time.Millisecond

// cardHTTPTimeout 是调用飞书 API 的单次请求超时。
const cardHTTPTimeout = 10 * time.Second

// cardTokenRefreshLeadTime 是提前刷新 token 的时间。
const cardTokenRefreshLeadTime = 5 * time.Minute

// CardKitManager 管理流式卡片的生命周期。
type CardKitManager interface {
	// CreateStreamingCard 在指定会话中创建初始卡片，返回卡片句柄。
	CreateStreamingCard(ctx context.Context, chatID, placeholder string) (StreamingCardHandle, error)
}

// StreamingCardHandle 是一张流式卡片的操作句柄。
type StreamingCardHandle interface {
	// AppendAndFlush 追加增量文本并在必要时（满足节流间隔）更新卡片。
	AppendAndFlush(ctx context.Context, delta string) error
	// UpdateStatus 更新状态行（工具执行状态等），不修改正文。
	UpdateStatus(ctx context.Context, status string) error
	// Finalize 终态化卡片：写入最终正文 + 操作按钮，之后不再更新。
	Finalize(ctx context.Context, content string, buttons []object.CardButton) error
}

// NewCardKitManager 根据是否 mock 模式选择实现。
func NewCardKitManager(mockMode bool, appID, appSecret, apiBaseURL string) CardKitManager {
	if mockMode {
		return &MockCardKitManager{}
	}
	return &FeishuCardKitManager{
		appID:      appID,
		appSecret:  appSecret,
		apiBaseURL: apiBaseURL,
		httpClient: &http.Client{Timeout: cardHTTPTimeout},
	}
}

// ---- Mock 实现 ----

// MockCardKitManager 在 mock 模式下将卡片操作输出到日志。
type MockCardKitManager struct{}

func (m *MockCardKitManager) CreateStreamingCard(_ context.Context, chatID, placeholder string) (StreamingCardHandle, error) {
	log.Printf("[Feishu-CardKit] CREATE chatId=%s placeholder=%s", chatID, placeholder)
	return &mockStreamingCard{chatID: chatID, lastUpdate: time.Now()}, nil
}

type mockStreamingCard struct {
	chatID     string
	buf        strings.Builder
	lastUpdate time.Time
	status     string
}

func (c *mockStreamingCard) AppendAndFlush(_ context.Context, delta string) error {
	c.buf.WriteString(delta)
	now := time.Now()
	if now.Sub(c.lastUpdate) >= cardThrottleInterval {
		c.lastUpdate = now
		log.Printf("[Feishu-CardKit] UPDATE chatId=%s totalLen=%d preview=%.120s", c.chatID, c.buf.Len(), c.buf.String())
	}
	return nil
}

func (c *mockStreamingCard) UpdateStatus(_ context.Context, status string) error {
	c.status = status
	log.Printf("[Feishu-CardKit] STATUS chatId=%s status=%s", c.chatID, status)
	return nil
}

func (c *mockStreamingCard) Finalize(_ context.Context, content string, buttons []object.CardButton) error {
	btnDesc := "none"
	if len(buttons) > 0 {
		names := make([]string, len(buttons))
		for i, b := range buttons {
			names[i] = b.Text
		}
		btnDesc = strings.Join(names, ", ")
	}
	log.Printf("[Feishu-CardKit] FINALIZE chatId=%s totalLen=%d buttons=[%s]", c.chatID, len(content), btnDesc)
	log.Printf("[Feishu-CardKit] --- CARD CONTENT START ---\n%s\n--- CARD CONTENT END ---", content)
	return nil
}

// ---- 飞书 API 实现 ----

// FeishuCardKitManager 通过飞书 Open API 管理流式卡片。
type FeishuCardKitManager struct {
	appID       string
	appSecret   string
	apiBaseURL  string
	httpClient  *http.Client
	tokenMu     sync.Mutex
	token       string
	tokenExpiry time.Time
}

// CreateStreamingCard 在飞书会话中创建一条交互式卡片消息，返回句柄。
func (m *FeishuCardKitManager) CreateStreamingCard(ctx context.Context, chatID, placeholder string) (StreamingCardHandle, error) {
	if err := m.ensureToken(); err != nil {
		return nil, fmt.Errorf("ensure token: %w", err)
	}

	card := buildCardContent("正在处理...", placeholder, nil)
	payload, _ := json.Marshal(map[string]any{
		"receive_id": chatID,
		"msg_type":   "interactive",
		"content":    string(card),
	})
	url := m.apiBaseURL + "/im/v1/messages?receive_id_type=chat_id"

	messageID, err := m.postCard(url, payload)
	if err != nil {
		return nil, fmt.Errorf("create card: %w", err)
	}

	log.Printf("[Feishu-CardKit] CREATE chatId=%s messageId=%s", chatID, messageID)
	return &feishuStreamingCard{
		manager:    m,
		chatID:     chatID,
		messageID:  messageID,
		lastUpdate: time.Now(),
	}, nil
}

type feishuStreamingCard struct {
	manager    *FeishuCardKitManager
	chatID     string
	messageID  string
	buf        strings.Builder
	lastUpdate time.Time
	status     string
	finalized  bool
}

func (c *feishuStreamingCard) AppendAndFlush(ctx context.Context, delta string) error {
	if c.finalized {
		return nil
	}
	c.buf.WriteString(delta)
	now := time.Now()
	if now.Sub(c.lastUpdate) < cardThrottleInterval {
		return nil
	}
	c.lastUpdate = now
	return c.patchCard()
}

func (c *feishuStreamingCard) UpdateStatus(ctx context.Context, status string) error {
	if c.finalized {
		return nil
	}
	c.status = status
	return c.patchCard()
}

func (c *feishuStreamingCard) Finalize(ctx context.Context, content string, buttons []object.CardButton) error {
	c.finalized = true
	c.buf.Reset()
	c.buf.WriteString(content)
	return c.patchCardWithButtons(buttons)
}

func (c *feishuStreamingCard) patchCard() error {
	card := buildCardContent(c.status, c.buf.String(), nil)
	payload, _ := json.Marshal(map[string]string{
		"msg_type": "interactive",
		"content":  string(card),
	})
	url := fmt.Sprintf("%s/im/v1/messages/%s", c.manager.apiBaseURL, c.messageID)
	return c.manager.patchCard(url, payload)
}

func (c *feishuStreamingCard) patchCardWithButtons(buttons []object.CardButton) error {
	card := buildCardContent(c.status, c.buf.String(), buttons)
	payload, _ := json.Marshal(map[string]string{
		"msg_type": "interactive",
		"content":  string(card),
	})
	url := fmt.Sprintf("%s/im/v1/messages/%s", c.manager.apiBaseURL, c.messageID)
	return c.manager.patchCard(url, payload)
}

// buildCardContent 构建飞书交互式卡片的 JSON 内容。
// status 显示在顶部（如工具执行状态），content 为正文（Markdown），buttons 为底部操作。
func buildCardContent(status, content string, buttons []object.CardButton) []byte {
	elements := []map[string]any{}

	if status != "" {
		elements = append(elements, map[string]any{
			"tag": "div",
			"text": map[string]any{
				"tag":     "lark_md",
				"content": status,
			},
		})
		elements = append(elements, map[string]any{"tag": "hr"})
	}

	elements = append(elements, map[string]any{
		"tag": "div",
		"text": map[string]any{
			"tag":     "lark_md",
			"content": content,
		},
	})

	if len(buttons) > 0 {
		actions := make([]map[string]any, 0, len(buttons))
		for _, b := range buttons {
			actions = append(actions, map[string]any{
				"tag":  "button",
				"text": map[string]any{"tag": "plain_text", "content": b.Text},
				"type": "primary",
				"value": map[string]string{
					"action": b.Action,
					"data":   b.Data,
				},
			})
		}
		elements = append(elements, map[string]any{
			"tag":     "action",
			"actions": actions,
		})
	}

	card := map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
			"update_multi":     true,
		},
		"header": map[string]any{
			"title": map[string]any{
				"tag":     "plain_text",
				"content": "AI 编码助手",
			},
			"template": "blue",
		},
		"elements": elements,
	}
	data, _ := json.Marshal(card)
	return data
}

// ensureToken 获取或刷新 tenant_access_token（线程安全）。
func (m *FeishuCardKitManager) ensureToken() error {
	m.tokenMu.Lock()
	defer m.tokenMu.Unlock()

	if m.token != "" && time.Now().Before(m.tokenExpiry) {
		return nil
	}

	body, _ := json.Marshal(map[string]string{
		"app_id":     m.appID,
		"app_secret": m.appSecret,
	})
	url := m.apiBaseURL + "/auth/v3/tenant_access_token/internal"
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request token: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            int    `json:"expire"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode token response: %w", err)
	}
	if result.Code != 0 {
		return fmt.Errorf("feishu token error code=%d msg=%s", result.Code, result.Msg)
	}

	m.token = result.TenantAccessToken
	m.tokenExpiry = time.Now().Add(time.Duration(result.Expire)*time.Second - cardTokenRefreshLeadTime)
	return nil
}

// postCard 发送创建卡片请求，返回 message_id。
func (m *FeishuCardKitManager) postCard(url string, payload []byte) (string, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+m.token)

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("feishu api status %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			MessageID string `json:"message_id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if result.Code != 0 {
		return "", fmt.Errorf("feishu api error code=%d msg=%s", result.Code, result.Msg)
	}
	return result.Data.MessageID, nil
}

// patchCard 发送更新卡片请求。
func (m *FeishuCardKitManager) patchCard(url string, payload []byte) error {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPatch, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+m.token)

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("feishu api status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
