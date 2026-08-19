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

/** 判断字符串是否为合法 IPv4（四个 0-255 的十进制段）。纯字符串判断，无外部依赖。 */
function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * 判断 URL 是否指向内网/私网地址（SSRF 防护）。
 * 供 image-ocr / attachments 在下载前拦截，避免被抓取页面诱导对内网地址发起 GET。
 *
 * 判定为私网的主机：
 * - 回环：localhost、127.0.0.0/8、::1
 * - 链路本地：169.254.0.0/16、fe80::/10
 * - 私网段：10.0.0.0/8、172.16.0.0/12、192.168.0.0/16
 * - CGNAT：100.64.0.0/10
 * - 0.0.0.0（及 0.0.0.0/8 本网络地址）
 * - IPv4 映射 IPv6（::ffff:0:0/96，含点分与 hex 形式）
 * - IPv6 ULA：fc00::/7
 * 普通域名（非 IP）一律放行；无法解析的 URL 保守地判定为私网并拒绝。
 */
export function isPrivateHost(rawUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    // URL 解析失败：无法确认目标，保守拒绝下载。
    return true;
  }

  // 去掉 IPv6 方括号与末尾点（如 "[::1]" -> "::1"、"localhost." -> "localhost"），统一小写。
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

  if (host === "localhost" || host === "0.0.0.0") return true;

  // IPv6 地址（含冒号）走 IPv6 网段判断；普通域名不含冒号，不会被误判。
  if (host.includes(":")) {
    if (host === "::1") return true; // 回环
    if (host.startsWith("fe80:")) return true; // 链路本地 fe80::/10
    if (host.startsWith("::ffff:")) return true; // IPv4 映射 IPv6 ::ffff:0:0/96
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // ULA fc00::/7
    return false; // 其余 IPv6 公网放行
  }

  // 仅对纯 IPv4 做网段判断，其余（普通域名）放行。
  if (!isIpv4(host)) return false;

  const parts = host.split(".").map(Number);
  const [a, b] = parts;
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 10) return true; // 10.0.0.0/8 私网
  if (a === 0) return true; // 0.0.0.0/8 本网络
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 私网
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
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
