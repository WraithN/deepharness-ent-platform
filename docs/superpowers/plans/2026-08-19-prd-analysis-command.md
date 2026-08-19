# /prd-analysis 竞品信息分析指令 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/prd-analysis` 指令：输入若干网站链接+提示词，agent 逐站抓取并提取信息，生成可预览、可下载 CSV 的对照表格（含信息来源证据）。

**Architecture:** crawler-service 增加临时文件 serve（`/files/:id`）并让 `web_scrape` 返回截图/附件下载 URL；agent 用 bash curl 下载证据到共享目录，写 `analysis.json` 并输出 `[[CARD:prd_analysis]]` 标记；dh-backend 加指令模板；前端 PrdAnalysisCard 读 JSON 渲染表格 + 导出 CSV。

**Tech Stack:** TypeScript（crawler Fastify、前端 React）、Go（dh-backend）。

**关联设计文档：** `docs/superpowers/specs/2026-08-19-prd-analysis-command-design.md`

## Global Constraints

- 仓库：`deepharness-ent-platform`，当前分支 `main`（本计划在 main 上新建功能分支后实施）。
- crawler-service：Node >=20，Fastify ^4.28.1，TS 5.5 strict，验证 `pnpm --filter @repo/crawler-service check-types` + `vitest`。
- dh-backend：Go 1.22，验证 `cd apps/dh-backend && go vet ./... && go build ./...`。
- dh-frontend：React 18 + TS strict，验证 `pnpm --filter @repo/dh-frontend check-types`（`npx tsc --noEmit -p tsconfig.check.json`）。前端无测试运行器，用类型检查 + 手动验证。
- 代码风格：中文注释、规则4 嵌套≤3 层、规则6 重复逻辑封装、规则7 禁魔法值、规则8 warnings 清零。
- crawler 现有 `lint` 脚本失效，用 `pnpm dlx @biomejs/biome lint <files>` 验证新文件。

## File Structure

- `apps/crawler-service/src/services/temp-files.ts`（新增）：临时文件存储/读取/清理 helper。
- `apps/crawler-service/src/routes/files.ts`（新增）：`GET /files/:id` serve 临时文件。
- `apps/crawler-service/src/config.ts`（修改）：加 `tempDir` + 清理时长。
- `apps/crawler-service/src/index.ts`（修改）：注册 files 路由 + 启动 LRU 清理任务。
- `apps/crawler-service/src/routes/mcp.ts`（修改）：`includeScreenshot` 参数 + 截图/附件存临时文件返回 URL。
- `apps/dh-backend/gateway/handler/command_config_defaults.go`（修改）：加 `/prd-analysis` 指令模板。
- `apps/dh-backend/gateway/handler/intent_rules_defaults.go`（修改）：加意图关键词。
- `apps/dh-backend/gateway/handler/agui_helpers.go`（修改）：加指令状态文案。
- `apps/dh-frontend/src/lib/commands.ts`（修改）：加分类映射。
- `apps/dh-frontend/src/components/chat/PrdAnalysisCard.tsx`（新增）：表格预览 + CSV 下载。
- `apps/dh-frontend/src/components/chat/MessageMarkers.tsx`（修改）：注册 PrdAnalysis 卡片渲染。

---

### Task 1: crawler 临时文件存储 + serve

**Files:**
- Create: `apps/crawler-service/src/services/temp-files.ts`
- Create: `apps/crawler-service/src/services/temp-files.test.ts`
- Create: `apps/crawler-service/src/routes/files.ts`
- Modify: `apps/crawler-service/src/config.ts`
- Modify: `apps/crawler-service/src/index.ts`

**Interfaces:**
- Produces: `saveTempFile(buffer: Buffer, ext: string): Promise<string>`（返回临时文件 id，形如 UUID）；`getTempFilePath(id: string): string | null`（id 非法返回 null）；`cleanupExpiredTempFiles(ttlMs: number): Promise<void>`。`GET /files/:id` 返回文件内容（404 若无）。

