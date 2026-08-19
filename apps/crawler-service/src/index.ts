import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import healthRoutes from "./routes/health.js";
import scrapeRoutes from "./routes/scrape.js";
import mcpRoutes from "./routes/mcp.js";
import filesRoutes from "./routes/files.js";
import { cleanupExpiredTempFiles } from "./services/temp-files.js";

// 临时文件 LRU 清理间隔（毫秒）。
const TEMP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const app = Fastify({
  logger: { level: config.logLevel },
  requestTimeout: config.requestTimeoutMs,
});

await app.register(cors, { origin: true });
await app.register(healthRoutes, { prefix: "/" });
await app.register(scrapeRoutes, { prefix: "/" });
await app.register(mcpRoutes, { prefix: "/" });
await app.register(filesRoutes, { prefix: "/" });

// 周期性清理过期临时文件，避免磁盘被陈旧截图/附件占满。
setInterval(() => {
  cleanupExpiredTempFiles(config.tempFileTtlMs).catch(() => {});
}, TEMP_CLEANUP_INTERVAL_MS);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`crawler-service listening on http://localhost:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
