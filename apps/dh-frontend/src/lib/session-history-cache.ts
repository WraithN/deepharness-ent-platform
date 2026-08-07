/**
 * 用户会话历史缓存（localStorage）。
 * 按工作区 + 用户隔离，最多保留 20 条最近会话，供方向键快速切换。
 */

const SESSION_HISTORY_KEY_PREFIX = 'dh_session_history';
const MAX_SESSION_HISTORY = 20;

/** 缓存中的单条会话记录。 */
export interface SessionHistoryEntry {
  sessionId: string;
  pluginKey: string;
  title: string;
  instanceId?: string;
  /** 最后访问时间戳（ms），用于排序。 */
  updatedAt: number;
}

/** 获取当前用户 ID（与 Chat.tsx / use-ag-ui-chat.ts 一致，token 即 userId）。 */
function getUserId(): string {
  return localStorage.getItem('token') ?? '';
}

/** 构建 localStorage key：dh_session_history:{workspaceId}:{userId} */
function getStorageKey(workspaceId: string): string {
  return `${SESSION_HISTORY_KEY_PREFIX}:${workspaceId}:${getUserId()}`;
}

/** 读取缓存的会话列表（按 updatedAt 降序）。 */
export function getSessionHistory(workspaceId: string): SessionHistoryEntry[] {
  const raw = localStorage.getItem(getStorageKey(workspaceId));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as SessionHistoryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 添加或更新一条会话记录（同 sessionId 更新并移至头部），自动裁剪到上限。 */
export function addSessionToHistory(workspaceId: string, entry: SessionHistoryEntry): void {
  const list = getSessionHistory(workspaceId);
  const filtered = list.filter(e => e.sessionId !== entry.sessionId);
  filtered.unshift(entry);
  const trimmed = filtered.slice(0, MAX_SESSION_HISTORY);
  localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(trimmed));
}

/** 从缓存中移除指定会话。 */
export function removeSessionFromHistory(workspaceId: string, sessionId: string): void {
  const list = getSessionHistory(workspaceId);
  const filtered = list.filter(e => e.sessionId !== sessionId);
  if (filtered.length === 0) {
    localStorage.removeItem(getStorageKey(workspaceId));
  } else {
    localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(filtered));
  }
}

/** 批量同步缓存（用 API 返回的列表覆盖，保留最近 20 条）。 */
export function syncSessionHistory(workspaceId: string, entries: SessionHistoryEntry[]): void {
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  const trimmed = sorted.slice(0, MAX_SESSION_HISTORY);
  if (trimmed.length === 0) {
    localStorage.removeItem(getStorageKey(workspaceId));
  } else {
    localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(trimmed));
  }
}
