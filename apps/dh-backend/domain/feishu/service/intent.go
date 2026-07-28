// Package service - intent.go 实现飞书消息的意图识别与路由。
//
// 初期使用关键词前缀匹配，覆盖编码/原型/需求/总结四种显式指令，
// 其余消息归为默认问答。后续可升级为 LLM 意图识别支持自然语言。
package service

import (
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/object"
)

// codingPrefixes 是编码意图的关键词前缀（不区分大小写）。
var codingPrefixes = []string{"编码：", "代码：", "code:", "编码:"}

// prototypePrefixes 是原型设计意图的关键词前缀。
var prototypePrefixes = []string{"原型：", "proto:", "原型:"}

// requirementPrefixes 是需求卡片意图的关键词前缀。
var requirementPrefixes = []string{"需求：", "requirement:", "需求:"}

// summaryKeywords 是群聊总结意图的关键词（包含即触发，不限位置）。
var summaryKeywords = []string{"总结", "summary", "群聊总结", "会议纪要"}

// ParseIntent 根据消息内容识别意图。
// 优先级：编码 > 原型 > 需求 > 总结 > 默认问答。
func ParseIntent(content string) object.Intent {
	trimmed := strings.TrimSpace(content)
	lower := strings.ToLower(trimmed)

	if hasAnyPrefix(lower, codingPrefixes) {
		return object.IntentCoding
	}
	if hasAnyPrefix(lower, prototypePrefixes) {
		return object.IntentPrototype
	}
	if hasAnyPrefix(lower, requirementPrefixes) {
		return object.IntentRequirement
	}
	for _, kw := range summaryKeywords {
		if strings.Contains(lower, kw) {
			return object.IntentGroupSummary
		}
	}
	return object.IntentChat
}

// StripPrefix 去除意图前缀，返回纯净的用户输入。
// 例如 "编码：实现登录中间件" -> "实现登录中间件"。
func StripPrefix(content string, intent object.Intent) string {
	trimmed := strings.TrimSpace(content)
	lower := strings.ToLower(trimmed)
	switch intent {
	case object.IntentCoding:
		return stripFirstPrefix(lower, trimmed, codingPrefixes)
	case object.IntentPrototype:
		return stripFirstPrefix(lower, trimmed, prototypePrefixes)
	case object.IntentRequirement:
		return stripFirstPrefix(lower, trimmed, requirementPrefixes)
	default:
		return trimmed
	}
}

// IntentRequiresAgent 返回该意图是否需要走 persistent 模式（工具调用+多轮上下文）。
func IntentRequiresAgent(intent object.Intent) bool {
	switch intent {
	case object.IntentCoding, object.IntentPrototype, object.IntentRequirement:
		return true
	default:
		return false
	}
}

// IntentNeedsGroupHistory 返回该意图是否需要拉取群历史消息。
func IntentNeedsGroupHistory(intent object.Intent) bool {
	return intent == object.IntentGroupSummary
}

func hasAnyPrefix(lower string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(lower, p) {
			return true
		}
	}
	return false
}

func stripFirstPrefix(lower, original string, prefixes []string) string {
	for _, p := range prefixes {
		if strings.HasPrefix(lower, p) {
			return strings.TrimSpace(original[len(p):])
		}
	}
	return original
}
