package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

const configFileName = "config.yaml"

// Config personal-stub 运行时配置。
// 包含文件/工程/预览服务配置，以及容器管理面配置（gatewayd 代理 + 上报中继）。
type Config struct {
	Port          string
	WorkspaceRoot string

	// Gatewayd 同容器 gatewayd admin API 地址（用于管理面代理）。
	GatewaydAdminURL string

	// DHBackend dh-backend 地址（用于上报中继）。
	DHBackendURL          string
	DHBackendRuntimeToken string // 上报 Bearer Token
	DHBackendRuntimeID    string // 当前容器对应的 runtime ID
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
		AdminURL string `yaml:"admin_url"`
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
	cfg.GatewaydAdminURL = yc.Gatewayd.AdminURL
	cfg.DHBackendURL = yc.DHBackend.URL
	cfg.DHBackendRuntimeToken = yc.DHBackend.RuntimeToken
	cfg.DHBackendRuntimeID = yc.DHBackend.RuntimeID

	// 环境变量覆盖
	cfg.Port = getEnv("PORT", cfg.Port)
	cfg.WorkspaceRoot = getEnv("WORKSPACE_ROOT", cfg.WorkspaceRoot)
	cfg.GatewaydAdminURL = getEnv("GATEWAYD_ADMIN_URL", cfg.GatewaydAdminURL)
	cfg.DHBackendURL = getEnv("DH_BACKEND_URL", cfg.DHBackendURL)
	cfg.DHBackendRuntimeToken = getEnv("DH_BACKEND_RUNTIME_TOKEN", cfg.DHBackendRuntimeToken)
	cfg.DHBackendRuntimeID = getEnv("DH_BACKEND_RUNTIME_ID", cfg.DHBackendRuntimeID)

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
