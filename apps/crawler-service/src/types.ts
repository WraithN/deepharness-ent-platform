import { z } from "zod";

export const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().default("/"),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});

export const scrapeRequestSchema = z.object({
  url: z.string().url(),
  cookies: z.array(cookieSchema).default([]),
  waitForSelector: z.string().optional(),
  maxDepth: z.coerce.number().int().min(1).max(10).default(2),
  includeLinks: z.boolean().default(true),
  includeScreenshot: z.boolean().default(false),
  outputFormat: z.enum(["markdown", "text", "html"]).default("markdown"),
});

export type Cookie = z.infer<typeof cookieSchema>;
export type ScrapeRequest = z.infer<typeof scrapeRequestSchema>;

export interface ScrapeResponse {
  url: string;
  title: string;
  markdown: string;
  text?: string;
  html?: string;
  cleanedHtml?: string;
  links: string[];
  screenshot?: string;
  metadata: {
    pageCount: number;
    crawlSource: "playwright";
    error?: string;
  };
}