- [ ] **Step 1: 写 temp-files 测试**

创建 `apps/crawler-service/src/services/temp-files.test.ts`：

```ts
import { describe, it, expect, afterEach } from "vitest";
import { saveTempFile, getTempFilePath, cleanupExpiredTempFiles } from "./temp-files.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DIR = path.join(os.tmpdir(), "crawler-files-test");
const TTL_MS = 1000;

describe("temp-files", () => {
  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("saveTempFile 写文件并返回 id，getTempFilePath 可读回", async () => {
    const id = await saveTempFile(Buffer.from("hello"), ".txt");
    expect(id).toBeTruthy();
    const p = getTempFilePath(id);
    expect(p).not.toBeNull();
    expect(fs.readFileSync(p!, "utf8")).toBe("hello");
  });

  it("getTempFilePath 对非法 id 返回 null（防路径穿越）", () => {
    expect(getTempFilePath("../etc/passwd")).toBeNull();
    expect(getTempFilePath("a/b")).toBeNull();
    expect(getTempFilePath("..")).toBeNull();
  });

  it("cleanupExpiredTempFiles 删除过期文件，保留新文件", async () => {
    const id = await saveTempFile(Buffer.from("x"), ".bin");
    await new Promise((r) => setTimeout(r, 1100));
    await cleanupExpiredTempFiles(TTL_MS);
    expect(getTempFilePath(id)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repo/crawler-service test src/services/temp-files.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 temp-files.ts**

创建 `apps/crawler-service/src/services/temp-files.ts`：

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

// 临时文件目录（截图/附件下载后暂存，供 agent curl 下载）。默认系统 tmp 下 crawler-files。
const tempDir = config.tempDir;

// id 只允许 UUID 形态（含扩展名），拒绝含路径分隔符/.. 的输入，防路径穿越。
const SAFE_ID_REGEX = /^[0-9a-f-]{36}(\.[a-z0-9]+)?$/i;

/** 保存 buffer 到临时目录，返回带扩展名的 id（UUID.ext）。 */
export async function saveTempFile(buffer: Buffer, ext: string): Promise<string> {
  await fs.mkdir(tempDir, { recursive: true });
  const id = `${randomUUID()}${ext}`;
  await fs.writeFile(path.join(tempDir, id), buffer);
  return id;
}

/** 返回临时文件的绝对路径；id 非法或文件不存在返回 null。 */
export function getTempFilePath(id: string): string | null {
  if (!SAFE_ID_REGEX.test(id)) return null;
  return path.join(tempDir, id);
}

/** 删除最后修改时间早于 ttlMs 的临时文件（LRU 清理）。 */
export async function cleanupExpiredTempFiles(ttlMs: number): Promise<void> {
  const now = Date.now();
  let entries: string[];
  try {
    entries = await fs.readdir(tempDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = path.join(tempDir, name);
    try {
      const stat = await fs.stat(p);
      if (now - stat.mtimeMs > ttlMs) await fs.unlink(p);
    } catch {
      // 文件可能已被并发清理，忽略。
    }
  }
}
```

- [ ] **Step 4: config.ts 加 tempDir + 清理时长**

`apps/crawler-service/src/config.ts` 的 `configSchema` 加：
```ts
tempDir: z.string().default("/tmp/crawler-files"),
tempFileTtlMs: z.coerce.number().default(30 * 60 * 1000),
```
`loadConfig` 的 raw 加：
```ts
tempDir: process.env.TEMP_DIR,
tempFileTtlMs: process.env.TEMP_FILE_TTL_MS,
```

> 注：测试用 `TEST_DIR` 需覆盖默认 tempDir。temp-files.ts 里 `tempDir` 从 config 读，测试里可在 import 前设置 `process.env.TEMP_DIR` 指向测试目录。adjust test setup accordingly（在测试文件顶部 `process.env.TEMP_DIR = TEST_DIR` 之前 import）。

