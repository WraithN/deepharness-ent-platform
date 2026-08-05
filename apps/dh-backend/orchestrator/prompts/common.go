package prompts

import "fmt"

// CommonPromptRules 是所有指令模板和 flow prompt 共享的通用提示词规则。
// 由 ApplyPromptCommon 自动 prepend 到渲染后的提示词前，确保无论是
// 交互式斜杠指令还是 orchestrator 多步流程，模型都遵循统一的基础约束。
const CommonPromptRules = `【通用规则】
1. 所有回复必须使用中文，包括标题、正文、标记、代码注释、文件路径说明等。
2. 不要在回复正文或标题中暴露内部工作目录（如 /home/.../workspace/...），只使用相对路径或项目名向用户说明。
3. 禁止使用 /workflows、/commit、/pr、/review 等后台 slash command；所有任务都通过直接回答或调用工具完成。
4. 在回复末尾用 [[FILE:绝对路径]] 或 [[PROJECT:绝对路径]] 标记实际创建的文件或工程。
5. 如果指令需要生成卡片，必须在回复末尾保留对应的 [[CARD:卡片类型]] 标记。
6. 除了 [[FILE:...]]、[[PROJECT:...]]、[[CARD:...]] 标记外，不要把普通 slash 字符串当作文件路径。
7. 不要输出执行计划、Next Move、步骤安排、分步策略、工具调用说明等元信息；只输出用户请求的结果内容、必要的解释说明以及要求的标记。
`

// standardsDirectiveFmt 是工作空间规范引用的格式模板。
// 在 ApplyPromptCommon 中自动 append 到渲染后的提示词末尾，
// 引导 agent 在项目子目录（git repo）内工作时主动读取 workspace root 的 AGENTS.md / DESIGN.md。
// %s 为 workspacePath 绝对路径。
const standardsDirectiveFmt = "\n\n【工作空间规范】\n请先阅读工作空间根目录下的 AGENTS.md（工作行为规范）和 DESIGN.md（UI 设计规范），并遵循其中的要求。\n路径：%s/AGENTS.md、%s/DESIGN.md"

// BuildStandardsDirective 构造工作空间规范引用文本。
// workspacePath 为空时返回空串（不注入）。
func BuildStandardsDirective(workspacePath string) string {
	if workspacePath == "" {
		return ""
	}
	return fmt.Sprintf(standardsDirectiveFmt, workspacePath, workspacePath)
}

// ApplyPromptCommon 对渲染后的提示词统一追加通用规则和规范引用。
// flow prompt 和 command template 渲染后均调用此函数，确保：
//  1. CommonPromptRules 自动 prepend（通用规则覆盖全链路）
//  2. 工作空间规范引用自动 append（agent 在项目子目录内仍能感知 AGENTS.md / DESIGN.md）
func ApplyPromptCommon(rendered, workspacePath string) string {
	result := CommonPromptRules + "\n\n" + rendered
	directive := BuildStandardsDirective(workspacePath)
	if directive != "" {
		result += directive
	}
	return result
}
