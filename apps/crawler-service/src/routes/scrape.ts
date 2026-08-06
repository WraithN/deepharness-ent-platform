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

    // 2. Firecrawl 负责结构化提取；传入 cookies 保持登录态，waitFor 支持 SPA 渲染。
    const firecrawlResult = await scrapeWithFirecrawl(pageResult.url, {
      maxPages: body.maxPages,
      includeLinks: body.includeLinks,
      cookies: body.cookies,
    });

    // 智能合并：优先使用内容更丰富的 markdown。
    // SPA 场景下 Firecrawl 可能返回空或极少内容，此时应回退到 Playwright 渲染结果。
    const fcMd = firecrawlResult?.markdown ?? "";
    const pwMd = pageResult.markdown;
    const useFirecrawl = fcMd.length >= pwMd.length * 0.5;

    const response: ScrapeResponse = {
      url: pageResult.url,
      title: firecrawlResult?.title || pageResult.title,
      markdown: useFirecrawl ? fcMd : pwMd,
      text: pageResult.text,
      html: body.outputFormat === "html" ? pageResult.html : undefined,
      links: body.includeLinks ? (firecrawlResult?.links ?? pageResult.links) : [],
      screenshot: pageResult.screenshot,
      metadata: {
        pageCount: firecrawlResult?.pageCount ?? 1,
        crawlSource: useFirecrawl && firecrawlResult ? "firecrawl" : "playwright",
      },
    };

    await reply.send(response);
  });
}
