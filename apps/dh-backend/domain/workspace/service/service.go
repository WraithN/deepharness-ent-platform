package service

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
)

// WorkspaceService 定义 workspace 模块的服务接口。
type WorkspaceService interface {
	CreateWorkspace(tenantID, name, description, ownerUserID string) (workspace.Workspace, error)
	GetWorkspace(id string) (workspace.Workspace, error)
	ListWorkspaces(tenantID string) ([]workspace.Workspace, error)

	AddMember(workspaceID, userID, role, subRole string) error
	ListMembers(workspaceID string) ([]workspace.Member, error)
	RemoveMember(workspaceID, userID string) error

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
