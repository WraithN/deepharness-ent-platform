import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Params = Partial<
  Record<keyof URLSearchParams, string | number | null | undefined>
>;

export function createQueryString(
  params: Params,
  searchParams: URLSearchParams
) {
  const newSearchParams = new URLSearchParams(searchParams?.toString());

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      newSearchParams.delete(key);
    } else {
      newSearchParams.set(key, String(value));
    }
  }

  return newSearchParams.toString();
}

export function formatDate(
  date: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {}
) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: opts.month ?? "long",
    day: opts.day ?? "numeric",
    year: opts.year ?? "numeric",
    ...opts,
  }).format(new Date(date));
}

/**
 * 将时间戳/ISO 字符串格式化为「年-月-日 时:分」。
 * 底层始终以时间戳存储，UI 层调用此函数统一格式化展示。
 */
export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 将时间戳/ISO 字符串/Date 格式化为「时:分」（HH:mm），用于聊天消息时间戳。
 */
export function formatTime(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 判断两个日期是否为同一天。
 * 入参可能是 Date、ISO 字符串或时间戳数字（SSE 重放后 createdAt 常为字符串），
 * 统一用 new Date() 规整，无效值返回 false 避免崩溃。
 */
export function isSameDay(a: Date | string | number, b: Date | string | number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

/**
 * 将内容中的工作区绝对路径前缀脱敏为相对路径。
 * 先剥离 {workspaceRoot}/{workspaceId}/{userId}/ 两层 ID 段，
 * 再剥离 products/prototypes/ 业务前缀，仅保留原型工程名起头的相对路径。
 * 例如 /home/nan/test/{wsId}/{userId}/products/prototypes/marketing-campaign/index.html
 *     展示为 marketing-campaign/index.html。
 */
export function sanitizeWorkspacePaths(text: string): string {
  return text
    .replace(/\/home\/nan\/test\/[^\/]+\/[^\/]+\//g, '')
    .replace(/products\/prototypes\//g, '');
}

/**
 * 将日期格式化为友好的人类可读日期标签（用于聊天日期分隔线）。
 * 今天 →「今天」、昨天 →「昨天」、今年 →「M月D日」、其他 →「YYYY年M月D日」。
 */
export function formatDateLabel(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, now)) return '今天';
  if (isSameDay(d, yesterday)) return '昨天';
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
