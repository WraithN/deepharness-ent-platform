import { describe, it, expect } from "vitest";
import { extractImageUrls, extractAttachmentUrls } from "./url-extract.js";

describe("extractImageUrls", () => {
  it("绝对化相对 URL，去重保序，过滤 data: URI", () => {
    const srcs = ["img/a.png", "https://x.test/b.jpg", "img/a.png", "data:image/png;base64,xxx"];
    expect(extractImageUrls(srcs, "https://x.test/page")).toEqual([
      "https://x.test/img/a.png",
      "https://x.test/b.jpg",
    ]);
  });

  it("空数组返回空", () => {
    expect(extractImageUrls([], "https://x.test/")).toEqual([]);
  });

  it("非法 URL 跳过不抛错", () => {
    expect(extractImageUrls(["http://[invalid", "img/a.png"], "https://x.test/")).toEqual([
      "https://x.test/img/a.png",
    ]);
  });
});

describe("extractAttachmentUrls", () => {
  it("匹配 .pdf/.docx/.doc 后缀（大小写不敏感），绝对化去重", () => {
    const hrefs = [
      "https://x.test/a.pdf",
      "/files/b.DOCX",
      "https://y.test/c.doc",
      "https://x.test/d.txt",
      "/files/b.docx",
    ];
    expect(extractAttachmentUrls(hrefs, "https://x.test/page")).toEqual([
      "https://x.test/a.pdf",
      "https://x.test/files/b.DOCX",
      "https://y.test/c.doc",
    ]);
  });

  it("空数组返回空", () => {
    expect(extractAttachmentUrls([], "https://x.test/")).toEqual([]);
  });
});
