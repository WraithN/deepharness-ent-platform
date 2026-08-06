package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/lib/pq"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// AgentGlobalConfig 保存来自 config.yaml 的全局 agent 与模型配置。
type AgentGlobalConfig struct {
	Agents []agent.AgentType
	// Models 为平铺模型池（由 ModelVendors 展开或旧的平铺配置），
	// 作为未配置厂商分组时的回退来源。
	Models []string
	// ModelVendors 按厂商分组的模型池，前端模型下拉框据此分组展示。
	ModelVendors []agent.ModelVendorGroup
}

const (
	// defaultModelVendorGroupKey/Name 是未配置厂商分组时回退使用的单一分组标识与名称。
	defaultModelVendorGroupKey  = "default"
	defaultModelVendorGroupName = "内置模型"
	// defaultAgentTimeoutSeconds 是 SSE 看门狗无事件超时阈值默认值（秒）。
	defaultAgentTimeoutSeconds = 120
)

// DBAgentConfigService 是基于 PostgreSQL 的 AgentConfigService 实现。
type DBAgentConfigService struct {
	db        *sql.DB
	globalCfg AgentGlobalConfig
}

// defaultBuiltinAgentTypes 为未配置全局 agent 时的默认内置智能体类型。
var defaultBuiltinAgentTypes = []agent.AgentType{
	{Key: "opencode", Name: "OpenCode", Description: "开源编码智能体，支持多种编程语言和框架", Enabled: true, Builtin: true},
	{Key: "claude-code", Name: "Claude Code", Description: "Anthropic 推出的编码助手，擅长复杂逻辑推理", Enabled: true, Builtin: true},
	{Key: "codex", Name: "Codex", Description: "OpenAI Codex，专为软件工程优化的 AI 模型", Enabled: true, Builtin: true},
}

// NewDBAgentConfigService 创建 PostgreSQL 实现的智能体配置服务。
func NewDBAgentConfigService(db *sql.DB, cfg AgentGlobalConfig) *DBAgentConfigService {
	svc := &DBAgentConfigService{db: db, globalCfg: cfg}
	if err := svc.seedBuiltinAgentTypes(); err != nil {
		// 初始化种子失败不应阻塞启动，仅记录日志。
		log.Printf("[AgentConfig] seed builtin agent types failed: %v", err)
	}
	return svc
}

// builtinAgentTypes 返回实际用于数据库种子的智能体类型列表。
func (s *DBAgentConfigService) builtinAgentTypes() []agent.AgentType {
	if len(s.globalCfg.Agents) > 0 {
		return s.globalCfg.Agents
	}
	return defaultBuiltinAgentTypes
}

