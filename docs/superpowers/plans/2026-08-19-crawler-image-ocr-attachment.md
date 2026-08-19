# crawler-service 追加图片 OCR + 附件转 markdown 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 crawler-service 的 `web_scrape` MCP 工具上追加图片 OCR 与附件转 markdown 两项可选能力，agent 按需开启，提取的文字拼进返回文本。

**Architecture:** `browser.ts` 在抓取时收集 `imageUrls`/`attachmentUrls`（不下载）；新模块 `image-ocr.ts`（tesseract.js OCR）与 `attachments.ts`（unpdf/mammoth+turndown 转换）各自开 Playwright download context（复用 cookie）下载并处理；`mcp.ts` 加 `includeImages`/`includeAttachments` 参数并拼接结果。

**Tech Stack:** TypeScript, Fastify, Playwright, tesseract.js（OCR）, unpdf（PDF）, mammoth（DOCX）, turndown（HTML->md）, vitest。

**关联设计文档：** `docs/superpowers/specs/2026-08-19-crawler-image-ocr-attachment-design.md`

## Global Constraints

- 仓库：`deepharness-ent-platform`，工作目录 `apps/crawler-service/`，包名 `@repo/crawler-service`。
- crawler-service：Node >=20, Fastify ^4.28.1, TypeScript 5.5 strict。
- 代码风格：中文注释、规则4 嵌套≤3 层、规则6 重复逻辑封装、规则7 禁魔法值、规则8 warnings 清零。
- 验证：`pnpm --filter @repo/crawler-service check-types` + `pnpm --filter @repo/crawler-service test`（vitest）。
- 现有 `lint` 脚本（`npx biome`）失效（解析到错误包），用 `pnpm dlx @biomejs/biome lint <files>` 验证新文件。
- vitest 已配置（`package.json` scripts.test = `vitest run`）。
- MCP 协议版本 `2024-11-05`。
- 所有提交在 `main` 分支（当前分支）。

## File Structure

- `apps/crawler-service/src/services/url-extract.ts`（新增）：`extractImageUrls`/`extractAttachmentUrls` 纯函数。
- `apps/crawler-service/src/services/browser.ts`（修改）：`PageResult` 加 `imageUrls`/`attachmentUrls` 字段；`openPageWithCookies` 收集 URL（调纯函数）。
- `apps/crawler-service/src/services/download-context.ts`（新增）：`withDownloadContext` helper（开 Playwright context 注入 cookie，提供 `context.request`）。
- `apps/crawler-service/src/services/image-ocr.ts`（新增）：`ocrPageImages`（tesseract.js OCR）。
- `apps/crawler-service/src/services/attachments.ts`（新增）：`fetchAndConvertAttachments`（下载 + PDF/DOCX 转 markdown）。
- `apps/crawler-service/src/services/merge.test.ts`（修改）：`page()` factory 补 `imageUrls: []`/`attachmentUrls: []`。
- `apps/crawler-service/src/routes/mcp.ts`（修改）：`web_scrape` 加 `includeImages`/`includeAttachments` 参数 + handler 集成 + 格式化函数。
- `apps/crawler-service/package.json`（修改）：加 `tesseract.js`/`unpdf`/`mammoth`/`turndown` 依赖。

---

### Task 1: URL 提取纯函数 + browser.ts PageResult 扩展

**Files:**
- Create: `apps/crawler-service/src/services/url-extract.ts`
- Create: `apps/crawler-service/src/services/url-extract.test.ts`
- Modify: `apps/crawler-service/src/services/browser.ts`
- Modify: `apps/crawler-service/src/services/merge.test.ts`

**Interfaces:**
- Produces: `extractImageUrls(srcs: string[], baseUrl: string): string[]`（过滤 data: URI、绝对化、去重保序）；`extractAttachmentUrls(hrefs: string[], baseUrl: string): string[]`（匹配 .pdf/.docx/.doc 后缀、绝对化、去重保序）；`PageResult` 新增 `imageUrls: string[]` + `attachmentUrls: string[]`。

- [ ] **Step 1: 写 url-extract 测试**

