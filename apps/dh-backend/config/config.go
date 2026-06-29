package config

import (
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	DEFAULT_CONFIG_FILE = "config.yaml"

	// Server defaults
	DEFAULT_PORT = "8080"

	// Session/Chat defaults
	DEFAULT_SESSION_STORE         = "memory"
	DEFAULT_MESSAGE_STORE         = "memory"
	DEFAULT_SESSION_TIMEOUT       = 30 * time.Minute
	DEFAULT_MAX_MESSAGES_PER_SESSION = 1000

	// Broker defaults
	DEFAULT_BROKER_TYPE = "memory"

	// Gatewayd defaults
	DEFAULT_GATEWAYD_ADMIN_URL = "http://127.0.0.1:2346"
	DEFAULT_GATEWAYD_AGENT_ID  = "claude-code"

	// AG-UI defaults
	DEFAULT_AGUI_WORKSPACE = "/home/nan/deepharness-ent-platform"

	// WebSocket defaults
	DEFAULT_RECONNECT_HISTORY_LIMIT = 50
	DEFAULT_WS_WRITE_TIMEOUT        = 10 * time.Second

	// Database defaults
	DEFAULT_DB_HOST     = "127.0.0.1"
	DEFAULT_DB_PORT     = "5433"
	DEFAULT_DB_USER     = "deepharness"
	DEFAULT_DB_PASSWORD = "deepharness"
	DEFAULT_DB_NAME     = "deepharness"

	// Repository defaults
	DEFAULT_REPOSITORY_ROOT = "/home/nan/test"

	// Workitem external integration defaults
	DEFAULT_WORKITEM_SYNC_INTERVAL     = 5 * time.Minute
	DEFAULT_WORKITEM_SYNC_WORKERS      = 4
	DEFAULT_WORKITEM_SYNC_TIMEOUT      = 30 * time.Second
	DEFAULT_WORKITEM_WRITEBACK_ENABLED = true
	DEFAULT_WORKITEM_WRITEBACK_WORKERS = 2
	DEFAULT_WORKITEM_WRITEBACK_RETRY   = 3
)

