package audit

import "time"

// Event 审计事件
type Event struct {
	ID        string         `json:"id"`
	TenantID  string         `json:"tenantId"`
	UserID    string         `json:"userId"`
	Action    string         `json:"action"`
	Resource  string         `json:"resource"`
	Details   map[string]any `json:"details"`
	CreatedAt time.Time      `json:"createdAt"`
}
