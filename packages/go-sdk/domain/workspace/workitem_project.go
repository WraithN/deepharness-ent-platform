package workspace

import "time"

// WorkitemProject 表示工作空间关联的外部工作项项目（Meego/PingCode 等）。
type WorkitemProject struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Platform    string    `json:"platform"`
	ExternalKey string    `json:"externalKey"`
	Name        string    `json:"name"`
	Config      any       `json:"config,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