- [ ] **Step 5: 实现 files.ts 路由**

创建 `apps/crawler-service/src/routes/files.ts`：

```ts
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import { getTempFilePath } from "../services/temp-files.js";

/** GET /files/:id 返回临时文件内容；id 非法或不存在返回 404。 */
export default async function filesRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/files/:id", async (req, reply) => {
    const filePath = getTempFilePath(req.params.id);
    if (!filePath || !fs.existsSync(filePath)) {
      reply.code(404);
      return { error: "not found" };
    }
    // 简单场景直接回 Buffer；扩展名决定 content-type 由 Fastify 推断。
    const buf = fs.readFileSync(filePath);
    reply.type("application/octet-stream");
    return buf;
  });
}
```

- [ ] **Step 6: index.ts 注册路由 + 启动清理任务**

`apps/crawler-service/src/index.ts`：
```ts
import filesRoutes from "./routes/files.js";
import { cleanupExpiredTempFiles } from "./services/temp-files.js";
// 注册：
await app.register(filesRoutes, { prefix: "/" });
// 启动 LRU 清理（每 5 分钟跑一次）：
setInterval(() => {
  cleanupExpiredTempFiles(config.tempFileTtlMs).catch(() => {});
}, 5 * 60 * 1000);
```
（`config` 已从 `./config.js` 导入。）

- [ ] **Step 7: 运行测试 + 类型检查**

Run: `pnpm --filter @repo/crawler-service test src/services/temp-files.test.ts && pnpm --filter @repo/crawler-service check-types`
Expected: 3 测试通过，0 errors

- [ ] **Step 8: 提交**

```bash
git add apps/crawler-service/src/services/temp-files.ts apps/crawler-service/src/services/temp-files.test.ts apps/crawler-service/src/routes/files.ts apps/crawler-service/src/config.ts apps/crawler-service/src/index.ts
git commit -m "feat(crawler): 临时文件存储 + /files/:id serve + LRU 清理"
```

---

### Task 2: web_scrape 加 includeScreenshot + 截图/附件返回 URL

**Files:**
- Modify: `apps/crawler-service/src/routes/mcp.ts`
- Create: `apps/crawler-service/src/services/screenshot-helper.ts`（如需要）

**Interfaces:**
- Consumes: `saveTempFile`（Task 1）、`crawlPagesWithBrowser` 的 `includeScreenshot`（返回 `PageResult.screenshot` = base64 data URL）、`fetchAndConvertAttachments`（现有，Task 3 of 上计划）。
- Produces: `web_scrape` 加 `includeScreenshot` 参数；text 末尾追加「--- 截图 ---」段（截图下载 URL）与「--- 附件文件 ---」段（附件下载 URL + markdown）。

- [ ] **Step 1: 扩展 inputSchema + import**

`apps/crawler-service/src/routes/mcp.ts`：
- `WEB_SCRAPE_INPUT` 加 `includeScreenshot: z.boolean().default(false).describe("是否整页截图并返回下载 URL（agent 可 curl 下载保存）")`。
- 顶部 import `saveTempFile`：`import { saveTempFile } from "../services/temp-files.js";`。
- 加分隔常量：`const SCREENSHOT_SECTION_SEPARATOR = "\n\n--- 截图 ---\n";`、`const ATTACHMENT_FILE_SECTION_SEPARATOR = "\n\n--- 附件文件 ---\n";`。

- [ ] **Step 2: 改造 handler（截图 + 附件存临时文件返回 URL）**

