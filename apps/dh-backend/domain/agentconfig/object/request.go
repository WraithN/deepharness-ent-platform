package object

import "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

// SaveWorkspaceConfigRequest 保存空间级智能体配置的请求参数。
type SaveWorkspaceConfigRequest struct {
	AgentKey       string                     `json:"agentKey"`
	Enabled        bool                       `json:"enabled"`
	IsDefault      bool                       `json:"isDefault"`
	Model          string                     `json:"model"`
	ModelSource    string                     `json:"modelSource"`
	BaseURL        string                     `json:"baseUrl"`
	APIKey         string                     `json:"apiKey"`
	Temperature    *float64                   `json:"temperature,omitempty"`
	// Timeout 为 SSE 看门狗无事件超时阈值（秒），默认 120 秒。
	Timeout        *int                        `json:"timeout,omitempty"`
	AdvancedConfig *agent.AdvancedAgentConfig `json:"advancedConfig,omitempty"`
}
