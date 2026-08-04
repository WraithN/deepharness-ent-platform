package handler

import (
	_ "embed"
	"log"
	"os"
	"sync"

	"gopkg.in/yaml.v3"
)

// CommandConfig 单条指令配置。
type CommandConfig struct {
	Cmd           string `json:"cmd" yaml:"cmd"`
	Label         string `json:"label" yaml:"label"`
	Desc          string `json:"desc" yaml:"desc"`
	Icon          string `json:"icon" yaml:"icon"`
	AllowTask     bool   `json:"allowTask" yaml:"allowTask"`
	AllowRepos    bool   `json:"allowRepos" yaml:"allowRepos"`
	RequireRepos  bool   `json:"requireRepos" yaml:"requireRepos"`
	RequireTask   bool   `json:"requireTask" yaml:"requireTask"`
	MaxRepos      int    `json:"maxRepos" yaml:"maxRepos"`
	Enabled       bool   `json:"enabled" yaml:"enabled"`
	Template      string `json:"template" yaml:"template"`
}

// CommandsFile 配置文件结构。
type CommandsFile struct {
	Commands []CommandConfig `json:"commands" yaml:"commands"`
}

// commandsConfigPath 外部配置文件路径（优先读取）。
const commandsConfigPath = "config/commands.yaml"

var (
	commandConfigs     []CommandConfig
	commandConfigsOnce sync.Once
)

// GetCommandConfigs 返回指令配置列表（懒加载，首次调用时读取配置文件）。
func GetCommandConfigs() []CommandConfig {
	commandConfigsOnce.Do(func() {
		commandConfigs = loadCommandConfigs()
	})
	return commandConfigs
}

// findCommandConfig 按指令名查找配置。
func findCommandConfig(cmd string) (CommandConfig, bool) {
	for _, c := range GetCommandConfigs() {
		if c.Cmd == cmd {
			return c, true
		}
	}
	return CommandConfig{}, false
}

// loadCommandConfigs 从配置文件加载指令配置。
// 优先读取外部 config/commands.yaml，不存在时回退到内嵌默认配置。
func loadCommandConfigs() []CommandConfig {
	data, err := os.ReadFile(commandsConfigPath)
	if err != nil {
		log.Printf("[Commands] config file not found (%s), using embedded defaults", commandsConfigPath)
		return embeddedCommands
	}

	var cf CommandsFile
	if err := yaml.Unmarshal(data, &cf); err != nil {
		log.Printf("[Commands] failed to parse %s: %v, using embedded defaults", commandsConfigPath, err)
		return embeddedCommands
	}

	if len(cf.Commands) == 0 {
		log.Printf("[Commands] no commands in %s, using embedded defaults", commandsConfigPath)
		return embeddedCommands
	}

	log.Printf("[Commands] loaded %d commands from %s", len(cf.Commands), commandsConfigPath)
	return cf.Commands
}
