package service

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
)

type WorkspaceCRUDService interface {
	CreateWorkspace(tenantID, name, description, ownerUserID, subRole, sourceWorkspaceID string, policy object.AgentPolicy) (workspace.Workspace, error)
	GetWorkspace(id string) (workspace.Workspace, error)
	UpdateWorkspace(id, name, description string, policy object.AgentPolicy) (workspace.Workspace, error)
	DeleteWorkspace(id string) error
	ListWorkspaces(tenantID string, page, pageSize int) (common.PaginatedList[workspace.Workspace], error)
	// ListMine 返回指定用户加入的工作空间及其成员关系（用于登录后确定当前空间与权限）。
	ListMine(userID string) ([]object.MineWorkspace, error)
}

type WorkspaceDirectoryService interface {
	// EnsureUserWorkspaceDirs 确保用户在工作空间下的 projects、files 与 products 目录存在。
	// 目录结构：WORKSPACE_ROOT/{userID}/{workspaceID}/{projects,files,products/{docs,prototypes}}
	// os.MkdirAll 是幂等的，并发安全。
	EnsureUserWorkspaceDirs(ctx context.Context, workspaceID, userID string) error
}

type WorkspaceMemberService interface {
	AddMember(workspaceID, userID, role, subRole string) error
	AddMemberByEmail(workspaceID, email, role, subRole string) error
	ListMembers(workspaceID string) ([]workspace.Member, error)
	GetMemberRole(workspaceID, userID string) (string, error)
	GetMemberSubRole(ctx context.Context, workspaceID, userID string) (string, error)
	UpdateMemberRole(workspaceID, userID, role, subRole string) error
	RemoveMember(workspaceID, userID, assetAssigneeID string) error
}

type WorkspaceAgentService interface {
	ListAgents(workspaceID string) ([]agent.Agent, error)
	CreateAgent(workspaceID string, req object.AgentRequest) (agent.Agent, error)
	GetDefaultAgent(workspaceID string) (agent.Agent, error)
}

type WorkspaceStandardService interface {
	ListStandards(workspaceID string, repoID string) ([]workspace.Standard, error)
	SaveStandard(workspaceID string, req object.StandardRequest) (workspace.Standard, error)
	DeleteStandard(workspaceID, standardID string) error
}

type WorkspaceCICDService interface {
	// GetCICD 读取工作空间所属租户关联的全局 CICD 配置。
	GetCICD(workspaceID string) (workspace.CICD, error)
}

type WorkspaceWorkitemProjectService interface {
	SetWorkitemProject(workspaceID string, req object.WorkitemProjectRequest) (workspace.WorkitemProject, error)
	GetWorkitemProject(workspaceID string) (workspace.WorkitemProject, error)
}

// WorkspaceService 定义 workspace 模块的服务接口。
type WorkspaceService interface {
	WorkspaceCRUDService
	WorkspaceDirectoryService
	WorkspaceMemberService
	WorkspaceAgentService
	WorkspaceStandardService
	WorkspaceCICDService
	CICDConfigService
	WorkspaceWorkitemProjectService
}
