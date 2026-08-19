import { extractText } from "unpdf";
import mammoth from "mammoth";
import TurndownService from "turndown";
import type { PageResult } from "./browser.js";
import type { Cookie } from "../types.js";
import { withDownloadContext } from "./download-context.js";
import { withTimeout } from "./timeout-utils.js";
import { isPrivateHost } from "./url-extract.js";

// 每页附件数上限，超出截断。过多附件会让串行下载+转换拖垮整体响应。
const MAX_ATTACHMENTS_PER_PAGE = 5;
// 单附件大小上限 10MB，防止巨型 PDF/DOCX 耗尽内存。
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// 单附件下载+转换超时。慢站点/大文件不应拖垮整体抓取。
const ATTACHMENT_SINGLE_TIMEOUT_MS = 30_000;
const ATTACHMENT_TIMEOUT_TEXT = "[转换超时]";
const ATTACHMENT_SKIP_TOO_LARGE_TEXT = "[跳过：附件超 10MB]";
const ATTACHMENT_SKIP_PRIVATE_HOST_TEXT = "[跳过：内网地址]";
// unpdf 默认返回 text: string[]（每页一项）；mergePages:true 合并为单个字符串。
const UNPDF_MERGE_PAGES = true;

export interface AttachmentResult {
  url: string;
  filename: string;
  markdown: string;
}

// 全局共享一个 TurndownService 实例（无状态，可复用）。
const turndown = new TurndownService();

/**
 * 拉取所有页面的附件（PDF/DOCX）并转换为 markdown。
 * 复用一个下载 context（cookie 注入），逐个下载转换。
 * 单个附件失败/超时/超限不阻断，markdown 字段标记失败原因。
 */
export async function fetchAndConvertAttachments(
  pages: PageResult[],
  cookies: Cookie[],
): Promise<AttachmentResult[]> {
  const fallbackBase = pages[0]?.url ?? "https://localhost/";
  return withDownloadContext(cookies, fallbackBase, async (request) => {
    const results: AttachmentResult[] = [];
    for (const page of pages) {
      // 每页只取前 N 个附件，避免附件密集页面拖垮整体。
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
  // SSRF 防护：内网/私网地址在发起任何请求前直接跳过。
  if (isPrivateHost(url)) {
    return { url, filename, markdown: ATTACHMENT_SKIP_PRIVATE_HOST_TEXT };
  }
  try {
    // 下载+转换作为一个整体受 30s 超时约束，慢下载/无 content-length 的大文件同样被兜底。
    const markdown = await withTimeout(
      downloadAndConvert(request, url, filename),
      ATTACHMENT_SINGLE_TIMEOUT_MS,
      ATTACHMENT_TIMEOUT_TEXT,
    );
    return { url, filename, markdown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url, filename, markdown: `[转换失败: ${msg}]` };
  }
}

/** 下载单附件并转换。content-length 超限时在读取 body 前快速拒绝，避免完整下载巨型文件。 */
async function downloadAndConvert(
  request: import("playwright").APIRequestContext,
  url: string,
  filename: string,
): Promise<string> {
  const resp = await request.get(url);
  const contentLength = Number(resp.headers()["content-length"] ?? 0);
  if (contentLength > MAX_ATTACHMENT_BYTES) {
    return ATTACHMENT_SKIP_TOO_LARGE_TEXT;
  }
  const buffer = Buffer.from(await resp.body());
  // content-length 缺失或不准确时，以实际下载字节数二次兜底。
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    return ATTACHMENT_SKIP_TOO_LARGE_TEXT;
  }
  return convertBuffer(buffer, filename);
}

/**
 * 按文件名后缀分派到对应转换器。
 * - PDF：unpdf.extractText(mergePages:true) -> 单字符串
 * - DOCX：mammoth 转 HTML -> turndown 转 markdown
 * - DOC：老二进制格式，mammoth 不支持，返回提示
 */
async function convertBuffer(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    // mergePages:true 让 unpdf 把多页文本合并为单字符串，避免 text 为 string[]。
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: UNPDF_MERGE_PAGES });
    return text || "[PDF 无文本，可能是扫描件]";
  }
  if (lower.endsWith(".docx")) {
    // mammoth 接受 { buffer: Buffer }（Node.js 路径）或 { arrayBuffer: ArrayBuffer }（浏览器路径）。
    // 这里用 { buffer }，类型对齐更直接，避免 buffer.buffer 的 ArrayBufferLike 边界问题。
    const { value: html } = await mammoth.convertToHtml({ buffer });
    return turndown.turndown(html);
  }
  if (lower.endsWith(".doc")) {
    return "[老格式 .doc 不支持，请转 .docx]";
  }
  return `[不支持的附件类型: ${filename}]`;
}

/** 从 URL 提取文件名；解析失败时退化为路径最后一段或原 URL。 */
function extractFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last || u.hostname;
  } catch {
    return url.split("/").pop() || url;
  }
}
