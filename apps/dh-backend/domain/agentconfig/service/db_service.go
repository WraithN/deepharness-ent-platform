package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/google/uuid"
)

// DBAgentConfigService 是基于 PostgreSQL 的 AgentConfigService 实现。
type DBAgentConfigService struct {
	db *sql.DB
}

// builtinAgentTypes 为系统内置智能体类型，作为平台目录的初始值。
var builtinAgentTypes = []agent.AgentType{
	{Key: "opencode", Name: "OpenCode", Description: "开源编码智能体，支持多种编程语言和框架", Enabled: true, Builtin: true},
	{Key: "claude-code", Name: "Claude Code", Description: "Anthropic 推出的编码助手，擅长复杂逻辑推理", Enabled: true, Builtin: true},
	{Key: "cursor-agent", Name: "Cursor Agent", Description: "基于 GPT-4 的智能编码代理", Enabled: false, Builtin: true},
	{Key: "codex", Name: "Codex", Description: "OpenAI Codex，专为软件工程优化的 AI 模型", Enabled: true, Builtin: true},
}

// NewDBAgentConfigService 创建 PostgreSQL 实现的智能体配置服务。
func NewDBAgentConfigService(db *sql.DB) *DBAgentConfigService {
	svc := &DBAgentConfigService{db: db}
	if err := svc.seedBuiltinAgentTypes(); err != nil {
		// 初始化种子失败不应阻塞启动，仅记录日志。
		fmt.Printf("[AgentConfig] seed builtin agent types failed: %v\n", err)
	}
	return svc
}

// seedBuiltinAgentTypes 确保内置智能体类型记录存在。
func (s *DBAgentConfigService) seedBuiltinAgentTypes() error {
	now := time.Now().UTC()
	for _, at := range builtinAgentTypes {
		_, err := s.db.Exec(`
			INSERT INTO platform_agent_types (agent_key, name, description, enabled, builtin, created_at, updated_at)
			VALUES ($1, $2, $3, $4, TRUE, $5, $5)
			ON CONFLICT (agent_key) DO NOTHING
		`, at.Key, at.Name, at.Description, at.Enabled, now)
		if err != nil {
			return fmt.Errorf("seed agent type %s failed: %w", at.Key, err)
		}
	}
	return nil
}