创建 `apps/crawler-service/src/services/url-extract.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { extractImageUrls, extractAttachmentUrls } from "./url-extract.js";

describe("extractImageUrls", () => {
  it("绝对化相对 URL，去重保序，过滤 data: URI", () => {
    const srcs = ["img/a.png", "https://x.test/b.jpg", "img/a.png", "data:image/png;base64,xxx"];
    expect(extractImageUrls(srcs, "https://x.test/page")).toEqual([
      "https://x.test/img/a.png",
      "https://x.test/b.jpg",
    ]);
  });

  it("空数组返回空", () => {
    expect(extractImageUrls([], "https://x.test/")).toEqual([]);
  });

  it("非法 URL 跳过不抛错", () => {
    expect(extractImageUrls(["http://[invalid", "img/a.png"], "https://x.test/")).toEqual([
      "https://x.test/img/a.png",
    ]);
  });
});

describe("extractAttachmentUrls", () => {
  it("匹配 .pdf/.docx/.doc 后缀（大小写不敏感），绝对化去重", () => {
    const hrefs = [
      "https://x.test/a.pdf",
      "/files/b.DOCX",
      "https://y.test/c.doc",
      "https://x.test/d.txt",
      "/files/b.docx",
    ];
    expect(extractAttachmentUrls(hrefs, "https://x.test/page")).toEqual([
      "https://x.test/a.pdf",
      "https://x.test/files/b.DOCX",
      "https://y.test/c.doc",
    ]);
  });

  it("空数组返回空", () => {
    expect(extractAttachmentUrls([], "https://x.test/")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @repo/crawler-service test src/services/url-extract.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 url-extract.ts**

创建 `apps/crawler-service/src/services/url-extract.ts`：

```ts
// 附件后缀白名单（小写匹配）。.doc 老格式 mammoth 不支持，仍收集由 attachments 模块报失败提示。
const ATTACHMENT_EXTENSIONS = [".pdf", ".docx", ".doc"];

// data: 内联图片不下载（base64 已在 cleanedHtml 里）。
function isDataUri(url: string): boolean {
  return url.startsWith("data:");
}

/** 绝对化单个 URL；解析失败返回空串。 */
function absolutize(raw: string, baseUrl: string): string {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

/**
 * 从 <img src> 列表提取有效图片 URL：过滤 data: URI、绝对化、去重保序。
 * 在 browser.ts 的 page.evaluate 返回原始 src 后调用（纯函数，可脱离浏览器测试）。
 */
export function extractImageUrls(srcs: string[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of srcs) {
    if (isDataUri(raw)) continue;
    const abs = absolutize(raw, baseUrl);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      result.push(abs);
    }
  }
  return result;
}

/**
 * 从 <a href> 列表提取附件链接：匹配 .pdf/.docx/.doc 后缀（大小写不敏感）、绝对化、去重保序。
 */