`mcp.ts` 的 tool handler 改：
```ts
async (args) => {
  try {
    const cookies: Cookie[] = (args.cookies ?? []).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/" }));
    const pages = await crawlPagesWithBrowser(args.url, cookies, args.maxDepth, { includeScreenshot: args.includeScreenshot });
    if (pages.length === 0) return { content: [{ type: "text" as const, text: SCRAPE_FAIL_TEXT }], isError: true };

    const md = mergePageMarkdown(pages);
    const cleaned = mergePageCleanedHtml(pages);
    let text = md + (cleaned ? `${HTML_SECTION_SEPARATOR}${cleaned}` : "");

    if (args.includeImages && pages.some((p) => p.imageUrls.length > 0)) {
      const ocrResults = await ocrPageImages(pages, cookies);
      if (ocrResults.length > 0) text += OCR_SECTION_SEPARATOR + formatOcrResults(ocrResults);
    }

    if (args.includeAttachments && pages.some((p) => p.attachmentUrls.length > 0)) {
      const attResults = await fetchAndConvertAttachments(pages, cookies);
      if (attResults.length > 0) {
        text += ATTACHMENT_SECTION_SEPARATOR + formatAttachmentResults(attResults);
        // 附件原始文件：crawler 已下载（buffer），存临时文件返回下载 URL。
        const fileLines = await Promise.all(attResults.map(async (a) => {
          const ext = extnameFromUrl(a.url);
          const id = await saveTempFile(await downloadAttachmentBuffer(a.url, cookies), ext);
          return `${a.filename}  ${buildTempFileUrl(id)}`;
        }));
        text += ATTACHMENT_FILE_SECTION_SEPARATOR + fileLines.join("\n");
      }
    }

    if (args.includeScreenshot) {
      const shotLines: string[] = [];
      for (const p of pages) {
        if (!p.screenshot) continue;
        const id = await saveScreenshot(p.screenshot);
        shotLines.push(`${p.url}  ${buildTempFileUrl(id)}`);
      }
      if (shotLines.length > 0) text += SCREENSHOT_SECTION_SEPARATOR + shotLines.join("\n");
    }

    return { content: [{ type: "text" as const, text }] };
  } catch (e) { /* 不变 */ }
}
```

> 实现者注意：`p.screenshot` 是 base64 data URL（`data:image/png;base64,...`）。`saveScreenshot` 需 decode base64 为 buffer 再 `saveTempFile(buffer, ".png")`。`downloadAttachmentBuffer(url, cookies)` 需复用 download-context 下载原始附件（`withDownloadContext` + `request.get(url).body()`），已下载过一版（fetchAndConvertAttachments 里），为避免重复下载，可让 `fetchAndConvertAttachments` 扩展返回 `buffer`，或单独 helper 重下。**推荐**：扩展 `AttachmentResult` 加可选 `buffer?: Buffer`，fetchAndConvertAttachments 里转换时把原始 buffer 带上，避免二次下载。

- [ ] **Step 3: 实现 saveScreenshot / buildTempFileUrl / extnameFromUrl helper**

在 `mcp.ts` 末尾加（或抽 `services/screenshot-helper.ts`）：
```ts
// 截图 base64 data URL -> 存临时文件，返回 id。
async function saveScreenshot(dataUrl: string): Promise<string> {
  const b64 = dataUrl.split(",")[1] ?? "";
  return saveTempFile(Buffer.from(b64, "base64"), ".png");
}

// 从附件 URL 提取扩展名（.pdf/.docx/.doc），无则 .bin。
function extnameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() ?? "";
    const ext = last.includes(".") ? `.${last.split(".").pop()!.toLowerCase()}` : ".bin";
    return /^\.[a-z0-9]+$/.test(ext) ? ext : ".bin";
  } catch {
    return ".bin";
  }
}

// 构造临时文件下载 URL（host 从 crawler 自身推导，端口 config.port）。
function buildTempFileUrl(id: string): string {
  return `http://localhost:${config.port}/files/${id}`;
}
```
（`config` 从 `../config.js` 导入。）

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @repo/crawler-service check-types`
Expected: 0 errors

- [ ] **Step 5: 启动 + curl 验证 includeScreenshot 返回截图 URL**

