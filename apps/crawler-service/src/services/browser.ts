import { Browser, BrowserContext, chromium, Page } from "playwright";
import { config } from "../config.js";
import { Cookie } from "../types.js";

let browserPromise: Promise<Browser> | null = null;

/**
 * 伪装用的 User-Agent，去除 HeadlessChrome 标记。
 * Playwright 默认 UA 含 "HeadlessChrome/xxx"，被反爬脚本直接识别。
 */
const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * SPA 页面加载后的固定渲染等待时间（毫秒）。
 * domcontentloaded 触发时 SPA 内容（React/Vue 等）通常尚未挂载，固定等待一段时间以获取渲染后的内容。
 * 不能用 networkidle：轮询型站点（在线看板、工作台等）持续有后台请求，networkidle 长期无法满足，
 * 会让抓取阻塞到接近 timeout（实测约 56s），导致前端长时间停留在"正在连接个人助手"。
 */
const SPA_RENDER_WAIT_MS = 3000;

/**
 * 多页遍历的边界常量：
 * - MIN_CRAWL_DEPTH：最小抓取深度（1 层 = 只抓起始页）。
 * - MAX_CRAWL_DEPTH：允许的最大深度上限，防止误配导致抓取爆炸。
 * - MAX_CRAWL_PAGES：单次抓取的最大页面数上限，防止 BFS 页面数爆炸。
 */
const MIN_CRAWL_DEPTH = 1;
const MAX_CRAWL_DEPTH = 10;
const MAX_CRAWL_PAGES = 30;

/**
 * 反检测 init script：在每个页面加载前注入，覆盖 navigator 指纹。
 * - navigator.webdriver: true -> false（最关键，Apifox 等站点据此跳转登录页）
 * - navigator.plugins: [] -> 3 个模拟插件（真实浏览器有插件）
 * - navigator.languages: ["en-US"] -> ["zh-CN","zh","en-US","en"]
 */
const STEALTH_INIT_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => false });
Object.defineProperty(navigator, 'plugins', {
  get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }],
});
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
window.chrome = { runtime: {} };
`;

/**
 * 获取全局复用的 Browser 实例。
 * 本地开发建议用 browserless/playwright 镜像；若无，首次启动会下载 Chromium。
 * --disable-blink-features=AutomationControlled 移除 navigator.webdriver 标记（配合 init script 双保险）。
 */
export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: config.browserHeadless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
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
 * 登录后返回页面基本信息（标题、URL、文本、markdown、链接等）。
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
  const context = await browser.newContext({
    userAgent: STEALTH_USER_AGENT,
    locale: "zh-CN",
  });

  // 注入反检测脚本，在每个页面的 JS 执行前覆盖 navigator 指纹。
  await context.addInitScript(STEALTH_INIT_SCRIPT);

  try {
    if (cookies.length > 0) {
      // 确保 cookie domain 与目标 URL 匹配；若未指定 domain，自动补全。
      const normalized = normalizeCookies(cookies, targetUrl);
      await context.addCookies(normalized);
    }

    const page = await context.newPage();
    // 使用 domcontentloaded 而非 networkidle：轮询型 SPA 后台请求不断，networkidle 会长时间阻塞。
    // domcontentloaded 后固定等待 SPA_RENDER_WAIT_MS，兼顾加载速度与内容渲染。
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: config.requestTimeoutMs });

    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: 10_000 }).catch(() => {
        // 非致命：继续处理页面已加载内容。
      });
    }

    // 等待动态内容基本稳定（SPA 渲染）。
    await page.waitForTimeout(SPA_RENDER_WAIT_MS);

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

/** 从 URL 提取 hostname；解析失败返回空串。 */
function extractHostname(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

/** 归一化链接：去掉 fragment（#），避免同一页面带锚点被重复抓取。解析失败返回空串。 */
function normalizeLink(href: string): string {
  try {
    const u = new URL(href);
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * 用 Playwright 做 BFS 多页遍历：从起始页出发，跟踪同域站内链接，最多抓取 maxDepth 层。
 * 返回按遍历顺序收集的所有页面结果（含起始页）。
 *
 * 深度语义：起始页为第 1 层；maxDepth=2 表示起始页 + 一层站内链接。
 * 不再依赖 Firecrawl：无论 Firecrawl 是否运行，多页抓取都由 Playwright 独立完成。
 */
export async function crawlPagesWithBrowser(
  startUrl: string,
  cookies: Cookie[],
  maxDepth: number,
  opts: {
    waitForSelector?: string;
    includeScreenshot?: boolean;
  },
): Promise<PageResult[]> {
  const depth = Math.min(Math.max(maxDepth, MIN_CRAWL_DEPTH), MAX_CRAWL_DEPTH);
  const startHost = extractHostname(startUrl);
  const visited = new Set<string>();
  const pages: PageResult[] = [];
  // BFS 队列：level 从 0 开始（起始页为第 1 层，level=0）。
  const queue: Array<{ url: string; level: number }> = [{ url: startUrl, level: 0 }];

  while (queue.length > 0 && pages.length < MAX_CRAWL_PAGES) {
    const item = queue.shift()!;
    const normalized = normalizeLink(item.url);
    if (!normalized || visited.has(normalized)) continue;
    visited.add(normalized);

    let page: PageResult;
    try {
      // 遍历必须开启 includeLinks，否则无法继续向下跟踪链接。
      page = await openPageWithCookies(normalized, cookies, {
        waitForSelector: opts.waitForSelector,
        includeScreenshot: opts.includeScreenshot,
        includeLinks: true,
      });
    } catch (err) {
      console.warn("[crawler] open page failed:", normalized, err instanceof Error ? err.message : String(err));
      continue;
    }
    pages.push(page);

    // 已到达最大深度，不再向下扩展链接。
    if (item.level + 1 >= depth) continue;

    // 只入队同域站内链接，且未访问过，避免爬到外部站点。
    for (const link of page.links) {
      const linkHost = extractHostname(link);
      if (startHost !== "" && linkHost !== startHost) continue;
      const normLink = normalizeLink(link);
      if (!normLink || visited.has(normLink)) continue;
      queue.push({ url: normLink, level: item.level + 1 });
    }
  }

  return pages;
}