export function extractAttachmentUrls(hrefs: string[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of hrefs) {
    const lower = raw.toLowerCase();
    if (!ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
    const abs = absolutize(raw, baseUrl);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      result.push(abs);
    }
  }
  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @repo/crawler-service test src/services/url-extract.test.ts`
Expected: PASS（5 个测试）

- [ ] **Step 5: browser.ts PageResult 加字段**

`apps/crawler-service/src/services/browser.ts`：
- `PageResult` interface 加两个字段：
```ts
export interface PageResult {
  title: string;
  url: string;
  markdown: string;
  text: string;
  html: string;
  cleanedHtml: string;
  links: string[];
  screenshot?: string;
  imageUrls: string[];
  attachmentUrls: string[];
}
```
- 顶部 import 加：
```ts
import { extractImageUrls, extractAttachmentUrls } from "./url-extract.js";
```
- `openPageWithCookies` 在收集 `links` 的 `page.evaluate` 附近（第 167-173 行），新增收集 img src 和 a href 原始列表：
```ts
const { rawLinks, rawImgSrcs, rawAttachmentHrefs } = await page.evaluate(() => {
  const rawLinks = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter((href) => href.startsWith("http://") || href.startsWith("https://"));
  const rawImgSrcs = Array.from(document.querySelectorAll("img[src]"))
    .map((img) => (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src);
  const rawAttachmentHrefs = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "");
  return { rawLinks, rawImgSrcs, rawAttachmentHrefs };
});
const links = opts.includeLinks ? [...new Set(rawLinks)] : [];
const imageUrls = extractImageUrls(rawImgSrcs, url);
const attachmentUrls = extractAttachmentUrls(rawAttachmentHrefs, url);
```
> 注：`links` 原 page.evaluate 合并到此 evaluate；`currentSrc` 优先（响应式图片 srcset 选中的）回退 `src`；`getAttribute("href")` 取原始值（可能相对），交由 `extractAttachmentUrls` 绝对化。
- return 改为：
```ts
return { title, url, markdown, text, html, cleanedHtml, links, screenshot, imageUrls, attachmentUrls };
```

- [ ] **Step 6: 更新 merge.test.ts 的 page() factory**

`apps/crawler-service/src/services/merge.test.ts` 的 `page()` 加新字段（避免 TS 报缺字段）：
```ts
function page(over: Partial<PageResult> = {}): PageResult {
  return {
    title: "T", url: "https://x.test/a", markdown: "md", text: "txt",
    html: "<h>h</h>", cleanedHtml: "<c>c</c>", links: [],
    imageUrls: [], attachmentUrls: [],
    ...over,
  };
}
```

- [ ] **Step 7: 类型检查 + 测试**

Run: `pnpm --filter @repo/crawler-service check-types && pnpm --filter @repo/crawler-service test`
Expected: 0 errors；全部测试通过（merge 5 + url-extract 5）

- [ ] **Step 8: 提交**

```bash
git add apps/crawler-service/src/services/url-extract.ts apps/crawler-service/src/services/url-extract.test.ts apps/crawler-service/src/services/browser.ts apps/crawler-service/src/services/merge.test.ts
git commit -m "feat(crawler): PageResult 收集 imageUrls/attachmentUrls + 纯函数提取"
```

---

### Task 2: download-context helper + image-ocr 模块

**Files:**
- Create: `apps/crawler-service/src/services/download-context.ts`
- Create: `apps/crawler-service/src/services/image-ocr.ts`
- Create: `apps/crawler-service/src/services/image-ocr.test.ts`
- Modify: `apps/crawler-service/package.json`（加 tesseract.js）

**Interfaces:**
- Consumes: `PageResult.imageUrls`（Task 1）、`getBrowser`/`STEALTH_USER_AGENT`/`normalizeCookies`（browser.ts，需 export）。
- Produces: `ocrPageImages(pages: PageResult[], cookies: Cookie[]): Promise<{ url: string; ocrText: string }[]>`。

- [ ] **Step 1: browser.ts export 复用项**

`apps/crawler-service/src/services/browser.ts`：把 `STEALTH_USER_AGENT` 和 `normalizeCookies` 加 `export`（供 download-context 复用，规则6 避免重复）：
```ts
export const STEALTH_USER_AGENT = "...";
export function normalizeCookies(cookies: Cookie[], targetUrl: string): Cookie[] { ... }
```
（原定义不改，只加 `export` 关键字。）

- [ ] **Step 2: 实现 download-context.ts**

创建 `apps/crawler-service/src/services/download-context.ts`：

```ts
import type { APIRequestContext } from "playwright";
import { getBrowser, normalizeCookies, STEALTH_USER_AGENT } from "./browser.js";
import type { Cookie } from "../types.js";

// 下载 context 复用页面抓取的 UA 与 cookie 注入逻辑，保证登录态图片/附件可下载。
// cookie 的 domain 缺失时用 fallbackBaseUrl 补全（通常是起始页 URL）。
export async function withDownloadContext<T>(
  cookies: Cookie[],
  fallbackBaseUrl: string,
  fn: (request: APIRequestContext) => Promise<T>,
): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: STEALTH_USER_AGENT });
  try {
    if (cookies.length > 0) {
      await context.addCookies(normalizeCookies(cookies, fallbackBaseUrl));
    }
    return await fn(context.request);
  } finally {
    await context.close();
  }
}
```

- [ ] **Step 3: 加 tesseract.js 依赖**

```bash
pnpm --filter @repo/crawler-service add tesseract.js
```

- [ ] **Step 4: 写 image-ocr 测试（mock tesseract + mock download context）**

创建 `apps/crawler-service/src/services/image-ocr.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";

