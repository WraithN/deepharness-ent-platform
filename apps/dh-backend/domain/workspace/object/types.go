package object

import (
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
)

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

// CICDConfigRequest 保存全局 CICD 配置请求。
type CICDConfigRequest struct {
	Name            string `json:"name"`
	TriggerBranches string `json:"triggerBranches"`
	WebhookURL      string `json:"webhookUrl"`
	Script          string `json:"script"`
	Config          any    `json:"config,omitempty"`
}

// MineWorkspace 表示当前用户加入的工作空间及其成员关系。
type MineWorkspace struct {
	workspace.Workspace
	Role       string   `json:"role"`
	SubRoles   []string `json:"subRoles"`
	TenantName string   `json:"tenantName"`
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

// 市场提示词审核状态常量（与 team/service 的 PromptStatus 取值保持一致，避免跨包循环依赖）。
const (
	PromptStatusPendingReview = "pending_review"
	PromptStatusOnShelf       = "on_shelf"
)

// WorkspacePrompt 表示某个工作空间下的提示词引用或自定义提示词。
type WorkspacePrompt struct {
	ID              string           `json:"id"`
	WorkspaceID     string           `json:"workspaceId"`
	LibraryPromptID *string          `json:"libraryPromptId,omitempty"`
	Categories      []PromptCategory `json:"categories"`
	Name            string           `json:"name"`
	Description     string           `json:"description"`
	Content         string           `json:"content"`
	UseCase         string           `json:"useCase"`
	UsageCount      int              `json:"usageCount"`
	IsCustom        bool             `json:"isCustom"`
	AddedToSpace    bool             `json:"addedToSpace"`
	Enabled         bool             `json:"enabled"`
	// CreatedBy/CreatedByName 记录将该提示词加入空间的用户（市场快照为添加人，自定义/副本为创建人）。
	CreatedBy     string `json:"createdBy,omitempty"`
	CreatedByName string `json:"createdByName,omitempty"`
	// SharedPromptID/ShareStatus 记录该提示词分享到市场后的审核条目与状态（pending_review/on_shelf/rejected/off_shelf）。
	SharedPromptID *string   `json:"sharedPromptId,omitempty"`
	ShareStatus    string    `json:"shareStatus,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// PromptCategory 表示某个工作空间下的提示词分类，每个空间独立管理。
type PromptCategory struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Name        string    `json:"name"`
	IsBuiltin   bool      `json:"isBuiltin"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// AddWorkspacePromptRequest 从提示词库添加到工作空间的请求。
type AddWorkspacePromptRequest struct {
	LibraryPromptID string `json:"libraryPromptId"`
}

// CreateWorkspacePromptRequest 在空间内直接创建自定义提示词（非市场来源）的请求。
// 用于「将会话/文本保存为提示词」等场景，创建出的提示词 library_prompt_id 为空、is_custom=true。
type CreateWorkspacePromptRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Content     string   `json:"content"`
	UseCase     string   `json:"useCase"`
	CategoryIDs []string `json:"categoryIds"`
}

// UpdateWorkspacePromptCategoryRequest 更新空间提示词分类的请求。
type UpdateWorkspacePromptCategoryRequest struct {
	CategoryIDs []string `json:"categoryIds"`
}

// UpdateWorkspacePromptEnabledRequest 更新空间提示词启用状态的请求。
type UpdateWorkspacePromptEnabledRequest struct {
	Enabled *bool `json:"enabled"`
}

// UpdateWorkspacePromptContentRequest 更新空间自定义提示词内容的请求。
// 仅允许修改非市场来源（library_prompt_id 为空）的自定义提示词。
type UpdateWorkspacePromptContentRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	UseCase     string `json:"useCase"`
}
