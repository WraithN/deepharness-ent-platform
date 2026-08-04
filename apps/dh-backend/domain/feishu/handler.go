// Package feishu 处理飞书机器人模块的 HTTP 请求。
//
// 架构合规（AGENTS.md 规则12）：webhook 接收飞书事件 -> 异步分发到 gatewayd（通过 AGUIClient）
// -> agent 在 gatewayd 容器中执行文件/代码操作 -> 回复异步发送回飞书。
// dh-backend 不直接执行 agent CLI、不直接写共享目录。
package feishu

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
)

var defaultFeishuService service.FeishuService

// Init 注入飞书机器人服务实例。
func Init(svc service.FeishuService) {
	defaultFeishuService = svc
}

// feishuEventReceiveType 是飞书消息接收事件的类型标识。
const feishuEventReceiveType = "im.message.receive_v1"

// feishuURLVerificationType 是飞书 URL 验证请求的类型标识。
const feishuURLVerificationType = "url_verification"

// feishuTextMessageType 是飞书文本消息类型。
const feishuTextMessageType = "text"

// feishuMentionKeyPrefix 是飞书 @ 消息中 mention key 的前缀。
const feishuMentionKeyPrefix = "@_user_"

// Webhook 处理 POST /api/v1/feishu/webhook，接收飞书事件回调。
// 该接口使用 BearerAuth 保护（本平台侧鉴权），飞书侧的签名校验在 mock 模式下跳过。
// 飞书要求 webhook 在 3 秒内返回 200，因此事件解析后立即响应，
// 实际的 agent 分发与回复发送在独立 goroutine 中异步进行。
func Webhook(w http.ResponseWriter, r *http.Request) {
	if defaultFeishuService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "feishu service not initialized")
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	// 读取并保留原始 body（签名校验与事件解析都需要）。
	body, ok := readBody(w, r)
	if !ok {
		return
	}

	// mock 模式跳过签名校验；真实模式需在此时校验 X-Lark-Signature。
	// 签名校验逻辑待接入真实飞书凭证时补充，当前 mock 模式可直接测试。

	// 飞书 URL 验证请求：直接回传 challenge。
	if challenge, isVerify := extractChallenge(body); isVerify {
		respondChallenge(w, challenge)
		return
	}

	ev, err := parseEvent(body)
	if err != nil {
		log.Printf("[Feishu] parse event failed: %v", err)
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid event payload")
		return
	}

	// 立即响应 200，飞书要求 3 秒内返回。
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(object.WebhookResponse{
		Code:     0,
		Message:  "accepted",
		Accepted: true,
	})

	// 异步处理事件：agent 执行可能耗时数分钟，不能阻塞 webhook 响应。
	safego.Go("feishu-handle-event", func() { defaultFeishuService.HandleEvent(ev) })
}

// BindUser 处理 POST /api/v1/feishu/bindings，绑定飞书用户与平台用户。
func BindUser(w http.ResponseWriter, r *http.Request) {
	if defaultFeishuService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "feishu service not initialized")
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	var req object.BindUserRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}

	result, err := defaultFeishuService.BindUser(req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(result)
}

// ListBindings 处理 GET /api/v1/feishu/bindings，列出全部飞书用户绑定。
func ListBindings(w http.ResponseWriter, r *http.Request) {
	if defaultFeishuService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "feishu service not initialized")
		return
	}
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	list, err := defaultFeishuService.ListBindings()
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(list)
}

// ListChatSessions 处理 GET /api/v1/feishu/chat-sessions，列出飞书会话映射。
func ListChatSessions(w http.ResponseWriter, r *http.Request) {
	if defaultFeishuService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "feishu service not initialized")
		return
	}
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	list, err := defaultFeishuService.ListChatSessions()
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(list)
}

// readBody 读取请求体并返回原始字节，失败时写入 400 错误。
func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "read body failed")
		return nil, false
	}
	return body, true
}

