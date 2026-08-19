// 附件后缀白名单（小写匹配）。.doc 老格式 mammoth 不支持，仍收集由 attachments 模块报失败提示。
const ATTACHMENT_EXTENSIONS = [".pdf", ".docx", ".doc"];

// data: 内联图片不下载（base64 已在 cleanedHtml 里）。
function isDataUri(url: string): boolean {
  return url.startsWith("data:");
}

/** 绝对化单个 URL；解析失败返回空串。 */
function absolutize(raw: string, baseUrl: string): string {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

/**
 * 从 <img src> 列表提取有效图片 URL：过滤 data: URI、绝对化、去重保序。
 * 在 browser.ts 的 page.evaluate 返回原始 src 后调用（纯函数，可脱离浏览器测试）。
 */
export function extractImageUrls(srcs: string[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of srcs) {
    if (isDataUri(raw)) continue;
    const abs = absolutize(raw, baseUrl);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      result.push(abs);
    }
  }
  return result;
}

/**
 * 从 <a href> 列表提取附件链接：匹配 .pdf/.docx/.doc 后缀（大小写不敏感）、绝对化、去重保序。
 * 去重按小写形式比较（同一附件在不同链接中大小写不一，应视为同一附件），保留首次出现的大小写。
 */
export function extractAttachmentUrls(hrefs: string[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of hrefs) {
    const lower = raw.toLowerCase();
    if (!ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
    const abs = absolutize(raw, baseUrl);
    // 附件 URL 按小写形式去重（Windows/IIS 等服务器路径大小写不敏感），输出保留首次出现的大小写。
    const dedupKey = abs.toLowerCase();
    if (abs && !seen.has(dedupKey)) {
      seen.add(dedupKey);
      result.push(abs);
    }
  }
  return result;
}
