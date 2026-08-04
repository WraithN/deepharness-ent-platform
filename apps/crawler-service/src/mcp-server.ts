import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";

/**
 * crawler-service 的 MCP server 入口。
 *
 * 以 stdio 方式被 gatewayd 的 MCP 聚合层 spawn；内部通过 HTTP 调用 crawler-service
 * 自身的 /scrape 端点，避免在每个 gatewayd 容器内重复启动 Playwright/Firecrawl。
 */

const CRAWLER_SERVICE_URL = process.env.CRAWLER_SERVICE_URL || `http://127.0.0.1:${config.port}`;

const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().default("/"),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});

const scrapeInputSchema = z.object({
  url: z.string().url().describe("目标网页 URL"),
  cookies: z.array(cookieSchema).optional().describe("预登录 cookie 列表"),
  waitForSelector: z.string().optional().describe("等待该选择器出现后再抓取"),
  maxPages: z.coerce.number().min(1).max(50).optional().describe("最多抓取页数，大于 1 时启用 Firecrawl 爬取"),
  includeLinks: z.boolean().optional().describe("是否返回页面链接"),
  includeScreenshot: z.boolean().optional().describe("是否返回 base64 截图"),
  outputFormat: z.enum(["markdown", "text", "html"]).optional().describe("输出格式"),
});

const server = new McpServer({
  name: "crawler-mcp-server",
  version: "0.1.0",
});

server.tool(
  "scrape",
  "抓取指定 URL 的网页内容，返回 markdown/text/html、标题、链接和可选截图。支持预登录 cookie 和多页爬取。",
  scrapeInputSchema.shape,
  async (input) => {
    const reqBody = {
      url: input.url,
      cookies: input.cookies ?? [],
      waitForSelector: input.waitForSelector,
      maxPages: input.maxPages ?? 1,
      includeLinks: input.includeLinks ?? true,
      includeScreenshot: input.includeScreenshot ?? false,
      outputFormat: input.outputFormat ?? "markdown",
    };

    try {
      const resp = await fetch(`${CRAWLER_SERVICE_URL}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return {
          content: [{ type: "text", text: `抓取失败: HTTP ${resp.status} ${text}` }],
          isError: true,
        };
      }

      const data = await resp.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `调用 crawler-service 异常: ${message}` }],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server fatal error:", err);
  process.exit(1);
});
