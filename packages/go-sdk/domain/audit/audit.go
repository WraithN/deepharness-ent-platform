package audit

import "time"

// Event 审计事件
type Event struct {
	ID        string
	TenantID  string
	UserID    string
	Action    string
	Resource  string
	Details   map[string]any
	CreatedAt time.Time
}
