package handler

// embeddedCommands 是内嵌的默认指令配置。
// 当外部 config/commands.yaml 不存在时使用此配置作为回退。
// 修改指令配置时请编辑 config/commands.yaml 文件。
var embeddedCommands = []CommandConfig{
	{
		Cmd:        "/prd-write",
		Label:      "写需求",
		Desc:       "生成结构化 PRD 文档",
		Icon:       "FileText",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Template:   "你是一位资深产品经理。请根据以下需求描述，生成一份结构化的 PRD（产品需求文档）。\n\n【文件输出要求】\n1. 将 PRD 文档写入 projects/products-jobs/prd/ 目录下。\n2. 文件命名格式：{需求名称}-prd.md。\n3. 文档使用 Markdown 格式编写。\n\n【PRD 内容结构】\n1. 背景与目标\n2. 用户场景\n3. 功能详情\n4. 业务流程图（使用 Mermaid 语法）\n5. 数据埋点要求\n\n【输出标记】\n文档写入完成后，在回复末尾标记：\n[[FILE:绝对路径/到/projects/products-jobs/prd/需求名称-prd.md]]\n\n【用户需求】\n{ARGS}",
	},
	{
		Cmd:        "/prd-research",
		Label:      "做调研",
		Desc:       "技术调研与方案选型",
		Icon:       "Compass",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Template:   "你是一位资深技术分析师。请根据以下主题，进行深入的技术调研并生成一份结构化的调研报告。\n\n【文件输出要求】\n1. 将调研文档写入 projects/products-jobs/research/ 目录下。\n2. 文件命名格式：{调研主题}-research.md。\n3. 文档使用 Markdown 格式编写。\n\n【调研报告内容结构】\n1. 调研背景与目标\n2. 现状分析\n3. 方案对比（使用表格对比优劣）\n4. 推荐方案及理由\n5. 风险与注意事项\n6. 参考资料\n\n【输出标记】\n[[FILE:绝对路径/到/projects/products-jobs/research/调研主题-research.md]]\n\n【调研主题】\n{ARGS}",
	},
	{
		Cmd:        "/proto-make",
		Label:      "做原型",
		Desc:       "生成 UI 原型设计稿",
		Icon:       "LayoutTemplate",
		AllowTask:  true,
		AllowRepos: true,
		MaxRepos:   2,
		Template:   "你是一位全栈工程师。请根据以下需求，生成一个可运行的前端+后端工程原型。\n\n【工程输出要求】\n1. 将工程创建在 projects/ 目录下。\n2. 前端使用 React + TypeScript + Tailwind CSS。\n3. 后端使用 Node.js（Express 或 Fastify）。\n4. 前后端都必须有完整的 package.json。\n\n【输出标记】\n[[PROJECT:绝对路径/到/projects/工程名]]\n\n【需求描述】\n{ARGS}",
	},
	{
		Cmd:          "/code",
		Label:        "写代码",
		Desc:         "根据需求编写代码",
		Icon:         "Code2",
		AllowTask:    true,
		AllowRepos:   true,
		RequireRepos: true,
		MaxRepos:     2,
		Template:   "你是一位资深工程师。请根据以下需求编写代码。\n\n【代码输出要求】\n1. 将代码写入 projects/ 目录下对应的工程中。\n2. 遵循该工程现有的代码风格和目录结构。\n3. 代码需包含必要的错误处理和注释。\n\n【输出标记】\n- 创建整个工程使用 [[PROJECT:绝对路径]] 标记。\n- 创建或修改单个文件使用 [[FILE:绝对路径]] 标记。\n\n【需求描述】\n{ARGS}",
	},
	{
		Cmd:        "/debug",
		Label:      "解BUG",
		Desc:       "定位并修复缺陷",
		Icon:       "Bug",
		AllowTask:  true,
		AllowRepos: true,
		MaxRepos:   2,
		Template:   "你是一位资深工程师。请根据以下缺陷描述，定位并修复问题。\n\n【调试要求】\n1. 先分析可能的根因，再给出修复方案。\n2. 修改代码时直接使用工具写入文件，不要只给出建议。\n3. 修复完成后简要说明修改了哪些文件、修改原因。\n\n【输出标记】\n- 修改多个文件使用 [[PROJECT:绝对路径]] 标记工程根目录。\n- 修改单个文件使用 [[FILE:绝对路径]] 标记。\n\n【缺陷描述】\n{ARGS}",
	},
	{
		Cmd:          "/review",
		Label:        "代码Review",
		Desc:         "审查代码质量与规范",
		Icon:         "CheckCircle",
		AllowTask:    true,
		AllowRepos:   true,
		RequireRepos: true,
		MaxRepos:     2,
		Template:   "你是一位资深代码审查专家。请对以下代码或工程进行 Code Review。\n\n【审查要求】\n1. 从代码质量、安全性、性能、可维护性四个维度进行审查。\n2. 对每个问题给出严重程度（严重/警告/建议）和具体修改建议。\n3. 审查结果以 Markdown 格式输出。\n\n【输出标记】\n如果审查过程中修改了代码，使用 [[FILE:绝对路径]] 或 [[PROJECT:绝对路径]] 标记。\n\n【审查目标】\n{ARGS}",
	},
}
