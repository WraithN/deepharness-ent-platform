package workspace

import "time"

// Standard 表示工作空间下的规范文件，例如编码规范、提交规范等。
type Standard struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	RepositoryID string    `json:"repositoryId,omitempty"`
	Type         string    `json:"type"`
	Name         string    `json:"name"`
	Content      string    `json:"content"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
