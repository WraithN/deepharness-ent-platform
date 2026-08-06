import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";

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

const server = new McpServer({
  name: "crawler-mcp-server",
  version: "0.2.0",
});

async function callScrape(body: Record<string, unknown>) {
  try {
    const resp = await fetch(`${CRAWLER_SERVICE_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return {
        content: [{ type: "text" as const, text: `抓取失败: HTTP ${resp.status} ${text}` }],
        isError: true,
      };
    }

    const data = await resp.json();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `调用 crawler-service 异常: ${message}` }],
      isError: true,
    };
  }
}

server.tool(
  "scrape",
  "抓取单个网页内容，返回 markdown/text/html、标题、链接和可选截图。支持预登录 cookie。",
  {
    url: z.string().url().describe("目标网页 URL"),
    cookies: z.array(cookieSchema).optional().describe("预登录 cookie 列表"),
    waitForSelector: z.string().optional().describe("等待该选择器出现后再抓取"),
    includeLinks: z.boolean().optional().describe("是否返回页面链接"),
    includeScreenshot: z.boolean().optional().describe("是否返回 base64 截图"),
    outputFormat: z.enum(["markdown", "text", "html"]).optional().describe("输出格式，默认 markdown"),
  },
  async (input) => {
    const reqBody = {
      url: input.url,
      cookies: input.cookies ?? [],
      waitForSelector: input.waitForSelector,
      maxPages: 1,
      includeLinks: input.includeLinks ?? true,
      includeScreenshot: input.includeScreenshot ?? false,
      outputFormat: input.outputFormat ?? "markdown",
    };
    return callScrape(reqBody);
  },
);

server.tool(
  "crawl",
  "多页爬取，自动跟踪站内链接并抓取多个相关页面，返回合并后的 markdown 内容和所有链路。支持 Firecrawl 深度爬取。",
  {
    url: z.string().url().describe("起始页 URL"),
    maxPages: z.coerce.number().min(1).max(50).default(5).describe("最多抓取页数，默认 5"),
    cookies: z.array(cookieSchema).optional().describe("预登录 cookie 列表"),
    outputFormat: z.enum(["markdown", "text", "html"]).optional().describe("输出格式，默认 markdown"),
  },
  async (input) => {
    const reqBody = {
      url: input.url,
      cookies: input.cookies ?? [],
      maxPages: input.maxPages,
      includeLinks: true,
      includeScreenshot: false,
      outputFormat: input.outputFormat ?? "markdown",
    };
    return callScrape(reqBody);
  },
);

server.tool(
  "screenshot",
  "截取网页全页截图，返回 base64 PNG 图片和页面基本信息（标题、URL）。",
  {
    url: z.string().url().describe("目标网页 URL"),
    cookies: z.array(cookieSchema).optional().describe("预登录 cookie 列表"),
    waitForSelector: z.string().optional().describe("等待该选择器出现后再截图"),
    fullPage: z.boolean().default(true).describe("是否截取全页，默认 true"),
  },
  async (input) => {
    const reqBody = {
      url: input.url,
      cookies: input.cookies ?? [],
      waitForSelector: input.waitForSelector,
      maxPages: 1,
      includeLinks: false,
      includeScreenshot: true,
      outputFormat: "markdown",
    };
    return callScrape(reqBody);
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