// mock download-context 的 withDownloadContext，避免真实开浏览器。
vi.mock("./download-context.js", () => ({
  withDownloadContext: vi.mock(async (_cookies: unknown, _base: string, fn: (req: unknown) => Promise<unknown>) => {
    // 假 request.get 返回一个极小 PNG buffer（1x1 透明）。
    const fakePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    const request = {
      get: vi.fn(async () => ({ body: async () => fakePng, headers: {} })),
    };
    return fn(request);
  }),
}));

// mock tesseract.js：recognize 返回固定文本。
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({ data: { text: "识别出的文字" } })),
    terminate: vi.fn(async () => {}),
  })),
}));

import { ocrPageImages } from "./image-ocr.js";
import type { PageResult } from "./browser.js";

function pageWithImages(urls: string[]): PageResult {
  return {
    title: "T", url: "https://x.test/p", markdown: "", text: "", html: "",
    cleanedHtml: "", links: [], imageUrls: urls, attachmentUrls: [],
  };
}

describe("ocrPageImages", () => {
  it("对每张图返回 OCR 文字", async () => {
    const out = await ocrPageImages([pageWithImages(["https://x.test/a.png", "https://x.test/b.png"])], []);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://x.test/a.png");
    expect(out[0].ocrText).toBe("识别出的文字");
  });

  it("无图片返回空数组", async () => {
    const out = await ocrPageImages([pageWithImages([])], []);
    expect(out).toEqual([]);
  });

  it("单张失败不阻断，ocrText 标失败", async () => {
    // 用一个会抛错的 mock 场景：重写 request.get 抛错
    const { withDownloadContext } = await import("./download-context.js");
    (withDownloadContext as unknown as { mock: unknown }).mock = vi.fn(async () => {
      throw new Error("boom");
    });
    // 此场景下整体抛错（download context 失败），由调用方 try/catch
    // 这里只验证正常路径的失败标记：单图下载失败应标 [OCR 失败]
    // 恢复 mock
    vi.resetModules();
  });
});
```

> 注：第三个测试较难精确 mock 单图失败。implementer可简化为只测前两个（正常+空），单图失败的 try/catch 逻辑通过代码审查保证，或用一个更精细的 mock（request.get 对特定 url 抛错）。若难测，移除第三个测试，在 report 里说明。

- [ ] **Step 5: 运行测试确认失败**

Run: `pnpm --filter @repo/crawler-service test src/services/image-ocr.test.ts`
Expected: FAIL（`image-ocr.ts` 不存在）

- [ ] **Step 6: 实现 image-ocr.ts**

创建 `apps/crawler-service/src/services/image-ocr.ts`：

```ts
import { createWorker } from "tesseract.js";
import type { PageResult } from "./browser.js";
import type { Cookie } from "../types.js";
import { withDownloadContext } from "./download-context.js";

// OCR 单图超时（含下载+识别）。大图/慢站点不应拖垮整体响应。
const OCR_SINGLE_TIMEOUT_MS = 30_000;
// 单图大小上限 10MB，防止巨型图耗尽内存。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ImageOcrResult {
  url: string;
  ocrText: string;
}

/**
 * 对所有页面的内嵌图片做 OCR。开一个下载 context（复用 cookie），逐张下载识别。
 * 单张失败/超时/超限不阻断，ocrText 标记失败原因。
 */
export async function ocrPageImages(
  pages: PageResult[],
  cookies: Cookie[],
): Promise<ImageOcrResult[]> {
  const allUrls = pages.flatMap((p) => p.imageUrls);
  if (allUrls.length === 0) return [];

  const fallbackBase = pages[0]?.url ?? "https://localhost/";
  const worker = await createWorker("chi_sim+eng");
  try {
    return await withDownloadContext(cookies, fallbackBase, async (request) => {
      const results: ImageOcrResult[] = [];
      for (const url of allUrls) {
        const result = await ocrSingle(request, worker, url);
        results.push(result);
      }
      return results;
    });
  } finally {
    await worker.terminate();
  }
}

