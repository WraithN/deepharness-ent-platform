package identity

import "time"

// User 表示平台用户
type User struct {
	ID        string
	TenantID  string
	Email     string
	Name      string
	Role      Role
	CreatedAt time.Time
}

// Role 用户角色
type Role string

const (
	RoleSuperAdmin Role = "superadmin"
	RoleAdmin      Role = "admin"
	RoleUser       Role = "user"
)

// Tenant 租户
type Tenant struct {
	ID        string
	Name      string
	CreatedAt time.Time
}
