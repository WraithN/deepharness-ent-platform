import { createWorker } from "tesseract.js";
import type { PageResult } from "./browser.js";
import type { Cookie } from "../types.js";
import { withDownloadContext } from "./download-context.js";
import { withTimeout } from "./timeout-utils.js";
import { isPrivateHost } from "./url-extract.js";

// OCR 单图超时（含下载+识别）。大图/慢站点不应拖垮整体响应。
const OCR_SINGLE_TIMEOUT_MS = 30_000;
// 单图大小上限 10MB，防止巨型图耗尽内存。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// 各类跳过/失败标记，统一文案便于调用方展示。
const OCR_SKIP_TOO_LARGE_TEXT = "[跳过：图片超 10MB]";
const OCR_SKIP_PRIVATE_HOST_TEXT = "[跳过：内网地址]";
const OCR_TIMEOUT_TEXT = "[OCR 超时]";
const OCR_NO_TEXT = "[OCR 无文字]";

export interface ImageOcrResult {
  url: string;
  ocrText: string;
}

/**
 * 对所有页面的内嵌图片做 OCR。开一个下载 context（复用 cookie），逐张下载识别。
 * 单张失败/超时/超限不阻断，ocrText 标记失败原因。
 */
export async function ocrPageImages(
  pages: PageResult[],
  cookies: Cookie[],
): Promise<ImageOcrResult[]> {
  const allUrls = pages.flatMap((p) => p.imageUrls);
  if (allUrls.length === 0) return [];

  const fallbackBase = pages[0]?.url ?? "https://localhost/";
  const worker = await createWorker("chi_sim+eng");
  try {
    return await withDownloadContext(cookies, fallbackBase, async (request) => {
      const results: ImageOcrResult[] = [];
      for (const url of allUrls) {
        const result = await ocrSingle(request, worker, url);
        results.push(result);
      }
      return results;
    });
  } finally {
    await worker.terminate();
  }
}

async function ocrSingle(
  request: import("playwright").APIRequestContext,
  worker: { recognize: (img: Buffer) => Promise<{ data: { text: string } }> },
  url: string,
): Promise<ImageOcrResult> {
  // SSRF 防护：内网/私网地址在发起任何请求前直接跳过。
  if (isPrivateHost(url)) {
    return { url, ocrText: OCR_SKIP_PRIVATE_HOST_TEXT };
  }
  try {
    // 下载+识别作为一个整体受 30s 超时约束，慢下载/无 content-length 的大文件同样被兜底。
    const text = await withTimeout(
      downloadAndRecognize(request, worker, url),
      OCR_SINGLE_TIMEOUT_MS,
      OCR_TIMEOUT_TEXT,
    );
    return { url, ocrText: text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url, ocrText: `[OCR 失败: ${msg}]` };
  }
}

/** 下载单图并识别。content-length 超限时在读取 body 前快速拒绝，避免完整下载巨型图。 */
async function downloadAndRecognize(
  request: import("playwright").APIRequestContext,
  worker: { recognize: (img: Buffer) => Promise<{ data: { text: string } }> },
  url: string,
): Promise<string> {
  const resp = await request.get(url);
  const contentLength = Number(resp.headers()["content-length"] ?? 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    return OCR_SKIP_TOO_LARGE_TEXT;
  }
  const buffer = Buffer.from(await resp.body());
  // content-length 缺失或不准确时，以实际下载字节数二次兜底。
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return OCR_SKIP_TOO_LARGE_TEXT;
  }
  const { data } = await worker.recognize(buffer);
  const text = data.text.trim();
  return text || OCR_NO_TEXT;
}
