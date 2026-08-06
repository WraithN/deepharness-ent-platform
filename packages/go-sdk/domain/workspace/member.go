package workspace

import "time"

// Member 表示用户在工作空间中的成员关系。
type Member struct {
	WorkspaceID  string    `json:"workspaceId"`
	UserID       string    `json:"userId"`
	DisplayID    string    `json:"displayId"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	Role         string    `json:"role"`
	SubRoles     []string  `json:"subRoles"`
	PlatformRole string    `json:"platformRole"`
	JoinedAt     time.Time `json:"joinedAt"`
}
