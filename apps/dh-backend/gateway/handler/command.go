package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// 指令前缀，所有聊天指令均以 / 开头。
const commandPrefix = "/"

// parseSlashCommand 从用户原始输入中解析斜杠指令。
// 返回: (指令名, 指令参数, 是否匹配到指令)。
// 例如 "/prd-write 做一个CRM系统" -> ("/prd-write", "做一个CRM系统", true)。
func parseSlashCommand(text string) (cmd, args string, ok bool) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, commandPrefix) {
		return "", "", false
	}
	idx := strings.IndexAny(text, " \t\n")
	if idx == -1 {
		return text, "", true
	}
	return text[:idx], strings.TrimSpace(text[idx:]), true
}

// quotedCardInfo 描述从前端传来的引用任务卡片（仅含基础字段，用于定位数据库记录）。
type quotedCardInfo struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// extractQuotedCard 从 RunAgentInput.Context 中提取引用的任务卡片标识。
func extractQuotedCard(ctxItems []agui.ContextItem) (quotedCardInfo, bool) {
	for _, item := range ctxItems {
		if item.Name != "quotedCard" {
			continue
		}
		var card quotedCardInfo
		if err := json.Unmarshal(item.Value, &card); err == nil && card.ID != "" {
			return card, true
		}
	}
	return quotedCardInfo{}, false
}

// extractSelectedRepos 从 RunAgentInput.Context 中提取用户选择的代码库列表。
func extractSelectedRepos(ctxItems []agui.ContextItem) ([]string, bool) {
	for _, item := range ctxItems {
		if item.Name != "selectedRepos" {
			continue
		}
		var repos []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(item.Value, &repos); err == nil && len(repos) > 0 {
			names := make([]string, 0, len(repos))
			for _, r := range repos {
				names = append(names, r.Name)
			}
			return names, true
		}
	}
	return nil, false
}

// taskTypeLabel 将卡片类型转换为中文标签。
func taskTypeLabel(t string) string {
	switch t {
	case "req", string(workitem.TypeRequirement):
		return "需求"
	case "defect":
		return "缺陷"
	case "case":
		return "用例"
	default:
		return "任务"
	}
}

// buildTaskCardBlock 根据数据库中的完整工作项信息，构建任务卡片上下文文本块。
func buildTaskCardBlock(item workitem.WorkItem) string {
	typeLabel := taskTypeLabel(string(item.Type))
	return fmt.Sprintf("\n\n【关联%s】\n- 编号: %s\n- 标题: %s\n- 描述: %s\n- 状态: %s\n- 优先级: %s\n- 提报人: %s\n- 负责人: %s\n- 来源: %s\n请在回答中参考上述%s信息。",
		typeLabel, item.ID, item.Title, item.Description,
		string(item.Status), string(item.Priority),
		item.Reporter, item.AssigneeID, string(item.Source),
		typeLabel)
}

// buildRepoBlock 构建代码库上下文文本块，注入到提示词中供 agent 参考。
func buildRepoBlock(repoNames []string) string {
	var sb strings.Builder
	sb.WriteString("\n\n【关联代码库】\n")
	for i, name := range repoNames {
		sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, name))
	}
	sb.WriteString("请在回答中参考上述代码库信息。")
	return sb.String()
}

// fetchWorkItem 通过 WorkItemService 从数据库查询工作项完整信息。
func fetchWorkItem(svc workitemservice.WorkItemService, cardID string) (workitem.WorkItem, bool) {
	if svc == nil {
		return workitem.WorkItem{}, false
	}
	item, err := svc.GetWorkItem(cardID)
	if err != nil {
		log.Printf("[AGUIHandler] fetch workitem failed: id=%s err=%v", cardID, err)
		return workitem.WorkItem{}, false
	}
	return item, true
}

// interceptCommands 检查最后一条用户消息中的斜杠指令，
// 若匹配则将该消息内容替换为指令专属提示词模板。
// 根据指令配置决定是否注入任务卡片和代码库信息：
//   - allowTask=true 且有任务卡片 → 注入任务信息
//   - allowRepos=true 且有代码库 → 注入代码库信息
//   - allowRepos=false → 忽略代码库（即使前端传了也不注入）
// workspacePath 用于替换模板中的 {WORKSPACE_PATH}，确保 AI 输出到正确的用户隔离目录。
// 返回 true 表示匹配到了已知斜杠指令，false 表示未匹配。
func interceptCommands(messages []agui.Message, ctxItems []agui.ContextItem, workspacePath string, workItemSvc workitemservice.WorkItemService) bool {
	card, hasCard := extractQuotedCard(ctxItems)
	repoNames, hasRepos := extractSelectedRepos(ctxItems)

	// 从数据库查询任务卡片的完整信息。
	var workItem workitem.WorkItem
	workItemFetched := false
	if hasCard {
		workItem, workItemFetched = fetchWorkItem(workItemSvc, card.ID)
	}

	// 只处理最后一条用户消息。
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

		// 情况一：匹配到已知指令，使用配置中的模板。
		if ok {
			cfg, found := findCommandConfig(cmd)
			if found {
				rendered := renderTemplate(cfg.Template, args, workspacePath)

				// 根据指令配置注入任务卡片。
				if cfg.AllowTask && workItemFetched {
					rendered += buildTaskCardBlock(workItem)
				}

				// 根据指令配置注入代码库（allowRepos=false 时忽略）。
				if cfg.AllowRepos && hasRepos {
					rendered += buildRepoBlock(repoNames)
				}

				// 记录被忽略的上下文。
				if !cfg.AllowRepos && hasRepos {
					log.Printf("[AGUIHandler] command %s ignores repos (allowRepos=false)", cmd)
				}
				if !cfg.AllowTask && hasCard {
					log.Printf("[AGUIHandler] command %s ignores task card (allowTask=false)", cmd)
				}

				messages[i].Content = json.RawMessage(fmt.Sprintf("%q", rendered))
				log.Printf("[AGUIHandler] command intercepted: %s args=%q hasCard=%v hasRepos=%v allowTask=%v allowRepos=%v",
					cmd, args, workItemFetched, hasRepos, cfg.AllowTask, cfg.AllowRepos)
				return true
			}
		}

		// 情况二：无指令或未知指令，但有任务卡片，将卡片信息追加到原始提示词。
		if workItemFetched {
			rendered := rawText + buildTaskCardBlock(workItem)
			messages[i].Content = json.RawMessage(fmt.Sprintf("%q", rendered))
			log.Printf("[AGUIHandler] task card injected: type=%s id=%s title=%q", workItem.Type, workItem.ID, workItem.Title)
			return false
		}

		return false
	}

	return false
}

// renderTemplate 将用户参数填入指令模板。
// 模板中的 {ARGS} 占位符会被替换为用户原始输入；
// {WORKSPACE_PATH} 会被替换为当前会话的 workspace 目录（workspace_root/{workspace_id}/{user_id}），
// 保证 AI 生成的文件写入正确的用户隔离目录，而非 agent 当前工作目录下的 projects/。
func renderTemplate(tmpl, args, workspacePath string) string {
	rendered := strings.ReplaceAll(tmpl, "{ARGS}", args)
	if workspacePath != "" {
		rendered = strings.ReplaceAll(rendered, "{WORKSPACE_PATH}", workspacePath)
	}
	return rendered
}

// CommandsHandler 处理 GET /api/v1/commands 请求。
// 返回指令配置列表，供前端动态渲染指令菜单和约束校验。
func CommandsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GetCommandConfigs())
}