// Config 保存后端运行时的所有可配置项。
type Config struct {
	Port             string
	SessionStoreType string
	MessageStoreType string
	BrokerType       string
	RedisURL         string
	GatewaydAdminURL string
	GatewaydAgentID  string
	AGUIWorkspace    string
	SessionTimeout time.Duration
	DBHost         string
	DBPort           string
	DBUser           string
	DBPassword       string
	DBName           string
	RepositoryRoot   string

	// Chat / Message
	MaxMessagesPerSession int

	// WebSocket
	WebSocketReconnectHistoryLimit int
	WebSocketWriteTimeout          time.Duration

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
		Timeout          string `yaml:"timeout"`
		MaxMessages      int    `yaml:"max_messages"`
	} `yaml:"session"`
	Broker struct {
		Type string `yaml:"type"`
	} `yaml:"broker"`
	Gatewayd struct {
		AdminURL string `yaml:"admin_url"`
		AgentID  string `yaml:"agent_id"`
	} `yaml:"gatewayd"`
	AGUI struct {
		Workspace string `yaml:"workspace"`
	} `yaml:"agui"`
	Websocket struct {
		ReconnectHistoryLimit int    `yaml:"reconnect_history_limit"`
		WriteTimeout          string `yaml:"write_timeout"`
	} `yaml:"websocket"`
	Database struct {
		Host     string `yaml:"host"`
		Port     string `yaml:"port"`
		User     string `yaml:"user"`
		Password string `yaml:"password"`
		Name     string `yaml:"name"`
	} `yaml:"database"`
	Redis struct {
		URL string `yaml:"url"`
	} `yaml:"redis"`
	Repository struct {
		Root string `yaml:"root"`
	} `yaml:"repository"`
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
func Load() Config {
	cfg := Config{
		Port:                  DEFAULT_PORT,
		SessionStoreType:      DEFAULT_SESSION_STORE,
		MessageStoreType:      DEFAULT_MESSAGE_STORE,
		BrokerType:            DEFAULT_BROKER_TYPE,
		GatewaydAdminURL:      DEFAULT_GATEWAYD_ADMIN_URL,
		GatewaydAgentID:       DEFAULT_GATEWAYD_AGENT_ID,
		AGUIWorkspace:         DEFAULT_AGUI_WORKSPACE,
		SessionTimeout:        DEFAULT_SESSION_TIMEOUT,
		DBHost:                DEFAULT_DB_HOST,
		DBPort:                DEFAULT_DB_PORT,
		DBUser:                DEFAULT_DB_USER,
		DBPassword:            DEFAULT_DB_PASSWORD,
		DBName:                DEFAULT_DB_NAME,
		RepositoryRoot:        DEFAULT_REPOSITORY_ROOT,
		MaxMessagesPerSession: DEFAULT_MAX_MESSAGES_PER_SESSION,
		WebSocketReconnectHistoryLimit: DEFAULT_RECONNECT_HISTORY_LIMIT,
		WebSocketWriteTimeout:          DEFAULT_WS_WRITE_TIMEOUT,
		WorkitemSyncInterval:           DEFAULT_WORKITEM_SYNC_INTERVAL,
		WorkitemSyncWorkers:            DEFAULT_WORKITEM_SYNC_WORKERS,
		WorkitemSyncTimeout:            DEFAULT_WORKITEM_SYNC_TIMEOUT,
		WorkitemWritebackEnabled:       DEFAULT_WORKITEM_WRITEBACK_ENABLED,
		WorkitemWritebackWorkers:       DEFAULT_WORKITEM_WRITEBACK_WORKERS,
		WorkitemWritebackRetry:         DEFAULT_WORKITEM_WRITEBACK_RETRY,
	}

	cfg = loadFromYAML(cfg)

	cfg.Port = getEnv("PORT", cfg.Port)
	cfg.SessionStoreType = getEnv("SESSION_STORE", cfg.SessionStoreType)
	cfg.MessageStoreType = getEnv("MESSAGE_STORE", cfg.MessageStoreType)
	cfg.BrokerType = getEnv("BROKER_TYPE", cfg.BrokerType)
	if v := os.Getenv("REDIS_URL"); v != "" {
		cfg.RedisURL = v
	}
	cfg.GatewaydAdminURL = getEnv("GATEWAYD_ADMIN_URL", cfg.GatewaydAdminURL)
	cfg.GatewaydAgentID = getEnv("GATEWAYD_AGENT_ID", cfg.GatewaydAgentID)
	cfg.AGUIWorkspace = getEnv("AGUI_WORKSPACE", cfg.AGUIWorkspace)
	cfg.SessionTimeout = getDurationEnv("SESSION_TIMEOUT", cfg.SessionTimeout)
	cfg.DBHost = getEnv("DB_HOST", cfg.DBHost)
	cfg.DBPort = getEnv("DB_PORT", cfg.DBPort)
	cfg.DBUser = getEnv("DB_USER", cfg.DBUser)
	cfg.DBPassword = getEnv("DB_PASSWORD", cfg.DBPassword)
	cfg.DBName = getEnv("DB_NAME", cfg.DBName)
	cfg.RepositoryRoot = getEnv("REPOSITORY_ROOT", cfg.RepositoryRoot)
	cfg.MaxMessagesPerSession = getIntEnv("MAX_MESSAGES_PER_SESSION", cfg.MaxMessagesPerSession)
	cfg.WebSocketReconnectHistoryLimit = getIntEnv("RECONNECT_HISTORY_LIMIT", cfg.WebSocketReconnectHistoryLimit)
	cfg.WebSocketWriteTimeout = getDurationEnv("WS_WRITE_TIMEOUT", cfg.WebSocketWriteTimeout)
	cfg.WorkitemSyncInterval = getDurationEnv("WORKITEM_SYNC_INTERVAL", cfg.WorkitemSyncInterval)
	cfg.WorkitemSyncWorkers = getIntEnv("WORKITEM_SYNC_WORKERS", cfg.WorkitemSyncWorkers)
	cfg.WorkitemSyncTimeout = getDurationEnv("WORKITEM_SYNC_TIMEOUT", cfg.WorkitemSyncTimeout)
	cfg.WorkitemWritebackEnabled = getBoolEnv("WORKITEM_WRITEBACK_ENABLED", cfg.WorkitemWritebackEnabled)
	cfg.WorkitemWritebackWorkers = getIntEnv("WORKITEM_WRITEBACK_WORKERS", cfg.WorkitemWritebackWorkers)
	cfg.WorkitemWritebackRetry = getIntEnv("WORKITEM_WRITEBACK_RETRY", cfg.WorkitemWritebackRetry)

	return cfg
}

