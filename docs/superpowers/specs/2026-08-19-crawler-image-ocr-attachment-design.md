# crawler-service 追加图片 OCR + 附件转 markdown

> 日期：2026-08-19
> 状态：设计已确认，待制定实施计划
> 关联：`docs/superpowers/specs/2026-08-18-crawler-mcp-tool-design.md`（前置：MCP 工具化）

## 1. 背景与目标

### 现状

crawler-service 已改造为 MCP 工具（`web_scrape`），agent 可自主调用抓取网页，返回 markdown +
清洗后 HTML 的纯文本。但缺少：

1. **图片文字提取**：页面内嵌的 `<img>`（产品截图、图表、图片型正文）里的文字无法被 AI
   读到。
2. **附件内容提取**：页面里的 PDF/WORD 附件链接，agent 无法获取其内容。

### 目标

在 `web_scrape` 工具上追加两项可选能力（agent 按需开启）：

1. **图片 OCR**：提取页面内嵌 `<img>`，下载后用 tesseract.js OCR，把识别出的文字拼进返回文本。
2. **附件转 markdown**：下载页面里的 PDF/WORD 附件，转为 markdown，拼进返回文本。

只回传**文字**（OCR 文字 + 附件 markdown），不回传图片/文件本身。

### 非目标

- 不做整页截图 OCR（用户确认：截图适合给 AI 看视觉布局，但本次目标是文字提取，文字型
  页面已有 text/markdown）。
- 不回传图片本身（MCP ImageContent block 不用）。
- 不下载除 PDF/WORD 外的附件类型（如 zip/exe）。
- 不改 `/scrape` HTTP 接口（仅扩展 MCP `web_scrape` 工具）。

## 2. 已确认决策

| 决策点 | 选择 |
|--------|------|
| 图片范围 | 仅内嵌 `<img>` OCR（不做整页截图 OCR） |
| 返回方式 | 只回传 OCR 文字，不回传图片本身 |
| OCR 引擎 | tesseract.js（纯 npm，WASM，chi_sim+eng） |
| PDF/WORD 转换 | 纯 npm：unpdf（PDF）+ mammoth（DOCX->HTML）+ turndown（HTML->markdown） |
| 附件来源 | BFS 所有页面（受 maxDepth 控制）的 `<a href>` 匹配 .pdf/.docx/.doc |
| 附件上限 | 每附件 10MB，每页 5 个，超出跳过 + warn |
| MCP 接口 | 扩展 `web_scrape` 加 `includeImages`/`includeAttachments` 布尔参数，默认 false |

## 3. 架构与数据流

```
agent 调 web_scrape(url, maxDepth, cookies, includeImages?, includeAttachments?)
  └─ crawlPagesWithBrowser（现有）-> PageResult[]
       每页新增 imageUrls[] + attachmentUrls[]（抓取时收集，绝对化+去重，不下载）
       │
       ├─ includeImages=true  -> image-ocr 模块：
       │    开 Playwright context（复用 cookie）-> 逐张下载 -> tesseract.js OCR
       │    -> [{url, ocrText}]
       │
       └─ includeAttachments=true -> attachments 模块（同 context 或新开）：
            提取 .pdf/.docx/.doc 链接 -> 限 10MB/个 5个/页 -> 下载
            PDF: unpdf -> markdown；DOCX: mammoth->html->turndown->markdown
            -> [{url, filename, markdown}]

  最终 text =
    <现有 markdown + cleanedHtml>
    --- 图片 OCR 文字 ---
    [img1 url]
    <ocrText>
    ...
    --- 附件内容 ---
    ## <filename> (<url>)
    <markdown>
    ...

  ToolResult: { content: [{ type: "text", text }] }
```

**关键设计**：

1. **URL 收集与下载分离**：`browser.ts` 的 `openPageWithCookies` 在 context 内收集
   `imageUrls`/`attachmentUrls`（绝对化、去重），不做下载。下载在 `image-ocr.ts`/
   `attachments.ts` 用**新的 Playwright context**（复用 cookies，带登录态）完成。这样
   `crawlPagesWithBrowser` 职责不变重，下载逻辑独立可测。
2. **两参数默认 false**：`includeImages`/`includeAttachments` 默认关闭，agent 按需开启，
   避免不必要的 OCR/下载耗时。向后兼容现有调用。
