package handler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
)

// 意图识别相关常量。
const (
	// intentPrefixChat 是闲聊意图的前缀标记。
	intentPrefixChat = "CHAT:"
	// intentPrefixIntent 是任务意图的前缀标记。
	intentPrefixIntent = "INTENT:"
	// intentRecognitionTimeout 是意图识别 LLM 调用的最大等待时间。
	// 规则匹配失败的场景再交给 LLM，但不应让用户等待太久。
	intentRecognitionTimeout = 15 * time.Second
)

// ruleBasedClassify 基于配置化关键字规则快速判断任务意图（置信度打分 + 上下文降级）。
// 打分：strong=2 分、weak=1 分，同一条规则内累加；总分 >= threshold 判为该任务意图。
// 降级：输入命中任一 downgradeWords（疑问/探讨/否定）时一律返回 nil，交给 LLM，
// 避免「怎么 review」「了解一下开发」「不要写代码」等被误判为任务。
// 未达阈值或无命中时返回 nil，调用方应 fallback 到 LLM 意图识别。
func ruleBasedClassify(userInput string) *IntentResult {
	input := strings.ToLower(strings.TrimSpace(userInput))
	if input == "" {
		return nil
	}

	cfg := GetIntentRulesConfig()

	// 上下文降级：含疑问/探讨/否定词时不走规则快路径。
	if containsAnyKeyword(input, cfg.DowngradeWords) {
		return nil
	}

	threshold := cfg.Threshold
	if threshold <= 0 {
		threshold = defaultIntentThreshold
	}

	// 多条规则达标时取最高分；同分取靠前规则（顺序稳定）。
	var bestCmd string
	var bestScore int
	for _, rule := range cfg.Rules {
		score := 0
		for _, kw := range rule.Strong {
			if containsKeyword(input, kw) {
				score += strongKeywordScore
			}
		}
		for _, kw := range rule.Weak {
			if containsKeyword(input, kw) {
				score += weakKeywordScore
			}
		}
		if score >= threshold && score > bestScore {
			bestScore = score
			bestCmd = rule.Cmd
		}
	}
	if bestCmd == "" {
		return nil
	}
	log.Printf("[Intent] rule-based mapped to command: %s (score=%d threshold=%d)", bestCmd, bestScore, threshold)
	return &IntentResult{IsChat: false, Command: bestCmd}
}

// containsKeyword 大小写不敏感的子串匹配（input 已小写）。
func containsKeyword(input, kw string) bool {
	kw = strings.ToLower(strings.TrimSpace(kw))
	return kw != "" && strings.Contains(input, kw)
}

// containsAnyKeyword 判断 input 是否命中任一关键字（大小写不敏感）。
func containsAnyKeyword(input string, keywords []string) bool {
	for _, kw := range keywords {
		if containsKeyword(input, kw) {
			return true
		}
	}
	return false
}

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
		cmdList.WriteString(fmt.Sprintf("- %s %s\n", cmd.Cmd, cmd.Desc))
	}

	return fmt.Sprintf(`判断用户输入是闲聊还是任务意图，只输出一行。

可用指令：
%s
规则：
1. 闲聊、问候、感谢、询问用法 → CHAT: <回复>
2. 任务意图 → INTENT: <指令>，例如 INTENT: /code

输入：%s`, cmdList.String(), userInput)
}

// recognizeIntent 调用 LLM 识别用户意图。
// 如果是闲聊，返回回复内容；如果是任务意图，返回匹配的指令。
// 调用失败时返回 error，调用方应 fallback 到正常流程。
func recognizeIntent(ctx context.Context, aguiClient *client.AGUIClient, userInput string) (*IntentResult, error) {
	// 先用规则快速路径匹配常见任务关键字，避免每次意图识别都启动 agent run。
	if result := ruleBasedClassify(userInput); result != nil {
		return result, nil
	}

	commands := GetCommandConfigs()
	prompt := intentRecognitionPrompt(userInput, commands)

	log.Printf("[Intent] recognizing intent for input: %q", truncate(userInput, 80))

	// 限制 LLM 意图识别的等待时间，防止模型不可用时长时间阻塞请求。
	llmCtx, cancel := context.WithTimeout(ctx, intentRecognitionTimeout)
	defer cancel()
	resp, err := aguiClient.QuickComplete(llmCtx, prompt)
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
// 兼容大小写不一致、code fence 包裹、前缀后带解释文本等 LLM 输出抖动。
func parseIntentResponse(resp string) *IntentResult {
	resp = strings.TrimSpace(resp)

	// 处理可能的 markdown code fence 包裹。
	resp = strings.TrimPrefix(resp, "```")
	resp = strings.TrimSuffix(resp, "```")
	resp = strings.TrimSpace(resp)

	upper := strings.ToUpper(resp)

	// 大小写不敏感匹配 CHAT 前缀。
	if strings.HasPrefix(upper, strings.ToUpper(intentPrefixChat)) {
		reply := strings.TrimSpace(resp[len(intentPrefixChat):])
		return &IntentResult{IsChat: true, Response: reply}
	}

	// 大小写不敏感匹配 INTENT 前缀，并取第一个 token 作为指令。
	if strings.HasPrefix(upper, strings.ToUpper(intentPrefixIntent)) {
		rest := strings.TrimSpace(resp[len(intentPrefixIntent):])
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			return nil
		}
		cmd := fields[0]
		if cfg, found := findCommandConfig(cmd); found {
			return &IntentResult{IsChat: false, Command: cfg.Cmd}
		}
		if cfg := fuzzyMatchCommand(cmd); cfg != nil {
			return &IntentResult{IsChat: false, Command: cfg.Cmd}
		}
		return nil
	}

	// 无前缀时，若整段内容恰好是一个已知指令名，也视为任务意图。
	trimmed := strings.TrimSpace(resp)
	if cfg, found := findCommandConfig(trimmed); found {
		return &IntentResult{IsChat: false, Command: cfg.Cmd}
	}
	if cfg := fuzzyMatchCommand(trimmed); cfg != nil {
		return &IntentResult{IsChat: false, Command: cfg.Cmd}
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
// 用原始用户输入作为 {ARGS}，复用 applyCommandConfig 统一处理模板渲染、
// 任务卡片与代码库注入，与 interceptCommands 行为保持一致。
func applyIntentCommand(messages []agui.Message, cmd, userInput, workspacePath, workspaceID string, ctxItems []agui.ContextItem, workItemSvc workitemservice.WorkItemService) error {
	cfg, found := findCommandConfig(cmd)
	if !found {
		return fmt.Errorf("intent command %s not found", cmd)
	}

	// 仅替换最后一条用户消息的内容。
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == agui.RoleUser {
			_, err := applyCommandConfig(messages, i, cfg, userInput, workspacePath, workspaceID, ctxItems, workItemSvc)
			return err
		}
	}
	return nil
}

// truncate 截断字符串到指定长度，超出部分用省略号替代。
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}
