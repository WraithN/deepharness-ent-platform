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
	// AgentStubURL 是 agent-stub 服务地址，用于代理文件/工程/预览相关请求。
	// agent-stub 部署在 WORKSPACE_ROOT 所在的服务器上，直接操作文件系统和 git。
	AgentStubURL string

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

	// Workitem external integration
	WorkitemPlatformWhitelist []string
	WorkitemSyncInterval      time.Duration
	WorkitemSyncWorkers       int
	WorkitemSyncTimeout       time.Duration
	WorkitemWritebackEnabled  bool
	WorkitemWritebackWorkers  int
	WorkitemWritebackRetry    int
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
	AgentStub struct {
		URL string `yaml:"url"`
	} `yaml:"agent_stub"`
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
	cfg.AgentStubURL = yc.AgentStub.URL
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
	cfg.AgentStubURL = getEnv("AGENT_STUB_URL", cfg.AgentStubURL)
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
	if c.AgentStubURL == "" {
		missing = append(missing, "agent_stub.url")
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
