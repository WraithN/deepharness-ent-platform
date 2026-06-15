package object

import "time"

// PersonalAssistant 表示一个“虾班智守”个人助手。
type PersonalAssistant struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Role        string    `json:"role"`
	Description string    `json:"description"`
	CreatorID   string    `json:"creatorId"`
	CreatorName string    `json:"creatorName"`
	IsMine      bool      `json:"isMine"`
	AvatarURL   string    `json:"avatarUrl,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Session 表示与某个个人助手的聊天会话。
type Session struct {
	ID           string    `json:"id"`
	AssistantID  string    `json:"assistantId"`
	Title        string    `json:"title"`
	MessageCount int       `json:"messageCount"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// Message 表示个人助手会话中的一条消息。
type Message struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Role      string    `json:"role"` // user | assistant | system
	Type      string    `json:"type"` // text
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

// WSMessage 是 WebSocket 中收发的消息结构。
type WSMessage struct {
	Event   string `json:"event"`
	Payload struct {
		Type    string `json:"type"`
		Content string `json:"content"`
	} `json:"payload"`
}

// WSResponse 是 WebSocket 返回给前端的事件结构。
type WSResponse struct {
	Event   string  `json:"event"`
	Payload Message `json:"payload"`
}
