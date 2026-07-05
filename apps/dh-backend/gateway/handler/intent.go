package handler

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
)

// 意图识别相关常量。
const (
	// intentPrefixChat 是闲聊意图的前缀标记。
	intentPrefixChat = "CHAT:"
	// intentPrefixIntent 是任务意图的前缀标记。
	intentPrefixIntent = "INTENT:"
)

// IntentResult 意图识别结果。
type IntentResult struct {
	IsChat   bool   // true=闲聊，false=任务意图
	Response string // 闲聊时的回复内容
	Command  string // 任务意图时映射到的指令（如 /code）
}

// intentRecognitionPrompt 构建意图识别提示词。
// 列出所有可用指令，要求 LLM 判断用户输入是闲聊还是任务。
func intentRecognitionPrompt(userInput string, commands []CommandConfig) string {
	var cmdList strings.Builder
	for _, cmd := range commands {
		cmdList.WriteString(fmt.Sprintf("- %s：%s（%s）\n", cmd.Cmd, cmd.Label, cmd.Desc))
	}

	return fmt.Sprintf(`你是一个意图识别助手。请分析用户的输入，判断它是闲聊还是有明确的任务意图。

可用的任务指令：
%s
判断规则：
1. 如果用户是打招呼、问简单问题、闲聊、询问功能用法、表达感谢等，直接回复用户。
   格式：CHAT: <你的回复>
2. 如果用户有明确的任务意图（如"帮我写个登录页面"、"做个CRM系统"、"修复这个bug"、"审查一下这段代码"等），选择最匹配的指令。
   格式：INTENT: <指令>（如 INTENT: /code）
3. 只输出一行，以 CHAT: 或 INTENT: 开头，不要输出其他内容。

用户输入：%s`, cmdList.String(), userInput)
}

// recognizeIntent 调用 LLM 识别用户意图。
// 如果是闲聊，返回回复内容；如果是任务意图，返回匹配的指令。
// 调用失败时返回 error，调用方应 fallback 到正常流程。
func recognizeIntent(ctx context.Context, aguiClient *client.AGUIClient, userInput string) (*IntentResult, error) {
	commands := GetCommandConfigs()
	prompt := intentRecognitionPrompt(userInput, commands)

	log.Printf("[Intent] recognizing intent for input: %q", truncate(userInput, 80))

	resp, err := aguiClient.QuickComplete(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("intent recognition failed: %w", err)
	}

	log.Printf("[Intent] raw response: %q", truncate(resp, 200))

	result := parseIntentResponse(resp)
	if result == nil {
		return nil, fmt.Errorf("intent response unparseable: %s", truncate(resp, 100))
	}

	if result.IsChat {
		log.Printf("[Intent] classified as CHAT")
	} else {
		log.Printf("[Intent] classified as INTENT: %s", result.Command)
	}

	return result, nil
}

// parseIntentResponse 解析 LLM 返回的意图识别结果。
// 支持格式：
//   CHAT: <回复内容>
//   INTENT: /<指令>
func parseIntentResponse(resp string) *IntentResult {
	resp = strings.TrimSpace(resp)

	// 处理可能的 markdown code fence 包裹。
	resp = strings.TrimPrefix(resp, "```")
	resp = strings.TrimSuffix(resp, "```")
	resp = strings.TrimSpace(resp)

	if strings.HasPrefix(resp, intentPrefixChat) {
		reply := strings.TrimSpace(strings.TrimPrefix(resp, intentPrefixChat))
		return &IntentResult{IsChat: true, Response: reply}
	}

	if strings.HasPrefix(resp, intentPrefixIntent) {
		cmd := strings.TrimSpace(strings.TrimPrefix(resp, intentPrefixIntent))
		// 验证指令是否存在。
		if cfg, found := findCommandConfig(cmd); found {
			return &IntentResult{IsChat: false, Command: cfg.Cmd}
		}
		// 指令不存在，尝试模糊匹配。
		if cfg := fuzzyMatchCommand(cmd); cfg != nil {
			return &IntentResult{IsChat: false, Command: cfg.Cmd}
		}
	}

	return nil
}

// fuzzyMatchCommand 模糊匹配指令名（去掉斜杠前缀后比较）。
func fuzzyMatchCommand(input string) *CommandConfig {
	input = strings.TrimPrefix(strings.TrimSpace(input), "/")
	if input == "" {
		return nil
	}
	for _, cfg := range GetCommandConfigs() {
		cmdName := strings.TrimPrefix(cfg.Cmd, "/")
		if strings.EqualFold(cmdName, input) {
			return &cfg
		}
	}
	return nil
}
// applyIntentCommand 将意图识别匹配到的指令模板应用到用户消息上。
// 用原始用户输入作为 {ARGS}，渲染指令模板并替换消息内容。
func applyIntentCommand(messages []agui.Message, cmd, userInput string) {
	cfg, found := findCommandConfig(cmd)
	if !found {
		return
	}

	rendered := renderTemplate(cfg.Template, userInput)

	// 仅替换最后一条用户消息的内容。
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == agui.RoleUser {
			messages[i].Content = agui.UserMessage("", rendered).Content
			return
		}
	}
}

// truncate 截断字符串到指定长度，超出部分用省略号替代。
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}