// loadFromYAML 读取 CONFIG_FILE 或默认的 config.yaml 并覆盖默认值。
func loadFromYAML(cfg Config) Config {
	configFile := os.Getenv("CONFIG_FILE")
	if configFile == "" {
		configFile = DEFAULT_CONFIG_FILE
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return cfg
	}

	var yc yamlConfig
	if err := yaml.Unmarshal(data, &yc); err != nil {
		return cfg
	}

	if yc.Server.Port != "" {
		cfg.Port = yc.Server.Port
	}
	if yc.Session.StoreType != "" {
		cfg.SessionStoreType = yc.Session.StoreType
	}
	if yc.Session.MessageStoreType != "" {
		cfg.MessageStoreType = yc.Session.MessageStoreType
	}
	if yc.Session.Timeout != "" {
		cfg.SessionTimeout = parseDurationOrDefault(yc.Session.Timeout, cfg.SessionTimeout)
	}
	if yc.Session.MaxMessages > 0 {
		cfg.MaxMessagesPerSession = yc.Session.MaxMessages
	}
	if yc.Broker.Type != "" {
		cfg.BrokerType = yc.Broker.Type
	}
	if yc.Gatewayd.AdminURL != "" {
		cfg.GatewaydAdminURL = yc.Gatewayd.AdminURL
	}
	if yc.Gatewayd.AgentID != "" {
		cfg.GatewaydAgentID = yc.Gatewayd.AgentID
	}
	if yc.AGUI.Workspace != "" {
		cfg.AGUIWorkspace = yc.AGUI.Workspace
	}
	if yc.Websocket.ReconnectHistoryLimit > 0 {
		cfg.WebSocketReconnectHistoryLimit = yc.Websocket.ReconnectHistoryLimit
	}
	if yc.Websocket.WriteTimeout != "" {
		cfg.WebSocketWriteTimeout = parseDurationOrDefault(yc.Websocket.WriteTimeout, cfg.WebSocketWriteTimeout)
	}
	if yc.Database.Host != "" {
		cfg.DBHost = yc.Database.Host
	}
	if yc.Database.Port != "" {
		cfg.DBPort = yc.Database.Port
	}
	if yc.Database.User != "" {
		cfg.DBUser = yc.Database.User
	}
	if yc.Database.Password != "" {
		cfg.DBPassword = yc.Database.Password
	}
	if yc.Database.Name != "" {
		cfg.DBName = yc.Database.Name
	}
	if yc.Redis.URL != "" {
		cfg.RedisURL = yc.Redis.URL
	}
	if yc.Repository.Root != "" {
		cfg.RepositoryRoot = yc.Repository.Root
	}
	if len(yc.Workitem.Platforms) > 0 {
		cfg.WorkitemPlatformWhitelist = yc.Workitem.Platforms
	}
	if yc.Workitem.Sync.Interval != "" {
		cfg.WorkitemSyncInterval = parseDurationOrDefault(yc.Workitem.Sync.Interval, cfg.WorkitemSyncInterval)
	}
	if yc.Workitem.Sync.Workers > 0 {
		cfg.WorkitemSyncWorkers = yc.Workitem.Sync.Workers
	}
	if yc.Workitem.Sync.Timeout != "" {
		cfg.WorkitemSyncTimeout = parseDurationOrDefault(yc.Workitem.Sync.Timeout, cfg.WorkitemSyncTimeout)
	}
	cfg.WorkitemWritebackEnabled = yc.Workitem.Writeback.Enabled
	if yc.Workitem.Writeback.Workers > 0 {
		cfg.WorkitemWritebackWorkers = yc.Workitem.Writeback.Workers
	}
	if yc.Workitem.Writeback.Retry > 0 {
		cfg.WorkitemWritebackRetry = yc.Workitem.Writeback.Retry
	}

	return cfg
}

func parseDurationOrDefault(v string, defaultValue time.Duration) time.Duration {
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return defaultValue
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
	return parseDurationOrDefault(v, defaultValue)
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
