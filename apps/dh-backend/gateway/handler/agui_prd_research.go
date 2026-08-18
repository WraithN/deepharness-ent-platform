package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
)

const prdResearchCommand = "/prd-research"

// tryAugmentPRDResearchMessage 检测最后一条用户消息是否为 /prd-research 指令。
// 不再主动抓取，改为在参数末尾追加提示，引导 agent 自主调用 crawler:web_scrape 工具。
// 返回 (是否命中, 是否发生致命错误需终止 run)。
func (h *AGUIHandler) tryAugmentPRDResearchMessage(r *http.Request, messages []agui.Message, workspaceID, runID string) (matched bool, abort bool) {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != agui.RoleUser {
			continue
		}
		rawText := messages[i].ContentText()
		original := extractOriginalUserPrompt(rawText)
		if original == "" {
			original = rawText
		}
		cmd, args, ok := parseSlashCommand(original)
		if !ok || cmd != prdResearchCommand {
			return false, false
		}
		// 追加工具使用提示，不再抓取注入。
		augmentedArgs := strings.TrimRight(args, "\n") + "\n\n【提示】如需抓取网页内容，可调用 crawler:web_scrape 工具。"
		augmented := cmd + " " + augmentedArgs
		data, err := json.Marshal(augmented)
		if err != nil {
			log.Printf("[AGUIHandler] run=%s marshal prd-research message failed: %v", runID, err)
			return true, false
		}
		messages[i].Content = json.RawMessage(data)
		return true, false
	}
	return false, false
}
