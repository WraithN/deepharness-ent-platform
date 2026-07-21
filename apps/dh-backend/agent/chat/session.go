package chat

import "time"

type Session struct {
	ID              string         `json:"id"`
	WorkspaceID     string         `json:"workspaceId"`
	WorkspacePath   string         `json:"workspacePath"`
	UserID          string         `json:"userId,omitempty"`
	AgentID         string         `json:"agentId"`
	GatewaydAgentID string         `json:"gatewaydAgentId"`
	AgentType       string         `json:"agentType"`
	Model         string         `json:"model"`
	ProjectID     string         `json:"projectId"`
	Title         string         `json:"title"`
	Context       map[string]any `json:"context,omitempty"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}
