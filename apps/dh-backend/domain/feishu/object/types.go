// Package object 定义飞书机器人模块的领域模型。
package object

import "time"

// DispatchMode 表示飞书消息的分发模式。
type DispatchMode string

const (
	// ModeOneShot 一次性问答：使用 QuickComplete，不持久化会话，无上下文延续。
	// 适用于普通提问（不以斜杠开头的消息）。
	ModeOneShot DispatchMode = "oneshot"
	// ModePersistent 持久化会话：按飞书 chat_id 复用 agent session，保留多轮上下文。
	// 适用于斜杠命令（如 /proto-make、/prd-write）等需要工具调用与上下文的场景。
	ModePersistent DispatchMode = "persistent"
)

// ChatType 表示飞书会话类型。
type ChatType string

const (
	ChatTypeP2P  ChatType = "p2p"  // 私聊
	ChatTypeGroup ChatType = "group" // 群聊
)

// FeishuUser 是飞书用户与平台用户的绑定关系，存储于 feishu_users 表。
// open_id 为飞书用户唯一标识，user_id 为平台用户 ID（决定 agent 工作目录归属），
// workspace_id 为该用户默认操作的工作空间。
type FeishuUser struct {
	OpenID      string    `json:"openId"`
	UserID      string    `json:"userId"`
	WorkspaceID string    `json:"workspaceId"`
	UserName    string    `json:"userName"`
	NickName    string    `json:"nickName"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// FeishuChatSession 是飞书会话与平台 agent session 的映射，存储于 feishu_chat_sessions 表。
// chat_id 为飞书会话 ID（群或私聊），session_id 为平台 agent session ID（gatewayd thread）。
// 同一飞书会话的多轮消息复用同一 session_id，以保持上下文延续。
type FeishuChatSession struct {
	ChatID      string       `json:"chatId"`
	SessionID   string       `json:"sessionId"`
	UserID      string       `json:"userId"`
	WorkspaceID string       `json:"workspaceId"`
	Mode        DispatchMode `json:"mode"`
	ChatType    ChatType     `json:"chatType"`
	CreatedAt   time.Time    `json:"createdAt"`
	UpdatedAt   time.Time    `json:"updatedAt"`
}

// BindUserRequest 是绑定飞书用户与平台用户的请求体。
type BindUserRequest struct {
	OpenID      string `json:"openId"`
	UserID      string `json:"userId"`
	WorkspaceID string `json:"workspaceId"`
	UserName    string `json:"userName"`
	NickName    string `json:"nickName"`
}

// InboundEvent 是从飞书 webhook 回调解析出的标准化事件。
// 无论 mock 模式还是真实飞书事件 v2，最终都归一化为此结构，
// 使下游分发逻辑与事件来源解耦。
type InboundEvent struct {
	// EventType 飞书事件类型，如 im.message.receive_v1。
	EventType string `json:"eventType"`
	// ChatID 飞书会话 ID。
	ChatID string `json:"chatId"`
	// ChatType 会话类型（p2p/group）。
	ChatType ChatType `json:"chatType"`
	// OpenID 发送者飞书 open_id。
	OpenID string `json:"openId"`
	// UserName 发送者名称（用于日志与绑定记录）。
	UserName string `json:"userName"`
	// MessageType 消息类型，目前仅支持 text。
	MessageType string `json:"messageType"`
	// Content 已去除 @机器人 标记的纯文本内容。
	Content string `json:"content"`
	// MessageID 飞书消息 ID，用于回复。
	MessageID string `json:"messageId"`
	// RawContent 原始消息内容（含 @标记），仅供日志排查。
	RawContent string `json:"rawContent,omitempty"`
}

// WebhookResponse 是 webhook 接口的同步响应。
// 飞书要求 webhook 在 3 秒内返回 200，因此实际消息处理是异步的，
// 此响应仅表示事件已接收。
type WebhookResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	// Accepted 表示事件是否已进入异步处理队列。
	Accepted bool `json:"accepted"`
}

// DispatchResult 是一次 agent 分发的结果。
type DispatchResult struct {
	Mode      DispatchMode `json:"mode"`
	SessionID string       `json:"sessionId"`
	Reply     string       `json:"reply"`
	// EventCount agent 产生的 SSE 事件数，用于日志观察。
	EventCount int `json:"eventCount"`
}

// Intent 表示飞书消息的意图类型，决定分发路径。
type Intent string

const (
	IntentCoding        Intent = "coding"        // 编码请求 -> AGUIClient.Run (persistent)
	IntentPrototype     Intent = "prototype"     // 原型设计 -> AGUIClient.Run (persistent)
	IntentRequirement   Intent = "requirement"   // 需求卡片 -> AGUIClient.Run (persistent)
	IntentGroupSummary  Intent = "group_summary" // 群聊总结 -> 拉群历史 + LLM 总结
	IntentChat          Intent = "chat"          // 默认问答 -> QuickComplete (oneshot)
)

// PermissionLevel 表示飞书用户的权限等级。
type PermissionLevel string

const (
	PermFull   PermissionLevel = "full"   // 白名单用户：编码/原型/需求/总结
	PermBasic  PermissionLevel = "basic"  // 普通用户：仅问答+总结
)

// CardButton 是流式卡片终态的操作按钮。
type CardButton struct {
	Text   string `json:"text"`
	Action string `json:"action"` // "copy" | "regenerate" | "export"
	Data   string `json:"data"`   // 按钮附加数据（如复制的文本内容）
}