// seedBuiltinAgentTypes 确保内置智能体类型记录存在。
func (s *DBAgentConfigService) seedBuiltinAgentTypes() error {
	now := time.Now().UTC()
	for _, at := range s.builtinAgentTypes() {
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

// ListGlobalModelGroups 返回全局配置中按厂商分组的模型池。
// 未配置厂商分组时将平铺模型池包装为单一「内置模型」分组，保证前端始终可展示。
func (s *DBAgentConfigService) ListGlobalModelGroups() []agent.ModelVendorGroup {
	if len(s.globalCfg.ModelVendors) > 0 {
		return s.globalCfg.ModelVendors
	}
	if len(s.globalCfg.Models) > 0 {
		return []agent.ModelVendorGroup{{
			Key:    defaultModelVendorGroupKey,
			Name:   defaultModelVendorGroupName,
			Models: s.globalCfg.Models,
		}}
	}
	return []agent.ModelVendorGroup{}
}

// ListAgentTypes 返回平台级智能体类型列表，按全局配置过滤。
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

	allowed := make(map[string]bool, len(s.globalCfg.Agents))
	for _, a := range s.globalCfg.Agents {
		allowed[a.Key] = true
	}

	result := make([]agent.AgentType, 0)
	for rows.Next() {
		var at agent.AgentType
		if err := rows.Scan(&at.Key, &at.Name, &at.Description, &at.Enabled, &at.Builtin, &at.CreatedAt, &at.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan agent type failed: %w", err)
		}
		// 全局配置为空时兼容旧数据，不过滤。
		if len(allowed) > 0 && !allowed[at.Key] {
			continue
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
		return agent.AgentType{}, common.NotFoundErrorf("agent type not found")
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
		return agent.AgentType{}, common.NotFoundErrorf("agent type not found")
	}
	if err != nil {
		return agent.AgentType{}, fmt.Errorf("get agent type failed: %w", err)
	}
	return at, nil
}

// workspaceAgentPolicy 表示工作空间维度的智能体策略。
type workspaceAgentPolicy struct {
	locked         bool
	lockedKeys     map[string]bool
	allowedKeys    map[string]bool
	defaultConfigs map[string]agent.WorkspaceAgentConfig
}

// getWorkspaceAgentPolicy 读取工作空间所属租户的智能体策略。
// 智能体策略统一存储在 tenants 表，同一租户下所有空间共享。
func (s *DBAgentConfigService) getWorkspaceAgentPolicy(workspaceID string) (workspaceAgentPolicy, error) {
	var locked bool
	var raw []byte
	var lockedKeysArr pq.StringArray
	var allowedKeys pq.StringArray
	err := s.db.QueryRow(`
		SELECT t.agent_config_locked, t.locked_agent_keys, t.allowed_agent_keys, t.default_agent_configs
		FROM workspaces w
		JOIN tenants t ON t.id = w.tenant_id
		WHERE w.id = $1
	`, workspaceID).Scan(&locked, &lockedKeysArr, &allowedKeys, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return workspaceAgentPolicy{}, common.NotFoundErrorf("workspace not found")
	}
	if err != nil {
		return workspaceAgentPolicy{}, fmt.Errorf("get tenant policy failed: %w", err)
	}

	policy := workspaceAgentPolicy{
		locked:      locked,
		lockedKeys:  make(map[string]bool, len(lockedKeysArr)),
		allowedKeys: make(map[string]bool, len(allowedKeys)),
	}
	for _, k := range lockedKeysArr {
		policy.lockedKeys[k] = true
	}
	for _, k := range allowedKeys {
		policy.allowedKeys[k] = true
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &policy.defaultConfigs); err != nil {
			return workspaceAgentPolicy{}, fmt.Errorf("unmarshal default agent configs failed: %w", err)
		}
	}
	return policy, nil
}

// isAgentAllowed 判断 agent key 是否被空间策略允许。
func (p workspaceAgentPolicy) isAgentAllowed(key string) bool {
	// 若空间未设置允许列表，则默认允许所有全局 agent（兼容旧数据）。
	return len(p.allowedKeys) == 0 || p.allowedKeys[key]
}

// isAgentLocked 判断指定 agent 是否被锁定。
// 当整体锁定（agentConfigLocked=true）时所有 agent 均被锁定；
// 否则检查该 agent key 是否在单独锁定列表中。
func (p workspaceAgentPolicy) isAgentLocked(key string) bool {
	return p.locked || p.lockedKeys[key]
}

// applyDefaultConfig 使用超管预设的默认配置填充未配置字段。
func (p workspaceAgentPolicy) applyDefaultConfig(cfg agent.WorkspaceAgentConfig) agent.WorkspaceAgentConfig {
	defaultCfg, ok := p.defaultConfigs[cfg.AgentKey]
	if !ok {
		return cfg
	}
	if cfg.Model == "" {
		cfg.Model = defaultCfg.Model
	}
	if cfg.ModelSource == "" {
		cfg.ModelSource = defaultCfg.ModelSource
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultCfg.BaseURL
	}
	if cfg.APIKey == "" {
		cfg.APIKey = defaultCfg.APIKey
	}
	if cfg.Temperature == nil && defaultCfg.Temperature != nil {
		t := *defaultCfg.Temperature
		cfg.Temperature = &t
	}
	if cfg.Timeout == nil && defaultCfg.Timeout != nil {
		t := *defaultCfg.Timeout
		cfg.Timeout = &t
	}
	if cfg.AdvancedConfig == nil && defaultCfg.AdvancedConfig != nil {
		cfg.AdvancedConfig = defaultCfg.AdvancedConfig
	}
	return cfg
}

// ListWorkspaceConfigs 返回某空间下所有智能体配置，受空间策略过滤并用默认配置初始化。
func (s *DBAgentConfigService) ListWorkspaceConfigs(workspaceID string) ([]agent.WorkspaceAgentConfig, error) {
	if workspaceID == "" {
		return nil, errors.New("workspace id is required")
	}

	policy, err := s.getWorkspaceAgentPolicy(workspaceID)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT t.agent_key, t.name, t.description, t.enabled,
			c.id, c.enabled, c.is_default, c.model, c.model_source, c.base_url, c.api_key,
			c.temperature, c.max_tokens, c.context_window, c.timeout, c.advanced_config,
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
			log.Printf("[AgentConfig] scan workspace config failed: %v", err)
			return nil, err
		}
		if !policy.isAgentAllowed(cfg.AgentKey) {
			continue
		}
		cfg = policy.applyDefaultConfig(cfg)
		result = append(result, cfg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace configs failed: %w", err)
	}
	return result, nil
}

// GetWorkspaceConfig 返回某空间下指定智能体的配置。
func (s *DBAgentConfigService) GetWorkspaceConfig(workspaceID, agentKey string) (agent.WorkspaceAgentConfig, error) {
	policy, err := s.getWorkspaceAgentPolicy(workspaceID)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}
	if !policy.isAgentAllowed(agentKey) {
		return agent.WorkspaceAgentConfig{}, errors.New("agent not allowed in this workspace")
	}

	row := s.db.QueryRow(`
		SELECT t.agent_key, t.name, t.description, t.enabled,
			c.id, c.enabled, c.is_default, c.model, c.model_source, c.base_url, c.api_key,
			c.temperature, c.max_tokens, c.context_window, c.timeout, c.advanced_config,
			c.created_at, c.updated_at
		FROM platform_agent_types t
		LEFT JOIN workspace_agent_configs c
			ON c.workspace_id = $1 AND c.agent_key = t.agent_key
		WHERE t.agent_key = $2
	`, workspaceID, agentKey)
	cfg, err := scanWorkspaceAgentConfig(workspaceID, row)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}
	return policy.applyDefaultConfig(cfg), nil
}

