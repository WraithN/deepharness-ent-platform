package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const configFileName = "config.yaml"

// Config 保存后端运行时的所有可配置项。所有值必须从 config.yaml 或环境变量获取。
type Config struct {
	Port             string
	SessionStoreType string
	MessageStoreType string
	BufferStoreType  string
	GatewaydAdminURL string
	GatewaydAgentID  string
	SessionTimeout   time.Duration
	DBHost           string
	DBPort           string
	DBUser           string
	DBPassword       string
	DBName           string
	WorkspaceRoot    string
	// PersonalStubURL 是 personal-stub 服务地址，用于代理文件/工程/预览相关请求。
	// personal-stub 部署在 WORKSPACE_ROOT 所在的服务器上，直接操作文件系统和 git。
	PersonalStubURL string

	// Redis（Buffer 存储后端，可选）
	RedisAddrs    []string
	RedisPassword string
	RedisDB       int
	RedisPrefix   string

	// Database connection pool
	DBMaxOpenConns    int
	DBMaxIdleConns    int
	DBConnMaxLifetime time.Duration

	// Chat / Message
	MaxMessagesPerSession int

	// ProductSpace 产品空间文档采纳后源文件清理配置。
	DocAdoptionCleanupEnabled      bool
	DocAdoptionCleanupRetentionDays int
	DocAdoptionCleanupInterval     time.Duration

	// Workitem external integration
	WorkitemPlatformWhitelist []string
	WorkitemSyncInterval      time.Duration
	WorkitemSyncWorkers       int
	WorkitemSyncTimeout       time.Duration
	WorkitemWritebackEnabled  bool
	WorkitemWritebackWorkers  int
	WorkitemWritebackRetry    int

	// CodingAgents 平台支持的 coding agent 白名单。
	CodingAgents []CodingAgentDefinition
	// CodingAgentModels 平台支持的模型池（由 model_vendors 展开，或旧的平铺 models）。
	CodingAgentModels []string
	// CodingAgentModelVendors 按厂商分组的模型池，供前端分组下拉展示。
	CodingAgentModelVendors []ModelVendorGroup

	// AgentRuntimeBearerToken 是外部 gatewayd / personal-stub 上报运行状态时必须携带的 Bearer Token。
	AgentRuntimeBearerToken string

	// Feishu 飞书机器人接入配置。
	// MockMode=true 时跳过签名校验并将回复输出到日志，便于本地用 curl 验证全链路；
	// MockMode=false 时按飞书事件 v2 协议校验签名并调用飞书 Open API 发送回复。
	FeishuAppID           string
	FeishuAppSecret       string
	FeishuVerifyToken     string
	FeishuEncryptKey      string
	FeishuWebhookToken    string
	FeishuAPIBaseURL      string
	FeishuBotUserID       string
	FeishuDefaultWorkspace string
	FeishuMockMode        bool
	FeishuDispatchTimeout time.Duration
	FeishuAdminUserIDs    []string
}

// CodingAgentDefinition 表示全局配置中一个 coding agent 的定义。
type CodingAgentDefinition struct {
	Key         string
	Name        string
	Description string
}

// ModelVendorGroup 表示 config.yaml 中按厂商分组的模型池。
type ModelVendorGroup struct {
	Key    string
	Name   string
	Models []string
}

