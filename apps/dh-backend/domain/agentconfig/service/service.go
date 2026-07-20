package service

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
)

// AgentConfigService 管理全局智能体类型与空间级智能体配置。
type AgentConfigService interface {
	// ListAgentTypes 返回平台级智能体类型列表（含启停状态）。
	ListAgentTypes() ([]agent.AgentType, error)
	// UpdateAgentType 更新平台级智能体类型的启停状态等元数据。
	UpdateAgentType(key string, enabled bool) (agent.AgentType, error)
	// GetAgentType 返回指定平台级智能体类型。
	GetAgentType(key string) (agent.AgentType, error)
	// ListGlobalModelGroups 返回全局配置中按厂商分组的模型池。
	// 未配置厂商分组时回退为单一「内置模型」分组，保证前端始终可用。
	ListGlobalModelGroups() []agent.ModelVendorGroup

	// ListWorkspaceConfigs 返回某空间下所有智能体配置。
	ListWorkspaceConfigs(workspaceID string) ([]agent.WorkspaceAgentConfig, error)
	// GetWorkspaceConfig 返回某空间下指定智能体的配置。
	GetWorkspaceConfig(workspaceID, agentKey string) (agent.WorkspaceAgentConfig, error)
	// SaveWorkspaceConfig 保存或更新空间级智能体配置。
	SaveWorkspaceConfig(workspaceID string, req SaveWorkspaceConfigRequest) (agent.WorkspaceAgentConfig, error)
	// CanModifyWorkspaceConfig 判断指定空间的智能体配置是否允许修改。
	CanModifyWorkspaceConfig(workspaceID, agentKey string) error
	// ListAvailableAgents 返回某空间下实际可用的智能体列表（全局启用 + 空间启用）。
	ListAvailableAgents(workspaceID string) ([]agent.AvailableAgent, error)
}

// SaveWorkspaceConfigRequest 保存空间级智能体配置的请求参数。
type SaveWorkspaceConfigRequest struct {
	AgentKey       string                      `json:"agentKey"`
	Enabled        bool                        `json:"enabled"`
	IsDefault      bool                        `json:"isDefault"`
	Model          string                      `json:"model"`
	ModelSource    string                      `json:"modelSource"`
	BaseURL        string                      `json:"baseUrl"`
	APIKey         string                      `json:"apiKey"`
	Temperature    *float64                    `json:"temperature,omitempty"`
	AdvancedConfig *agent.AdvancedAgentConfig  `json:"advancedConfig,omitempty"`
}
