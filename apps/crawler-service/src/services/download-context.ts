import type { APIRequestContext } from "playwright";
import { getBrowser, normalizeCookies, STEALTH_USER_AGENT } from "./browser.js";
import type { Cookie } from "../types.js";

// 下载 context 复用页面抓取的 UA 与 cookie 注入逻辑，保证登录态图片/附件可下载。
// cookie 的 domain 缺失时用 fallbackBaseUrl 补全（通常是起始页 URL）。
export async function withDownloadContext<T>(
  cookies: Cookie[],
  fallbackBaseUrl: string,
  fn: (request: APIRequestContext) => Promise<T>,
): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: STEALTH_USER_AGENT });
  try {
    if (cookies.length > 0) {
      await context.addCookies(normalizeCookies(cookies, fallbackBaseUrl));
    }
    return await fn(context.request);
  } finally {
    await context.close();
  }
}