// yamlConfig 与 config.yaml 的分层结构对应。
type yamlConfig struct {
	Server struct {
		Port string `yaml:"port"`
	} `yaml:"server"`
	Session struct {
		StoreType        string `yaml:"store_type"`
		MessageStoreType string `yaml:"message_store_type"`
		BufferStoreType  string `yaml:"buffer_store_type"`
		Timeout          string `yaml:"timeout"`
		MaxMessages      int    `yaml:"max_messages"`
	} `yaml:"session"`
	Redis struct {
		Addrs    []string `yaml:"addrs"`
		Password string   `yaml:"password"`
		DB       int      `yaml:"db"`
		Prefix   string   `yaml:"prefix"`
	} `yaml:"redis"`
	Gatewayd struct {
		AdminURL string `yaml:"admin_url"`
		AgentID  string `yaml:"agent_id"`
	} `yaml:"gatewayd"`
	Database struct {
		Host            string `yaml:"host"`
		Port            string `yaml:"port"`
		User            string `yaml:"user"`
		Password        string `yaml:"password"`
		Name            string `yaml:"name"`
		MaxOpenConns    int    `yaml:"max_open_conns"`
		MaxIdleConns    int    `yaml:"max_idle_conns"`
		ConnMaxLifetime string `yaml:"conn_max_lifetime"`
	} `yaml:"database"`
	Workspace struct {
		Root string `yaml:"root"`
	} `yaml:"workspace"`
	PersonalStub struct {
		URL string `yaml:"url"`
	} `yaml:"personal_stub"`
	ProductSpace struct {
		DocAdoptionCleanup struct {
			Enabled        bool   `yaml:"enabled"`
			RetentionDays  int    `yaml:"retention_days"`
			Interval       string `yaml:"interval"`
		} `yaml:"doc_adoption_cleanup"`
	} `yaml:"product_space"`
	Workitem struct {
		Platforms []string `yaml:"platforms"`
		Sync      struct {
			Interval string `yaml:"interval"`
			Workers  int    `yaml:"workers"`
			Timeout  string `yaml:"timeout"`
		} `yaml:"sync"`
		Writeback struct {
			Enabled bool `yaml:"enabled"`
			Workers int  `yaml:"workers"`
			Retry   int  `yaml:"retry"`
		} `yaml:"writeback"`
	} `yaml:"workitem"`
	CodingAgents struct {
		Agents []struct {
			Key         string `yaml:"key"`
			Name        string `yaml:"name"`
			Description string `yaml:"description"`
		} `yaml:"agents"`
		// Models 为旧的平铺模型池，保留用于兼容；
		// 当 model_vendors 配置存在时以分组配置为准并展开为平铺列表。
		Models       []string `yaml:"models"`
		ModelVendors []struct {
			Key    string   `yaml:"key"`
			Name   string   `yaml:"name"`
			Models []string `yaml:"models"`
		} `yaml:"model_vendors"`
	} `yaml:"coding_agents"`
	AgentRuntime struct {
		BearerToken string `yaml:"bearer_token"`
	} `yaml:"agent_runtime"`
	Feishu struct {
		AppID            string   `yaml:"app_id"`
		AppSecret        string   `yaml:"app_secret"`
		VerifyToken      string   `yaml:"verify_token"`
		EncryptKey       string   `yaml:"encrypt_key"`
		WebhookToken     string   `yaml:"webhook_token"`
		APIBaseURL       string   `yaml:"api_base_url"`
		BotUserID        string   `yaml:"bot_user_id"`
		DefaultWorkspace string   `yaml:"default_workspace"`
		MockMode         bool     `yaml:"mock_mode"`
		DispatchTimeout  string   `yaml:"dispatch_timeout"`
		AdminUserIDs     []string `yaml:"admin_user_ids"`
	} `yaml:"feishu"`
}

