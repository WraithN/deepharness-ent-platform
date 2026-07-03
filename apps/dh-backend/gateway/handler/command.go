package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// 指令前缀，所有聊天指令均以 / 开头。
const commandPrefix = "/"

// 指令名称常量，与前端 CHAT_COMMANDS 保持一致。
const (
	cmdPrdWrite    = "/prd-write"
	cmdProtoMake   = "/proto-make"
	cmdPrdResearch = "/prd-research"
	cmdCode        = "/code"
	cmdDebug       = "/debug"
	cmdReview      = "/review"
)

// 文档输出目录常量（相对于 agent 工作目录）。
const (
	prdOutputDir     = "projects/products-jobs/prd"
	researchOutputDir = "projects/products-jobs/research"
	protoOutputDir   = "projects"
)

// parseSlashCommand 从用户原始输入中解析斜杠指令。
// 返回: (指令名, 指令参数, 是否匹配到指令)。
// 例如 "/prd-write 做一个CRM系统" -> ("/prd-write", "做一个CRM系统", true)。
func parseSlashCommand(text string) (cmd, args string, ok bool) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, commandPrefix) {
		return "", "", false
	}
	// 取第一个空白分隔指令名和参数。
	idx := strings.IndexAny(text, " \t\n")
	if idx == -1 {
		return text, "", true
	}
	return text[:idx], strings.TrimSpace(text[idx:]), true
}

// commandPromptTemplate 返回指令对应的提示词模板。
// 不匹配的指令返回空字符串。
func commandPromptTemplate(cmd string) string {
	switch cmd {
	case cmdPrdWrite:
		return prdWriteTemplate
	case cmdProtoMake:
		return protoMakeTemplate
	case cmdPrdResearch:
		return prdResearchTemplate
	case cmdCode:
		return codeTemplate
	case cmdDebug:
		return debugTemplate
	case cmdReview:
		return reviewTemplate
	default:
		return ""
	}
}

// quotedCardInfo 描述从前端传来的引用任务卡片（仅含基础字段，用于定位数据库记录）。
type quotedCardInfo struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// extractQuotedCard 从 RunAgentInput.Context 中提取引用的任务卡片标识。
// 前端将 quotedCard 序列化为 JSON 对象放入 context 项。
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

// taskTypeLabel 将卡片类型转换为中文标签。
// 前端使用 req/defect/case，数据库使用 requirement/defect/case。
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

// buildTaskCardBlock 根据数据库中的完整工作项信息，构建任务卡片上下文文本块，用于注入提示词。
func buildTaskCardBlock(item workitem.WorkItem) string {
	typeLabel := taskTypeLabel(string(item.Type))
	return fmt.Sprintf("\n\n【关联%s】\n- 编号: %s\n- 标题: %s\n- 描述: %s\n- 状态: %s\n- 优先级: %s\n- 提报人: %s\n- 负责人: %s\n- 来源: %s\n请在回答中参考上述%s信息。",
		typeLabel, item.ID, item.Title, item.Description,
		string(item.Status), string(item.Priority),
		item.Reporter, item.AssigneeID, string(item.Source),
		typeLabel)
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
// 同时，如果上下文中包含引用的任务卡片，从数据库查询完整信息后注入到提示词中。
// 替换发生在 saveUserMessages 之后、aguiClient.Run 之前，
// 因此 agent 收到的是模板化后的提示词，而数据库中保存的是用户原始输入。
func interceptCommands(messages []agui.Message, ctxItems []agui.ContextItem, workItemSvc workitemservice.WorkItemService) {
	card, hasCard := extractQuotedCard(ctxItems)

	// 从数据库查询任务卡片的完整信息。
	var workItem workitem.WorkItem
	workItemFetched := false
	if hasCard {
		workItem, workItemFetched = fetchWorkItem(workItemSvc, card.ID)
	}

	// 只处理最后一条用户消息（即用户刚刚发送的这条）。
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

		// 情况一：匹配到已知指令，使用指令模板。
		if ok {
			tmpl := commandPromptTemplate(cmd)
			if tmpl != "" {
				rendered := renderTemplate(tmpl, args)
				if workItemFetched {
					rendered += buildTaskCardBlock(workItem)
				}
				messages[i].Content = json.RawMessage(fmt.Sprintf("%q", rendered))
				log.Printf("[AGUIHandler] command intercepted: %s args=%q hasCard=%v", cmd, args, workItemFetched)
				return
			}
		}

		// 情况二：无指令或未知指令，但有任务卡片，将卡片信息追加到原始提示词。
		if workItemFetched {
			rendered := rawText + buildTaskCardBlock(workItem)
			messages[i].Content = json.RawMessage(fmt.Sprintf("%q", rendered))
			log.Printf("[AGUIHandler] task card injected: type=%s id=%s title=%q", workItem.Type, workItem.ID, workItem.Title)
			return
		}

		return
	}
}

