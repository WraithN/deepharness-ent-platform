package chat

import "time"

type Session struct {
	ID        string
	AgentType string
	Model     string
	ProjectID string
	Context   map[string]any
	CreatedAt time.Time
	UpdatedAt time.Time
}
