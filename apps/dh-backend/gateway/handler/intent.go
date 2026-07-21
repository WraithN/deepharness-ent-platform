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

// commandKeyword 为单条指令维护一组关键字，用于规则匹配快速路径。
// 使用切片保证匹配顺序稳定，避免 map 迭代随机性导致同一输入命中不同指令。
type commandKeyword struct {
	cmd      string
	keywords []string
}

// commandKeywords 按优先级排列的规则关键字列表。
// 命中关键字时直接返回任务意图，无需调用 LLM，显著降低意图识别延迟。
var commandKeywords = []commandKeyword{
	{"/prd-write", []string{"写需求", "prd", "需求文档", "产品需求"}},
	{"/prd-research", []string{"调研", "技术调研", "方案选型", "研究报告"}},
	{"/proto-make", []string{"原型", "做原型", "ui原型", "可运行原型"}},
	{"/code", []string{"写代码", "写个", "做一个", "开发", "实现", "编写代码", "创建工程", "写页面", "做个系统", "做个网站", "写功能"}},
	{"/debug", []string{"bug", "缺陷", "修复", "报错", "错误", "问题", "调试"}},
	{"/review", []string{"review", "审查", "代码审查", "codereview", "代码review", "评审"}},
}

// ruleBasedClassify 基于关键字规则快速判断任务意图。
// 未命中任何关键字时返回 nil，调用方应 fallback 到 LLM 意图识别。
func ruleBasedClassify(userInput string) *IntentResult {
	input := strings.ToLower(strings.TrimSpace(userInput))
	if input == "" {
		return nil
	}
	for _, ck := range commandKeywords {
		for _, kw := range ck.keywords {
			if strings.Contains(input, strings.ToLower(kw)) {
				return &IntentResult{IsChat: false, Command: ck.cmd}
			}
		}
	}
	return nil
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
		log.Printf("[Intent] rule-based mapped to command: %s", result.Command)
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
func applyIntentCommand(messages []agui.Message, cmd, userInput, workspacePath string, ctxItems []agui.ContextItem, workItemSvc workitemservice.WorkItemService) error {
	cfg, found := findCommandConfig(cmd)
	if !found {
		return fmt.Errorf("intent command %s not found", cmd)
	}

	// 仅替换最后一条用户消息的内容。
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == agui.RoleUser {
			_, err := applyCommandConfig(messages, i, cfg, userInput, workspacePath, ctxItems, workItemSvc)
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
