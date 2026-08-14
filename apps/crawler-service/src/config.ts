import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(8091),
  // Fastify 服务器端请求超时，必须 > crawlTimeoutMs，确保 BFS 总体超时能先触发并返回部分结果。
  requestTimeoutMs: z.coerce.number().default(100_000),
  // BFS 多页遍历的总体超时：超时后停止开新页，返回已抓取的部分结果，避免站点链接过多时长时间阻塞。
  crawlTimeoutMs: z.coerce.number().default(90_000),
  // 单页 page.goto 的超时上限；实际取 min(pageTimeoutMs, BFS 剩余时间)，防止末页占满总体超时。
  pageTimeoutMs: z.coerce.number().default(30_000),
  browserHeadless: z.coerce.boolean().default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

function loadConfig() {
  const raw = {
    port: process.env.PORT,
    requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
    crawlTimeoutMs: process.env.CRAWL_TIMEOUT_MS,
    pageTimeoutMs: process.env.PAGE_TIMEOUT_MS,
    browserHeadless: process.env.BROWSER_HEADLESS,
    logLevel: process.env.LOG_LEVEL,
  };
  return configSchema.parse(raw);
}

export const config = loadConfig();
