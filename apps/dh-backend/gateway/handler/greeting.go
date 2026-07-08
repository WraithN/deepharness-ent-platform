package handler

import (
	"regexp"
	"strings"
)

// greetingPattern 匹配常见的打招呼/问候语（支持中英文及常见标点）。
// 用于在用户输入命中问候语时直接返回静态回复，避免调用 LLM 意图识别或 agent run 导致长时间“思考中”。
var greetingPattern = regexp.MustCompile(`^(你好|您好|哈喽|嗨|hello|hi|hey|早上好|中午好|晚上好|早安|晚安)([\s!！.。]*)?$`)

// isGreeting 判断用户输入是否为简单问候语。
func isGreeting(input string) bool {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return false
	}
	return greetingPattern.MatchString(strings.ToLower(trimmed))
}

// greetingResponse 返回问候语的静态回复。
func greetingResponse() string {
	return "你好！我是 DeepHarness 智能助手，有什么可以帮你的吗？"
}
