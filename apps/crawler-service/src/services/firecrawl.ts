import FirecrawlApp, { CrawlParams, ScrapeParams } from "@mendable/firecrawl-js";
import { config } from "../config.js";
import type { Cookie } from "../types.js";

const client = new FirecrawlApp({
  apiKey: config.firecrawlApiKey || "dummy",
  apiUrl: config.firecrawlUrl,
});

// SPA 页面 JS 渲染等待时间（毫秒）。Firecrawl 在页面加载后等待此时间再提取内容，
// 确保动态渲染的 SPA 内容（React/Vue/Angular）已完成挂载。
const SPA_WAIT_FOR_MS = 5000;

export interface FirecrawlResult {
  markdown: string;
  links: string[];
  title: string;
  pageCount: number;
  source: "firecrawl";
}

/**
 * 将 cookies 转换为 Cookie header 字符串。
 */
function cookiesToHeader(cookies: Cookie[]): string {
  if (!cookies.length) return "";
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * 调用 self-hosted Firecrawl 抓取/爬取目标 URL。
 * 若 Firecrawl 未启动或返回错误，返回 null，由调用方降级到 Playwright。
 *
 * 支持 SPA 应用：通过 waitFor 参数等待 JS 渲染完成后再提取内容。
 * 支持登录态：将 cookies 作为 Cookie header 传递给 Firecrawl。
 */
export async function scrapeWithFirecrawl(
  url: string,
  opts: { maxPages?: number; includeLinks?: boolean; cookies?: Cookie[] },
): Promise<FirecrawlResult | null> {
  try {
    if ((opts.maxPages ?? 1) > 1) {
      return await crawl(url, opts.maxPages ?? 1, opts.cookies ?? []);
    }
    return await scrape(url, opts.cookies ?? []);
  } catch (err) {
    console.warn("[firecrawl] failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function scrape(url: string, cookies: Cookie[]): Promise<FirecrawlResult | null> {
  const params: ScrapeParams = {
    formats: ["markdown", "links"],
    onlyMainContent: true,
    // 等待 JS 渲染完成，支持 SPA 应用内容提取。
    waitFor: SPA_WAIT_FOR_MS,
  };

  // 传递登录态 cookies，使 Firecrawl 能抓取需要认证的页面。
  const cookieHeader = cookiesToHeader(cookies);
  if (cookieHeader) {
    (params as Record<string, unknown>).headers = { Cookie: cookieHeader };
  }

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

async function crawl(url: string, limit: number, cookies: Cookie[]): Promise<FirecrawlResult | null> {
  const scrapeOptions: Record<string, unknown> = {
    formats: ["markdown", "links"],
    onlyMainContent: true,
    waitFor: SPA_WAIT_FOR_MS,
  };

  const cookieHeader = cookiesToHeader(cookies);
  if (cookieHeader) {
    scrapeOptions.headers = { Cookie: cookieHeader };
  }

  const params: CrawlParams = {
    limit,
    scrapeOptions,
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
