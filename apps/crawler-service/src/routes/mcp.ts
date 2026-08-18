import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { crawlPagesWithBrowser } from "../services/browser.js";
import { mergePageMarkdown, mergePageCleanedHtml } from "../services/merge.js";
import type { Cookie } from "../types.js";

// MCP server 元信息，与 package.json 的 name/version 保持一致，供 client 在 initialize 响应中识别。
const MCP_SERVER_NAME = "crawler-service";
const MCP_SERVER_VERSION = "0.0.1";

// web_scrape 工具标识与输出文本中的分隔标识。
const WEB_SCRAPE_TOOL_NAME = "web_scrape";
const HTML_SECTION_SEPARATOR = "\n\n--- 页面 HTML 结构 ---\n";

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
        const pages = await crawlPagesWithBrowser(args.url, cookies, args.maxDepth, {});
        if (pages.length === 0) {
          return { content: [{ type: "text" as const, text: SCRAPE_FAIL_TEXT }], isError: true };
        }
        const md = mergePageMarkdown(pages);
        const cleaned = mergePageCleanedHtml(pages);
        const text = md + (cleaned ? `${HTML_SECTION_SEPARATOR}${cleaned}` : "");
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