// ListAgentTypes 返回平台级智能体类型列表。
func (s *DBAgentConfigService) ListAgentTypes() ([]agent.AgentType, error) {
	rows, err := s.db.Query(`
		SELECT agent_key, name, description, enabled, builtin, created_at, updated_at
		FROM platform_agent_types
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list agent types failed: %w", err)
	}
	defer rows.Close()

	result := make([]agent.AgentType, 0)
	for rows.Next() {
		var at agent.AgentType
		if err := rows.Scan(&at.Key, &at.Name, &at.Description, &at.Enabled, &at.Builtin, &at.CreatedAt, &at.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan agent type failed: %w", err)
		}
		result = append(result, at)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agent types failed: %w", err)
	}
	return result, nil
}

// UpdateAgentType 更新平台级智能体类型的启用状态。
func (s *DBAgentConfigService) UpdateAgentType(key string, enabled bool) (agent.AgentType, error) {
	now := time.Now().UTC()
	res, err := s.db.Exec(`
		UPDATE platform_agent_types
		SET enabled = $1, updated_at = $2
		WHERE agent_key = $3
	`, enabled, now, key)
	if err != nil {
		return agent.AgentType{}, fmt.Errorf("update agent type failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return agent.AgentType{}, fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return agent.AgentType{}, errors.New("agent type not found")
	}
	return s.GetAgentType(key)
}

// GetAgentType 返回指定平台级智能体类型。
func (s *DBAgentConfigService) GetAgentType(key string) (agent.AgentType, error) {
	var at agent.AgentType
	err := s.db.QueryRow(`
		SELECT agent_key, name, description, enabled, builtin, created_at, updated_at
		FROM platform_agent_types WHERE agent_key = $1
	`, key).Scan(&at.Key, &at.Name, &at.Description, &at.Enabled, &at.Builtin, &at.CreatedAt, &at.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return agent.AgentType{}, errors.New("agent type not found")
	}
	if err != nil {
		return agent.AgentType{}, fmt.Errorf("get agent type failed: %w", err)
	}
	return at, nil
}

// ListWorkspaceConfigs 返回某空间下所有智能体配置，未配置的智能体返回默认空配置。
func (s *DBAgentConfigService) ListWorkspaceConfigs(workspaceID string) ([]agent.WorkspaceAgentConfig, error) {
	if workspaceID == "" {
		return nil, errors.New("workspace id is required")
	}

	// 先取出平台目录，再左联空间配置。
	rows, err := s.db.Query(`
		SELECT t.agent_key, t.name, t.description, t.enabled,
			c.id, c.enabled, c.model, c.model_source, c.base_url, c.api_key,
			c.temperature, c.max_tokens, c.context_window, c.advanced_config,
			c.created_at, c.updated_at
		FROM platform_agent_types t
		LEFT JOIN workspace_agent_configs c
			ON c.workspace_id = $1 AND c.agent_key = t.agent_key
		ORDER BY t.created_at ASC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace configs failed: %w", err)
	}
	defer rows.Close()

	result := make([]agent.WorkspaceAgentConfig, 0)
	for rows.Next() {
		cfg, err := scanWorkspaceAgentConfig(workspaceID, rows)
		if err != nil {
			fmt.Printf("[AgentConfig] scan workspace config failed: %v\n", err)
			return nil, err
		}
		result = append(result, cfg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace configs failed: %w", err)
	}
	return result, nil
}

// GetWorkspaceConfig 返回某空间下指定智能体的配置。
func (s *DBAgentConfigService) GetWorkspaceConfig(workspaceID, agentKey string) (agent.WorkspaceAgentConfig, error) {
	row := s.db.QueryRow(`
		SELECT t.agent_key, t.name, t.description, t.enabled,
			c.id, c.enabled, c.model, c.model_source, c.base_url, c.api_key,
			c.temperature, c.max_tokens, c.context_window, c.advanced_config,
			c.created_at, c.updated_at
		FROM platform_agent_types t
		LEFT JOIN workspace_agent_configs c
			ON c.workspace_id = $1 AND c.agent_key = t.agent_key
		WHERE t.agent_key = $2
	`, workspaceID, agentKey)
	return scanWorkspaceAgentConfig(workspaceID, row)
}

// SaveWorkspaceConfig 保存或更新空间级智能体配置。
func (s *DBAgentConfigService) SaveWorkspaceConfig(workspaceID string, req SaveWorkspaceConfigRequest) (agent.WorkspaceAgentConfig, error) {
	if workspaceID == "" {
		return agent.WorkspaceAgentConfig{}, errors.New("workspace id is required")
	}
	if req.AgentKey == "" {
		return agent.WorkspaceAgentConfig{}, errors.New("agentKey is required")
	}

	// 校验智能体类型是否存在。
	if _, err := s.GetAgentType(req.AgentKey); err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}

	advancedJSON, err := marshalAdvancedConfig(req.AdvancedConfig)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}

	now := time.Now().UTC()
	id := uuid.New().String()

	_, err = s.db.Exec(`
		INSERT INTO workspace_agent_configs (
			id, workspace_id, agent_key, enabled, model, model_source, base_url, api_key,
			temperature, max_tokens, context_window, advanced_config, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
		ON CONFLICT (workspace_id, agent_key) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			model = EXCLUDED.model,
			model_source = EXCLUDED.model_source,
			base_url = EXCLUDED.base_url,
			api_key = EXCLUDED.api_key,
			temperature = EXCLUDED.temperature,
			max_tokens = EXCLUDED.max_tokens,
			context_window = EXCLUDED.context_window,
			advanced_config = EXCLUDED.advanced_config,
			updated_at = EXCLUDED.updated_at
	`, id, workspaceID, req.AgentKey, req.Enabled, req.Model, req.ModelSource, req.BaseURL, req.APIKey,
		req.Temperature, advancedJSON.MaxTokens, advancedJSON.ContextWindow, advancedJSON.Raw, now)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, fmt.Errorf("save workspace config failed: %w", err)
	}

	return s.GetWorkspaceConfig(workspaceID, req.AgentKey)
}

// ListAvailableAgents 返回某空间下实际可用的智能体列表。
func (s *DBAgentConfigService) ListAvailableAgents(workspaceID string) ([]agent.AvailableAgent, error) {
	configs, err := s.ListWorkspaceConfigs(workspaceID)
	if err != nil {
		return nil, err
	}

	result := make([]agent.AvailableAgent, 0)
	for _, cfg := range configs {
		// 仅当平台启用且空间启用时才对外展示。
		if !cfg.Enabled {
			continue
		}
		result = append(result, agent.AvailableAgent{
			AgentKey:    cfg.AgentKey,
			Name:        agentDisplayName(cfg.AgentKey),
			Description: "",
			Model:       cfg.Model,
		})
	}
	return result, nil
}