```bash
cd apps/crawler-service && PORT=8095 npx tsx src/index.ts > /tmp/opencode/crawler-prd.log 2>&1 &
sleep 5
curl -s -X POST http://localhost:8095/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_scrape","arguments":{"url":"https://example.com","maxDepth":0,"includeScreenshot":true}}}' --max-time 60 | grep -o 'files/[0-9a-f-]*\.png'
pkill -f 'tsx src/index'
```
Expected: 输出含 `files/<uuid>.png`（截图 URL）。

- [ ] **Step 6: 提交**

```bash
git add apps/crawler-service/src/routes/mcp.ts apps/crawler-service/src/services/attachments.ts
git commit -m "feat(crawler): web_scrape 加 includeScreenshot + 截图/附件返回下载 URL"
```

---

### Task 3: dh-backend /prd-analysis 指令模板 + 意图识别 + 文案

**Files:**
- Modify: `apps/dh-backend/gateway/handler/command_config_defaults.go`
- Modify: `apps/dh-backend/gateway/handler/intent_rules_defaults.go`
- Modify: `apps/dh-backend/gateway/handler/agui_helpers.go`

**Interfaces:**
- Consumes: 现有 `CommandConfig` 结构、`embeddedCommands`、`defaultIntentRules`、`commandStateLabels`。
- Produces: `/prd-analysis` 指令（模板含输入解析/抓取/证据保存/JSON 产出说明）。

- [ ] **Step 1: 加指令模板**

`command_config_defaults.go` 的 `embeddedCommands` 数组（`/prd-research` 条目后）加：

```go
{
    Cmd:         "/prd-analysis",
    Label:       "竞品信息分析",
    Desc:        "输入若干网站链接+提示词，爬取并提取相关信息，生成可预览下载的对照表格",
    Icon:        "Table2",
    AllowTask:   false,
    AllowRepos:  false,
    MaxRepos:    0,
    Enabled:     true,
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
```

- [ ] **Step 2: 加意图识别关键词**

`intent_rules_defaults.go` 的 `defaultIntentRules` 加：
```go
{Cmd: "/prd-analysis", Strong: []string{"竞品信息分析", "网站信息对照", "多站信息提取"}, Weak: []string{"信息分析", "对照表格", "多网站"}},
```

- [ ] **Step 3: 加指令状态文案**

`agui_helpers.go` 的 `commandStateLabels`（约 115 行 `/prd-research` 附近）加：
```go
"/prd-analysis": "正在进行竞品信息分析",
```

- [ ] **Step 4: 编译 + vet**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 0 warnings，0 errors

- [ ] **Step 5: 提交**

```bash
git add apps/dh-backend/gateway/handler/command_config_defaults.go apps/dh-backend/gateway/handler/intent_rules_defaults.go apps/dh-backend/gateway/handler/agui_helpers.go
git commit -m "feat(dh-backend): 新增 /prd-analysis 竞品信息分析指令"
```

---

### Task 4: 前端 PrdAnalysisCard + 卡片注册 + CSV 下载

**Files:**
- Modify: `apps/dh-frontend/src/lib/commands.ts`
- Create: `apps/dh-frontend/src/components/chat/PrdAnalysisCard.tsx`
- Modify: `apps/dh-frontend/src/components/chat/MessageMarkers.tsx`

**Interfaces:**
- Consumes: `fileApi.content(path)`（读 analysis.json，返回 `{ content }`）；`parseCardTypes`（markers.ts）；`parseFileMarkers`（拿 analysis.json 路径）。
- Produces: `PrdAnalysisCard` 组件（props 含 json 文件路径），渲染表格 + 「下载 CSV」按钮。

- [ ] **Step 1: commands.ts 加分类**

`apps/dh-frontend/src/lib/commands.ts` 的 `COMMAND_CATEGORIES` 加：
```ts
'/prd-analysis': 'product',
```

- [ ] **Step 2: 实现 PrdAnalysisCard**

创建 `apps/dh-frontend/src/components/chat/PrdAnalysisCard.tsx`：

