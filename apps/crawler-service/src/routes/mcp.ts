import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { crawlPagesWithBrowser } from "../services/browser.js";
import { mergePageMarkdown, mergePageCleanedHtml } from "../services/merge.js";
import { ocrPageImages } from "../services/image-ocr.js";
import { fetchAndConvertAttachments, type AttachmentResult } from "../services/attachments.js";
import { saveTempFile } from "../services/temp-files.js";
import { isPrivateHost } from "../services/url-extract.js";
import { config } from "../config.js";
import type { Cookie } from "../types.js";

// MCP server 元信息，与 package.json 的 name/version 保持一致，供 client 在 initialize 响应中识别。
const MCP_SERVER_NAME = "crawler-service";
const MCP_SERVER_VERSION = "0.0.1";

// web_scrape 工具标识与输出文本中的分隔标识。
const WEB_SCRAPE_TOOL_NAME = "web_scrape";
const HTML_SECTION_SEPARATOR = "\n\n--- 页面 HTML 结构 ---\n";
// 图片 OCR / 附件 markdown 在最终 text 中追加的段落分隔标识。
const OCR_SECTION_SEPARATOR = "\n\n--- 图片 OCR 文字 ---\n";
const ATTACHMENT_SECTION_SEPARATOR = "\n\n--- 附件内容 ---\n";
// 截图下载 URL 与附件文件下载 URL 在 text 末尾追加的段落分隔标识。
const SCREENSHOT_SECTION_SEPARATOR = "\n\n--- 截图 ---\n";
const ATTACHMENT_FILE_SECTION_SEPARATOR = "\n\n--- 附件文件 ---\n";

// web_scrape 工具的输入 schema。maxDepth 默认 0（单页），与 scrapeRequestSchema 的 min(1) 不同：
// MCP 工具允许 0 表示只抓起始页，crawlPagesWithBrowser 内部会把 0 clamp 到 MIN_CRAWL_DEPTH(1)。
const WEB_SCRAPE_INPUT = {
  url: z.string().url().describe("目标网页 URL（http/https）"),
  maxDepth: z.number().int().min(0).max(10).default(0).describe("同域站内链接跟踪深度，0 表示只抓单页"),
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string().optional(),
        path: z.string().optional(),
      }),
    )
    .optional()
    .describe("可选，登录态 cookie（agent 从对话上下文或用户提供的 cookie 传入）"),
  includeImages: z.boolean().default(false).describe("是否对页面内嵌 <img> 做 OCR 提取文字"),
  includeAttachments: z.boolean().default(false).describe("是否下载页面里的 PDF/WORD 附件并转为 markdown"),
  includeScreenshot: z.boolean().default(false).describe("是否整页截图并返回下载 URL（agent 可 curl 下载保存）"),
};

/** MCP 错误响应中 content 的固定文本前缀，便于 agent 在异常情况下识别失败原因。 */
const SCRAPE_FAIL_TEXT = "抓取失败：无法获取页面内容";
const SCRAPE_ERROR_PREFIX = "抓取异常：";

/**
 * 构建一个新的 McpServer 实例并注册 web_scrape 工具。
 * 无状态模式下每个请求创建独立 server/transport，避免跨请求状态污染。
 */
function buildMcpServer(): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
  server.tool(
    WEB_SCRAPE_TOOL_NAME,
    "抓取指定 URL 的网页内容（Playwright 多页 BFS 遍历），返回 markdown / 清洗后 HTML / 文本。供 agent 在会话中自主调用以获取网页内容进行分析。",
    WEB_SCRAPE_INPUT,
    async (args) => {
      try {
        const cookies: Cookie[] = (args.cookies ?? []).map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? "/",
        }));
        // SSRF 防护：起始 URL 指向内网/私网地址时直接拒绝，避免被诱导抓取内部服务。
        if (isPrivateHost(args.url)) {
          return { content: [{ type: "text" as const, text: "[跳过：内网地址]" }], isError: true };
        }
        const pages = await crawlPagesWithBrowser(args.url, cookies, args.maxDepth, {
          includeScreenshot: args.includeScreenshot,
        });
        if (pages.length === 0) {
          return { content: [{ type: "text" as const, text: SCRAPE_FAIL_TEXT }], isError: true };
        }
        const md = mergePageMarkdown(pages);
        const cleaned = mergePageCleanedHtml(pages);
        let text = md + (cleaned ? `${HTML_SECTION_SEPARATOR}${cleaned}` : "");

        // 仅当显式开启且页面确有图片时才触发 OCR，避免无谓下载/识别开销。
        if (args.includeImages && pages.some((p) => p.imageUrls.length > 0)) {
          const ocrResults = await ocrPageImages(pages, cookies);
          if (ocrResults.length > 0) {
            text += OCR_SECTION_SEPARATOR + formatOcrResults(ocrResults);
          }
        }

        // 仅当显式开启且页面确有附件时才下载转换，避免无谓网络请求。
        if (args.includeAttachments && pages.some((p) => p.attachmentUrls.length > 0)) {
          const attResults = await fetchAndConvertAttachments(pages, cookies);
          if (attResults.length > 0) {
            text += ATTACHMENT_SECTION_SEPARATOR + formatAttachmentResults(attResults);
            // 附件原始文件：crawler 已下载（buffer），存临时文件返回下载 URL 供 agent curl 下载。
            const fileLines = await saveAttachmentFiles(attResults);
            if (fileLines.length > 0) {
              text += ATTACHMENT_FILE_SECTION_SEPARATOR + fileLines.join("\n");
            }
          }
        }

        // 截图：整页 PNG base64 -> 存临时文件，返回下载 URL 供 agent curl 下载。
        if (args.includeScreenshot) {
          const shotLines: string[] = [];
          for (const p of pages) {
            if (!p.screenshot) continue;
            const id = await saveScreenshot(p.screenshot);
            shotLines.push(`${p.url}  ${buildTempFileUrl(id)}`);
          }
          if (shotLines.length > 0) {
            text += SCREENSHOT_SECTION_SEPARATOR + shotLines.join("\n");
          }
        }

        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: `${SCRAPE_ERROR_PREFIX}${msg}` }], isError: true };
      }
    },
  );
  return server;
}

