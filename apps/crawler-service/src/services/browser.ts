import { Browser, BrowserContext, chromium, Page } from "playwright";
import { config } from "../config.js";
import { Cookie } from "../types.js";
import { extractImageUrls, extractAttachmentUrls } from "./url-extract.js";

let browserPromise: Promise<Browser> | null = null;

/**
 * 伪装用的 User-Agent，去除 HeadlessChrome 标记。
 * Playwright 默认 UA 含 "HeadlessChrome/xxx"，被反爬脚本直接识别。
 */
export const STEALTH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * SPA 页面加载后等待渲染内容出现的最长时间（毫秒）。
 * domcontentloaded 触发时 SPA 内容（React/Vue/Angular 等）通常尚未挂载。
 * 使用 waitForFunction 等待 body.innerText 非空，而非固定 sleep：
 * 渲染快的页面提前继续，慢的页面（如 PingCode 工作台这种 Angular SPA）给足时间。
 * 不能用 networkidle：轮询型站点（在线看板、工作台等）持续有后台请求，networkidle 长期无法满足，
 * 会让抓取阻塞到接近 timeout（实测约 56s），导致前端长时间停留在"正在连接个人助手"。
 */
const SPA_RENDER_WAIT_MS = 8000;

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
 * BFS 循环中，剩余时间不足此阈值时不再开启新页面。
 * 5s 不足以加载并渲染一个 SPA 页面，继续抓只会拿到空内容且可能超时。
 */
const MIN_REMAINING_FOR_NEW_PAGE_MS = 5000;

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
  cleanedHtml: string;
  links: string[];
  screenshot?: string;
  imageUrls: string[];
  attachmentUrls: string[];
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
    pageTimeoutMs?: number;
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
    // 单页超时由调用方通过 pageTimeoutMs 控制（BFS 中取 min(配置值, 剩余总体时间)）。
    const gotoTimeout = opts.pageTimeoutMs ?? config.pageTimeoutMs;
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: gotoTimeout });

    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: 10_000 }).catch(() => {
        // 非致命：继续处理页面已加载内容。
      });
    }

    // 轮询 innerText 直到内容稳定（连续 2 次相同且非空）或超时。
    // 比固定 sleep 更高效（渲染快的页面提前继续），比一次性 waitForFunction 更准确
    // （等待内容不再变化而非仅非空，避免在加载提示出现时就取空内容）。
    const pollIntervalMs = 1000;
    const stableThreshold = 2;
    let prevText = "";
    let stableCount = 0;
    const pollDeadline = Date.now() + SPA_RENDER_WAIT_MS;
    while (Date.now() < pollDeadline) {
      const currentText = await page.evaluate(() => (document.body?.innerText ?? "").trim());
      if (currentText.length > 0 && currentText === prevText) {
        stableCount++;
        if (stableCount >= stableThreshold) break;
      } else {
        stableCount = 0;
      }
      prevText = currentText;
      await page.waitForTimeout(pollIntervalMs);
    }

    const title = await page.title();
    const url = page.url();
    const html = await page.content();
    // 清洗 HTML：移除 script/style/noscript/svg 等噪音元素，保留 body 结构化 HTML。
    // 供 agent 分析页面 UI 布局与组件结构（markdown 提取对 Angular 等 SPA 框架覆盖不足）。
    const cleanedHtml = await page.evaluate(() => {
      const clone = document.body!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, noscript, svg").forEach((el) => el.remove());
      return clone.innerHTML;
    });
    // 优先用 innerText（仅可见文本，更干净）；若太短（<50 字符，可能是折叠导航等 CSS 隐藏了大部分文本），
    // 回退到 textContent（排除 script/style/noscript），获取 DOM 中的全部文本节点。
    const text = await page.evaluate(() => {
      const inner = (document.body?.innerText ?? "").trim();
      if (inner.length >= 50) return inner;
      const clone = document.body!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
      return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    // 一次 evaluate 同时收集 a[href]（链接 + 附件）和 img[src]（图片）原始列表，
    // 避免多次 evaluate 的跨 JS↔Host 桥往返开销。
    // - rawLinks：HTTP(S) 完整链接（用于 BFS 站内跳转跟踪），仍按 opts.includeLinks 过滤。
    // - rawImgSrcs：currentSrc 优先（响应式 srcset 选中的），回退 src；含相对/绝对/data URI，交由 extractImageUrls 处理。
    // - rawAttachmentHrefs：getAttribute("href") 取原始值（可能相对），交由 extractAttachmentUrls 绝对化。
    const { rawLinks, rawImgSrcs, rawAttachmentHrefs } = await page.evaluate(() => {
      const rawLinks = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.startsWith("http://") || href.startsWith("https://"));
      const rawImgSrcs = Array.from(document.querySelectorAll("img[src]"))
        .map((img) => (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src);
      const rawAttachmentHrefs = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "");
      return { rawLinks, rawImgSrcs, rawAttachmentHrefs };
    });
    const links = opts.includeLinks ? [...new Set(rawLinks)] : [];
    const imageUrls = extractImageUrls(rawImgSrcs, url);
    const attachmentUrls = extractAttachmentUrls(rawAttachmentHrefs, url);

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

    return { title, url, markdown, text, html, cleanedHtml, links, screenshot, imageUrls, attachmentUrls };
  } finally {
    await context.close();
  }
}

export function normalizeCookies(cookies: Cookie[], targetUrl: string): Cookie[] {
  const url = new URL(targetUrl);
  return cookies.map((c) => ({
    ...c,
    // name 前后可能有空白（上游解析残留），Playwright addCookies 对 name 中的空白报 Invalid cookie fields。
    name: c.name.trim(),
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

  // 总体 deadline：超时后停止开新页，返回已抓取的部分结果，避免链接过多的站点（如工作台）
  // 串行抓取耗时远超上游超时导致整体失败。deadline 在循环中检查，当前页会用剩余时间作为 goto 超时。
  const crawlDeadline = Date.now() + config.crawlTimeoutMs;

  while (queue.length > 0 && pages.length < MAX_CRAWL_PAGES) {
    // 剩余时间不足时不再开启新页面，确保在总体超时前返回已抓取内容。
    const remaining = crawlDeadline - Date.now();
    if (remaining <= MIN_REMAINING_FOR_NEW_PAGE_MS) {
      console.warn(
        `[crawler] crawl deadline approaching, stopping early: pages=${pages.length} remaining=${remaining}ms`,
      );
      break;
    }
    // 单页超时取配置值与剩余时间的较小值，防止末页的 goto 超时越过总体 deadline。
    const pageTimeout = Math.min(config.pageTimeoutMs, remaining);

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
        pageTimeoutMs: pageTimeout,
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