// agentDisplayName 根据 agent_key 返回友好的显示名称。
func agentDisplayName(key string) string {
	switch key {
	case "opencode":
		return "OpenCode"
	case "claude-code":
		return "Claude Code"
	case "cursor-agent":
		return "Cursor Agent"
	case "codex":
		return "Codex"
	default:
		return key
	}
}

// advancedConfigJSON 用于把高级配置拆分为独立列 + raw JSON。
type advancedConfigJSON struct {
	MaxTokens     *int
	ContextWindow *int
	Raw           sql.NullString
}

func marshalAdvancedConfig(cfg *agent.AdvancedAgentConfig) (advancedConfigJSON, error) {
	var result advancedConfigJSON
	if cfg == nil {
		return result, nil
	}
	result.MaxTokens = cfg.MaxTokens
	result.ContextWindow = cfg.ContextWindow
	raw, err := json.Marshal(cfg)
	if err != nil {
		return result, fmt.Errorf("marshal advanced config failed: %w", err)
	}
	result.Raw = sql.NullString{String: string(raw), Valid: true}
	return result, nil
}

func unmarshalAdvancedConfig(maxTokens, contextWindow sql.NullInt32, raw sql.NullString) (*agent.AdvancedAgentConfig, error) {
	var cfg agent.AdvancedAgentConfig
	if raw.Valid && raw.String != "" {
		if err := json.Unmarshal([]byte(raw.String), &cfg); err != nil {
			return nil, fmt.Errorf("unmarshal advanced config failed: %w", err)
		}
	}
	if maxTokens.Valid {
		v := int(maxTokens.Int32)
		cfg.MaxTokens = &v
	}
	if contextWindow.Valid {
		v := int(contextWindow.Int32)
		cfg.ContextWindow = &v
	}
	if cfg.MaxTokens == nil && cfg.ContextWindow == nil && cfg.Extra == nil {
		return nil, nil
	}
	return &cfg, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanWorkspaceAgentConfig(workspaceID string, row scanner) (agent.WorkspaceAgentConfig, error) {
	var cfg agent.WorkspaceAgentConfig
	cfg.WorkspaceID = workspaceID
	var platformEnabled bool
	var configEnabled sql.NullBool
	var id, model, modelSource, baseURL, apiKey sql.NullString
	var temperature sql.NullFloat64
	var maxTokens, contextWindow sql.NullInt32
	var advancedRaw sql.NullString
	var createdAt, updatedAt sql.NullTime

	err := row.Scan(
		&cfg.AgentKey, &cfg.Name, &cfg.Description, &platformEnabled,
		&id, &configEnabled, &model, &modelSource, &baseURL, &apiKey,
		&temperature, &maxTokens, &contextWindow, &advancedRaw,
		&createdAt, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return agent.WorkspaceAgentConfig{}, errors.New("workspace agent config not found")
	}
	if err != nil {
		return agent.WorkspaceAgentConfig{}, fmt.Errorf("scan workspace agent config failed: %w", err)
	}

	// 未配置过的工作空间智能体默认启用，沿用平台级设置。
	if configEnabled.Valid {
		cfg.Enabled = configEnabled.Bool
	} else {
		cfg.Enabled = true
	}

	cfg.ID = sqlutil.ScanNullString(id)
	cfg.Model = sqlutil.ScanNullString(model)
	cfg.ModelSource = sqlutil.ScanNullString(modelSource)
	cfg.BaseURL = sqlutil.ScanNullString(baseURL)
	cfg.APIKey = sqlutil.ScanNullString(apiKey)
	cfg.CreatedAt = sqlutil.ScanNullTime(createdAt)
	cfg.UpdatedAt = sqlutil.ScanNullTime(updatedAt)

	if temperature.Valid {
		v := temperature.Float64
		cfg.Temperature = &v
	}

	cfg.AdvancedConfig, err = unmarshalAdvancedConfig(maxTokens, contextWindow, advancedRaw)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}

	// 若平台级已禁用，则空间级也视为禁用。
	if !platformEnabled {
		cfg.Enabled = false
	}

	return cfg, nil
}
