import { describe, it, expect, vi } from "vitest";
import type { APIRequestContext } from "playwright";

// mock download-context 的 withDownloadContext，避免真实开浏览器。
// 默认实现：request.get 返回 1x1 透明 PNG buffer。
vi.mock("./download-context.js", () => ({
  withDownloadContext: vi.fn(async (
    _cookies: unknown,
    _base: unknown,
    fn: (request: { get: (url: string) => Promise<unknown> }) => Promise<unknown>,
  ) => {
    const fakePng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    const request = {
      get: async () => ({ body: async () => fakePng, headers: () => ({}) }),
    };
    return fn(request);
  }),
}));

// mock tesseract.js：recognize 返回固定文本，一个 worker 处理多图。
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({ data: { text: "识别出的文字" } })),
    terminate: vi.fn(async () => {}),
  })),
}));

import { ocrPageImages } from "./image-ocr.js";
import { withDownloadContext } from "./download-context.js";
import type { PageResult } from "./browser.js";

function pageWithImages(urls: string[]): PageResult {
  return {
    title: "T",
    url: "https://x.test/p",
    markdown: "",
    text: "",
    html: "",
    cleanedHtml: "",
    links: [],
    imageUrls: urls,
    attachmentUrls: [],
  };
}

describe("ocrPageImages", () => {
  it("对每张图返回 OCR 文字", async () => {
    const out = await ocrPageImages(
      [pageWithImages(["https://x.test/a.png", "https://x.test/b.png"])],
      [],
    );
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://x.test/a.png");
    expect(out[0].ocrText).toBe("识别出的文字");
  });

  it("无图片返回空数组", async () => {
    const out = await ocrPageImages([pageWithImages([])], []);
    expect(out).toEqual([]);
  });

  it("单张下载失败标记 [OCR 失败] 不阻断其他图", async () => {
    // 覆盖一次 withDownloadContext：request.get 对含 "fail" 的 URL 抛错，其余返回正常 PNG。
    // 验证 ocrSingle 的 try/catch 把单图失败转为 [OCR 失败: ...] 标记，不影响其他图结果。
    vi.mocked(withDownloadContext).mockImplementationOnce(async (_cookies, _base, fn) => {
      const fakePng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      );
      const request = {
        get: async (url: string) => {
          if (url.includes("fail")) throw new Error("network error");
          return { body: async () => fakePng, headers: () => ({}) };
        },
      } as unknown as APIRequestContext;
      return fn(request);
    });

    const out = await ocrPageImages(
      [pageWithImages(["https://x.test/ok.png", "https://x.test/fail.png"])],
      [],
    );
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://x.test/ok.png");
    expect(out[0].ocrText).toBe("识别出的文字");
    expect(out[1].url).toBe("https://x.test/fail.png");
    expect(out[1].ocrText).toContain("[OCR 失败");
    expect(out[1].ocrText).toContain("network error");
  });

  it("内网图片地址被 SSRF 拦截，返回 [跳过：内网地址]", async () => {
    const out = await ocrPageImages(
      [pageWithImages(["http://127.0.0.1/secret.png", "https://x.test/a.png"])],
      [],
    );
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("http://127.0.0.1/secret.png");
    expect(out[0].ocrText).toBe("[跳过：内网地址]");
    expect(out[1].ocrText).toBe("识别出的文字");
  });
});