// renderTemplate 将用户参数填入指令模板。
// 模板中的 {ARGS} 占位符会被替换为用户原始输入。
func renderTemplate(tmpl, args string) string {
	return strings.ReplaceAll(tmpl, "{ARGS}", args)
}

// --- 指令提示词模板 ---
// 每个模板包含：
// 1. 角色与任务描述
// 2. 文件输出路径规范（必须使用相对路径，基于 agent 工作目录）
// 3. 文件卡片标记要求（[[FILE:...]] 或 [[PROJECT:...]]，前端据此渲染卡片）
// 4. {ARGS} 占位符，运行时替换为用户输入

const prdWriteTemplate = `你是一位资深产品经理。请根据以下需求描述，生成一份结构化的 PRD（产品需求文档）。

【文件输出要求】
1. 将 PRD 文档写入 projects/products-jobs/prd/ 目录下（如目录不存在请先创建）。
2. 文件命名格式：{需求名称}-prd.md（例如：用户登录-prd.md）。需求名称从用户输入中提取关键词，使用中文或英文均可。
3. 文档使用 Markdown 格式编写。

【PRD 内容结构】
1. 背景与目标
2. 用户场景
3. 功能详情
4. 业务流程图（使用 Mermaid 语法）
5. 数据埋点要求

【输出标记】
文档写入完成后，在回复末尾必须用以下格式标记文件路径（每行一个）：
[[FILE:绝对路径/到/projects/products-jobs/prd/需求名称-prd.md]]
注意：路径必须是绝对路径。

【用户需求】
{ARGS}`

const prdResearchTemplate = `你是一位资深技术分析师。请根据以下主题，进行深入的技术调研并生成一份结构化的调研报告。

【文件输出要求】
1. 将调研文档写入 projects/products-jobs/research/ 目录下（如目录不存在请先创建）。
2. 文件命名格式：{调研主题}-research.md（例如：微服务选型-research.md）。
3. 文档使用 Markdown 格式编写。

【调研报告内容结构】
1. 调研背景与目标
2. 现状分析
3. 方案对比（使用表格对比优劣）
4. 推荐方案及理由
5. 风险与注意事项
6. 参考资料

【输出标记】
文档写入完成后，在回复末尾必须用以下格式标记文件路径（每行一个）：
[[FILE:绝对路径/到/projects/products-jobs/research/调研主题-research.md]]
注意：路径必须是绝对路径。

【调研主题】
{ARGS}`

const protoMakeTemplate = `你是一位全栈工程师。请根据以下需求，生成一个可运行的前端+后端工程原型。

【工程输出要求】
1. 将工程创建在 projects/ 目录下，工程目录名使用需求关键词的英文命名（如 projects/user-login/）。
2. 前端使用 React + TypeScript + Tailwind CSS。
3. 后端使用 Node.js（Express 或 Fastify）。
4. 工程结构示例：
   projects/{工程名}/
   ├── frontend/    # React 前端
   │   ├── src/
   │   ├── package.json
   │   └── vite.config.ts
   └── backend/     # Node.js 后端
       ├── src/
       └── package.json
5. 前端和后端都必须有完整的 package.json，确保可以 npm install && npm run dev 启动。

【输出标记】
工程创建完成后，在回复末尾必须用以下格式标记工程路径（每行一个）：
[[PROJECT:绝对路径/到/projects/工程名]]
注意：路径必须是绝对路径。

【需求描述】
{ARGS}`

const codeTemplate = `你是一位资深工程师。请根据以下需求编写代码。

【代码输出要求】
1. 将代码写入 projects/ 目录下对应的工程中。
2. 遵循该工程现有的代码风格和目录结构。
3. 代码需包含必要的错误处理和注释。

【输出标记】
- 如果创建了整个工程，使用 [[PROJECT:绝对路径]] 标记。
- 如果只是创建或修改单个文件，使用 [[FILE:绝对路径]] 标记。

【需求描述】
{ARGS}`

const debugTemplate = `你是一位资深工程师。请根据以下缺陷描述，定位并修复问题。

【调试要求】
1. 先分析可能的根因，再给出修复方案。
2. 修改代码时直接使用工具写入文件，不要只给出建议。
3. 修复完成后简要说明修改了哪些文件、修改原因。

【输出标记】
- 如果修改了整个工程中的多个文件，使用 [[PROJECT:绝对路径]] 标记工程根目录。
- 如果只修改了单个文件，使用 [[FILE:绝对路径]] 标记。

【缺陷描述】
{ARGS}`

const reviewTemplate = `你是一位资深代码审查专家。请对以下代码或工程进行 Code Review。

【审查要求】
1. 从代码质量、安全性、性能、可维护性四个维度进行审查。
2. 对每个问题给出严重程度（严重/警告/建议）和具体修改建议。
3. 审查结果以 Markdown 格式输出。

【输出标记】
如果审查过程中修改了代码，使用 [[FILE:绝对路径]] 或 [[PROJECT:绝对路径]] 标记修改的文件/工程。

【审查目标】
{ARGS}`
