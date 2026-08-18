import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import healthRoutes from "./routes/health.js";
import scrapeRoutes from "./routes/scrape.js";
import mcpRoutes from "./routes/mcp.js";

const app = Fastify({
  logger: { level: config.logLevel },
  requestTimeout: config.requestTimeoutMs,
});

await app.register(cors, { origin: true });
await app.register(healthRoutes, { prefix: "/" });
await app.register(scrapeRoutes, { prefix: "/" });
await app.register(mcpRoutes, { prefix: "/" });

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`crawler-service listening on http://localhost:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
