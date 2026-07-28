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
		Enabled:      true,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深产品经理。请根据以下需求描述，生成一份结构化的 PRD（产品需求文档）。\n\n【文件输出要求】\n1. 将 PRD 文档写入 {WORKSPACE_PATH}/projects/products-jobs/prd/ 目录下。\n2. 文件命名格式：{需求名称}-prd.md。\n3. 文档使用 Markdown 格式编写。\n\n【PRD 内容结构】\n1. 背景与目标\n2. 用户场景\n3. 功能详情\n4. 业务流程图（使用 Mermaid 语法）\n5. 数据埋点要求\n\n【输出标记】\n文档写入完成后，在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的 PRD 文件，\n例如 [[FILE:{WORKSPACE_PATH}/projects/products-jobs/prd/login-prd.md]]。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【用户需求】\n{ARGS}",
	},
	{
		Cmd:        "/prd-research",
		Label:      "做调研",
		Desc:       "技术调研与方案选型",
		Icon:       "Compass",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      true,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深技术分析师。请根据以下主题，进行深入的技术调研并生成一份结构化的调研报告。\n\n【文件输出要求】\n1. 将调研文档写入 {WORKSPACE_PATH}/projects/products-jobs/research/ 目录下。\n2. 文件命名格式：{调研主题}-research.md。\n3. 文档使用 Markdown 格式编写。\n\n【调研报告内容结构】\n1. 调研背景与目标\n2. 现状分析\n3. 方案对比（使用表格对比优劣）\n4. 推荐方案及理由\n5. 风险与注意事项\n6. 参考资料\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的调研报告文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【调研主题】\n{ARGS}",
	},
	{
		Cmd:        "/proto-make",
		Label:      "做原型",
		Desc:       "生成 UI 原型设计稿",
		Icon:       "LayoutTemplate",
		AllowTask:  true,
		AllowRepos: true,
		MaxRepos:   2,
		Enabled:      true,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位前端工程师与 UI 设计师。请根据以下需求，生成一个可运行的前端原型工程（基于 Node + Vite）。\n\n【工程输出要求】\n1. 将工程创建在 {WORKSPACE_PATH}/products/prototypes/ 目录下，工程目录名使用需求关键词的英文命名（如 {WORKSPACE_PATH}/products/prototypes/user-login/）。\n2. 使用 React + TypeScript + Tailwind CSS + Vite。\n3. 不需要后端服务；所有数据使用本地 mock 数据（放在 src/mocks/ 或 public/mock/）。\n4. 关键组件/可点击元素必须添加稳定的 data-dh-id 属性，例如：\n   <button data-dh-id=\\\"submit-btn\\\">提交</button>\n   <div data-dh-id=\\\"user-card\\\">...</div>\n   这对后续产品标注和走查非常重要。\n5. 工程必须包含 `pnpm run dev` 用于本地预览，以及 `pnpm run build` 用于构建生产包。\n6. 所有文件创建完成后，只执行一次 `pnpm install && pnpm run build`，确保产出 `dist/index.html` 和 `dist/assets/`。不要重复执行 install。\n7. 最终产物结构：\n   {WORKSPACE_PATH}/products/prototypes/{工程名}/\n   ├── package.json\n   ├── vite.config.ts\n   ├── index.html\n   ├── src/\n   ├── public/mock/\n   └── dist/\n       ├── index.html\n       └── assets/\n\n【输出标记】\n工程创建完成后，在回复末尾仅输出一个工程根目录标记，不要输出 [[FILE:...]] 标记：\n[[PROJECT:{WORKSPACE_PATH}/products/prototypes/{工程名}]]\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n同时根据用户输入的需求卡片标题或需求描述，总结一个简短的中文需求名，并用 [[REQ_NAME:需求名]] 标记输出。若已引用需求卡片，尽量与卡片标题保持一致。\n\n【需求描述】\n{ARGS}",
	},
	{
		Cmd:          "/code",
		Label:        "写代码",
		Desc:         "根据需求生成技术文档并编写代码",
		Icon:         "Code2",
		AllowTask:    true,
		AllowRepos:   true,
		RequireRepos: false,
		MaxRepos:     2,
		Enabled:      true,
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深工程师。请根据需求卡片/描述完成以下任务。\n\n【任务流程】\n1. 首先生成技术文档（包含架构设计、数据模型、接口/组件设计、实现步骤），写入 {WORKSPACE_PATH}/projects/{工程名}/README.md 或 {WORKSPACE_PATH}/projects/{工程名}/docs/tech-spec.md。\n2. 如果用户尚未明确指定工程目录（即没有已选择的代码库或未提供工程名），完成技术文档后必须调用 question 工具向用户确认工程选择。调用格式如下：\n   {\n     \"questions\": [\n       {\n         \"id\": \"project\",\n         \"header\": \"技术文档已生成\",\n         \"text\": \"请选择或输入一个工程目录名称。若目录不存在，将自动创建新工程。\",\n         \"options\": []\n       }\n     ]\n   }\n3. 收到用户响应后，将响应中的工程名称作为 `{工程名}`，继续编写实现代码并写入 {WORKSPACE_PATH}/projects/{工程名}/ 目录。\n4. 如果用户选择的代码库已存在，优先在已有代码库目录下修改；如果用户输入了新工程名且目录不存在，则创建新工程并写入代码。\n5. 如果需求卡片中包含产品原型（product prototype），请在技术文档中参考原型进行设计，并在实现时保持与原型一致的页面结构与交互。\n\n【代码输出要求】\n1. 将代码写入 {WORKSPACE_PATH}/projects/{工程名}/ 目录下。\n2. 遵循该工程现有的代码风格和目录结构。\n3. 代码需包含必要的错误处理和注释。\n\n【输出标记】\n- 技术文档用 [[FILE:文件完整路径]] 标记。\n- 创建或修改整个工程用 [[PROJECT:工程完整路径]] 标记。\n- 创建或修改单个文件用 [[FILE:文件完整路径]] 标记。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【需求描述】\n{ARGS}",
	},
	{
		Cmd:        "/debug",
		Label:      "解BUG",
		Desc:       "定位并修复缺陷",
		Icon:       "Bug",
		AllowTask:  true,
		AllowRepos: true,
		MaxRepos:   2,
		Enabled:      true,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深工程师。请根据以下缺陷描述，定位并修复问题。\n\n【调试要求】\n1. 先分析可能的根因，再给出修复方案。\n2. 修改代码时直接使用工具写入文件，不要只给出建议。\n3. 修复完成后简要说明修改了哪些文件、修改原因。\n\n【输出标记】\n- 修改了多个文件用 [[PROJECT:工程完整路径]] 标记根目录。\n- 修改了单个文件用 [[FILE:文件完整路径]] 标记。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【缺陷描述】\n{ARGS}",
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
		Enabled:      true,
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深代码审查专家。请对以下代码或工程进行 Code Review。\n\n【审查要求】\n1. 从代码质量、安全性、性能、可维护性四个维度进行审查。\n2. 对每个问题给出严重程度（严重/警告/建议）和具体修改建议。\n3. 审查结果以 Markdown 格式输出。\n\n【输出标记】\n如果审查过程中修改了代码，用 [[FILE:文件完整路径]] 或 [[PROJECT:工程完整路径]] 标记。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【审查目标】\n{ARGS}",
	},
	{
		Cmd:          "/unit-test",
		Label:        "生成单测",
		Desc:         "为代码生成单元测试",
		Icon:         "FlaskConical",
		AllowTask:    true,
		AllowRepos:   true,
		RequireRepos: true,
		MaxRepos:     2,
		Enabled:      true,
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深测试工程师。请根据以下代码或需求，生成完整的单元测试。\n\n【测试要求】\n1. 覆盖正常路径、异常路径与边界条件。\n2. 测试代码写入对应工程的 tests/ 目录或与被测文件同目录。\n3. 使用项目现有测试框架（如 Jest / Vitest / pytest）。\n\n【输出标记】\n- 创建单个测试文件用 [[FILE:文件完整路径]] 标记。\n- 涉及多个文件用 [[PROJECT:工程完整路径]] 标记。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【目标代码/需求】\n{ARGS}",
	},
	{
		Cmd:          "/refactor",
		Label:        "重构代码",
		Desc:         "对指定工程中的某个功能或能力进行重构",
		Icon:         "RefreshCw",
		AllowTask:    true,
		AllowRepos:   true,
		RequireRepos: true,
		MaxRepos:     2,
		Enabled:      true,
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深代码重构专家。请对以下指定工程中的功能或能力进行重构。\n\n【任务流程】\n1. 先阅读目标工程的代码结构、命名规范与测试覆盖情况。\n2. 明确用户希望重构的功能或模块范围，禁止在范围不明时大面积改动。\n3. 制定重构计划：列出要修改的文件、重构步骤、风险点与回滚策略。\n4. 小步执行重构，每次只做一个语义明确的改动；优先使用提取函数、重命名、引入卫语句、消除重复等手段。\n5. 若涉及接口或函数签名变更，必须同步更新所有调用方与对应测试。\n\n【重构原则】\n1. 保持外部行为兼容：重构前后功能表现应一致。\n2. 遵循现有工程风格：命名、结构、类型、错误处理与周边代码保持一致。\n3. 禁止过度设计：不要为了抽象而抽象；复杂逻辑必须添加注释。\n4. 代码嵌套不超过 3 层；超过时提取函数或使用卫语句。\n5. 同一逻辑出现超过两处必须封装为小函数。\n6. 不允许出现魔法值，数字与字符串字面量必须提取为常量。\n\n【验证要求】\n1. 重构完成后运行构建/类型检查/测试，确保无 warning、无失败用例。\n2. 若无法运行测试，至少说明已检查的项与结果。\n\n【输出标记】\n- 创建或修改单个文件用 [[FILE:文件完整路径]] 标记。\n- 涉及多个文件用 [[PROJECT:工程完整路径]] 标记工程根目录。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【重构目标】\n{ARGS}",
	},
	{
		Cmd:        "/test-case",
		Label:      "生成测试用例",
		Desc:       "生成结构化测试用例",
		Icon:       "ClipboardList",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深测试工程师。请根据以下需求或功能描述，生成结构化的测试用例。\n\n【文件输出要求】\n1. 将测试用例文档写入 {WORKSPACE_PATH}/projects/products-jobs/test-cases/ 目录下。\n2. 文件命名格式：{功能名称}-test-cases.md。\n3. 每条用例包含：用例编号、标题、前置条件、操作步骤、预期结果、优先级。\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的测试用例文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【功能描述】\n{ARGS}",
	},
	{
		Cmd:        "/auto-test",
		Label:      "自动化脚本",
		Desc:       "生成自动化测试脚本",
		Icon:       "Terminal",
		AllowTask:  true,
		AllowRepos: true,
		MaxRepos:   1,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深测试开发工程师。请根据以下需求或接口，生成可运行的自动化测试脚本。\n\n【脚本要求】\n1. 脚本写入 {WORKSPACE_PATH}/projects/ 对应工程的 tests/ 或 e2e/ 目录。\n2. 优先使用 Playwright / Cypress / Jest 等常见工具，并说明运行方式。\n3. 包含关键断言与用例说明。\n\n【输出标记】\n用 [[FILE:文件完整路径]] 或 [[PROJECT:工程完整路径]] 标记输出文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【目标需求/接口】\n{ARGS}",
	},
	{
		Cmd:        "/bug-analysis",
		Label:      "BUG分析",
		Desc:       "分析缺陷根因与影响",
		Icon:       "Search",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深测试分析师。请根据以下缺陷现象，进行根因分析并评估影响范围。\n\n【分析要求】\n1. 列出可能的根因假设并给出验证思路。\n2. 评估对功能、性能、用户体验的影响。\n3. 输出修复建议与回归测试重点。\n\n【输出标记】\n如需写入文件，用 [[FILE:文件完整路径]] 标记。务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【缺陷现象】\n{ARGS}",
	},
	{
		Cmd:        "/test-report",
		Label:      "测试报告",
		Desc:       "生成测试报告",
		Icon:       "FileBarChart",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深测试经理。请根据以下测试执行情况或数据，生成一份测试报告。\n\n【报告内容】\n1. 测试范围与目标\n2. 测试执行摘要（用例数、通过/失败数、阻塞数）\n3. 缺陷统计与严重度分布\n4. 风险评估与发布建议\n5. 遗留问题与后续计划\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的测试报告文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【测试数据/描述】\n{ARGS}",
	},
	{
		Cmd:        "/ui-spec",
		Label:      "UI规范",
		Desc:       "生成 UI 设计规范",
		Icon:       "Layout",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深 UI 设计师。请根据以下需求，生成一份 UI 设计规范文档。\n\n【文档内容】\n1. 色彩规范（主色、辅助色、状态色、文字色）\n2. 字体与字号规范\n3. 间距与圆角规范\n4. 按钮、输入框、卡片等组件样式规范\n5. 布局栅格示例\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的 UI 规范文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【需求描述】\n{ARGS}",
	},
	{
		Cmd:        "/design-review",
		Label:      "设计走查",
		Desc:       "检查设计稿与实现一致性",
		Icon:       "Eye",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深设计走查专家。请根据以下设计稿或实现描述，检查设计还原与一致性。\n\n【走查维度】\n1. 视觉还原（颜色、字体、间距、圆角）\n2. 交互流程与状态完整性\n3. 响应式与可访问性\n4. 设计 Token 使用是否一致\n\n【输出标记】\n如需写入文件，用 [[FILE:文件完整路径]] 标记。务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【设计稿/实现描述】\n{ARGS}",
	},
	{
		Cmd:        "/design-token",
		Label:      "Design Token",
		Desc:       "生成 Design Token 定义",
		Icon:       "Palette",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深设计系统专家。请根据以下品牌或设计需求，生成一份 Design Token 定义。\n\n【Token 要求】\n1. 包含颜色、字体、间距、圆角、阴影、断点等维度。\n2. 输出为 JSON 或 CSS 变量格式，便于代码使用。\n3. 命名语义清晰，支持层级扩展。\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的 Token 文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【品牌/设计需求】\n{ARGS}",
	},
	{
		Cmd:        "/ui-design",
		Label:      "UI设计稿",
		Desc:       "根据需求生成 UI 设计稿与交互说明",
		Icon:       "Palette",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深 UI 设计师。请根据以下需求，生成一份高保真 UI 设计稿说明与交互规范。\n\n【设计稿内容】\n1. 页面结构与信息架构\n2. 各关键页面的视觉说明（布局、配色、字体、间距、组件使用）\n3. 交互动效与状态变化（默认、悬停、点击、禁用、加载、错误）\n4. 响应式适配要点\n5. 可访问性（Accessibility）注意事项\n\n【文件输出要求】\n1. 将设计稿文档写入 {WORKSPACE_PATH}/projects/products-jobs/design/ 目录下。\n2. 文件命名格式：{需求关键词}-ui-design.md。\n3. 文档使用 Markdown 格式编写。\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的设计稿文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【需求描述】\n{ARGS}",
	},
	{
		Cmd:        "/ui-kit",
		Label:      "UI组件库",
		Desc:       "生成一套UI组件库规范与示例",
		Icon:       "Box",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深 UI 设计师与设计系统专家。请根据以下需求，生成一套完整的 UI 组件库规范文档。\n\n【文档内容】\n1. 组件库概述与设计原则（色彩、字体、间距、圆角、阴影等）。\n2. 常用组件清单：按钮、输入框、下拉选择、单选/复选、开关、卡片、弹窗、表格、导航、标签页等。\n3. 每个组件包含：用途说明、变体状态（默认、悬停、禁用、错误等）、尺寸规格、使用示例、注意事项。\n4. 组件命名与代码实现建议（基于 React + TypeScript + Tailwind CSS）。\n5. 可访问性（Accessibility）与响应式适配要点。\n\n【文件输出要求】\n1. 将 UI 组件库文档写入 {WORKSPACE_PATH}/projects/products-jobs/design/ 目录下。\n2. 文件命名格式：{需求关键词}-ui-kit.md。\n3. 文档使用 Markdown 格式编写。\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的 UI 组件库文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【需求描述】\n{ARGS}",
	},
	{
		Cmd:        "/req-breakdown",
		Label:      "需求拆分",
		Desc:       "将需求拆分为结构化的需求项与验收标准",
		Icon:       "ListChecks",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      true,
		Template: `【语言要求】
你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。

你是一位资深产品经理。请根据以下需求，拆分为结构化的需求项（含主需求与子需求），并给出简洁的需求描述与验收标准。

【拆分原则】
1. 控制粒度：以"功能模块"为粒度拆分，不要拆到按钮级、字段级细节。
2. 层级限制：最多 2 层（父需求 + 子需求），不要出现孙需求。
3. 数量建议：父需求 3~7 项，每项子需求不超过 3 项。
4. 验收标准精简：每个分类（正常/异常/UI/边界）最多 2 条，聚焦核心路径，不罗列极端边缘 case。

【需求项结构】
每个需求项必须包含以下字段：
1. 需求标题：简洁描述需求项（一句话）。
2. 需求描述（简明扼要）：
   - 角色（谁）：谁要使用这个功能。
   - 使用场景（什么时候）：在什么业务场景触发。
   - 用户动作（想要做什么）：用户希望执行什么行为。
   - 业务目标（价值）：解决什么问题。
   - 约束与边界（可选）：范围限制、依赖条件。
3. 验收标准（精简）：
   - 正常流程验收（主路径，1~2 条）。
   - 异常流程验收（1~2 条）。
   - UI & 交互验收（1~2 条）。
   - 边界约束验收（可选，1 条）。
4. 主/子关系：顶层为父需求，可拆分为子需求（最多一层）。子需求通过 parentId 引用父需求 id。
5. workitemId（可选）：如果该需求项与【已有需求列表】中的某条需求匹配（标题相同或语义高度相似），
   则添加此字段，值为已有需求的 ID。没有匹配的项不要添加此字段。

【文件输出要求】
1. 将需求拆分文档写入 {WORKSPACE_PATH}/projects/products-jobs/req-breakdown/ 目录下。
2. 文件命名格式：{需求关键词}-req-breakdown.md，需求关键词从用户需求中提取，使用英文或拼音（例如 login-req-breakdown.md）。
3. 文档使用 Markdown 格式编写，包含主/子需求层级。

【聊天输出要求】
1. 在回复末尾保留以下标记，用于前端渲染卡片：
[[FILE:{WORKSPACE_PATH}/projects/products-jobs/req-breakdown/{需求关键词}-req-breakdown.md]]
[[FILE:{WORKSPACE_PATH}/projects/products-jobs/req-breakdown/{需求关键词}-req-breakdown.json]]
[[CARD:req_breakdown]]
2. 结构化 JSON 数据可能很长，请使用 bash 工具写入独立的 JSON 文件，而不是把完整 JSON 塞进聊天回复：
   - 文件路径：{WORKSPACE_PATH}/projects/products-jobs/req-breakdown/{需求关键词}-req-breakdown.json
   - 使用 heredoc 方式写入，确保 JSON 内容完整、合法、不被截断。
   - JSON 结构：{"title":"...","generatedAt":"...","total":N,"items":[{"id":"R-1","parentId":null,"title":"...","workitemId":"已有需求ID（可选）","description":{"role":"...","scenario":"...","action":"...","value":"...","constraints":"..."},"acceptanceCriteria":{"normal":["..."],"error":["..."],"ui":["..."],"boundary":["..."]},"priority":"P0|P1|P2"}]}
   - 示例命令：
     cat > {WORKSPACE_PATH}/projects/products-jobs/req-breakdown/{需求关键词}-req-breakdown.json << 'EOF'
     {"title":"...","total":5,"items":[{"id":"R-1","parentId":null,"title":"...","priority":"P1","description":{...},"acceptanceCriteria":{...}}]}
     EOF
3. Markdown 文档供人阅读，JSON 文件供前端渲染卡片，两者都要完整生成。

【需求描述】
{ARGS}`,
	},
	{
		Cmd:        "/data-analysis",
		Label:      "数据分析",
		Desc:       "分析数据并生成洞察",
		Icon:       "BarChart3",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      false,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深数据分析师。请根据以下数据或分析目标，生成数据洞察报告。\n\n【报告内容】\n1. 分析目标与指标说明\n2. 数据清洗与假设说明\n3. 关键指标与趋势分析\n4. 洞察结论与行动建议\n5. 可视化建议（图表类型）\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的分析报告文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【数据/分析目标】\n{ARGS}",
	},
}
