package workspace

import "time"

// CICD 表示工作空间下的 CI/CD 配置。
type CICD struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	TriggerBranches string    `json:"triggerBranches"`
	WebhookURL      string    `json:"webhookUrl"`
	Script          string    `json:"script"`
	Config          any       `json:"config,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
