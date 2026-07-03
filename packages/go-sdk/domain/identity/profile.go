package identity

import "time"

// Profile 表示用户的个人信息（与 User 1:1 关联）。
// 昵称仍存于 User.Name，本结构存储头像、描述、SSH Key 等扩展资料。
type Profile struct {
	UserID      string    `json:"userId"`
	AvatarURL   string    `json:"avatarUrl"`
	Description string    `json:"description"`
	SSHKey      string    `json:"sshKey"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
