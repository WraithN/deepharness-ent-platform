# /prd-analysis 竞品信息分析指令

> 日期：2026-08-19
> 状态：设计已确认，待制定实施计划
> 关联：`docs/superpowers/specs/2026-08-18-crawler-mcp-tool-design.md`（crawler MCP 工具化）、
> `docs/superpowers/specs/2026-08-19-crawler-image-ocr-attachment-design.md`（图片 OCR + 附件转 markdown）

## 1. 背景与目标

### 现状

crawler-service 已具备 MCP `web_scrape` 工具（抓取网页正文 + 图片 OCR + 附件转 markdown），
agent 可自主调用。现有 `/prd-research` 指令产出原型/文档，但缺少「批量网站信息对照」场景：
用户给一批网站 + 一个调研提示词，希望系统逐站提取相关信息，汇总成一张可预览、可下载的
对照表格（含信息来源证据）。

### 目标

新增 `/prd-analysis` 指令：

1. 输入：若干网站链接 + 一个提示词（自由格式）。
2. agent 对每个网站调 `web_scrape`（含图片 OCR、附件转换、整页截图）抓取。
3. 提取「提示词提及的信息」+ 推断「网站对应公司」+ 记录「信息来源」（页面链接/截图/附件）。
4. 交付物：一张表格（可预览 + 下载 CSV），每行 = 一个网站，列 = 网站 / 公司 / 提示词提及的信息 / 信息来源。

### 非目标

- 不改 `/prd-research`（产品调研原型）行为。
- 不做前端专用输入表单（自由格式文本输入）。
- 不做 Excel/JSON 下载（仅 CSV）。
- 不自动对比/汇总跨网站结论（仅逐站提取 + 表格汇总，agent 可在 finding 里做简短归纳）。

## 2. 已确认决策

| 决策点 | 选择 |
|--------|------|
| 表格交付机制 | agent 写 `analysis.json` 文件 + `[[CARD:prd_analysis]]` + `[[FILE:...]]` 标记，前端读 JSON 渲染 |
| 输入格式 | 自由格式：若干 http(s) 链接 + 一个提示词（其余文字） |
| 下载格式 | 仅 CSV（来源多值用 `; ` 拼接） |
| 信息来源 | 链接 + 截图 + 附件都保存 |
| 截图保存 | 整页截图 PNG（`includeScreenshot`） |
| 附件保存 | 原始文件 + 转换后 markdown 都保存 |
| 保存链路 | 方案 A：crawler 临时 serve + agent curl 下载到共享目录 |
| 表格列 | 网站 / 公司 / 提示词提及的信息 / 信息来源 |
| 公司信息来源 | agent 从网站内容推断（footer/about/logo/域名） |

## 3. 整体架构与数据流

```
用户输入：/prd-analysis
  https://a.com
  https://b.com
  提示词：提取各家的定价方案
        ↓
dh-backend 拦截指令 → 渲染模板 → agent 收到指令
        ↓
agent 对每个网站调 crawler:web_scrape(includeImages=true, includeAttachments=true, includeScreenshot=true, maxDepth=1)
        ↓
web_scrape 返回：正文 markdown + 图片OCR文字 + 附件markdown + 截图下载URL + 附件下载URL
        ↓
agent 用 bash curl 下载证据到共享目录 {WORKSPACE}/pm-jobs/prd-analysis/{标识}/sources/
  ├── screenshots/{网站}-{序号}.png      （整页截图）
  ├── attachments/{文件名}               （原始 PDF/DOCX）
  └── attachments/{文件名}.md            （转换后 markdown）
        ↓
agent 分析每个网站，提取「提示词提及的信息」+ 公司名 + 来源 → 生成表格数据
        ↓
agent 写 {WORKSPACE}/pm-jobs/prd-analysis/{标识}/analysis.json（表格结构化数据）
  并输出 [[CARD:prd_analysis]] [[FILE:.../analysis.json]] 标记
        ↓
前端 PrdAnalysisCard 读取 analysis.json → 渲染表格（预览）→ 提供 CSV 下载
```

**核心设计**：