// extractChallenge 从请求体中提取 URL 验证的 challenge 值。
// 飞书在配置 webhook 回调地址时会发送 {"challenge":"...","type":"url_verification"} 进行验证。
func extractChallenge(body []byte) (string, bool) {
	if len(body) == 0 {
		return "", false
	}
	var probe struct {
		Challenge string `json:"challenge"`
		Type      string `json:"type"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return "", false
	}
	if probe.Type == feishuURLVerificationType && probe.Challenge != "" {
		return probe.Challenge, true
	}
	return "", false
}

// respondChallenge 回传飞书 URL 验证 challenge。
func respondChallenge(w http.ResponseWriter, challenge string) {
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]string{"challenge": challenge})
}

// parseEvent 将飞书事件回调体解析为标准化 InboundEvent。
// 支持两种格式：
//   - mock 简化格式：含 mock_event 字段，字段已扁平化，便于 curl 测试。
//   - 飞书事件 v2 标准格式：含 schema/header/event 结构。
func parseEvent(body []byte) (object.InboundEvent, error) {
	// 先探测是否为 mock 简化格式。
	var mockProbe struct {
		MockEvent bool `json:"mock_event"`
	}
	if json.Unmarshal(body, &mockProbe) == nil && mockProbe.MockEvent {
		return parseMockEvent(body)
	}
	return parseFeishuV2Event(body)
}

// parseMockEvent 解析 mock 简化格式事件。
func parseMockEvent(body []byte) (object.InboundEvent, error) {
	var raw struct {
		ChatID      string `json:"chat_id"`
		ChatType    string `json:"chat_type"`
		OpenID      string `json:"open_id"`
		UserName    string `json:"user_name"`
		MessageType string `json:"message_type"`
		Content     string `json:"content"`
		MessageID   string `json:"message_id"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return object.InboundEvent{}, err
	}
	if raw.MessageType == "" {
		raw.MessageType = feishuTextMessageType
	}
	if raw.ChatType == "" {
		raw.ChatType = string(object.ChatTypeP2P)
	}
	return object.InboundEvent{
		EventType:   feishuEventReceiveType,
		ChatID:      raw.ChatID,
		ChatType:    object.ChatType(raw.ChatType),
		OpenID:      raw.OpenID,
		UserName:    raw.UserName,
		MessageType: raw.MessageType,
		Content:     stripMentions(raw.Content),
		RawContent:  raw.Content,
		MessageID:   raw.MessageID,
	}, nil
}

// parseFeishuV2Event 解析飞书事件 v2 标准格式。
func parseFeishuV2Event(body []byte) (object.InboundEvent, error) {
	var raw struct {
		Header struct {
			EventType string `json:"event_type"`
			Token     string `json:"token"`
		} `json:"header"`
		Event struct {
			Sender struct {
				SenderID struct {
					OpenID string `json:"open_id"`
				} `json:"sender_id"`
			} `json:"sender"`
			Message struct {
				MessageID   string `json:"message_id"`
				ChatID      string `json:"chat_id"`
				ChatType    string `json:"chat_type"`
				MessageType string `json:"message_type"`
				Content     string `json:"content"`
				Mentions    []struct {
					Key  string `json:"key"`
					Name string `json:"name"`
				} `json:"mentions"`
			} `json:"message"`
		} `json:"event"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return object.InboundEvent{}, err
	}

	// 仅处理文本消息，其他类型（图片/文件等）暂不支持。
	if raw.Event.Message.MessageType != feishuTextMessageType {
		return object.InboundEvent{}, fmt.Errorf("unsupported message type: %s", raw.Event.Message.MessageType)
	}

	// 飞书文本消息 content 是 JSON 字符串：{"text":"@_user_1 实际内容"}
	textContent := extractTextContent(raw.Event.Message.Content)
	cleaned := stripMentions(textContent)

	return object.InboundEvent{
		EventType:   raw.Header.EventType,
		ChatID:      raw.Event.Message.ChatID,
		ChatType:    object.ChatType(raw.Event.Message.ChatType),
		OpenID:      raw.Event.Sender.SenderID.OpenID,
		MessageType: raw.Event.Message.MessageType,
		Content:     cleaned,
		RawContent:  textContent,
		MessageID:   raw.Event.Message.MessageID,
	}, nil
}

// extractTextContent 从飞书文本消息的 content JSON 中提取纯文本。
// 飞书 content 格式为 {"text":"实际内容"}，解析失败时原样返回。
func extractTextContent(content string) string {
	if content == "" {
		return ""
	}
	var parsed struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return content
	}
	return parsed.Text
}

// stripMentions 去除消息文本中的 @机器人 标记。
// 飞书 @ 标记格式为 @_user_N（N 为序号），需移除以得到纯用户输入。
func stripMentions(text string) string {
	// 按 @_user_ 分割并丢弃每段开头的序号标记（如 "1 "）。
	parts := strings.Split(text, feishuMentionKeyPrefix)
	if len(parts) == 1 {
		return strings.TrimSpace(text)
	}
	var sb strings.Builder
	for i, part := range parts {
		if i == 0 {
			sb.WriteString(part)
			continue
		}
		// 跳过 mention 序号前缀（数字+可能的空格），保留后面的实际内容。
		sb.WriteString(stripMentionIndex(part))
	}
	return strings.TrimSpace(sb.String())
}

// stripMentionIndex 去除 mention 标记后的序号前缀（如 "1 hello" -> "hello"）。
func stripMentionIndex(s string) string {
	for i, r := range s {
		if r == ' ' {
			return s[i+1:]
		}
		// 非数字字符表示序号已结束，保留剩余内容。
		if r < '0' || r > '9' {
			return s
		}
	}
	return ""
}
