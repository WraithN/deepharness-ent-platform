import { describe, it, expect } from "vitest";
import { mergePageMarkdown, mergePageText, mergePageHtml, mergePageCleanedHtml, dedupe } from "./merge.js";
import type { PageResult } from "./browser.js";

function page(over: Partial<PageResult> = {}): PageResult {
  return {
    title: "T", url: "https://x.test/a", markdown: "md", text: "txt",
    html: "<h>h</h>", cleanedHtml: "<c>c</c>", links: [], ...over,
  };
}

describe("merge functions", () => {
  it("mergePageMarkdown 每页前加 URL 标题，空 body 回退 text", () => {
    const out = mergePageMarkdown([page({ url: "https://x.test/a", markdown: "", text: "fallback" })]);
    expect(out).toContain("https://x.test/a");
    expect(out).toContain("fallback");
  });

  it("mergePageCleanedHtml 每页前加 URL 注释", () => {
    const out = mergePageCleanedHtml([page({ url: "https://x.test/a", cleanedHtml: "<c/>" })]);
    expect(out).toContain("<!-- https://x.test/a -->");
    expect(out).toContain("<c/>");
  });

  it("多页用 PAGE_SEPARATOR 连接，空页被过滤", () => {
    const out = mergePageMarkdown([
      page({ url: "u1", markdown: "m1" }),
      page({ url: "u2", markdown: "", text: "" }),
    ]);
    expect(out).toContain("m1");
    expect(out).not.toContain("u2");
  });

  it("dedupe 去重保序", () => {
    expect(dedupe(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("mergePageText 与 mergePageHtml 过滤空串", () => {
    expect(mergePageText([page({ text: "" }), page({ text: "t" })])).toBe("t");
    expect(mergePageHtml([page({ html: "" }), page({ html: "<h/>" })])).toBe("<h/>");
  });
});
