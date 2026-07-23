package handler

import (
	"log"
	"os"
	"sync"

	"gopkg.in/yaml.v3"
)

// 意图识别规则层打分常量。
const (
	// strongKeywordScore 强信号关键字命中得分（单独命中即达默认阈值）。
	strongKeywordScore = 2
	// weakKeywordScore 弱信号关键字命中得分（需叠加才达阈值）。
	weakKeywordScore = 1
	// defaultIntentThreshold 默认任务判定阈值。
	defaultIntentThreshold = 2
)

// IntentRule 单条指令的规则层关键字配置。
type IntentRule struct {
	Cmd    string   `json:"cmd" yaml:"cmd"`
	Strong []string `json:"strong" yaml:"strong"`
	Weak   []string `json:"weak" yaml:"weak"`
}

// IntentRulesConfig 意图识别规则层配置。
type IntentRulesConfig struct {
	Threshold      int           `json:"threshold" yaml:"threshold"`
	Rules          []IntentRule  `json:"rules" yaml:"rules"`
	DowngradeWords []string      `json:"downgradeWords" yaml:"downgradeWords"`
}

// intentRulesConfigPath 外部配置文件路径（优先读取）。
const intentRulesConfigPath = "config/intent_rules.yaml"

var (
	intentRules     IntentRulesConfig
	intentRulesOnce sync.Once
)

// GetIntentRulesConfig 返回意图识别规则配置（懒加载，首次调用时读取配置文件）。
func GetIntentRulesConfig() IntentRulesConfig {
	intentRulesOnce.Do(func() {
		intentRules = loadIntentRulesConfig()
	})
	return intentRules
}

// loadIntentRulesConfig 从配置文件加载意图识别规则。
// 优先读取外部 config/intent_rules.yaml，不存在或解析失败时回退到内嵌默认配置。
func loadIntentRulesConfig() IntentRulesConfig {
	data, err := os.ReadFile(intentRulesConfigPath)
	if err != nil {
		log.Printf("[IntentRules] config file not found (%s), using embedded defaults", intentRulesConfigPath)
		return embeddedIntentRules
	}

	var cfg IntentRulesConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		log.Printf("[IntentRules] failed to parse %s: %v, using embedded defaults", intentRulesConfigPath, err)
		return embeddedIntentRules
	}

	if len(cfg.Rules) == 0 {
		log.Printf("[IntentRules] no rules in %s, using embedded defaults", intentRulesConfigPath)
		return embeddedIntentRules
	}

	if cfg.Threshold <= 0 {
		cfg.Threshold = defaultIntentThreshold
	}

	log.Printf("[IntentRules] loaded %d rules from %s (threshold=%d)", len(cfg.Rules), intentRulesConfigPath, cfg.Threshold)
	return cfg
}