// Load 从 config.yaml 加载配置，并以环境变量为最高优先级覆盖。
// config.yaml 路径由 CONFIG_FILE 环境变量指定，默认为 "config.yaml"。
func Load() (Config, error) {
	cfg := Config{}

	configFile := os.Getenv("CONFIG_FILE")
	if configFile == "" {
		configFile = configFileName
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return cfg, fmt.Errorf("read config file %s failed: %w", configFile, err)
	}

	var yc yamlConfig
	if err := yaml.Unmarshal(data, &yc); err != nil {
		return cfg, fmt.Errorf("parse config file %s failed: %w", configFile, err)
	}

	// YAML → Config
	cfg.Port = yc.Server.Port
	cfg.SessionStoreType = yc.Session.StoreType
	cfg.MessageStoreType = yc.Session.MessageStoreType
	cfg.BufferStoreType = yc.Session.BufferStoreType
	cfg.SessionTimeout = parseDurationOrZero(yc.Session.Timeout)
	cfg.MaxMessagesPerSession = yc.Session.MaxMessages
	cfg.GatewaydAdminURL = yc.Gatewayd.AdminURL
	cfg.GatewaydAgentID = yc.Gatewayd.AgentID
	cfg.DBHost = yc.Database.Host
	cfg.DBPort = yc.Database.Port
	cfg.DBUser = yc.Database.User
	cfg.DBPassword = yc.Database.Password
	cfg.DBName = yc.Database.Name
	cfg.DBMaxOpenConns = yc.Database.MaxOpenConns
	cfg.DBMaxIdleConns = yc.Database.MaxIdleConns
	cfg.DBConnMaxLifetime = parseDurationOrZero(yc.Database.ConnMaxLifetime)
	cfg.WorkspaceRoot = yc.Workspace.Root
	cfg.PersonalStubURL = yc.PersonalStub.URL
	cfg.DocAdoptionCleanupEnabled = yc.ProductSpace.DocAdoptionCleanup.Enabled
	cfg.DocAdoptionCleanupRetentionDays = yc.ProductSpace.DocAdoptionCleanup.RetentionDays
	cfg.DocAdoptionCleanupInterval = parseDurationOrZero(yc.ProductSpace.DocAdoptionCleanup.Interval)
	cfg.RedisAddrs = yc.Redis.Addrs
	cfg.RedisPassword = yc.Redis.Password
	cfg.RedisDB = yc.Redis.DB
	cfg.RedisPrefix = yc.Redis.Prefix
	cfg.WorkitemPlatformWhitelist = yc.Workitem.Platforms
	cfg.WorkitemSyncInterval = parseDurationOrZero(yc.Workitem.Sync.Interval)
	cfg.WorkitemSyncWorkers = yc.Workitem.Sync.Workers
	cfg.WorkitemSyncTimeout = parseDurationOrZero(yc.Workitem.Sync.Timeout)
	cfg.WorkitemWritebackEnabled = yc.Workitem.Writeback.Enabled
	cfg.WorkitemWritebackWorkers = yc.Workitem.Writeback.Workers
	cfg.WorkitemWritebackRetry = yc.Workitem.Writeback.Retry

	for _, a := range yc.CodingAgents.Agents {
		cfg.CodingAgents = append(cfg.CodingAgents, CodingAgentDefinition{
			Key:         a.Key,
			Name:        a.Name,
			Description: a.Description,
		})
	}
	for _, v := range yc.CodingAgents.ModelVendors {
		cfg.CodingAgentModelVendors = append(cfg.CodingAgentModelVendors, ModelVendorGroup{
			Key:    v.Key,
			Name:   v.Name,
			Models: v.Models,
		})
	}
	// 模型池平铺列表：优先从厂商分组展开，兼容旧的平铺 models 配置。
	cfg.CodingAgentModels = yc.CodingAgents.Models
	if len(cfg.CodingAgentModelVendors) > 0 {
		cfg.CodingAgentModels = flattenModelVendors(cfg.CodingAgentModelVendors)
	}
	cfg.AgentRuntimeBearerToken = yc.AgentRuntime.BearerToken

	// Feishu 机器人配置
	cfg.FeishuAppID = yc.Feishu.AppID
	cfg.FeishuAppSecret = yc.Feishu.AppSecret
	cfg.FeishuVerifyToken = yc.Feishu.VerifyToken
	cfg.FeishuEncryptKey = yc.Feishu.EncryptKey
	cfg.FeishuWebhookToken = yc.Feishu.WebhookToken
	cfg.FeishuAPIBaseURL = yc.Feishu.APIBaseURL
	cfg.FeishuBotUserID = yc.Feishu.BotUserID
	cfg.FeishuDefaultWorkspace = yc.Feishu.DefaultWorkspace
	cfg.FeishuMockMode = yc.Feishu.MockMode
	cfg.FeishuDispatchTimeout = parseDurationOrZero(yc.Feishu.DispatchTimeout)
	cfg.FeishuAdminUserIDs = yc.Feishu.AdminUserIDs

	// 环境变量覆盖
	cfg.Port = getEnv("PORT", cfg.Port)
	cfg.SessionStoreType = getEnv("SESSION_STORE", cfg.SessionStoreType)
	cfg.MessageStoreType = getEnv("MESSAGE_STORE", cfg.MessageStoreType)
	cfg.BufferStoreType = getEnv("BUFFER_STORE", cfg.BufferStoreType)
	cfg.GatewaydAdminURL = getEnv("GATEWAYD_ADMIN_URL", cfg.GatewaydAdminURL)
	cfg.GatewaydAgentID = getEnv("GATEWAYD_AGENT_ID", cfg.GatewaydAgentID)
	cfg.SessionTimeout = getDurationEnv("SESSION_TIMEOUT", cfg.SessionTimeout)
	cfg.DBHost = getEnv("DB_HOST", cfg.DBHost)
	cfg.DBPort = getEnv("DB_PORT", cfg.DBPort)
	cfg.DBUser = getEnv("DB_USER", cfg.DBUser)
	cfg.DBPassword = getEnv("DB_PASSWORD", cfg.DBPassword)
	cfg.DBName = getEnv("DB_NAME", cfg.DBName)
	cfg.WorkspaceRoot = getEnv("WORKSPACE_ROOT", cfg.WorkspaceRoot)
	cfg.PersonalStubURL = getEnv("PERSONAL_STUB_URL", cfg.PersonalStubURL)
	cfg.DocAdoptionCleanupEnabled = getBoolEnv("DOC_ADOPTION_CLEANUP_ENABLED", cfg.DocAdoptionCleanupEnabled)
	cfg.DocAdoptionCleanupRetentionDays = getIntEnv("DOC_ADOPTION_CLEANUP_RETENTION_DAYS", cfg.DocAdoptionCleanupRetentionDays)
	cfg.DocAdoptionCleanupInterval = getDurationEnv("DOC_ADOPTION_CLEANUP_INTERVAL", cfg.DocAdoptionCleanupInterval)
	cfg.DBMaxOpenConns = getIntEnv("DB_MAX_OPEN_CONNS", cfg.DBMaxOpenConns)
	cfg.DBMaxIdleConns = getIntEnv("DB_MAX_IDLE_CONNS", cfg.DBMaxIdleConns)
	cfg.DBConnMaxLifetime = getDurationEnv("DB_CONN_MAX_LIFETIME", cfg.DBConnMaxLifetime)
	cfg.MaxMessagesPerSession = getIntEnv("MAX_MESSAGES_PER_SESSION", cfg.MaxMessagesPerSession)
	cfg.WorkitemSyncInterval = getDurationEnv("WORKITEM_SYNC_INTERVAL", cfg.WorkitemSyncInterval)
	cfg.WorkitemSyncWorkers = getIntEnv("WORKITEM_SYNC_WORKERS", cfg.WorkitemSyncWorkers)
	cfg.WorkitemSyncTimeout = getDurationEnv("WORKITEM_SYNC_TIMEOUT", cfg.WorkitemSyncTimeout)
	cfg.WorkitemWritebackEnabled = getBoolEnv("WORKITEM_WRITEBACK_ENABLED", cfg.WorkitemWritebackEnabled)
	cfg.WorkitemWritebackWorkers = getIntEnv("WORKITEM_WRITEBACK_WORKERS", cfg.WorkitemWritebackWorkers)
	cfg.WorkitemWritebackRetry = getIntEnv("WORKITEM_WRITEBACK_RETRY", cfg.WorkitemWritebackRetry)
	cfg.RedisPassword = getEnv("REDIS_PASSWORD", cfg.RedisPassword)
	cfg.RedisDB = getIntEnv("REDIS_DB", cfg.RedisDB)
	cfg.RedisPrefix = getEnv("REDIS_PREFIX", cfg.RedisPrefix)
	if redisAddrsEnv := getEnv("REDIS_ADDRS", ""); redisAddrsEnv != "" {
		cfg.RedisAddrs = strings.Split(redisAddrsEnv, ",")
	}
	cfg.AgentRuntimeBearerToken = getEnv("AGENT_RUNTIME_BEARER_TOKEN", cfg.AgentRuntimeBearerToken)

	// Feishu 环境变量覆盖
	cfg.FeishuAppID = getEnv("FEISHU_APP_ID", cfg.FeishuAppID)
	cfg.FeishuAppSecret = getEnv("FEISHU_APP_SECRET", cfg.FeishuAppSecret)
	cfg.FeishuVerifyToken = getEnv("FEISHU_VERIFY_TOKEN", cfg.FeishuVerifyToken)
	cfg.FeishuEncryptKey = getEnv("FEISHU_ENCRYPT_KEY", cfg.FeishuEncryptKey)
	cfg.FeishuWebhookToken = getEnv("FEISHU_WEBHOOK_TOKEN", cfg.FeishuWebhookToken)
	cfg.FeishuAPIBaseURL = getEnv("FEISHU_API_BASE_URL", cfg.FeishuAPIBaseURL)
	cfg.FeishuBotUserID = getEnv("FEISHU_BOT_USER_ID", cfg.FeishuBotUserID)
	cfg.FeishuDefaultWorkspace = getEnv("FEISHU_DEFAULT_WORKSPACE", cfg.FeishuDefaultWorkspace)
	cfg.FeishuMockMode = getBoolEnv("FEISHU_MOCK_MODE", cfg.FeishuMockMode)
	cfg.FeishuDispatchTimeout = getDurationEnv("FEISHU_DISPATCH_TIMEOUT", cfg.FeishuDispatchTimeout)
	if adminIDs := getEnv("FEISHU_ADMIN_USER_IDS", ""); adminIDs != "" {
		cfg.FeishuAdminUserIDs = strings.Split(adminIDs, ",")
	}

	if err := cfg.validate(); err != nil {
		return cfg, err
	}

	return cfg, nil
}

