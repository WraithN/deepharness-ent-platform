import { describe, it, expect, vi } from "vitest";

// mock download-context 的 withDownloadContext，避免真实开浏览器。
// 按附件后缀分发不同 buffer 给 request.get，供 fetchSingle 下载后转换。
vi.mock("./download-context.js", () => ({
  withDownloadContext: vi.fn(async (_cookies: unknown, _base: string, fn: (req: unknown) => Promise<unknown>) => {
    const fakePdf = Buffer.from("%PDF-1.4 fake");
    const fakeDocx = Buffer.from("PK fake docx");
    const request = {
      get: vi.fn(async (url: string) => {
        if (url.endsWith(".pdf")) return { body: async () => fakePdf, headers: { "content-length": "100" } };
        if (url.endsWith(".docx")) return { body: async () => fakeDocx, headers: { "content-length": "100" } };
        throw new Error("not found");
      }),
    };
    return fn(request);
  }),
}));

// mock unpdf：extractText 返回固定正文（与 mergePages:true 形态一致：text 为 string）。
vi.mock("unpdf", () => ({
  extractText: vi.fn(async () => ({ text: "PDF 正文内容", pages: ["PDF 正文内容"] })),
}));

// mock mammoth：convertToHtml 返回固定 HTML 串。
vi.mock("mammoth", () => ({
  default: { convertToHtml: vi.fn(async () => ({ value: "<h1>WORD 标题</h1><p>正文</p>" })) },
}));

// mock turndown：把 HTML 转 markdown 的实际逻辑用简单规则模拟。
vi.mock("turndown", () => ({
  default: class FakeTurndown {
    turndown(html: string) { return `# WORD 标题\n\n正文`; }
  },
}));

import { fetchAndConvertAttachments } from "./attachments.js";
import type { PageResult } from "./browser.js";

function pageWithAttachments(urls: string[]): PageResult {
  return {
    title: "T", url: "https://x.test/p", markdown: "", text: "", html: "",
    cleanedHtml: "", links: [], imageUrls: [], attachmentUrls: urls,
  };
}

describe("fetchAndConvertAttachments", () => {
  it("PDF 转 markdown", async () => {
    const out = await fetchAndConvertAttachments([pageWithAttachments(["https://x.test/a.pdf"])], []);
    expect(out).toHaveLength(1);
    expect(out[0].filename).toBe("a.pdf");
    expect(out[0].markdown).toContain("PDF 正文内容");
  });

  it("DOCX 转 markdown", async () => {
    const out = await fetchAndConvertAttachments([pageWithAttachments(["https://x.test/b.docx"])], []);
    expect(out[0].filename).toBe("b.docx");
    expect(out[0].markdown).toContain("WORD 标题");
  });

  it("无附件返回空", async () => {
    const out = await fetchAndConvertAttachments([pageWithAttachments([])], []);
    expect(out).toEqual([]);
  });
});