3. **只回传文字**：OCR 文字 + 附件 markdown 拼进 ToolResult 的 text，不回传图片/文件本身。
4. **单条失败不阻断**：某图片 OCR 失败或某附件下载/转换失败，跳过并记录，不影响整体响应。

## 4. 组件设计

### 4.1 `browser.ts` 扩展（PageResult 增字段）

```ts
export interface PageResult {
  // ... 现有字段（title, url, markdown, text, html, cleanedHtml, links, screenshot）
  imageUrls: string[];       // 页面 <img src> 绝对化去重
  attachmentUrls: string[];  // <a href> 匹配 .pdf/.docx/.doc 后缀，绝对化去重
}
```

`openPageWithCookies` 在收集 `links` 附近，用 `page.evaluate` 提取：

- `<img>` 的 `src`（优先 `currentSrc`，回退 `src`），过滤 data: URI（base64 内联图不下载），
  绝对化（`new URL(src, page.url())`），去重。
- `<a href>` 匹配 `.pdf`/`.docx`/`.doc` 后缀（大小写不敏感），绝对化，去重。

`crawlPagesWithBrowser` 的 BFS 遍历仍只抓 HTML 页面（不下载二进制附件），`imageUrls`/
`attachmentUrls` 仅收集 URL，下载在 handler 层。

### 4.2 `services/image-ocr.ts`（新增）

```ts
export interface ImageOcrResult {
  url: string;
  ocrText: string;
}

export async function ocrPageImages(
  pages: PageResult[],
  cookies: Cookie[],
): Promise<ImageOcrResult[]>;
```

- 开一个 Playwright context（复用 `normalizeCookies` 注入逻辑，抽共用）。
- 遍历所有页面的 `imageUrls`，逐张 `context.request.get(url)` 下载：
  - size check：响应 `content-length` 超 10MB 跳过（图片本身不大，10MB 足够）。
  - 拿 `arrayBuffer`。
- `tesseract.recognize(buffer, { lang: "chi_sim+eng" })` -> `.data.text`：
  - tesseract.js 在 Node 首次运行会下载 chi_sim/eng 语言数据（CDN 默认）；离线环境可配
    `langPath` 指向本地 `tessdata` 目录。
  - worker 初始化有成本，复用同一个 worker 实例处理多张图（`createWorker` 一次，
    `recognize` 多次，最后 `terminate`）。
- 单张失败 try/catch，`ocrText` 置 `"[OCR 失败: <reason>]"`。
- 单张超时 30s（`Promise.race` 或 tesseract 的 timeout 配置）。

### 4.3 `services/attachments.ts`（新增）

```ts
export interface AttachmentResult {
  url: string;
  filename: string;
  markdown: string;
}

export async function fetchAndConvertAttachments(
  pages: PageResult[],
  cookies: Cookie[],
): Promise<AttachmentResult[]>;
```

- 开 Playwright context（与 image-ocr 各自独立开，简单；context 成本可接受，调用 `withDownloadContext` 共用 cookie 注入逻辑）。
- 每页最多 5 个附件（`attachmentUrls` 截断），每个 size check 10MB：
  - 先 HEAD 请求取 `content-length`；无 content-length 则流式下载累计字节，超 10MB 中止。
- 按后缀（小写）分发转换：
  - `.pdf` -> `unpdf`：`extractText(buffer)` 或结构化 API，组装 markdown（标题+段落+列表，
    保留分页 `\n\n---\n`）。
  - `.docx`/`.doc` -> `mammoth.convertToHtml(buffer)` -> `TurndownService().turndown(html)`
    -> markdown。
- 单个失败 try/catch，`markdown` 置 `"[转换失败: <reason>]"`。
- 单个超时 30s（下载+转换合计）。

> 注：`.doc`（老格式）mammoth 不支持，会进失败分支并提示"老格式 .doc 不支持，请转 .docx"。
> YAGNI，不引入 antiword/libreoffice。

### 4.4 `services/download-context.ts`（新增，共用下载 context）

```ts
export async function withDownloadContext<T>(
  cookies: Cookie[],
  fn: (request: PlaywrightRequest) => Promise<T>,
): Promise<T>;
```

- 开 browser context，注入 cookie（复用 `normalizeCookies`），提供 `context.request` 给回调。
- image-ocr 和 attachments 各自调用 `withDownloadContext`（各自独立开 context，简单；context 成本可接受）。
- 抽出来避免两个模块重复 cookie 注入逻辑（规则6）。

