package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

const configFileName = "config.yaml"

// Config personal-stub 运行时配置。
// 仅包含文件/工程/预览服务所需的最小配置项。
type Config struct {
	Port          string
	WorkspaceRoot string
}

// yamlConfig 与 config.yaml 的分层结构对应。
type yamlConfig struct {
	Server struct {
		Port string `yaml:"port"`
	} `yaml:"server"`
	Workspace struct {
		Root string `yaml:"root"`
	} `yaml:"workspace"`
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

	// 环境变量覆盖
	cfg.Port = getEnv("PORT", cfg.Port)
	cfg.WorkspaceRoot = getEnv("WORKSPACE_ROOT", cfg.WorkspaceRoot)

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
