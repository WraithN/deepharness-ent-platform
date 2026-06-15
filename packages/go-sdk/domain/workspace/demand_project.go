package workspace

import "time"

// DemandProject 表示工作空间关联的需求项目（外部需求平台项目）。
type DemandProject struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Platform    string    `json:"platform"`
	ExternalKey string    `json:"externalKey"`
	Name        string    `json:"name"`
	Config      any       `json:"config,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
