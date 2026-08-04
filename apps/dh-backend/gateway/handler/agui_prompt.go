package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
)

// extractOriginalUserPrompt 从包装后的提示词模板中提取用户原始输入。
func extractOriginalUserPrompt(text string) string {
	// 兼容历史数据：前端曾经用 JSON.stringify 双重编码 content，导致此处收到的
	// 文本以 " 开头且换行为字面量 \n。尝试再解码一层以还原真实内容。
	if strings.HasPrefix(text, "\"") {
		var decoded string
		if err := json.Unmarshal([]byte(text), &decoded); err == nil {
			text = decoded
		}
	}
	idx := strings.Index(text, USER_PROMPT_MARKER)
	if idx == -1 {
		return ""
	}
	return strings.TrimSpace(text[idx+len(USER_PROMPT_MARKER):])
}

// deriveSessionTitle 根据用户提示词生成会话标题，最多 30 个字符。
func deriveSessionTitle(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return "新会话"
	}
	// 优先使用原始提示词（如果包含模板标记）。
	original := extractOriginalUserPrompt(text)
	if original != "" {
		text = original
	}
	text = strings.ReplaceAll(text, "\n", " ")
	if utf8.RuneCountInString(text) <= 30 {
		return text
	}
	return string([]rune(text)[:30]) + "..."
}

// extractContextItemRaw 从上下文项列表中按名称查找并返回原始 JSON 值。
func extractContextItemRaw(items []agui.ContextItem, name string) json.RawMessage {
	for _, item := range items {
		if item.Name == name {
			return item.Value
		}
	}
	return nil
}

// extractLastUserText 从消息列表中提取最后一条用户消息的纯文本。
// 用于意图识别时获取用户的原始输入。
func extractLastUserText(messages []agui.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != agui.RoleUser {
			continue
		}
		rawText := messages[i].ContentText()
		original := extractOriginalUserPrompt(rawText)
		if original != "" {
			return original
		}
		return rawText
	}
	return ""
}

// logPrompt 将最终发送给 agent 的提示词写入调试文件，避免主日志膨胀。
// 主日志只记录提示词长度和文件路径，排查时可直接查看对应文件。
func logPrompt(runID string, messages []agui.Message) {
	if runID == "" {
		return
	}
	dir := "/tmp/dh-prompts"
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("[AGUIHandler] create prompt log dir failed: %v", err)
		return
	}
	path := filepath.Join(dir, runID+".txt")
	f, err := os.Create(path)
	if err != nil {
		log.Printf("[AGUIHandler] create prompt log file failed: %v", err)
		return
	}
	defer f.Close()

	var totalLen int
	for i, m := range messages {
		text := m.ContentText()
		totalLen += len(text)
		fmt.Fprintf(f, "--- Message %d (%s) ---\n%s\n\n", i+1, m.Role, text)
	}
	log.Printf("[AGUIHandler] prompt logged to %s, messages=%d totalChars=%d", path, len(messages), totalLen)
}
