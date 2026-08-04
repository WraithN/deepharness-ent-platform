import { Browser, BrowserContext, chromium, Page } from "playwright";
import { config } from "../config.js";
import { Cookie } from "../types.js";

let browserPromise: Promise<Browser> | null = null;

/**
 * 获取全局复用的 Browser 实例。
 * 本地开发建议用 browserless/playwright 镜像；若无，首次启动会下载 Chromium。
 */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: config.browserHeadless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

export interface PageResult {
  title: string;
  url: string;
  markdown: string;
  text: string;
  html: string;
  links: string[];
  screenshot?: string;
}

/**
 * 用 Playwright 打开页面并注入 cookie。
 * 登录后返回页面基本信息；Firecrawl 负责后续结构化提取。
 */
export async function openPageWithCookies(
  targetUrl: string,
  cookies: Cookie[],
  opts: {
    waitForSelector?: string;
    includeScreenshot?: boolean;
    includeLinks?: boolean;
  },
): Promise<PageResult> {
  const browser = await getBrowser();
  const context = await browser.newContext();

  try {
    if (cookies.length > 0) {
      // 确保 cookie domain 与目标 URL 匹配；若未指定 domain，自动补全。
      const normalized = normalizeCookies(cookies, targetUrl);
      await context.addCookies(normalized);
    }

    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: config.requestTimeoutMs });

    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: 10_000 }).catch(() => {
        // 非致命：继续处理页面已加载内容。
      });
    }

    // 等待动态内容基本稳定。
    await page.waitForTimeout(1500);

    const title = await page.title();
    const url = page.url();
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    const links = opts.includeLinks
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]"))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((href) => href.startsWith("http://") || href.startsWith("https://")),
        )
      : [];

    let screenshot: string | undefined;
    if (opts.includeScreenshot) {
      const buffer = await page.screenshot({ fullPage: true, type: "png" });
      screenshot = `data:image/png;base64,${buffer.toString("base64")}`;
    }

    // 用 page.evaluate 做一次简单的 markdown 兜底（标题 + 段落）。
    const markdown = await page.evaluate(() => {
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
      const paragraphs = Array.from(document.querySelectorAll("p, li, h2, h3, h4"))
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .join("\n\n");
      return h1 ? `# ${h1}\n\n${paragraphs}` : paragraphs;
    });

    return { title, url, markdown, text, html, links: [...new Set(links)], screenshot };
  } finally {
    await context.close();
  }
}

function normalizeCookies(cookies: Cookie[], targetUrl: string): Cookie[] {
  const url = new URL(targetUrl);
  return cookies.map((c) => ({
    ...c,
    domain: c.domain || url.hostname,
    path: c.path || "/",
  }));
}
