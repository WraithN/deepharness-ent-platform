package agent

import "time"

// Agent 表示 AI Agent 配置。
type Agent struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Name            string    `json:"name"`
	Role            string    `json:"role"`
	Description     string    `json:"description"`
	Config          any       `json:"config,omitempty"`
	IsDefault       bool      `json:"isDefault"`
	CreatedByUserID string    `json:"createdByUserId"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// Session 表示 Agent 会话。
type Session struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	AgentID     string    `json:"agentId"`
	Title       string    `json:"title"`
	Model       string    `json:"model"`
	Context     any       `json:"context,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Message 表示会话消息。
type Message struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Role      string    `json:"role"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
	Metadata  any       `json:"metadata,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// AgentType 表示平台级智能体类型元数据。
type AgentType struct {
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Enabled     bool      `json:"enabled"`
	Builtin     bool      `json:"builtin"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// AdvancedAgentConfig 表示智能体高级配置参数。
type AdvancedAgentConfig struct {
	MaxTokens        *int           `json:"maxTokens,omitempty"`
	ContextWindow    *int           `json:"contextWindow,omitempty"`
	TopP             *float64       `json:"topP,omitempty"`
	TopK             *int           `json:"topK,omitempty"`
	FrequencyPenalty *float64       `json:"frequencyPenalty,omitempty"`
	PresencePenalty  *float64       `json:"presencePenalty,omitempty"`
	Extra            map[string]any `json:"extra,omitempty"`
}

// WorkspaceAgentConfig 表示空间级智能体运行时配置。
type WorkspaceAgentConfig struct {
	ID              string              `json:"id"`
	WorkspaceID     string              `json:"workspaceId"`
	AgentKey        string              `json:"agentKey"`
	Name            string              `json:"name"`
	Description     string              `json:"description"`
	Enabled         bool                `json:"enabled"`
	IsDefault       bool                `json:"isDefault"`
	Model           string              `json:"model"`
	ModelSource     string              `json:"modelSource"`
	BaseURL         string              `json:"baseUrl"`
	APIKey          string              `json:"apiKey"`
	Temperature     *float64            `json:"temperature,omitempty"`
	// Timeout 为 SSE 看门狗无事件超时阈值（秒），默认 120 秒。
	// 保存后会通过 /sessions/{sessionId}/agents/{instanceId}/config 同步到 gatewayd。
	Timeout         *int                `json:"timeout,omitempty"`
	AdvancedConfig  *AdvancedAgentConfig `json:"advancedConfig,omitempty"`
	CreatedAt       time.Time           `json:"createdAt"`
	UpdatedAt       time.Time           `json:"updatedAt"`
}

// ModelVendorGroup 表示按厂商分组的模型池。
// 厂商清单在 config.yaml 的 coding_agents.model_vendors 中配置，
// 前端模型下拉框据此按厂商分组展示，避免长列表平铺。
type ModelVendorGroup struct {
	Key    string   `json:"key"`
	Name   string   `json:"name"`
	Models []string `json:"models"`
}

// AvailableAgent 表示前端智能体选择器中展示的智能体项。
type AvailableAgent struct {
	AgentKey    string  `json:"agentKey"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Model       string  `json:"model"`
}
