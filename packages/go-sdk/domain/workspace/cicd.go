package workspace

import "time"

// CICD 表示工作空间下的 CI/CD 配置（读取视图，实际来源于租户关联的全局配置）。
type CICD struct {
	ID              string    `json:"id"`
	TenantID        string    `json:"tenantId"`
	WorkspaceID     string    `json:"workspaceId"`
	Name            string    `json:"name"`
	TriggerBranches string    `json:"triggerBranches"`
	WebhookURL      string    `json:"webhookUrl"`
	Script          string    `json:"script"`
	Config          any       `json:"config,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// CICDConfig 表示超管在能力配置中维护的全局 CI/CD 配置。
type CICDConfig struct {
	ID              string    `json:"id"`
	TenantID        string    `json:"tenantId"`
	Name            string    `json:"name"`
	TriggerBranches string    `json:"triggerBranches"`
	WebhookURL      string    `json:"webhookUrl"`
	Script          string    `json:"script"`
	Config          any       `json:"config,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
