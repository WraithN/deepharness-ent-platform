package workspace

import "time"

// Member 表示用户在工作空间中的成员关系。
type Member struct {
	WorkspaceID string    `json:"workspaceId"`
	UserID      string    `json:"userId"`
	Role        string    `json:"role"`
	SubRole     string    `json:"subRole"`
	JoinedAt    time.Time `json:"joinedAt"`
}
