import FirecrawlApp, { CrawlParams, ScrapeParams } from "@mendable/firecrawl-js";
import { config } from "../config.js";

const client = new FirecrawlApp({
  apiKey: config.firecrawlApiKey || "dummy",
  apiUrl: config.firecrawlUrl,
});

export interface FirecrawlResult {
  markdown: string;
  links: string[];
  title: string;
  pageCount: number;
  source: "firecrawl";
}

/**
 * 调用 self-hosted Firecrawl 抓取/爬取目标 URL。
 * 若 Firecrawl 未启动或返回错误，返回 null，由调用方降级到 Playwright。
 */
export async function scrapeWithFirecrawl(
  url: string,
  opts: { maxPages?: number; includeLinks?: boolean },
): Promise<FirecrawlResult | null> {
  try {
    if ((opts.maxPages ?? 1) > 1) {
      return await crawl(url, opts.maxPages ?? 1);
    }
    return await scrape(url);
  } catch (err) {
    console.warn("[firecrawl] failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function scrape(url: string): Promise<FirecrawlResult | null> {
  const params: ScrapeParams = {
    formats: ["markdown", "links"],
    onlyMainContent: true,
  };

  const resp = await client.scrapeUrl(url, params);
  if (!resp.success || !resp.markdown) {
    return null;
  }

  return {
    title: resp.metadata?.title ?? "",
    markdown: resp.markdown,
    links: resp.links ?? [],
    pageCount: 1,
    source: "firecrawl",
  };
}

async function crawl(url: string, limit: number): Promise<FirecrawlResult | null> {
  const params: CrawlParams = {
    limit,
    scrapeOptions: {
      formats: ["markdown", "links"],
      onlyMainContent: true,
    },
  };

  const resp = await client.crawlUrl(url, params);
  if (!resp.success || !resp.data?.length) {
    return null;
  }

  const markdowns: string[] = [];
  const links: string[] = [];
  let title = "";
  for (const page of resp.data) {
    if (page.markdown) markdowns.push(page.markdown);
    if (page.links) links.push(...page.links);
    if (page.metadata?.title && !title) title = page.metadata.title;
  }

  return {
    title,
    markdown: markdowns.join("\n\n---\n\n"),
    links: [...new Set(links)],
    pageCount: resp.data.length,
    source: "firecrawl",
  };
}
