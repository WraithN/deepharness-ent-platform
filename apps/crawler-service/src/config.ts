import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(8091),
  firecrawlUrl: z.string().url().default("http://localhost:3002"),
  firecrawlApiKey: z.string().default(""),
  requestTimeoutMs: z.coerce.number().default(60_000),
  browserHeadless: z.coerce.boolean().default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

function loadConfig() {
  const raw = {
    port: process.env.PORT,
    firecrawlUrl: process.env.FIRECRAWL_URL,
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
    requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
    browserHeadless: process.env.BROWSER_HEADLESS,
    logLevel: process.env.LOG_LEVEL,
  };
  return configSchema.parse(raw);
}

export const config = loadConfig();