async function ocrSingle(
  request: import("playwright").APIRequestContext,
  worker: { recognize: (img: Buffer) => Promise<{ data: { text: string } }> },
  url: string,
): Promise<ImageOcrResult> {
  try {
    const resp = await request.get(url);
    const buffer = Buffer.from(await resp.body());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { url, ocrText: `[OCR 跳过：图片超 ${MAX_IMAGE_BYTES / 1024 / 1024}MB]` };
    }
    const { data } = await withTimeout(
      worker.recognize(buffer),
      OCR_SINGLE_TIMEOUT_MS,
      "[OCR 超时]",
    );
    const text = data.text.trim();
    return { url, ocrText: text || "[OCR 无文字]" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url, ocrText: `[OCR 失败: ${msg}]` };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, timeoutText: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutText)), ms),
    ),
  ]);
}
```

> 注：`createWorker("chi_sim+eng")` 的 API 以安装的 tesseract.js 版本为准（v5 支持 string lang，v4 可能要 `createWorker` + `loadLanguage`）。若 API 不同，按实际版本调整，保持「一个 worker 处理多图，最后 terminate」语义。`withTimeout` 抽为共用 helper（规则6，attachments 也用），或放 `download-context.ts`/独立 utils。本 Task 先放 image-ocr，Task 3 抽出。

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter @repo/crawler-service test src/services/image-ocr.test.ts`
Expected: PASS

- [ ] **Step 8: 类型检查**

Run: `pnpm --filter @repo/crawler-service check-types`
Expected: 0 errors

- [ ] **Step 9: 提交**

```bash
git add apps/crawler-service/src/services/download-context.ts apps/crawler-service/src/services/image-ocr.ts apps/crawler-service/src/services/image-ocr.test.ts apps/crawler-service/src/services/browser.ts apps/crawler-service/package.json pnpm-lock.yaml
git commit -m "feat(crawler): 新增 image-ocr 模块（tesseract.js OCR）+ download-context helper"
```

---

### Task 3: attachments 模块（PDF/DOCX 转 markdown）

**Files:**
- Create: `apps/crawler-service/src/services/attachments.ts`
- Create: `apps/crawler-service/src/services/attachments.test.ts`
- Modify: `apps/crawler-service/package.json`（加 unpdf/mammoth/turndown）
- Modify: `apps/crawler-service/src/services/image-ocr.ts`（抽 `withTimeout` 到共用 utils）

**Interfaces:**
- Consumes: `PageResult.attachmentUrls`（Task 1）、`withDownloadContext`（Task 2）。
- Produces: `fetchAndConvertAttachments(pages: PageResult[], cookies: Cookie[]): Promise<{ url: string; filename: string; markdown: string }[]>`。

- [ ] **Step 1: 加依赖**

```bash
pnpm --filter @repo/crawler-service add unpdf mammoth turndown
```

- [ ] **Step 2: 抽 withTimeout 到共用 utils**

创建 `apps/crawler-service/src/services/timeout-utils.ts`：
```ts
// 通用超时包装：超时抛带 timeoutText 的 Error，供调用方 try/catch 转为失败标记。
export async function withTimeout<T>(p: Promise<T>, ms: number, timeoutText: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutText)), ms),
    ),
  ]);
}
```
`image-ocr.ts` 删除本地 `withTimeout`，改 `import { withTimeout } from "./timeout-utils.js";`。

- [ ] **Step 3: 写 attachments 测试（mock 转换函数）**

创建 `apps/crawler-service/src/services/attachments.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./download-context.js", () => ({
  withDownloadContext: vi.mock(async (_cookies: unknown, _base: string, fn: (req: unknown) => Promise<unknown>) => {
    const fakePdf = Buffer.from("%PDF-1.4 fake");
    const fakeDocx = Buffer.from("PK fake docx");
    const request = {
      get: vi.fn(async (url: string) => {
        if (url.endsWith(".pdf")) return { body: async () => fakePdf, headers: { "content-length": "100" } };
        if (url.endsWith(".docx")) return { body: async () => fakeDocx, headers: { "content-length": "100" } };
        throw new Error("not found");
      }),
    };
    return fn(request);
  }),
}));

vi.mock("unpdf", () => ({
  extractText: vi.fn(async () => ({ text: "PDF 正文内容", pages: ["PDF 正文内容"] })),
}));

vi.mock("mammoth", () => ({
  default: { convertToHtml: vi.fn(async () => ({ value: "<h1>WORD 标题</h1><p>正文</p>" })) },
}));

vi.mock("turndown", () => ({
  default: class FakeTurndown {
    turndown(html: string) { return `# WORD 标题\n\n正文`; }
  },
}));

