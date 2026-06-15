package workspace

import "time"

// Workspace 表示一个工作空间，是项目、成员、标准、CICD 等资源的容器。
type Workspace struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenantId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