1. **证据保存由 agent 完成**：agent 有 bash/文件写入工具（写共享目录），符合架构约束
   （crawler 独立容器不写共享目录）。crawler 只负责截图/下载附件到临时目录并 serve，
   返回下载 URL；agent curl 下载到共享目录。避免 LLM 精确处理大 base64。
2. **web_scrape 返回 URL 而非 base64**：截图/附件以「下载 URL」形式追加到 text 返回，
   agent 的 bash curl 可靠下载。
3. **表格 JSON 结构**：`{ rows: [{ website, company, finding, sources: [...] }] }`。
4. **前端复用 `[[CARD:...]]` 机制**：`parseCardTypes` 识别 `prd_analysis`，读 JSON 渲染卡片。

## 4. 组件设计

### 4.1 crawler-service 临时文件 serve（`routes/files.ts` 新增）

- `GET /files/:id`：静态 serve 临时文件（截图 PNG / 附件 PDF/DOCX）。
- 截图/附件下载后存到 crawler 本地临时目录（配置项 `tempDir`，默认系统 tmp 下
  `crawler-files/`），返回 `{ url: "http://<crawler-host>:<port>/files/<uuid>" }`。
- **LRU 清理**：临时文件按最后访问/创建时间清理（保留 30 分钟，定时任务删除过期文件）。
- **安全**：`/files/:id` 仅 serve 白名单临时目录内文件，id 用随机 UUID（不可枚举），
  路径穿越防护（`path.resolve` 校验在临时目录内）。

### 4.2 web_scrape 扩展（`routes/mcp.ts` + `services/browser.ts`）

**`includeScreenshot` 参数**：
- `WEB_SCRAPE_INPUT` 加 `includeScreenshot: z.boolean().default(false)`。
- handler 调 `crawlPagesWithBrowser(url, cookies, maxDepth, { includeScreenshot: args.includeScreenshot })`。
- 截图 buffer 存 crawler 临时目录，返回下载 URL（而非 base64）。

**附件下载 URL**：
- `includeAttachments` 时，附件 buffer 存临时目录，返回下载 URL；转换后的 markdown 仍内联在 text。

**text 返回结构**（在现有正文 + OCR + 附件 markdown 基础上追加）：
```
<正文 markdown + cleanedHtml>
--- 图片 OCR 文字 ---
...
--- 附件内容 ---
...
--- 截图 ---
截图: https://a.com  http://crawler:8091/files/<uuid-1.png>
--- 附件文件 ---
附件: price-sheet.pdf  http://crawler:8091/files/<uuid-2.pdf>
```

### 4.3 指令模板（`command_config_defaults.go`）

新增 `CommandConfig`：
```go
{
  Cmd: "/prd-analysis", Label: "竞品信息分析",
  Desc: "输入若干网站链接+提示词，爬取并提取相关信息，生成可预览下载的对照表格",
  Icon: "Table2", AllowTask: false, AllowRepos: false, MaxRepos: 0, Enabled: true,
  Template: `...`,
}
```

模板要点（告诉 agent）：
1. **输入解析**：从 `{ARGS}` 解析「若干 http(s) URL」与「提示词」（其余文字）。URL 可能每行一个或空格/逗号分隔。
2. **任务独立性**：输出根目录 `{WORKSPACE_PATH}/pm-jobs/prd-analysis/`，忽略会话历史残留。
3. **逐站抓取**：对每个 URL 调 `crawler:web_scrape`，参数 `includeImages=true, includeAttachments=true, includeScreenshot=true, maxDepth=1`。
4. **证据保存**：截图 URL 用 bash `curl -L -o sources/screenshots/{网站}-{序号}.png <url>` 下载；附件 URL curl 下载到 `sources/attachments/{文件名}`，同时把附件 markdown 写 `sources/attachments/{文件名}.md`（登录态附件若 curl 失败则只写 markdown）。
5. **信息提取**：针对提示词，从每站抓取内容提取「提示词提及的信息」（finding，尽量具体 + 引用原文关键句）；推断「网站对应公司」（footer/about/logo/域名）；记录「信息来源」。
6. **表格产出**：写 `analysis.json`（结构见下），输出 `[[CARD:prd_analysis]] [[FILE:.../analysis.json]]`。

