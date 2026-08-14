import { FastifyInstance } from "fastify";
import { scrapeRequestSchema, ScrapeResponse } from "../types.js";
import { crawlPagesWithBrowser, PageResult } from "../services/browser.js";

/** 多页内容合并时的页分隔符。 */
const PAGE_SEPARATOR = "\n\n---\n\n";

/** 合并多页的同名字段，并在每页前加 URL 标题，便于下游识别内容来源。 */
function mergePageMarkdown(pages: PageResult[]): string {
  return pages
    .map((p) => {
      // markdown 兜底提取可能为空（SPA 无 h1/p/li），此时回退到 innerText。
      const body = p.markdown || p.text;
      return `## ${p.url}\n\n${body}`;
    })
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

function mergePageText(pages: PageResult[]): string {
  return pages
    .map((p) => p.text)
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

function mergePageHtml(pages: PageResult[]): string {
  return pages
    .map((p) => p.html)
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

/** 合并多页的清洗后 HTML，每页前加 URL 注释，便于下游识别内容来源。 */
function mergePageCleanedHtml(pages: PageResult[]): string {
  return pages
    .map((p) => `<!-- ${p.url} -->\n${p.cleanedHtml}`)
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

export default async function scrapeRoutes(app: FastifyInstance) {
  app.post<{
    Body: unknown;
    Reply: ScrapeResponse | { error: string };
  }>("/scrape", async (req, reply) => {
    const parsed = scrapeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      await reply.send({ error: parsed.error.message });
      return;
    }
    const body = parsed.data;

    // 用 Playwright 做 BFS 多页遍历（跟踪同域站内链接，最多 maxDepth 层）。
    // 不再依赖 Firecrawl，保证多页抓取在 Firecrawl 未运行时同样可用。
    const pages = await crawlPagesWithBrowser(body.url, body.cookies, body.maxDepth, {
      waitForSelector: body.waitForSelector,
      includeScreenshot: body.includeScreenshot,
    });

    if (pages.length === 0) {
      reply.status(502);
      await reply.send({ error: "无法抓取页面内容" });
      return;
    }

    const response: ScrapeResponse = {
      url: pages[0].url,
      title: pages[0].title,
      markdown: mergePageMarkdown(pages),
      text: mergePageText(pages),
      html: body.outputFormat === "html" ? mergePageHtml(pages) : undefined,
      cleanedHtml: mergePageCleanedHtml(pages),
      links: body.includeLinks ? dedupe(pages.flatMap((p) => p.links)) : [],
      screenshot: pages[0].screenshot,
      metadata: {
        pageCount: pages.length,
        crawlSource: "playwright",
      },
    };

    await reply.send(response);
  });
}