/**
 * 将异常转换为符合 MCP JSON-RPC 规范的错误响应写入 Fastify 原始响应流。
 * 仅在响应头尚未发送时写入，避免与 handleRequest 已部分写入的响应冲突。
 */
function writeJsonRpcError(raw: import("http").ServerResponse, id: unknown, message: string): void {
  if (raw.headersSent) return;
  raw.writeHead(500, { "Content-Type": "application/json" });
  raw.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32603, message },
      id: id ?? null,
    }),
  );
}

export default async function mcpRoutes(app: FastifyInstance) {
  // Streamable HTTP 传输：POST 接收 JSON-RPC 请求，GET 用于 SSE 流（本实现无状态，GET 返回 405）。
  app.post("/mcp", async (req, reply) => {
    // handleRequest 会直接操作 req.raw / reply.raw 并 end 响应，
    // hijack 告知 Fastify 不要在 handler 返回后再次接管 / 序列化响应，避免二次写入导致报错。
    reply.hijack();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildMcpServer();
    try {
      await server.connect(transport);
      // 将 Fastify 已解析的请求体透传给 transport，避免 transport 重复读取流。
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeJsonRpcError(reply.raw, null, `Internal server error: ${msg}`);
    } finally {
      // 无状态模式：响应关闭后释放 transport / server 资源，防止内存泄漏。
      reply.raw.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    }
  });
  app.get("/mcp", async (_req, reply) => {
    reply.code(405).send({ error: "GET not supported, use POST" });
  });
}

/**
 * 将 OCR 结果格式化为纯文本段落：每张图以 `[url]\nocrText` 形式呈现，图片间空行分隔。
 * 纯函数，便于在 mcp handler 中拼接到最终 text。
 */
function formatOcrResults(results: { url: string; ocrText: string }[]): string {
  return results.map((r) => `[${r.url}]\n${r.ocrText}`).join("\n\n");
}

/**
 * 将附件转换结果格式化为 markdown 段落：每个附件以 `## filename (url)` 标题 + 正文呈现，附件间空行分隔。
 * 纯函数，便于在 mcp handler 中拼接到最终 text。
 */
function formatAttachmentResults(results: { url: string; filename: string; markdown: string }[]): string {
  return results.map((r) => `## ${r.filename} (${r.url})\n\n${r.markdown}`).join("\n\n");
}

// 截图 base64 data URL -> 存临时文件，返回 id。
async function saveScreenshot(dataUrl: string): Promise<string> {
  const b64 = dataUrl.split(",")[1] ?? "";
  return saveTempFile(Buffer.from(b64, "base64"), ".png");
}

/**
 * 将附件结果中已下载的原始文件存入临时文件，返回「filename  URL」行列表。
 * 只有成功下载到 buffer 的附件才入库；跳过/失败/超限项无 buffer，直接略过。
 */
async function saveAttachmentFiles(attResults: AttachmentResult[]): Promise<string[]> {
  const lines: string[] = [];
  for (const a of attResults) {
    if (!a.buffer) continue;
    const ext = extnameFromUrl(a.url);
    const id = await saveTempFile(a.buffer, ext);
    lines.push(`${a.filename}  ${buildTempFileUrl(id)}`);
  }
  return lines;
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

// 构造临时文件下载 URL。优先使用 PUBLIC_BASE_URL（生产环境 agent 无法访问 crawler 的 localhost），
// 未配置时回退到 http://localhost:{port}（本地开发）。
function buildTempFileUrl(id: string): string {
  const base = config.publicBaseUrl || `http://localhost:${config.port}`;
  return `${base}/files/${id}`;
}