```tsx
import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileApi } from "@/lib/file-api";

interface SourceItem { type: string; url?: string; path?: string; markdown?: string; }
interface Row { website: string; company: string; finding: string; sources: SourceItem[]; }
interface PrdAnalysisData { rows: Row[]; }

// CSV 字段与表格列对应；来源列多值用 "；" 拼接。
const CSV_HEADERS = ["网站", "公司", "提示词提及的信息", "信息来源"];

function escapeCsvCell(v: string): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sourcesToText(sources: SourceItem[]): string {
  return (sources ?? []).map((s) => {
    if (s.type === "page") return `页面:${s.url ?? ""}`;
    if (s.type === "screenshot") return `截图:${s.path ?? s.url ?? ""}`;
    if (s.type === "file") return `附件:${s.path ?? s.url ?? ""}`;
    return s.url ?? "";
  }).join("；");
}

function buildCsv(rows: Row[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([r.website, r.company, r.finding, sourcesToText(r.sources)].map(escapeCsvCell).join(","));
  }
  return lines.join("\n");
}

export function PrdAnalysisCard({ jsonPath }: { jsonPath: string }) {
  const [data, setData] = useState<PrdAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fileApi.content(jsonPath)
      .then((f) => {
        if (cancelled) return;
        const parsed = JSON.parse(f.content) as PrdAnalysisData;
        setData(parsed);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jsonPath]);

  const downloadCsv = () => {
    if (!data) return;
    const blob = new Blob(["\uFEFF" + buildCsv(data.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prd-analysis.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground p-3"><Loader2 className="h-4 w-4 animate-spin" />加载表格中...</div>;
  if (error) return <div className="text-sm text-destructive p-3">表格加载失败：{error}</div>;
  if (!data || data.rows.length === 0) return null;

  return (
    <div className="border rounded-md overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <span className="text-sm font-medium">竞品信息分析</span>
        <Button size="sm" variant="outline" className="h-7" onClick={downloadCsv}>
          <Download className="h-3.5 w-3.5 mr-1" />下载 CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20 text-left">
              <th className="px-3 py-2 font-medium">网站</th>
              <th className="px-3 py-2 font-medium">公司</th>
              <th className="px-3 py-2 font-medium">提示词提及的信息</th>
              <th className="px-3 py-2 font-medium">信息来源</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-b align-top">
                <td className="px-3 py-2"><a href={r.website} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{r.website}</a></td>
                <td className="px-3 py-2">{r.company}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">{r.finding}</td>
                <td className="px-3 py-2">
                  {r.sources.map((s, j) => (
                    <div key={j} className="text-xs text-muted-foreground">
                      {s.type === "page" && s.url && <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline break-all">{s.url}</a>}
                      {s.type === "screenshot" && <span>截图：{s.path ?? s.url}</span>}
                      {s.type === "file" && <span>附件：{s.path ?? s.url}</span>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 注册卡片渲染（MessageMarkers.tsx）**

`apps/dh-frontend/src/components/chat/MessageMarkers.tsx`：
- import `PrdAnalysisCard`。
- 在现有 MarkerRenderer（参考 ReviewReportMarkerRenderer）后加 `PrdAnalysisMarkerRenderer`：
```tsx
function PrdAnalysisMarkerRenderer({ allText, filePaths }: { allText: string; filePaths: string[] }) {
  const hasPrdAnalysis = parseCardTypes(allText).includes("prd_analysis");
  if (!hasPrdAnalysis) return null;
  const jsonPath = filePaths.find((p) => p.endsWith("analysis.json"));
  if (!jsonPath) return null;
  return <PrdAnalysisCard jsonPath={jsonPath} />;
}
```
- 在 MessageMarkers 主组件里调用（把 `allText` + 已解析的 filePaths 传入）。

> 实现者注意：MessageMarkers 主组件已解析 `filePaths`（fileAttachments / parseAllFilePaths）。确认变量名，把 analysis.json 路径传入 PrdAnalysisMarkerRenderer。参考 ReviewReportMarkerRenderer 如何拿 reportPath。

- [ ] **Step 4: 类型检查**

Run: `cd apps/dh-frontend && npx tsc --noEmit -p tsconfig.check.json 2>&1 | grep -E "PrdAnalysisCard|MessageMarkers|commands" || echo "无相关 error"`
Expected: 无 PrdAnalysisCard/MessageMarkers/commands 相关 error

- [ ] **Step 5: 提交**

```bash
git add apps/dh-frontend/src/lib/commands.ts apps/dh-frontend/src/components/chat/PrdAnalysisCard.tsx apps/dh-frontend/src/components/chat/MessageMarkers.tsx
git commit -m "feat(dh-frontend): PrdAnalysisCard 表格预览 + CSV 下载"
```

---

### Task 5: 集成验证

**Files:** 无（验证任务）

- [ ] **Step 1: 全量构建 + 测试**

```bash
cd /home/nan/deepharness/deepharness-ent-platform
pnpm --filter @repo/crawler-service check-types && pnpm --filter @repo/crawler-service test
cd apps/dh-backend && go vet ./... && go build ./... && cd ../..
cd apps/dh-frontend && npx tsc --noEmit -p tsconfig.check.json && cd ../..
```
Expected: 全部通过（crawler 19 tests + 无 tsc/go errors）。

- [ ] **Step 2: 端到端验证 web_scrape 截图 + 附件 URL**

启动 crawler，curl web_scrape 一个含截图 + 附件的本地页面，确认 text 里含 `--- 截图 ---`（files/xxx.png URL）+ `--- 附件文件 ---`（files/xxx.pdf URL），且 `GET /files/<id>` 能下载。

- [ ] **Step 3: 验证指令配置 + 前端卡片（手动）**

启动 dh-backend + 前端，`GET /v1/commands` 确认含 `/prd-analysis`。触发一次 `/prd-analysis`（若干链接 + 提示词），确认 agent 产出 analysis.json + `[[CARD:prd_analysis]]`，前端展示表格 + 「下载 CSV」可导出。

> 若环境无法完整跑 agent 会话，至少验证：指令配置加载、前端卡片渲染逻辑（构造假 analysis.json 通过 fileApi 读取）、CSV 下载。记录已验证/未验证项。

- [ ] **Step 4: 记录部署注意事项（若有）**

如 crawler 临时文件目录在容器内需挂载卷、截图/附件 URL 的 host 在跨容器场景需用可路由地址（`buildTempFileUrl` 用 `localhost` 仅限同机）—— 记录到 report，跨容器时改用环境变量注入 crawler 对外地址。

- [ ] **Step 5: 全部通过则计划完成**

```bash
git status  # clean
```

---

## Self-Review 备注

- **Spec 覆盖**：临时文件 serve（Task 1）、includeScreenshot+URL（Task 2）、指令模板+意图+文案（Task 3）、前端卡片+CSV（Task 4）、集成验证（Task 5）。设计文档每节均有对应 Task。
- **类型一致性**：`saveTempFile`/`getTempFilePath`/`cleanupExpiredTempFiles`（Task 1）被 mcp.ts（Task 2）与 files.ts（Task 1）一致使用；`AttachmentResult` 加 `buffer?`（Task 2 注）与 `fetchAndConvertAttachments` 返回类型一致；`analysis.json` 结构（Task 3 模板）与 `PrdAnalysisData`（Task 4）字段一致（website/company/finding/sources）。
- **buildTempFileUrl 的 localhost 假设**：Task 2 用 `localhost:${config.port}`，跨容器时需环境变量注入对外地址，已在 Task 5 Step 4 记录，不在本计划内改（YAGNI）。
- **前端无测试运行器**：Task 4 用类型检查 + 手动验证，CSV 生成是纯函数（buildCsv）但未引入测试框架，符合仓库现状（AGENTS.md 前端无测试）。
