/**
 * 用户输入消息历史缓存（localStorage）。
 * 按工作区 + 用户隔离，最多保留最近 N 条用户发送的消息文本，
 * 供聊天输入框内通过 ↑/↓ 方向键快速回溯。
 */

const INPUT_HISTORY_KEY_PREFIX = 'dh_input_history';
export const MAX_INPUT_HISTORY = 50;

/** 获取当前用户 ID（与 session-history-cache.ts 一致，token 即 userId）。 */
function getUserId(): string {
  return localStorage.getItem('token') ?? '';
}

/** 构建 localStorage key：dh_input_history:{workspaceId}:{userId} */
function getStorageKey(workspaceId: string): string {
  return `${INPUT_HISTORY_KEY_PREFIX}:${workspaceId}:${getUserId()}`;
}

/** 读取缓存的输入历史（按时间倒序，索引 0 为最近一条）。 */
export function getInputHistory(workspaceId: string): string[] {
  if (!workspaceId) return [];
  const raw = localStorage.getItem(getStorageKey(workspaceId));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 添加一条输入到历史；与最近一条重复时仅将其移到头部，超过上限自动裁剪。 */
export function addInputHistory(workspaceId: string, text: string): void {
  if (!workspaceId || !text.trim()) return;
  const trimmed = text.trim();
  const list = getInputHistory(workspaceId).filter(item => item !== trimmed);
  list.unshift(trimmed);
  const trimmedList = list.slice(0, MAX_INPUT_HISTORY);
  localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(trimmedList));
}

/** 清空指定工作区的输入历史。 */
export function clearInputHistory(workspaceId: string): void {
  if (!workspaceId) return;
  localStorage.removeItem(getStorageKey(workspaceId));
}
