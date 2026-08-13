import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().default(8091),
  requestTimeoutMs: z.coerce.number().default(60_000),
  browserHeadless: z.coerce.boolean().default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

function loadConfig() {
  const raw = {
    port: process.env.PORT,
    requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
    browserHeadless: process.env.BROWSER_HEADLESS,
    logLevel: process.env.LOG_LEVEL,
  };
  return configSchema.parse(raw);
}

export const config = loadConfig();
