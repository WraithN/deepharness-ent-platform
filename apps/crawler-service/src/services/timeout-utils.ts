// 通用超时包装：超时抛带 timeoutText 的 Error，供调用方 try/catch 转为失败标记。
// image-ocr / attachments 共用，避免在每个模块各自定义。
//
// 实现细节：用 try/finally 在 Promise.race 结束后清理 setTimeout 句柄。
// 若不清理，即便主 Promise 已 resolve，定时器仍会持续占用内存直到触发（OCR/附件
// 循环中会累积大量未释放的 timer）。
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  timeoutText: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutText)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
