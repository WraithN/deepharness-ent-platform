package chat

import "time"

type Session struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspaceId"`
	AgentID     string         `json:"agentId"`
	AgentType   string         `json:"agentType"`
	Model       string         `json:"model"`
	ProjectID   string         `json:"projectId"`
	Title       string         `json:"title"`
	Context     map[string]any `json:"context,omitempty"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}
