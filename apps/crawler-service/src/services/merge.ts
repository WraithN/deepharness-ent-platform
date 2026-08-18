import type { PageResult } from "./browser.js";

/** 多页内容合并时的页分隔符。 */
const PAGE_SEPARATOR = "\n\n---\n\n";

/** 合并多页的同名字段，并在每页前加 URL 标题，便于下游识别内容来源。 */
export function mergePageMarkdown(pages: PageResult[]): string {
  return pages
    .map((p) => {
      // markdown 兜底提取可能为空（SPA 无 h1/p/li），此时回退到 innerText。
      const body = p.markdown || p.text;
      // body 为空时整页跳过（含 URL 标题），避免输出仅有标题的空页。
      return body.trim().length > 0 ? `## ${p.url}\n\n${body}` : "";
    })
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

export function mergePageText(pages: PageResult[]): string {
  return pages
    .map((p) => p.text)
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

export function mergePageHtml(pages: PageResult[]): string {
  return pages
    .map((p) => p.html)
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

/** 合并多页的清洗后 HTML，每页前加 URL 注释，便于下游识别内容来源。 */
export function mergePageCleanedHtml(pages: PageResult[]): string {
  return pages
    .map((p) => `<!-- ${p.url} -->\n${p.cleanedHtml}`)
    .filter((s) => s.trim().length > 0)
    .join(PAGE_SEPARATOR);
}

export function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