**analysis.json 结构**：
```json
{
  "rows": [
    {
      "website": "https://a.com",
      "company": "A 公司",
      "finding": "定价：Pro 版 $29/月，含 5 席位",
      "sources": [
        { "type": "page", "url": "https://a.com/pricing" },
        { "type": "screenshot", "url": "https://a.com/pricing", "path": "sources/screenshots/a-com-1.png" },
        { "type": "file", "url": "https://a.com/price-sheet.pdf", "path": "sources/attachments/price-sheet.pdf", "markdown": "sources/attachments/price-sheet.pdf.md" }
      ]
    }
  ]
}
```

> source.type：`page`（页面链接）/ `screenshot`（截图）/ `file`（附件）。path 为共享目录内相对路径（相对 prd-analysis/{标识}/）。

### 4.4 前端 PrdAnalysisCard（`components/chat/` 新增）

- `parseCardTypes`（`AssistantMessage.tsx`）识别 `prd_analysis`。
- 解析 `[[FILE:.../analysis.json]]`，通过 dh-backend 文件 serve 接口拉 JSON（复用 ResearchPrototypeCard 的文件读取模式）。
- 渲染表格：网站（可点击链接）/ 公司 / 提示词提及的信息 / 信息来源（页面链接 + 截图缩略图点击放大 + 附件链接）。
- 「下载 CSV」：rows 转 CSV（表头 + 行，来源列用「页面:url; 截图:path; 附件:path」拼接），`Blob` + `a.download`。
- `commands.ts` 加 `'/prd-analysis': 'product'` 分类。

### 4.5 错误处理

| 场景 | 处理 |
|------|------|
| 某网站抓取失败 | 该行 finding 标「抓取失败：<原因>」，sources 仅 URL |
| 截图/附件下载失败 | 来源列标 URL，不阻断 |
| 登录态附件 curl 失败 | 仅保存 markdown，原始文件留空 |
| agent 未生成 JSON | 前端不展示卡片，仅普通文本 |
| 临时文件过期被清理 | 来源列 URL 仍可用（指向原站），本地 path 失效时前端降级显示 URL |

## 5. 涉及文件

| 仓库 | 文件 | 改动 |
|------|------|------|
| deepharness-ent-platform | `apps/crawler-service/src/routes/files.ts` | 新增：临时文件 serve + LRU 清理 |
| | `apps/crawler-service/src/routes/mcp.ts` | 扩展：includeScreenshot + 截图/附件返回 URL |
| | `apps/crawler-service/src/services/browser.ts` | 扩展：截图存临时文件返回 URL（如需要） |
| | `apps/crawler-service/src/config.ts` | 加 tempDir / 清理时长配置 |
| | `apps/dh-backend/gateway/handler/command_config_defaults.go` | 加 /prd-analysis 指令模板 |
| | `apps/dh-backend/gateway/handler/intent_rules_defaults.go` | 加意图识别关键词（可选） |
| | `apps/dh-backend/gateway/handler/agui_helpers.go` | 加指令状态文案（可选） |
| | `apps/dh-frontend/src/lib/commands.ts` | 加分类映射 |
| | `apps/dh-frontend/src/components/chat/PrdAnalysisCard.tsx` | 新增：表格预览 + CSV 下载 |
| | `apps/dh-frontend/src/components/chat/AssistantMessage.tsx` | parseCardTypes 识别 + 渲染卡片 |
| | `apps/dh-frontend/src/lib/...`（卡片解析） | 加 parsePrdAnalysis 逻辑 |

## 6. 兼容性

- `web_scrape` 新增参数默认 false，现有调用不变。
- `/prd-analysis` 是新指令，不影响现有指令。
- crawler `/files/:id` 是新路由，不影响 `/scrape`/`/mcp`。

## 7. 测试策略

- crawler：`files.ts` 临时文件 serve + LRU 清理单测（mock 文件系统）；`mcp.ts` includeScreenshot 返回 URL 测试。
- dh-backend：指令模板渲染（`{ARGS}`/`{WORKSPACE_PATH}`）已有测试模式，加 /prd-analysis 配置存在性测试。
- 前端：PrdAnalysisCard 的 JSON 解析 + CSV 生成纯函数测试（如引入测试框架；否则手动验证 + 类型检查）。
