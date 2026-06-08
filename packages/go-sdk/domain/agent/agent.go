package agent

import "time"

// Agent 表示 AI Agent 配置
type Agent struct {
	ID          string
	TenantID    string
	Name        string
	Description string
	Model       string
	Prompt      string
	Skills      []string
	CreatedAt   time.Time
}

// Session 表示 Agent 会话
type Session struct {
	ID        string
	TenantID  string
	UserID    string
	AgentID   string
	Messages  []Message
	CreatedAt time.Time
}

// Message 会话消息
type Message struct {
	Role      string
	Content   string
	Tokens    int
	CreatedAt time.Time
}
