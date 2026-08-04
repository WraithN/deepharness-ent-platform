import { FastifyInstance } from "fastify";
import { scrapeRequestSchema, ScrapeResponse } from "../types.js";
import { openPageWithCookies } from "../services/browser.js";
import { scrapeWithFirecrawl } from "../services/firecrawl.js";

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

    // 1. Playwright 负责登录态 + 页面渲染兜底。
    const pageResult = await openPageWithCookies(body.url, body.cookies, {
      waitForSelector: body.waitForSelector,
      includeScreenshot: body.includeScreenshot,
      includeLinks: body.includeLinks,
    });

    // 2. Firecrawl 负责结构化提取；失败则使用 Playwright 兜底 markdown。
    const firecrawlResult = await scrapeWithFirecrawl(pageResult.url, {
      maxPages: body.maxPages,
      includeLinks: body.includeLinks,
    });

    const response: ScrapeResponse = {
      url: pageResult.url,
      title: firecrawlResult?.title || pageResult.title,
      markdown: firecrawlResult?.markdown || pageResult.markdown,
      text: pageResult.text,
      html: body.outputFormat === "html" ? pageResult.html : undefined,
      links: body.includeLinks ? (firecrawlResult?.links ?? pageResult.links) : [],
      screenshot: pageResult.screenshot,
      metadata: {
        pageCount: firecrawlResult?.pageCount ?? 1,
        crawlSource: firecrawlResult ? "firecrawl" : "playwright",
      },
    };

    await reply.send(response);
  });
}
