package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

const configFileName = "config.yaml"

// Config personal-stub 运行时配置。
// 包含文件/工程/预览服务配置，以及容器管理面配置（gatewayd 进程管理 + 上报中继）。
type Config struct {
	Port          string
	WorkspaceRoot string

	// GatewaydBin gatewayd 二进制路径。非空时 personal-stub 自动启动和管理 gatewayd 进程。
	// 为空时回退到外部启动模式（GATEWAYD_ADMIN_URL 指向外部已启动的 gatewayd）。
	GatewaydBin string
	// GatewaydMode gatewayd 管理模式："single"（1:1）或 "multi"（1:N）。
	GatewaydMode string
	// GatewaydAgentPort 1:1 模式下 gatewayd agent API 端口。
	GatewaydAgentPort int
	// GatewaydAdminPort 1:1 模式下 gatewayd admin API 端口。
	GatewaydAdminPort int
	// GatewaydAdminURL 外部启动模式下 gatewayd admin API 地址（向后兼容）。
	GatewaydAdminURL string

	// DHPlatformUserID 1:1 模式下传递给 gatewayd 的用户 ID。
	DHPlatformUserID string

	// DHBackend dh-backend 地址（用于上报中继）。
	DHBackendURL          string
	DHBackendRuntimeToken string // 上报 Bearer Token（同时作为 gatewayd 的 DH_PLATFORM_API_KEY）
	DHBackendRuntimeID    string // 当前容器对应的 runtime ID（同时作为 gatewayd 的 DH_PLATFORM_RUNTIME_ID）
}

// yamlConfig 与 config.yaml 的分层结构对应。
type yamlConfig struct {
	Server struct {
		Port string `yaml:"port"`
	} `yaml:"server"`
	Workspace struct {
		Root string `yaml:"root"`
	} `yaml:"workspace"`
	Gatewayd struct {
		Bin       string `yaml:"bin"`
		Mode      string `yaml:"mode"`
		AgentPort int    `yaml:"agent_port"`
		AdminPort int    `yaml:"admin_port"`
		AdminURL  string `yaml:"admin_url"`
	} `yaml:"gatewayd"`
	DHBackend struct {
		URL           string `yaml:"url"`
		RuntimeToken  string `yaml:"runtime_bearer_token"`
		RuntimeID     string `yaml:"runtime_id"`
	} `yaml:"dh_backend"`
}

// Load 从 config.yaml 加载配置，环境变量优先级最高。
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

	cfg.Port = yc.Server.Port
	cfg.WorkspaceRoot = yc.Workspace.Root
	cfg.GatewaydBin = yc.Gatewayd.Bin
	cfg.GatewaydMode = yc.Gatewayd.Mode
	cfg.GatewaydAgentPort = yc.Gatewayd.AgentPort
	cfg.GatewaydAdminPort = yc.Gatewayd.AdminPort
	cfg.GatewaydAdminURL = yc.Gatewayd.AdminURL
	cfg.DHBackendURL = yc.DHBackend.URL
	cfg.DHBackendRuntimeToken = yc.DHBackend.RuntimeToken
	cfg.DHBackendRuntimeID = yc.DHBackend.RuntimeID

	// 环境变量覆盖
	cfg.Port = getEnv("PORT", cfg.Port)
	cfg.WorkspaceRoot = getEnv("WORKSPACE_ROOT", cfg.WorkspaceRoot)
	cfg.GatewaydBin = getEnv("GATEWAYD_BIN", cfg.GatewaydBin)
	cfg.GatewaydMode = getEnv("GATEWAYD_MODE", cfg.GatewaydMode)
	cfg.GatewaydAgentPort = getIntEnv("GATEWAYD_AGENT_PORT", cfg.GatewaydAgentPort)
	cfg.GatewaydAdminPort = getIntEnv("GATEWAYD_ADMIN_PORT", cfg.GatewaydAdminPort)
	cfg.GatewaydAdminURL = getEnv("GATEWAYD_ADMIN_URL", cfg.GatewaydAdminURL)
	cfg.DHPlatformUserID = getEnv("DH_PLATFORM_USER_ID", cfg.DHPlatformUserID)
	cfg.DHBackendURL = getEnv("DH_BACKEND_URL", cfg.DHBackendURL)
	cfg.DHBackendRuntimeToken = getEnv("DH_BACKEND_RUNTIME_TOKEN", cfg.DHBackendRuntimeToken)
	cfg.DHBackendRuntimeID = getEnv("DH_BACKEND_RUNTIME_ID", cfg.DHBackendRuntimeID)

	// 若未配置 runtime_id，默认使用主机名作为运行时 ID。
	// 这确保每个容器/主机有唯一标识，无需手动配置。
	if cfg.DHBackendRuntimeID == "" {
		hostname, err := os.Hostname()
		if err == nil && hostname != "" {
			cfg.DHBackendRuntimeID = hostname
		}
	}

	// gatewayd 模式默认为 single（1:1）。
	if cfg.GatewaydMode == "" {
		cfg.GatewaydMode = "single"
	}

	// 1:1 模式下端口默认值。
	if cfg.GatewaydAgentPort == 0 {
		cfg.GatewaydAgentPort = 2345
	}
	if cfg.GatewaydAdminPort == 0 {
		cfg.GatewaydAdminPort = 2346
	}

	if err := cfg.validate(); err != nil {
		return cfg, err
	}

	return cfg, nil
}

func (c Config) validate() error {
	var missing []string
	if c.Port == "" {
		missing = append(missing, "server.port")
	}
	if c.WorkspaceRoot == "" {
		missing = append(missing, "workspace.root")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required config: %s", strings.Join(missing, ", "))
	}
	return nil
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

func getIntEnv(key string, defaultValue int) int {
	v := os.Getenv(key)
	if v == "" {
		return defaultValue
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultValue
	}
	return n
}