// CanModifyWorkspaceConfig 判断指定空间的智能体配置是否允许修改。
// 整体锁定或该 agent 被单独锁定时返回错误。
func (s *DBAgentConfigService) CanModifyWorkspaceConfig(workspaceID, agentKey string) error {
	policy, err := s.getWorkspaceAgentPolicy(workspaceID)
	if err != nil {
		return err
	}
	if policy.isAgentLocked(agentKey) {
		return errors.New("agent config is locked for this workspace")
	}
	if !policy.isAgentAllowed(agentKey) {
		return errors.New("agent not allowed in this workspace")
	}
	return nil
}

// SaveWorkspaceConfig 保存或更新空间级智能体配置。
func (s *DBAgentConfigService) SaveWorkspaceConfig(workspaceID string, req object.SaveWorkspaceConfigRequest) (agent.WorkspaceAgentConfig, error) {
	if workspaceID == "" {
		return agent.WorkspaceAgentConfig{}, errors.New("workspace id is required")
	}
	if req.AgentKey == "" {
		return agent.WorkspaceAgentConfig{}, errors.New("agentKey is required")
	}

	if err := s.CanModifyWorkspaceConfig(workspaceID, req.AgentKey); err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}

	// 校验智能体类型是否存在。
	if _, err := s.GetAgentType(req.AgentKey); err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}

	advancedJSON, err := marshalAdvancedConfig(req.AdvancedConfig)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}

	// 未指定超时阈值时写入默认值 120 秒，与 gatewayd 插件默认值保持一致。
	if req.Timeout == nil {
		t := defaultAgentTimeoutSeconds
		req.Timeout = &t
	}

	now := time.Now().UTC()
	id := idutil.GenerateID()

	// 开启事务保存配置；若设置为默认智能体，先清空同空间其他默认智能体，确保最多只有一个默认。
	tx, err := s.db.Begin()
	if err != nil {
		return agent.WorkspaceAgentConfig{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.Exec(`UPDATE workspace_agent_configs SET is_default = false WHERE workspace_id = $1`, workspaceID); err != nil {
			return agent.WorkspaceAgentConfig{}, fmt.Errorf("clear default agent failed: %w", err)
		}
	}

	_, err = tx.Exec(`
		INSERT INTO workspace_agent_configs (
			id, workspace_id, agent_key, enabled, is_default, model, model_source, base_url, api_key,
			temperature, max_tokens, context_window, timeout, advanced_config, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
		ON CONFLICT (workspace_id, agent_key) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			is_default = EXCLUDED.is_default,
			model = EXCLUDED.model,
			model_source = EXCLUDED.model_source,
			base_url = EXCLUDED.base_url,
			api_key = EXCLUDED.api_key,
			temperature = EXCLUDED.temperature,
			max_tokens = EXCLUDED.max_tokens,
			context_window = EXCLUDED.context_window,
			timeout = EXCLUDED.timeout,
			advanced_config = EXCLUDED.advanced_config,
			updated_at = EXCLUDED.updated_at
	`, id, workspaceID, req.AgentKey, req.Enabled, req.IsDefault, req.Model, req.ModelSource, req.BaseURL, req.APIKey,
		req.Temperature, advancedJSON.MaxTokens, advancedJSON.ContextWindow, req.Timeout, advancedJSON.Raw, now)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, fmt.Errorf("save workspace config failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return agent.WorkspaceAgentConfig{}, fmt.Errorf("commit failed: %w", err)
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
		// 仅当空间启用时才对外展示。
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
	var isDefault sql.NullBool
	var id, model, modelSource, baseURL, apiKey sql.NullString
	var temperature sql.NullFloat64
	var maxTokens, contextWindow, timeout sql.NullInt32
	var advancedRaw sql.NullString
	var createdAt, updatedAt sql.NullTime

	err := row.Scan(
		&cfg.AgentKey, &cfg.Name, &cfg.Description, &platformEnabled,
		&id, &configEnabled, &isDefault, &model, &modelSource, &baseURL, &apiKey,
		&temperature, &maxTokens, &contextWindow, &timeout, &advancedRaw,
		&createdAt, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return agent.WorkspaceAgentConfig{}, common.NotFoundErrorf("workspace agent config not found")
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
	if isDefault.Valid {
		cfg.IsDefault = isDefault.Bool
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
	if timeout.Valid {
		v := int(timeout.Int32)
		cfg.Timeout = &v
	}

	cfg.AdvancedConfig, err = unmarshalAdvancedConfig(maxTokens, contextWindow, advancedRaw)
	if err != nil {
		return agent.WorkspaceAgentConfig{}, err
	}

	return cfg, nil
}
