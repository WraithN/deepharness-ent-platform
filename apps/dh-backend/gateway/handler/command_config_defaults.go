package handler

// embeddedCommands 是内嵌的默认指令配置。
// 当外部 config/commands.yaml 不存在时使用此配置作为回退。
// 修改指令配置时请编辑 config/commands.yaml 文件。
var embeddedCommands = []CommandConfig{
	{
		Cmd:         "/grill-me",
		Label:       "头脑风暴",
		Desc:        "基于任务卡片进行头脑风暴，逐步澄清需求并生成需求设计文档",
		Icon:        "Lightbulb",
		AllowTask:   true,
		AllowRepos:  false,
		RequireTask: true,
		MaxRepos:    0,
		Enabled:     true,
		Template: `【语言要求】
你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。

你是一位资深产品经理。请基于任务卡片内容，通过逐个提问的方式澄清需求，最终生成一份需求设计文档草案。

【核心规则：先确认，再输出问题与选项】
每次提问时，先输出一句简短确认（首次可跳过确认，直接说明开始提问），然后输出问题正文和备选选项，最后以 [[QUESTION:...]] 标记结束。
不要输出分析过程，直接输出确认、问题和选项。
每次用户回答后，你将在下一轮看到"问题：XXX 用户回答：YYY"的上下文，请据此简短确认并继续输出下一个问题。
提问总数控制在 1～5 个之间，当需求已经澄清时即可停止提问，不必强行凑满 5 个。
在用户需求澄清完成前，禁止生成文档、禁止执行文件写入、禁止调用任何工具。

【输出格式（必须严格遵守）】
问题正文与选项必须放在同一行的 [[QUESTION:...]] 标记中，格式如下（不要放在代码块中，直接输出纯文本）：

[[QUESTION:问题正文|A. 选项一说明|B. 选项二说明|C. 选项三说明]]

规则：
1. 文本中至少提供 2 个选项，建议 3 个。
2. 选项格式为：字母. 说明文字（用 | 分隔）。
3. 问题正文不要含选项。
4. 每次只提一个问题。
5. 在用户需求澄清完成前，禁止生成文档、禁止执行文件写入、禁止调用任何工具。

【提问覆盖维度（按需覆盖）】
根据任务卡片内容，按需覆盖以下维度，每个维度最多提一个问题，总提问数控制在 1～5 个：
1. 核心场景：用户在什么场景下使用？推送什么内容？
2. 用户角色：谁配置？谁接收？是否有权限要求？
3. 内容范围：推送哪些数据？时间范围？筛选条件？
4. 业务规则：频次/时间点？失败处理？数量限制？
5. 优先级与依赖：依赖哪些已有功能？MVP 范围？

【结束条件】
当 1～5 个问题已经足够澄清需求，或用户已明确表达无需继续提问时，即可告知用户"需求已澄清，即将生成需求设计文档草案"，然后生成文档。
如果还有关键维度未澄清，必须继续提问，禁止提前结束提问流程。

【需求设计文档草案输出要求】
基于任务卡片内容以及用户的回答，生成一份需求设计文档草案：
1. 将文档写入 {WORKSPACE_PATH}/pm-jobs/brainstorm/ 目录下。
2. 文件命名格式：{需求关键词}-brainstorm.md。
3. 文档使用 Markdown 格式编写，包含以下结构：
   - 需求背景与目标
   - 用户角色与场景
   - 功能需求详情
   - 业务规则与约束
   - 验收标准
   - 非功能性需求
   - 开放问题与后续跟进

【输出标记】
在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的需求设计文档草案文件。
务必使用真实的文件系统绝对路径，不要使用占位符。

【补充说明】
任务卡片内容已自动附加在上方。本指令要求必须提供需求卡片；收到需求卡片后，在澄清完成时必须输出一份需求设计文档草案，禁止只输出问题而不输出文档。
若用户在输入框中提供了额外说明，也请一并参考。

【用户补充说明】
{ARGS}`,
	},
	{
		Cmd:        "/prd-write",
		Label:      "写需求",
		Desc:       "生成结构化 PRD 文档",
		Icon:       "FileText",
		AllowTask:  true,
		AllowRepos: false,
		MaxRepos:   0,
		Enabled:      true,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深产品经理。请根据以下需求描述，生成一份结构化的 PRD（产品需求文档）。\n\n【文件输出要求】\n1. 将 PRD 文档写入 {WORKSPACE_PATH}/pm-jobs/prd/ 目录下。\n2. 文件命名格式：{需求名称}-prd.md。\n3. 文档使用 Markdown 格式编写。\n\n【PRD 内容结构】\n1. 背景与目标\n2. 用户场景\n3. 功能详情\n4. 业务流程图（使用 Mermaid 语法）\n5. 数据埋点要求\n\n【输出标记】\n文档写入完成后，在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的 PRD 文件，\n例如 [[FILE:{WORKSPACE_PATH}/pm-jobs/prd/login-prd.md]]。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【用户需求】\n{ARGS}",
	},
	{
		Cmd:          "/prd-research",
		Label:        "产品调研",
		Desc:         "输入产品名称或产品链接（可附登录Cookie），调研分析并产出原型项目、功能列表、UI设计、产品分析",
		Icon:         "Globe",
		AllowTask:    false,
		AllowRepos:   false,
		MaxRepos:     0,
		Enabled:      true,
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深产品经理 + UI/UX 设计师 + 前端工程师。请根据【用户需求】完成产品调研分析，并产出四个产物。\n\n【任务独立性与路径约束（最高优先级）】\n1. 本指令是独立的新任务。会话历史（含锚定摘要/Important Details）中可能残留此前其他任务的上下文（如其他项目的工作目录、其他需求的设计决策等），与本任务无关，必须忽略；禁止沿用其中的工作目录、文件路径或任务结论。\n2. 本任务唯一合法的输出根目录是 {WORKSPACE_PATH}/pm-jobs/prd-research/。所有产物文件必须使用以该目录开头的绝对路径创建；严禁写入会话历史中提及的任何项目目录（如 projects/ 下的工程），严禁使用相对路径。\n3. 若历史上下文与本条消息的要求冲突，以本条消息为准。\n\n【输入场景】\n本指令兼容两种输入，按【用户需求】的内容自动识别：\n1. 仅产品名称：用户只提供产品名称（如「调研产品：XXX」）。基于你对该产品的了解与公开信息进行分析与产出；若你不了解该产品，请明确说明，并基于其所属领域给出合理推断。\n2. 产品链接（可附登录 Cookie）：用户提供「调研链接：<URL>」，可能附带「登录Cookie：<name=value; ...>」。【用户需求】中包含【已抓取网页内容】时，仔细阅读并理解目标网站的核心功能、信息架构、交互流程与视觉风格；若抓取内容为空或不足，请基于 URL 给出合理分析，并提示用户提供登录 Cookie 以获取完整内容。\n\n【产物目录】\n1. 在 {WORKSPACE_PATH}/pm-jobs/prd-research/ 目录下创建本次任务目录，目录名使用网站域名或简短英文标识（如 example-com）。\n2. 必须生成以下四个产物（文件名中的 {产品名} 替换为目标产品的实际名称，例如「竞品调研-PingCode产品整体分析.md」）：\n   - 产品分析文档：{WORKSPACE_PATH}/pm-jobs/prd-research/{标识}/竞品调研-{产品名}产品整体分析.md\n   - 功能列表：{WORKSPACE_PATH}/pm-jobs/prd-research/{标识}/竞品调研-{产品名}产品功能列表.md\n   - UI 设计文档：{WORKSPACE_PATH}/pm-jobs/prd-research/{标识}/竞品调研-{产品名}产品UI设计分析.md\n   - 原型项目：{WORKSPACE_PATH}/pm-jobs/prd-research/{标识}/prototype/（Vite + React 可运行工程）\n\n【执行流程】\n必须严格按以下两步顺序执行：\n1. 第一步：并行完成三份文档——竞品调研-{产品名}产品整体分析.md、竞品调研-{产品名}产品功能列表.md、竞品调研-{产品名}产品UI设计分析.md。三者之间没有依赖关系，应在同一轮中并行推进撰写，不要串行等待。\n2. 第二步：三份文档完成后，基于竞品调研-{产品名}产品UI设计分析.md 与已抓取的页面内容进行 1:1 原型仿真，生成 prototype/ 工程。原型必须在样式上与原产品保持一致：布局结构、配色、字体、字号、间距、圆角、组件样式与关键交互均按原产品 1:1 还原（仅产品名称场景则按调研结论还原其公开页面的典型风格）。\n\n【竞品调研-{产品名}产品整体分析.md 内容结构】\n1. 产品定位与目标用户\n2. 核心功能概述\n3. 信息架构（使用 Mermaid 图）\n4. 关键页面与交互流程\n5. 商业模式分析（如可推断）\n6. 竞品差异化分析\n7. 优缺点总结与改进建议\n\n【竞品调研-{产品名}产品功能列表.md 内容结构】\n使用表格形式列出所有功能模块，每行为一个功能，包含以下列：\n| 功能名称 | 功能描述 | 优先级(P0/P1/P2) | 所在页面 | 交互说明 |\n\n【竞品调研-{产品名}产品UI设计分析.md 内容结构】\n1. 设计风格概述\n2. 色彩系统（主色、辅助色、状态色、文字色，附带色值）\n3. 字体与字号规范\n4. 间距与圆角规范\n5. 组件规范（按钮、输入框、卡片、导航等）\n6. 关键页面布局说明\n\n【原型项目要求】\n- 使用 React 18 + TypeScript + Tailwind CSS + Vite 创建工程。\n- 不需要后端服务；所有数据使用本地 mock 数据（放在 src/mocks/ 中），mock 数据应尽可能还原目标网站的真实数据结构和体量。\n- 关键组件/可点击元素必须添加稳定的 data-dh-id 属性。\n- 工程必须包含 `pnpm run dev` 和 `pnpm run build` 脚本。\n- 所有文件创建完成后，在工程目录下执行一次 `pnpm install && pnpm run build`，确保产出 dist/index.html 和 dist/assets/。\n- 1:1 仿真要求：尽可能还原目标产品的布局、配色、字体、间距、组件样式与关键交互，样式与原产品保持一致。\n- 图表使用 ECharts CDN（`https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js`）。\n- 不要生成登录页、注册页或任何认证流程，除非目标网站的核心功能就是认证。\n\n【输出标记】\n- 文档类产物使用 [[FILE:文件完整路径]] 标记。\n- 原型工程使用 [[PROJECT:工程完整路径]] 标记工程根目录（即 prototype/ 目录）。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【用户需求】\n{ARGS}",
	},
	{
		Cmd:          "/prd-analysis",
		Label:        "竞品信息分析",
		Desc:         "输入若干网站链接+提示词，爬取并提取相关信息，生成可预览下载的对照表格",
		Icon:         "Table2",
		AllowTask:    false,
		AllowRepos:   false,
		MaxRepos:     0,
		Enabled:      true,
		Template: `【语言要求】
你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。

你是一位资深市场研究员。请根据【用户需求】中的若干网站链接与一个提示词，逐站爬取并提取提示词相关信息，汇总成对照表格。

【任务独立性与路径约束（最高优先级）】
1. 本指令是独立的新任务，忽略会话历史中残留的上下文、工作目录与任务结论。
2. 本任务唯一合法的输出根目录是 {WORKSPACE_PATH}/pm-jobs/prd-analysis/。所有文件必须使用以该目录开头的绝对路径。
3. 若历史上下文与本条消息冲突，以本条消息为准。

【输入解析】
从【用户需求】中解析两部分：
1. 若干网站链接：所有 http/https 开头的 URL（可能每行一个，或空格/逗号分隔）。
2. 提示词：除链接外的其余文字，描述要提取什么信息。
若没有解析到任何 http/https 链接，说明无法执行并提示用户补充链接。

【执行流程】
1. 在 {WORKSPACE_PATH}/pm-jobs/prd-analysis/ 下创建本次任务目录，目录名用简短英文标识（如 pricing-research）。
2. 对每个网站链接调用 crawler:web_scrape 工具，参数：url=链接, maxDepth=1, includeImages=true, includeAttachments=true, includeScreenshot=true。
3. 抓取结果中的「--- 截图 ---」段包含截图下载 URL，「--- 附件文件 ---」段包含附件下载 URL。用 bash 执行 curl -L -o 下载到本任务目录的 sources/screenshots/ 与 sources/attachments/ 下（截图命名 {网站}-{序号}.png，附件保留原文件名）。若附件 curl 失败（如登录态），只保存附件 markdown 到 sources/attachments/{文件名}.md。
4. 针对提示词，从每个网站的抓取内容中提取「提示词提及的信息」（finding，具体、可引用原文关键句）；推断「网站对应的公司」（从页脚/about/logo/域名推断）；记录「信息来源」。

【表格产出】
写一个 JSON 文件 {WORKSPACE_PATH}/pm-jobs/prd-analysis/{标识}/analysis.json，结构：
{"rows":[{"website":"https://a.com","company":"A 公司","finding":"...","sources":[{"type":"page","url":"https://a.com/pricing"},{"type":"screenshot","url":"https://a.com/pricing","path":"sources/screenshots/a-com-1.png"},{"type":"file","url":"https://a.com/x.pdf","path":"sources/attachments/x.pdf","markdown":"sources/attachments/x.pdf.md"}]}]}
说明：
- website 为输入的网站链接；company 为推断的公司名；finding 为针对提示词提取的信息。
- sources 数组记录信息来源：type 为 page（页面链接）/screenshot（截图）/file（附件）；path 为相对本任务目录的路径。
- 每个网站至少一个 page 来源；有截图/附件则加对应来源。
- 若某网站抓取失败，finding 填「抓取失败：<原因>」，sources 仅含 page URL。

【输出标记】
写完 analysis.json 后，在回复末尾输出两个标记，不要输出额外正文：
[[CARD:prd_analysis]]
[[FILE:{WORKSPACE_PATH}/pm-jobs/prd-analysis/{标识}/analysis.json]]
务必使用真实的文件系统绝对路径，不要使用占位符。

【用户需求】
{ARGS}`,
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
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位前端工程师与 UI 设计师。请根据以下需求，生成一个可运行的前端原型工程（基于 Node + Vite）。\n\n【工程输出要求】\n1. 将工程创建在 {WORKSPACE_PATH}/pm-jobs/prototypes/ 目录下，工程目录名使用需求关键词的英文命名（如 {WORKSPACE_PATH}/pm-jobs/prototypes/user-login/）。\n2. 使用 React + TypeScript + Tailwind CSS + Vite。\n3. 不需要后端服务；所有数据使用本地 mock 数据（放在 src/mocks/ 或 public/mock/）。\n4. 关键组件/可点击元素必须添加稳定的 data-dh-id 属性，例如：\n   <button data-dh-id=\\\"submit-btn\\\">提交</button>\n   <div data-dh-id=\\\"user-card\\\">...</div>\n   这对后续产品标注和走查非常重要。\n5. 工程必须包含 `pnpm run dev` 用于本地预览，以及 `pnpm run build` 用于构建生产包。\n6. 所有文件创建完成后，只执行一次 `pnpm install && pnpm run build`，确保产出 `dist/index.html` 和 `dist/assets/`。不要重复执行 install。\n7. 最终产物结构：\n   {WORKSPACE_PATH}/pm-jobs/prototypes/{工程名}/\n   ├── package.json\n   ├── vite.config.ts\n   ├── index.html\n   ├── src/\n   ├── public/mock/\n   └── dist/\n       ├── index.html\n       └── assets/\n\n【输出标记】\n工程创建完成后，在回复末尾仅输出一个工程根目录标记，不要输出 [[FILE:...]] 标记：\n[[PROJECT:{WORKSPACE_PATH}/pm-jobs/prototypes/{工程名}]]\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n同时根据用户输入的需求卡片标题或需求描述，总结一个简短的中文需求名，并用 [[REQ_NAME:需求名]] 标记输出。若已引用需求卡片，尽量与卡片标题保持一致。\n\n【需求描述】\n{ARGS}",
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
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深工程师。请根据需求卡片/描述完成以下任务。\n\n【任务流程】\n1. 首先生成技术文档（包含架构设计、数据模型、接口/组件设计、实现步骤），写入 {WORKSPACE_PATH}/dev-jobs/{工程名}/README.md 或 {WORKSPACE_PATH}/dev-jobs/{工程名}/docs/tech-spec.md。\n2. 如果用户尚未明确指定工程目录（即没有已选择的代码库或未提供工程名），完成技术文档后必须调用 question 工具向用户确认工程选择。调用格式如下：\n   {\n     \"questions\": [\n       {\n         \"header\": \"技术文档已生成\",\n         \"question\": \"请选择或输入一个工程目录名称。若目录不存在，将自动创建新工程。\",\n         \"options\": []\n       }\n     ]\n   }\n3. 收到用户响应后，将响应中的工程名称作为 `{工程名}`，继续编写实现代码并写入 {WORKSPACE_PATH}/dev-jobs/{工程名}/ 目录。\n4. 如果用户选择的代码库已存在，优先在已有代码库目录下修改；如果用户输入了新工程名且目录不存在，则创建新工程并写入代码。\n5. 如果需求卡片中包含产品原型（product prototype），请在技术文档中参考原型进行设计，并在实现时保持与原型一致的页面结构与交互。\n\n【代码输出要求】\n1. 将代码写入 {WORKSPACE_PATH}/dev-jobs/{工程名}/ 目录下。\n2. 遵循该工程现有的代码风格和目录结构。\n3. 代码需包含必要的错误处理和注释。\n\n【输出标记】\n- 技术文档用 [[FILE:文件完整路径]] 标记。\n- 创建或修改整个工程用 [[PROJECT:工程完整路径]] 标记。\n- 创建或修改单个文件用 [[FILE:文件完整路径]] 标记。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【需求描述】\n{ARGS}",
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
		Label:        "智能评审",
		Desc:         "审查代码质量与规范",
		Icon:         "CheckCircle",
		AllowTask:    true,
		AllowRepos:   true,
		RequireRepos: true,
		MaxRepos:     2,
		Enabled:      true,
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深代码审查专家。请对以下代码或工程进行 Code Review。\n\n【分支切换】\n如果【关联代码库】中指定了分支，请先在工程目录下执行 git checkout <分支名> 切换到对应分支。\n切换后使用 git rev-parse HEAD 确认当前 commit hash，该 hash 需写入评审报告和结构化输出。\n如果分支切换失败，请终止评审并报告错误原因，不要在错误分支上进行评审。\n\n【审查要求】\n1. 从代码质量、安全性、性能、可维护性四个维度进行审查。\n2. 对每个问题给出严重程度（致命/严重/一般/轻微）和具体修改建议。\n3. 审查结果以 Markdown 格式输出，写入评审报告文件。\n\n【评审报告输出】\n1. 将完整评审报告写入被审查工程目录下的 .review/review-{YYYY-MM-DD-HHmmss}.md 文件。\n   工程目录路径见上方【关联代码库】中的\"路径\"信息，必须使用该路径作为基准目录。\n   报告文件绝对路径 = 工程路径 + /.review/review-{YYYY-MM-DD-HHmmss}.md\n2. 报告格式要求：\n   - 顶部包含工程名、分支、当前 commit hash 信息\n   - 按严重程度分组列出所有问题（致命、严重、一般、轻微）\n   - 每个问题包含：文件路径、行号、问题描述、修改建议\n   - 底部包含评审总结，包含各严重程度的问题数量统计（格式：致命: N，严重: N，一般: N，轻微: N）\n\n【重要：结构化评审数据输出】\n完成评审并写入报告文件后，你必须在回复中输出结构化评审数据。这是必须执行的步骤，不可省略。\n\n输出格式要求（严格遵守）：\n1. 使用 [[REVIEW_REPORT_START]] 作为起始标记\n2. 中间是一个完整的 JSON 对象\n3. 使用 [[REVIEW_REPORT_END]] 作为结束标记\n4. JSON 中必须包含 issues 数组，每个问题对应一条记录\n\n示例（请替换为实际值）：\n[[REVIEW_REPORT_START]]{\"projectPath\":\"/absolute/path/to/project\",\"projectName\":\"项目名\",\"branch\":\"main\",\"commit\":\"abc123\",\"critical\":5,\"high\":3,\"medium\":2,\"low\":1,\"reportPath\":\"/absolute/path/to/.review/review-2026-01-01-120000.md\",\"summary\":\"评审总结，200字以内\",\"issues\":[{\"id\":\"R1\",\"filePath\":\"/absolute/path/to/file.ts\",\"line\":10,\"severity\":\"critical\",\"title\":\"问题标题\",\"description\":\"问题描述\",\"suggestion\":\"修改建议\"},{\"id\":\"R2\",\"filePath\":\"/absolute/path/to/other.ts\",\"line\":20,\"severity\":\"high\",\"title\":\"问题标题\",\"description\":\"问题描述\",\"suggestion\":\"修改建议\"}]}[[REVIEW_REPORT_END]]\n\n严格要求：\n- 必须使用 [[REVIEW_REPORT_START]] 和 [[REVIEW_REPORT_END]] 标记，禁止使用 [[REVIEW_REPORT:{...}]] 或其他任何格式\n- issues 数组必须包含所有发现的问题，每个问题一条记录\n- id 用 R1、R2、R3... 递增编号\n- filePath 必须使用绝对路径（以 / 开头）\n- severity 取 critical/high/medium/low 之一\n- summary 字段必须填写评审总结\n- 所有路径必须使用绝对路径（以 / 开头）\n\n【审查目标】\n{ARGS}",
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
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深测试工程师。请根据以下需求或功能描述，生成结构化的测试用例。\n\n【文件输出要求】\n1. 将测试用例文档写入 {WORKSPACE_PATH}/tester-jobs/test-cases/ 目录下。\n2. 文件命名格式：{功能名称}-test-cases.md。\n3. 每条用例包含：用例编号、标题、前置条件、操作步骤、预期结果、优先级。\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的测试用例文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【功能描述】\n{ARGS}",
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
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深测试开发工程师。请根据以下需求或接口，生成可运行的自动化测试脚本。\n\n【脚本要求】\n1. 脚本写入 {WORKSPACE_PATH}/dev-jobs/ 对应工程的 tests/ 或 e2e/ 目录。\n2. 优先使用 Playwright / Cypress / Jest 等常见工具，并说明运行方式。\n3. 包含关键断言与用例说明。\n\n【输出标记】\n用 [[FILE:文件完整路径]] 或 [[PROJECT:工程完整路径]] 标记输出文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【目标需求/接口】\n{ARGS}",
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
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深 UI 设计师。请根据以下需求，生成一份高保真 UI 设计稿说明与交互规范。\n\n【设计稿内容】\n1. 页面结构与信息架构\n2. 各关键页面的视觉说明（布局、配色、字体、间距、组件使用）\n3. 交互动效与状态变化（默认、悬停、点击、禁用、加载、错误）\n4. 响应式适配要点\n5. 可访问性（Accessibility）注意事项\n\n【文件输出要求】\n1. 将设计稿文档写入 {WORKSPACE_PATH}/uidesigner-jobs/design/ 目录下。\n2. 文件命名格式：{需求关键词}-ui-design.md。\n3. 文档使用 Markdown 格式编写。\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的设计稿文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【需求描述】\n{ARGS}",
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
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深 UI 设计师与设计系统专家。请根据以下需求，生成一套完整的 UI 组件库规范文档。\n\n【文档内容】\n1. 组件库概述与设计原则（色彩、字体、间距、圆角、阴影等）。\n2. 常用组件清单：按钮、输入框、下拉选择、单选/复选、开关、卡片、弹窗、表格、导航、标签页等。\n3. 每个组件包含：用途说明、变体状态（默认、悬停、禁用、错误等）、尺寸规格、使用示例、注意事项。\n4. 组件命名与代码实现建议（基于 React + TypeScript + Tailwind CSS）。\n5. 可访问性（Accessibility）与响应式适配要点。\n\n【文件输出要求】\n1. 将 UI 组件库文档写入 {WORKSPACE_PATH}/uidesigner-jobs/design/ 目录下。\n2. 文件命名格式：{需求关键词}-ui-kit.md。\n3. 文档使用 Markdown 格式编写。\n\n【输出标记】\n在回复末尾用 [[FILE:文件完整路径]] 标记你实际创建的 UI 组件库文件。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【需求描述】\n{ARGS}",
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
1. 将需求拆分文档写入 {WORKSPACE_PATH}/pm-jobs/req-breakdown/ 目录下。
2. 文件命名格式：{需求关键词}-req-breakdown.md，需求关键词从用户需求中提取，使用英文或拼音（例如 login-req-breakdown.md）。
3. 文档使用 Markdown 格式编写，包含主/子需求层级。

【聊天输出要求】
1. 在回复末尾保留以下标记，用于前端渲染卡片：
[[FILE:{WORKSPACE_PATH}/pm-jobs/req-breakdown/{需求关键词}-req-breakdown.md]]
[[FILE:{WORKSPACE_PATH}/pm-jobs/req-breakdown/{需求关键词}-req-breakdown.json]]
[[CARD:req_breakdown]]
2. 结构化 JSON 数据可能很长，请使用 bash 工具写入独立的 JSON 文件，而不是把完整 JSON 塞进聊天回复：
   - 文件路径：{WORKSPACE_PATH}/pm-jobs/req-breakdown/{需求关键词}-req-breakdown.json
   - 使用 heredoc 方式写入，确保 JSON 内容完整、合法、不被截断。
   - JSON 结构：{"title":"...","generatedAt":"...","total":N,"items":[{"id":"R-1","parentId":null,"title":"...","workitemId":"已有需求ID（可选）","description":{"role":"...","scenario":"...","action":"...","value":"...","constraints":"..."},"acceptanceCriteria":{"normal":["..."],"error":["..."],"ui":["..."],"boundary":["..."]},"priority":"P0|P1|P2"}]}
   - 示例命令：
     cat > {WORKSPACE_PATH}/pm-jobs/req-breakdown/{需求关键词}-req-breakdown.json << 'EOF'
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
	{
		Cmd:          "/dev-doc",
		Label:        "工程文档",
		Desc:         "基于工程代码生成完整工程文档（必须选择工程）",
		Icon:         "BookOpen",
		AllowTask:    true,
		AllowRepos:   true,
		RequireRepos: true,
		MaxRepos:     1,
		Enabled:      true,
		Template:     "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深技术文档工程师。请基于用户选择的工程代码，使用 understand-anything 技能（或等价的代码理解能力）全面理解工程结构、模块依赖、接口定义与关键实现，然后生成一份完整的工程文档。\n\n【任务要求】\n1. 必须先通读工程目录结构、README、主要源码与配置文件。\n2. 若具备 understand-anything 技能，请优先调用该技能对工程进行整体理解。\n3. 生成的工程文档应覆盖：\n   - 工程概述与目标\n   - 技术栈与依赖说明\n   - 目录结构说明\n   - 核心模块/组件/服务介绍\n   - 关键接口/API 说明\n   - 数据流与调用关系\n   - 环境配置与运行方式\n   - 部署/发布说明\n   - 常见问题与排障\n4. 文档使用 Markdown 格式编写，条理清晰、示例准确。\n\n【文件输出要求】\n1. 将工程文档写入所选工程根目录下的 docs/ 目录中（如 {WORKSPACE_PATH}/dev-jobs/{工程名}/docs/）。\n2. 主文档命名：{工程名}-dev-doc.md。\n3. 如果内容较多，可分文件输出，并在主文档中给出索引。\n\n【输出标记】\n- 创建的单个文档用 [[FILE:文件完整路径]] 标记。\n- 涉及整个工程的梳理用 [[PROJECT:工程完整路径]] 标记工程根目录。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【用户需求】\n{ARGS}",
	},
	{
		Cmd:        "/arch-design",
		Label:      "技术设计",
		Desc:       "基于工程或需求生成技术设计文档",
		Icon:       "Layers",
		AllowTask:  true,
		AllowRepos: true,
		MaxRepos:   2,
		Enabled:    true,
		Template:   "【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n你是一位资深系统架构师。请根据用户提供的工程或需求，生成一份结构化的技术设计文档。\n\n【工程选择规则（重要）】\n1. 是否基于工程代码库进行设计，仅以\"本次指令是否选择了关联代码库\"为准。\n2. 严禁复用历史会话中出现过的代码库；历史会话中的\"关联代码库\"信息不得作为本次工程的依据。\n3. 若本次已选择关联代码库（可能不止一个），直接进入\"基于工程代码库\"流程。\n4. 若本次未选择关联代码库，直接进入\"基于需求从零设计\"流程，无需询问用户。\n\n【任务要求】\n1. 若目标为工程代码库（本次已选择，可能多个）：\n   - 必须先逐一阅读每个工程的目录结构、README、关键模块与核心实现，全面理解现有架构、技术栈与数据模型。\n   - 若有多个工程，需理清工程间的依赖关系与调用链路。\n   - 在充分理解工程现状的基础上，结合用户需求给出增量或重构的技术设计方案，保持与现有工程风格一致。\n   - 设计方案应明确标注哪些部分是对现有工程的修改、哪些是新增。\n2. 若目标为纯需求（未选择工程）：\n   - 基于需求描述，从零开始设计整体技术方案。\n3. 技术设计文档必须包含以下内容：\n   - 设计目标与背景\n   - 现有工程现状分析（仅基于工程时）\n   - 总体架构图（必须使用 Mermaid 语法绘制）\n   - 模块/服务划分与职责\n   - 数据模型与存储设计\n   - 接口/API 设计（包含请求方法、路径、参数、响应格式）\n   - 关键流程时序图（必须使用 Mermaid 语法绘制）\n   - 技术选型与理由\n   - 非功能性考虑（性能、安全、可扩展性、可维护性）\n   - 实现步骤与里程碑\n   - 风险与回滚策略\n4. 文档使用 Markdown 格式编写，架构图和时序图使用 Mermaid 代码块。\n\n【文件输出要求】\n1. 若目标为单个工程：将文档写入该工程根目录下的 docs/ 目录，命名格式：{工程名}-arch-design.md。\n2. 若目标为多个工程：将文档写入第一个工程根目录下的 docs/ 目录，命名格式：arch-design.md。\n3. 若目标为纯需求：将文档写入 {WORKSPACE_PATH}/dev-jobs/arch-design/ 目录，命名格式：{需求关键词}-arch-design.md。\n\n【输出标记】\n- 单个设计文档用 [[FILE:文件完整路径]] 标记。\n- 若基于工程生成，同时用 [[PROJECT:工程完整路径]] 标记工程根目录。\n务必使用真实的文件系统绝对路径，不要使用占位符。\n\n【用户需求】\n{ARGS}",
	},
}