### 4.5 `mcp.ts` 扩展 web_scrape

inputSchema 加两个可选布尔参数：

```ts
includeImages: z.boolean().default(false).describe("是否对页面内嵌 <img> 做 OCR 提取文字"),
includeAttachments: z.boolean().default(false).describe("是否下载页面里的 PDF/WORD 附件并转为 markdown"),
```

handler 逻辑：

```ts
const pages = await crawlPagesWithBrowser(args.url, cookies, args.maxDepth, {});
// ... 现有 md + cleaned 拼接
let text = md + (cleaned ? `${HTML_SECTION_SEPARATOR}${cleaned}` : "");

if (args.includeImages && pages.some(p => p.imageUrls.length > 0)) {
  const ocrResults = await ocrPageImages(pages, cookies);
  text += formatOcrResults(ocrResults);
}

if (args.includeAttachments && pages.some(p => p.attachmentUrls.length > 0)) {
  const attResults = await fetchAndConvertAttachments(pages, cookies);
  text += formatAttachmentResults(attResults);
}

return { content: [{ type: "text" as const, text }] };
```

格式化函数（抽到 `mcp.ts` 内或 `services/format.ts`，规则6）：

```
--- 图片 OCR 文字 ---

[<img1 url>]
<ocrText>

[<img2 url>]
<ocrText>

--- 附件内容 ---

## <filename1> (<url1>)
<markdown>

## <filename2> (<url2>)
<markdown>
```

### 4.6 超时与整体耗时

- crawler config `requestTimeoutMs = 100000`（100s）：MCP 请求总超时。
- 单图 OCR 超时 30s，单附件下载+转换超时 30s。
- 附件数量上限（每页 5 个）+ 总页数上限（MAX_CRAWL_PAGES=30）控制总工作量。
- 极端情况（30 页 × 5 附件 = 150 个附件 × 30s）会超总超时，但实际附件远少于此；超时后
  MCP 返回已处理的部分结果（与现有 BFS 超时一致）。

## 5. 依赖新增

`apps/crawler-service/package.json`：

| 依赖 | 用途 | 备注 |
|------|------|------|
| `tesseract.js` | OCR | WASM，首次下载 chi_sim/eng 语言数据 |
| `unpdf` | PDF 文本提取 | 基于 pdfjs |
| `mammoth` | DOCX -> HTML | 纯 JS |
| `turndown` | HTML -> markdown | dh-frontend 已有但 crawler 独立加 |

## 6. 错误处理与上限

| 场景 | 处理 |
|------|------|
| 单图 OCR 失败 | 跳过，ocrText = `[OCR 失败: <reason>]` |
| 单图超 10MB | 跳过，不进结果 |
| 单图 OCR 超时 30s | 跳过，ocrText = `[OCR 超时]` |
| 单附件下载失败 | 跳过，markdown = `[下载失败: <reason>]` |
| 单附件超 10MB | 跳过，不下载 |
| 单附件转换失败 | 跳过，markdown = `[转换失败: <reason>]` |
| 单附件超时 30s | 跳过，markdown = `[转换超时]` |
| 每页附件超 5 个 | 截断，多余的跳过 |
| .doc 老格式 | markdown = `[老格式 .doc 不支持，请转 .docx]` |
| 整体 MCP 超时 | 返回已处理的部分结果 |

所有失败均不阻断整体响应，agent 仍能拿到正文 + 已成功的 OCR/附件文字。

## 7. 测试策略

- `image-ocr.test.ts`：mock tesseract（`vi.mock`），验证调用参数、失败处理、超时。
- `attachments.test.ts`：mock `context.request.get` 返回假 buffer，验证 PDF/DOCX 分发、size 限制、失败处理。
- URL 提取逻辑（绝对化/去重/后缀过滤）：抽纯函数 `extractImageUrls(html, baseUrl)` /
  `extractAttachmentUrls(html, baseUrl)`，单独测试。
- 格式化函数 `formatOcrResults`/`formatAttachmentResults`：纯函数测试。

## 8. 兼容性

- `web_scrape` 新增参数默认 false，现有调用（不传）行为不变。
- `crawlPagesWithBrowser` 的 `PageResult` 增字段，现有 `/scrape` 路由不受影响（不读新字段）。
- crawler-service 现有 `/scrape` 接口不变。
