package agent

import "time"

// Agent 表示 AI Agent 配置。
type Agent struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Name            string    `json:"name"`
	Role            string    `json:"role"`
	Description     string    `json:"description"`
	Config          any       `json:"config,omitempty"`
	IsDefault       bool      `json:"isDefault"`
	CreatedByUserID string    `json:"createdByUserId"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// Session 表示 Agent 会话。
type Session struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	AgentID     string    `json:"agentId"`
	Title       string    `json:"title"`
	Model       string    `json:"model"`
	Context     any       `json:"context,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Message 表示会话消息。
type Message struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Role      string    `json:"role"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
	Metadata  any       `json:"metadata,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}
