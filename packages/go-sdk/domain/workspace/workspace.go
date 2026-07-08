package workspace

import "time"

// Workspace 表示一个工作空间，是成员、工作项项目、标准、CICD 等资源的容器。
type Workspace struct {
	ID                  string    `json:"id"`
	DisplayID           string    `json:"displayId"`
	TenantID            string    `json:"tenantId"`
	Name                string    `json:"name"`
	Description         string    `json:"description"`
	AgentConfigLocked   bool      `json:"agentConfigLocked"`
	LockedAgentKeys     []string  `json:"lockedAgentKeys"`
	AllowedAgentKeys    []string  `json:"allowedAgentKeys"`
	DefaultAgentConfigs any       `json:"defaultAgentConfigs,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}
