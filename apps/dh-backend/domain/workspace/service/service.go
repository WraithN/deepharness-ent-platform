package service

import (
	"context"
	"errors"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
)

// ErrMemberNotFound 表示指定用户不是该工作空间的成员。
// 供依赖方区分“无权限”与“成员/工作空间不存在”，避免统一返回 403 造成信息泄露。
var ErrMemberNotFound = errors.New("workspace member not found")

// AgentPolicy 表示超管为工作空间设置的智能体策略。
type AgentPolicy struct {
	AgentConfigLocked   bool                           `json:"agentConfigLocked"`
	LockedAgentKeys     []string                       `json:"lockedAgentKeys"`
	AllowedAgentKeys    []string                       `json:"allowedAgentKeys"`
	DefaultAgentConfigs map[string]AgentConfigSnapshot `json:"defaultAgentConfigs"`
}

// AgentConfigSnapshot 表示超管为某个 agent 预设的默认配置快照。
type AgentConfigSnapshot struct {
	Enabled        bool                       `json:"enabled"`
	Model          string                     `json:"model"`
	ModelSource    string                     `json:"modelSource"`
	BaseURL        string                     `json:"baseUrl"`
	APIKey         string                     `json:"apiKey"`
	Temperature    *float64                   `json:"temperature,omitempty"`
	AdvancedConfig *agent.AdvancedAgentConfig `json:"advancedConfig,omitempty"`
}

// WorkspaceService 定义 workspace 模块的服务接口。
type WorkspaceService interface {
	CreateWorkspace(tenantID, name, description, ownerUserID, subRole, sourceWorkspaceID string, policy AgentPolicy) (workspace.Workspace, error)
	GetWorkspace(id string) (workspace.Workspace, error)
	UpdateWorkspace(id, name, description string, policy AgentPolicy) (workspace.Workspace, error)
	DeleteWorkspace(id string) error
	ListWorkspaces(tenantID string, page, pageSize int) (common.PaginatedList[workspace.Workspace], error)
	// ListMine 返回指定用户加入的工作空间及其成员关系（用于登录后确定当前空间与权限）。
	ListMine(userID string) ([]MineWorkspace, error)
	// EnsureUserWorkspaceDirs 确保用户在工作空间下的 projects、files 与 products 目录存在。
	// 目录结构：WORKSPACE_ROOT/{userID}/{workspaceID}/{projects,files,products/{docs,prototypes}}
	// os.MkdirAll 是幂等的，并发安全。
	EnsureUserWorkspaceDirs(ctx context.Context, workspaceID, userID string) error

	AddMember(workspaceID, userID, role, subRole string) error
	AddMemberByEmail(workspaceID, email, role, subRole string) error
	ListMembers(workspaceID string) ([]workspace.Member, error)
	GetMemberRole(workspaceID, userID string) (string, error)
	GetMemberSubRole(ctx context.Context, workspaceID, userID string) (string, error)
	UpdateMemberRole(workspaceID, userID, role, subRole string) error
	RemoveMember(workspaceID, userID, assetAssigneeID string) error

	SetWorkitemProject(workspaceID string, req WorkitemProjectRequest) (workspace.WorkitemProject, error)
	GetWorkitemProject(workspaceID string) (workspace.WorkitemProject, error)

	ListAgents(workspaceID string) ([]agent.Agent, error)
	CreateAgent(workspaceID string, req AgentRequest) (agent.Agent, error)
	GetDefaultAgent(workspaceID string) (agent.Agent, error)

	ListStandards(workspaceID string, repoID string) ([]workspace.Standard, error)
	SaveStandard(workspaceID string, req StandardRequest) (workspace.Standard, error)
	DeleteStandard(workspaceID, standardID string) error

	GetCICD(workspaceID string) (workspace.CICD, error)
	SaveCICD(workspaceID string, req CICDRequest) (workspace.CICD, error)
}

// WorkitemProjectRequest 设置工作项项目请求。
type WorkitemProjectRequest struct {
	Platform    string `json:"platform"`
	ExternalKey string `json:"externalKey"`
	Name        string `json:"name"`
}

// AgentRequest 创建 Agent 请求。
type AgentRequest struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Config      any    `json:"config"`
	IsDefault   bool   `json:"isDefault"`
}

// StandardRequest 保存规范请求。
type StandardRequest struct {
	ID           string `json:"id,omitempty"`
	RepositoryID string `json:"repositoryId,omitempty"`
	Type         string `json:"type"`
	Name         string `json:"name"`
	Content      string `json:"content"`
}

// CICDRequest 保存 CI/CD 配置请求。
type CICDRequest struct {
	TriggerBranches string `json:"triggerBranches"`
	WebhookURL      string `json:"webhookUrl"`
	Script          string `json:"script"`
}

// MineWorkspace 表示当前用户加入的工作空间及其成员关系。
type MineWorkspace struct {
	workspace.Workspace
	Role       string `json:"role"`
	SubRole    string `json:"subRole"`
	TenantName string `json:"tenantName"`
}

// 空间成员权限角色常量（决定空间内管理权限）。
const (
	MemberRoleSpaceAdmin = "space_admin"
	MemberRoleMember     = "member"
)

// 职能子角色常量（决定功能可见性，仅对 member 生效收敛）。
const (
	MemberSubRoleDeveloper = "developer"
	MemberSubRoleTester    = "tester"
	MemberSubRolePM        = "pm"
	MemberSubRoleDesigner  = "designer"
)
