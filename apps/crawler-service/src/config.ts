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
  // 临时文件目录：截图/附件下载后暂存，供 agent curl 下载。
  tempDir: z.string().default("/tmp/crawler-files"),
  // 临时文件保留时长（毫秒），超时由 LRU 清理任务删除。
  tempFileTtlMs: z.coerce.number().default(30 * 60 * 1000),
  // 对外可达的基础 URL（如截图/附件下载 URL 的 host）。生产环境 crawler 部署在独立服务器，
  // 需显式配置可被 agent 访问的地址；为空时回退到 http://localhost:{port}（本地开发）。
  publicBaseUrl: z.string().default(""),
});

function loadConfig() {
  const raw = {
    port: process.env.PORT,
    requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
    crawlTimeoutMs: process.env.CRAWL_TIMEOUT_MS,
    pageTimeoutMs: process.env.PAGE_TIMEOUT_MS,
    browserHeadless: process.env.BROWSER_HEADLESS,
    logLevel: process.env.LOG_LEVEL,
    tempDir: process.env.TEMP_DIR,
    tempFileTtlMs: process.env.TEMP_FILE_TTL_MS,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
  };
  return configSchema.parse(raw);
}

export const config = loadConfig();
