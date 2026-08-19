import { createWorker } from "tesseract.js";
import type { PageResult } from "./browser.js";
import type { Cookie } from "../types.js";
import { withDownloadContext } from "./download-context.js";
import { withTimeout } from "./timeout-utils.js";

// OCR 单图超时（含下载+识别）。大图/慢站点不应拖垮整体响应。
const OCR_SINGLE_TIMEOUT_MS = 30_000;
// 单图大小上限 10MB，防止巨型图耗尽内存。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
  try {
    const resp = await request.get(url);
    const buffer = Buffer.from(await resp.body());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { url, ocrText: `[OCR 跳过：图片超 ${MAX_IMAGE_BYTES / 1024 / 1024}MB]` };
    }
    const { data } = await withTimeout(
      worker.recognize(buffer),
      OCR_SINGLE_TIMEOUT_MS,
      "[OCR 超时]",
    );
    const text = data.text.trim();
    return { url, ocrText: text || "[OCR 无文字]" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url, ocrText: `[OCR 失败: ${msg}]` };
  }
}
