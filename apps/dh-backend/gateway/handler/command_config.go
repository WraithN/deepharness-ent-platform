package handler

import (
	_ "embed"
	"log"
	"os"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// CommandConfig 单条指令配置。
type CommandConfig struct {
	Cmd          string `json:"cmd" yaml:"cmd"`
	Label        string `json:"label" yaml:"label"`
	Desc         string `json:"desc" yaml:"desc"`
	Icon         string `json:"icon" yaml:"icon"`
	AllowTask    bool   `json:"allowTask" yaml:"allowTask"`
	AllowRepos   bool   `json:"allowRepos" yaml:"allowRepos"`
	RequireRepos bool   `json:"requireRepos" yaml:"requireRepos"`
	RequireTask  bool   `json:"requireTask" yaml:"requireTask"`
	MaxRepos     int    `json:"maxRepos" yaml:"maxRepos"`
	Enabled      bool   `json:"enabled" yaml:"enabled"`
	Template     string `json:"template" yaml:"template"`
	// CometTemplate 是 Comet Classic 工作流模板；当 comet_flow 开关启用时使用此模板替代 Template。
	// 为空表示该指令不接入 comet 流程，开关启用时仍走原 Template。
	CometTemplate string `json:"cometTemplate,omitempty" yaml:"cometTemplate,omitempty"`
	// IsBuiltin 标识系统内置指令（来自 commands.yaml）；内置指令核心字段不可修改，仅可切换 enabled。
	IsBuiltin bool `json:"isBuiltin" yaml:"-"`
}

// CommandsFile 配置文件结构。
type CommandsFile struct {
	Commands []CommandConfig `json:"commands" yaml:"commands"`
}

// commandsConfigPath 外部配置文件路径（优先读取）。
const commandsConfigPath = "config/commands.yaml"

// 指令缓存相关常量。
const (
	// commandCacheTTL 是合并指令列表缓存有效期，CRUD 后主动失效。
	commandCacheTTL = 30 * time.Second
)

var (
	commandStoreInstance *commandStore
	commandYamlOnce      sync.Once
	commandYamlCache     []CommandConfig
	// 合并指令列表缓存：applyCommandConfig 渲染热路径调用，用读写锁 + TTL 减少查库。
	commandCache    []CommandConfig
	commandCachedAt time.Time
	commandCacheMu  sync.RWMutex
)

// SetCommandStore 注入指令 DB 存储，启用 DB 驱动的自定义指令与系统指令 enabled override。
// 在 server 初始化阶段调用。
func SetCommandStore(s *commandStore) {
	commandStoreInstance = s
}

// GetCommandConfigs 返回合并后的指令列表（系统指令来自 yaml + DB enabled override + 自定义指令来自 DB）。
// 带 TTL 缓存，CRUD 后主动失效。
func GetCommandConfigs() []CommandConfig {
	if cached, ok := readCommandCache(); ok {
		return cached
	}
	return refreshCommandCache()
}

// readCommandCache 尝试读取有效缓存，命中返回 (列表, true)。
func readCommandCache() ([]CommandConfig, bool) {
	commandCacheMu.RLock()
	defer commandCacheMu.RUnlock()
	if time.Since(commandCachedAt) < commandCacheTTL {
		return commandCache, true
	}
	return nil, false
}

// refreshCommandCache 重建合并列表并更新缓存。
func refreshCommandCache() []CommandConfig {
	commandCacheMu.Lock()
	defer commandCacheMu.Unlock()
	// 双检：持锁后再校验，避免并发重复构建。
	if time.Since(commandCachedAt) < commandCacheTTL {
		return commandCache
	}
	merged := buildMergedCommands()
	commandCache = merged
	commandCachedAt = time.Now()
	return merged
}

// invalidateCommandCache 清除缓存，在 CRUD 后调用使新值即时生效。
func invalidateCommandCache() {
	commandCacheMu.Lock()
	defer commandCacheMu.Unlock()
	commandCachedAt = time.Time{}
}

// buildMergedCommands 合并 yaml 系统指令与 DB 指令（自定义全字段 + 系统指令 enabled override）。
func buildMergedCommands() []CommandConfig {
	yamlCmds := loadYamlCommands()
	result := make([]CommandConfig, 0, len(yamlCmds)+8)

	dbRows, _ := listCommandDBRows()
	dbMap := make(map[string]dbCommand, len(dbRows))
	for _, r := range dbRows {
		dbMap[r.Cmd] = r
	}

	// 系统指令：核心字段来自 yaml，enabled 被 DB override 覆盖（若有）。
	for _, yc := range yamlCmds {
		c := yc
		c.IsBuiltin = true
		if row, ok := dbMap[c.Cmd]; ok {
			c.Enabled = row.Enabled
		}
		result = append(result, c)
	}

	// 自定义指令：全字段来自 DB（is_builtin=false）。
	for _, r := range dbRows {
		if r.IsBuiltin {
			continue
		}
		result = append(result, dbCommandToConfig(r))
	}
	return result
}

// listCommandDBRows 从 DB 读取全部指令行（store 未注入时返回空）。
func listCommandDBRows() ([]dbCommand, error) {
	if commandStoreInstance == nil {
		return nil, nil
	}
	return commandStoreInstance.listAll()
}

// dbCommandToConfig 将 dbCommand 转为 CommandConfig（自定义指令用）。
func dbCommandToConfig(r dbCommand) CommandConfig {
	return CommandConfig{
		Cmd:           r.Cmd,
		Label:         r.Label,
		Desc:          r.Desc,
		Icon:          r.Icon,
		AllowTask:     r.AllowTask,
		AllowRepos:    r.AllowRepos,
		RequireRepos:  r.RequireRepos,
		RequireTask:   r.RequireTask,
		MaxRepos:      r.MaxRepos,
		Enabled:       r.Enabled,
		Template:      r.Template,
		CometTemplate: r.CometTemplate,
		IsBuiltin:     false,
	}
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

// loadYamlCommands 懒加载 yaml 系统指令（仅首次调用时读文件，之后返回缓存）。
// yaml 是系统指令的唯一数据源，核心字段不可通过 API 修改。
func loadYamlCommands() []CommandConfig {
	commandYamlOnce.Do(func() {
		commandYamlCache = readYamlCommands()
	})
	return commandYamlCache
}

// readYamlCommands 从配置文件加载系统指令，不存在时回退到内嵌默认配置。
func readYamlCommands() []CommandConfig {
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
