// Package service - replier.go 实现飞书回复发送器。
//
// Replier 抽象了"将 agent 回复发送回飞书"这一动作，使分发逻辑与具体发送渠道解耦：
//   - MockReplier：mock 模式下将回复输出到日志，便于本地 curl 验证全链路。
//   - FeishuReplier：真实模式下调用飞书 Open API 发送消息。
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
)

// Replier 定义飞书回复发送器接口。
// Send 是异步的：实现内部可按需启动 goroutine 或同步发送，
// 调用方（HandleEvent）已在 goroutine 中，因此同步发送即可。
type Replier interface {
	Send(ev object.InboundEvent, reply string)
}

// NewReplier 根据是否 mock 模式选择回复发送器实现。
// mock 模式下 tokenManager 可为 nil（不会被调用）。
func NewReplier(mockMode bool, tokenManager *FeishuTokenManager, apiBaseURL string) Replier {
	if mockMode {
		return &MockReplier{}
	}
	return NewFeishuReplier(tokenManager, apiBaseURL)
}

// MockReplier 将回复输出到日志，不调用任何外部 API。
type MockReplier struct{}

// Send 打印回复内容到标准日志输出。
func (m *MockReplier) Send(ev object.InboundEvent, reply string) {
	log.Printf("[Feishu-MockReply] chatId=%s openId=%s userName=%s\n--- REPLY START ---\n%s\n--- REPLY END ---",
		ev.ChatID, ev.OpenID, ev.UserName, reply)
}

// FeishuReplier 通过飞书 Open API 发送回复。
// token 管理委托给共享的 FeishuTokenManager，避免并发数据竞争。
type FeishuReplier struct {
	tokenManager *FeishuTokenManager
	apiBaseURL   string
	httpClient   *http.Client
}

// apiTimeout 飞书 API 调用超时。
const apiTimeout = 15 * time.Second

// NewFeishuReplier 创建真实飞书回复发送器。
func NewFeishuReplier(tokenManager *FeishuTokenManager, apiBaseURL string) *FeishuReplier {
	return &FeishuReplier{
		tokenManager: tokenManager,
		apiBaseURL:   apiBaseURL,
		httpClient:   &http.Client{Timeout: apiTimeout},
	}
}

// Send 通过飞书 Open API 发送回复消息。
// 优先使用 reply 接口（回复指定消息），失败时回退到按 chat_id 发送。
func (r *FeishuReplier) Send(ev object.InboundEvent, reply string) {
	// 获取 token 快照（线程安全），后续在锁外使用不可变字符串
	token, err := r.tokenManager.GetToken(context.Background())
	if err != nil {
		log.Printf("[Feishu] ensure token failed: %v", err)
		return
	}
	if ev.MessageID != "" && r.replyToMessage(ev.MessageID, reply, token) == nil {
		return
	}
	if ev.MessageID != "" {
		log.Printf("[Feishu] reply to message failed, fallback to chat send")
	}
	if err := r.sendToChat(ev.ChatID, reply, token); err != nil {
		log.Printf("[Feishu] send to chat failed chatId=%s: %v", ev.ChatID, err)
	}
}

// replyToMessage 回复指定消息（飞书 POST /im/v1/messages/{message_id}/reply）。
func (r *FeishuReplier) replyToMessage(messageID, text, token string) error {
	content, _ := json.Marshal(map[string]string{"text": text})
	payload, _ := json.Marshal(map[string]string{
		"msg_type": "text",
		"content":  string(content),
	})
	url := fmt.Sprintf("%s/im/v1/messages/%s/reply", r.apiBaseURL, messageID)
	return r.postFeishu(url, payload, token)
}

// sendToChat 向指定会话发送消息（飞书 POST /im/v1/messages?receive_id_type=chat_id）。
func (r *FeishuReplier) sendToChat(chatID, text, token string) error {
	content, _ := json.Marshal(map[string]string{"text": text})
	payload, _ := json.Marshal(map[string]any{
		"receive_id": chatID,
		"msg_type":   "text",
		"content":    string(content),
	})
	url := r.apiBaseURL + "/im/v1/messages?receive_id_type=chat_id"
	return r.postFeishu(url, payload, token)
}

// postFeishu 向飞书 API 发送 POST 请求并校验响应码。
// token 为 GetToken 返回的不可变快照，可安全在锁外使用。
func (r *FeishuReplier) postFeishu(url string, payload []byte, token string) error {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("feishu api status %d: %s", resp.StatusCode, string(respBody))
	}
	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&result)
	if result.Code != 0 {
		return fmt.Errorf("feishu api error code=%d msg=%s", result.Code, result.Msg)
	}
	return nil
}