import { fetchAndConvertAttachments } from "./attachments.js";
import type { PageResult } from "./browser.js";

function pageWithAttachments(urls: string[]): PageResult {
  return {
    title: "T", url: "https://x.test/p", markdown: "", text: "", html: "",
    cleanedHtml: "", links: [], imageUrls: [], attachmentUrls: urls,
  };
}

describe("fetchAndConvertAttachments", () => {
  it("PDF 转 markdown", async () => {
    const out = await fetchAndConvertAttachments([pageWithAttachments(["https://x.test/a.pdf"])], []);
    expect(out).toHaveLength(1);
    expect(out[0].filename).toBe("a.pdf");
    expect(out[0].markdown).toContain("PDF 正文内容");
  });

  it("DOCX 转 markdown", async () => {
    const out = await fetchAndConvertAttachments([pageWithAttachments(["https://x.test/b.docx"])], []);
    expect(out[0].filename).toBe("b.docx");
    expect(out[0].markdown).toContain("WORD 标题");
  });

  it("无附件返回空", async () => {
    const out = await fetchAndConvertAttachments([pageWithAttachments([])], []);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm --filter @repo/crawler-service test src/services/attachments.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 5: 实现 attachments.ts**

创建 `apps/crawler-service/src/services/attachments.ts`：

```ts
import { extractText } from "unpdf";
import mammoth from "mammoth";
import TurndownService from "turndown";
import type { PageResult } from "./browser.js";
import type { Cookie } from "../types.js";
import { withDownloadContext } from "./download-context.js";
import { withTimeout } from "./timeout-utils.js";

// 每页附件数上限，超出截断。
const MAX_ATTACHMENTS_PER_PAGE = 5;
// 单附件大小上限 10MB。
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// 单附件下载+转换超时。
const ATTACHMENT_SINGLE_TIMEOUT_MS = 30_000;
const ATTACHMENT_TIMEOUT_TEXT = "[转换超时]";

export interface AttachmentResult {
  url: string;
  filename: string;
  markdown: string;
}

const turndown = new TurndownService();

export async function fetchAndConvertAttachments(
  pages: PageResult[],
  cookies: Cookie[],
): Promise<AttachmentResult[]> {
  const fallbackBase = pages[0]?.url ?? "https://localhost/";
  return withDownloadContext(cookies, fallbackBase, async (request) => {
    const results: AttachmentResult[] = [];
    for (const page of pages) {
      const urls = page.attachmentUrls.slice(0, MAX_ATTACHMENTS_PER_PAGE);
      for (const url of urls) {
        const result = await fetchSingle(request, url);
        results.push(result);
      }
    }
    return results;
  });
}

async function fetchSingle(
  request: import("playwright").APIRequestContext,
  url: string,
): Promise<AttachmentResult> {
  const filename = extractFilename(url);
  try {
    const resp = await request.get(url);
    const buffer = Buffer.from(await resp.body());
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      return { url, filename, markdown: `[跳过：附件超 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB]` };
    }
    const markdown = await withTimeout(
      convertBuffer(buffer, filename),
      ATTACHMENT_SINGLE_TIMEOUT_MS,
      ATTACHMENT_TIMEOUT_TEXT,
    );
    return { url, filename, markdown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url, filename, markdown: `[转换失败: ${msg}]` };
  }
}

async function convertBuffer(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const { text } = await extractText(new Uint8Array(buffer));
    return text || "[PDF 无文本，可能是扫描件]";
  }
  if (lower.endsWith(".docx")) {
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buffer.buffer });
    return turndown.turndown(html);
  }
  if (lower.endsWith(".doc")) {
    return "[老格式 .doc 不支持，请转 .docx]";
  }
  return `[不支持的附件类型: ${filename}]`;
}

function extractFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last || u.hostname;
  } catch {
    return url.split("/").pop() || url;
  }
}
```

> 注：`unpdf` 的 `extractText` API 以实际版本为准。若返回结构不同（如 `{ text, pages }`），取 `text` 或 `pages.join("\n\n")`。`mammoth.convertToHtml` 接受 `{ arrayBuffer }` 或 `{ buffer }`，以实际版本为准。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @repo/crawler-service test src/services/attachments.test.ts`
Expected: PASS（3 个测试）

- [ ] **Step 7: 全量测试 + 类型检查**

Run: `pnpm --filter @repo/crawler-service check-types && pnpm --filter @repo/crawler-service test`
Expected: 0 errors；全部测试通过

- [ ] **Step 8: 提交**

```bash
git add apps/crawler-service/src/services/attachments.ts apps/crawler-service/src/services/attachments.test.ts apps/crawler-service/src/services/timeout-utils.ts apps/crawler-service/src/services/image-ocr.ts apps/crawler-service/package.json pnpm-lock.yaml
git commit -m "feat(crawler): 新增 attachments 模块（PDF/DOCX 转 markdown）"
```

---

### Task 4: mcp.ts 扩展 web_scrape + 格式化函数

**Files:**
- Modify: `apps/crawler-service/src/routes/mcp.ts`

**Interfaces:**
- Consumes: `ocrPageImages`（Task 2）、`fetchAndConvertAttachments`（Task 3）。
- Produces: `web_scrape` 工具新增 `includeImages`/`includeAttachments` 参数；返回 text 追加 OCR 文字段 + 附件 markdown 段。

- [ ] **Step 1: 扩展 inputSchema**

`apps/crawler-service/src/routes/mcp.ts` 的 `WEB_SCRAPE_INPUT` 加两个参数：
```ts
const WEB_SCRAPE_INPUT = {
  url: z.string().url().describe("目标网页 URL（http/https）"),
  maxDepth: z.number().int().min(0).max(10).default(0).describe("同域站内链接跟踪深度，0 表示只抓单页"),
  cookies: z.array(z.object({
    name: z.string(), value: z.string(),
    domain: z.string().optional(), path: z.string().optional(),
  })).optional().describe("可选，登录态 cookie（agent 从对话上下文或用户提供的 cookie 传入）"),
  includeImages: z.boolean().default(false).describe("是否对页面内嵌 <img> 做 OCR 提取文字"),
  includeAttachments: z.boolean().default(false).describe("是否下载页面里的 PDF/WORD 附件并转为 markdown"),
};
```

- [ ] **Step 2: import 新模块**

`mcp.ts` 顶部加：
```ts
import { ocrPageImages } from "../services/image-ocr.js";
import { fetchAndConvertAttachments } from "../services/attachments.js";
```
加格式化分隔常量：
```ts
const OCR_SECTION_SEPARATOR = "\n\n--- 图片 OCR 文字 ---\n";
const ATTACHMENT_SECTION_SEPARATOR = "\n\n--- 附件内容 ---\n";
```

- [ ] **Step 3: 改 handler 集成 OCR + 附件**

`mcp.ts` 的 tool handler 改为（在现有 md + cleaned 拼接后追加）：
```ts
async (args) => {
  try {
    const cookies: Cookie[] = (args.cookies ?? []).map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path ?? "/",
    }));
    const pages = await crawlPagesWithBrowser(args.url, cookies, args.maxDepth, {});
    if (pages.length === 0) {
      return { content: [{ type: "text" as const, text: SCRAPE_FAIL_TEXT }], isError: true };
    }
    const md = mergePageMarkdown(pages);
    const cleaned = mergePageCleanedHtml(pages);
    let text = md + (cleaned ? `${HTML_SECTION_SEPARATOR}${cleaned}` : "");

    if (args.includeImages && pages.some((p) => p.imageUrls.length > 0)) {
      const ocrResults = await ocrPageImages(pages, cookies);
      if (ocrResults.length > 0) {
        text += OCR_SECTION_SEPARATOR + formatOcrResults(ocrResults);
      }
    }

    if (args.includeAttachments && pages.some((p) => p.attachmentUrls.length > 0)) {
      const attResults = await fetchAndConvertAttachments(pages, cookies);
      if (attResults.length > 0) {
        text += ATTACHMENT_SECTION_SEPARATOR + formatAttachmentResults(attResults);
      }
    }

    return { content: [{ type: "text" as const, text }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text" as const, text: `${SCRAPE_ERROR_PREFIX}${msg}` }], isError: true };
  }
}
```

- [ ] **Step 4: 加格式化纯函数**

`mcp.ts` 末尾加（或抽到 `services/format.ts`，规则6；这里先放 mcp.ts）：
```ts
function formatOcrResults(results: { url: string; ocrText: string }[]): string {
  return results
    .map((r) => `[${r.url}]\n${r.ocrText}`)
    .join("\n\n");
}

function formatAttachmentResults(results: { url: string; filename: string; markdown: string }[]): string {
  return results
    .map((r) => `## ${r.filename} (${r.url})\n\n${r.markdown}`)
    .join("\n\n");
}
```

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter @repo/crawler-service check-types`
Expected: 0 errors

- [ ] **Step 6: 启动 + curl 验证 MCP tools/list 含新参数**

启动 crawler-service（用 tsx 跑源码，端口避让 8091）：
```bash
cd apps/crawler-service && PORT=8094 npx tsx src/index.ts > /tmp/opencode/crawler-ocr.log 2>&1 &
sleep 5
curl -s -X POST http://localhost:8094/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | grep -o 'includeImages\|includeAttachments'
pkill -f 'tsx src/index'
```
Expected: 输出含 `includeImages` 和 `includeAttachments`。

- [ ] **Step 7: 提交**

```bash
git add apps/crawler-service/src/routes/mcp.ts
git commit -m "feat(crawler): web_scrape 加 includeImages/includeAttachments 参数 + 结果拼接"
```

---

### Task 5: 集成验证

**Files:** 无（验证任务）

- [ ] **Step 1: 全量构建 + 测试**

Run: `cd /home/nan/deepharness/deepharness-ent-platform && pnpm --filter @repo/crawler-service check-types && pnpm --filter @repo/crawler-service test`
Expected: 0 errors，全部测试通过（merge 5 + url-extract 5 + image-ocr 2-3 + attachments 3）。

- [ ] **Step 2: 启动 + 端到端验证 OCR + 附件**

```bash
cd apps/crawler-service && PORT=8094 npx tsx src/index.ts > /tmp/opencode/crawler-ocr.log 2>&1 &
sleep 5
# 抓取一个含图片的页面（example.com 无图片，用任意公开页；这里用 example.com 验证参数透传 + 不报错）
curl -s -X POST http://localhost:8094/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_scrape","arguments":{"url":"https://example.com","maxDepth":0,"includeImages":true,"includeAttachments":true}}}' --max-time 60 | head -c 500
pkill -f 'tsx src/index'
```
Expected: 返回 JSON-RPC 响应（SSE 格式），content text 含正文；example.com 无图片/附件，OCR/附件段为空（不报错）。

- [ ] **Step 3: （可选）真实含图片/附件页面验证**

若有可测的含图片+PDF 的公开页面，curl 调用验证 OCR 文字 + 附件 markdown 出现在 text。若环境受限，跳过并在 report 说明。

- [ ] **Step 4: 部署注意事项记录**

确认 `docs/superpowers/specs/2026-08-19-crawler-image-ocr-attachment-design.md` 已涵盖部署注意（tesseract.js 首次下载语言数据 CDN；unpdf/mammoth 纯 JS 无系统依赖）。无需额外 bug doc。

- [ ] **Step 5: 全部通过则计划完成**

```bash
git status   # clean
```

---

## Self-Review 备注

- **Spec 覆盖**：URL 提取（Task 1）、download-context（Task 2）、image-ocr（Task 2）、attachments（Task 3）、mcp 扩展+格式化（Task 4）、集成验证（Task 5）。设计文档每节均有对应 Task。
- **类型一致性**：`PageResult.imageUrls`/`attachmentUrls`（Task 1）在 image-ocr（Task 2）/attachments（Task 3）/mcp（Task 4）一致使用；`ocrPageImages`/`fetchAndConvertAttachments` 返回类型与 mcp 格式化函数入参一致；`withTimeout` 抽到 `timeout-utils.ts`（Task 3）后 image-ocr 改 import。
- **withTimeout 时序**：Task 2 先内联实现，Task 3 抽出到 timeout-utils 并改 image-ocr import。Task 2 的 commit 含内联版，Task 3 的 commit 含抽取。两步迁移，避免 Task 2 依赖未创建的 timeout-utils。
- **mock 精度**：image-ocr 的单图失败测试较难精确 mock，implementer 可简化为正常+空两个测试，失败逻辑靠代码审查 + 集成验证保证，在 report 说明。
