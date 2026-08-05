package identity

import "time"

// User 表示平台用户
type User struct {
	ID           string        `json:"id"`
	TenantID     string        `json:"tenantId"`
	Email        string        `json:"email"`
	Name         string        `json:"name"`
	PlatformRole PlatformRole  `json:"platformRole"`
	CreatedAt    time.Time     `json:"createdAt"`
}

// PlatformRole 平台角色，决定登录入口与全局权限。
// 取值：super_admin（超级管理员，归属系统租户）/ tenant_admin（租户管理员）/ user（普通用户）。
type PlatformRole string

const (
	PlatformRoleSuperAdmin  PlatformRole = "super_admin"
	PlatformRoleTenantAdmin PlatformRole = "tenant_admin"
	PlatformRoleUser        PlatformRole = "user"
)

// SystemTenantID 系统租户 ID，承载不绑定业务租户的超级管理员。
const SystemTenantID = "__system__"

// Tenant 租户
type Tenant struct {
	ID                  string    `json:"id"`
	DisplayID           string    `json:"displayId"`
	Name                string    `json:"name"`
	AgentConfigLocked   bool      `json:"agentConfigLocked"`
	LockedAgentKeys     []string  `json:"lockedAgentKeys"`
	AllowedAgentKeys    []string  `json:"allowedAgentKeys"`
	DefaultAgentConfigs any       `json:"defaultAgentConfigs,omitempty"`
	CICDConfigID        string    `json:"cicdConfigId"`
	CreatedAt           time.Time `json:"createdAt"`
}
