import { FastifyInstance } from "fastify";
import { scrapeRequestSchema, ScrapeResponse } from "../types.js";
import { crawlPagesWithBrowser } from "../services/browser.js";
import { mergePageMarkdown, mergePageText, mergePageHtml, mergePageCleanedHtml, dedupe } from "../services/merge.js";

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
