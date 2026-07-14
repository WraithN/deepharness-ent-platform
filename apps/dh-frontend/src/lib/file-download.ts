/**
 * 浏览器端文件下载工具
 * 统一 Blob/文本触发下载的逻辑，供版本导出、原型导出等场景复用。
 */

/** 触发浏览器下载 Blob 对象。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 触发浏览器下载文本内容（默认 Markdown 类型）。 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/markdown;charset=utf-8'
): void {
  downloadBlob(new Blob([content], { type: mime }), filename);
}