// validate 检查必填配置项是否已设置。
func (c Config) validate() error {
	var missing []string
	if c.Port == "" {
		missing = append(missing, "server.port")
	}
	if c.SessionStoreType == "" {
		missing = append(missing, "session.store_type")
	}
	if c.MessageStoreType == "" {
		missing = append(missing, "session.message_store_type")
	}
	if c.SessionTimeout <= 0 {
		missing = append(missing, "session.timeout")
	}
	if c.MaxMessagesPerSession <= 0 {
		missing = append(missing, "session.max_messages")
	}
	if c.GatewaydAdminURL == "" {
		missing = append(missing, "gatewayd.admin_url")
	}
	if c.GatewaydAgentID == "" {
		missing = append(missing, "gatewayd.agent_id")
	}
	if c.DBHost == "" {
		missing = append(missing, "database.host")
	}
	if c.DBPort == "" {
		missing = append(missing, "database.port")
	}
	if c.DBUser == "" {
		missing = append(missing, "database.user")
	}
	if c.DBName == "" {
		missing = append(missing, "database.name")
	}
	if c.WorkspaceRoot == "" {
		missing = append(missing, "workspace.root")
	}
	if c.PersonalStubURL == "" {
		missing = append(missing, "personal_stub.url")
	}
	if c.DBMaxOpenConns <= 0 {
		missing = append(missing, "database.max_open_conns")
	}
	if c.DBMaxIdleConns <= 0 {
		missing = append(missing, "database.max_idle_conns")
	}
	if c.DBConnMaxLifetime <= 0 {
		missing = append(missing, "database.conn_max_lifetime")
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required config: %s", strings.Join(missing, ", "))
	}
	return nil
}

// flattenModelVendors 将厂商分组模型池展开为平铺列表。
func flattenModelVendors(vendors []ModelVendorGroup) []string {
	models := make([]string, 0)
	for _, v := range vendors {
		models = append(models, v.Models...)
	}
	return models
}

func parseDurationOrZero(v string) time.Duration {
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0
	}
	return d
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return defaultValue
	}
	return parseDurationOrZero(v)
}

func getIntEnv(key string, defaultValue int) int {
	v := os.Getenv(key)
	if v == "" {
		return defaultValue
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return defaultValue
	}
	return n
}

func getBoolEnv(key string, defaultValue bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return defaultValue
	}
	low := strings.ToLower(v)
	if low == "true" || low == "1" || low == "yes" {
		return true
	}
	if low == "false" || low == "0" || low == "no" {
		return false
	}
	return defaultValue
}
