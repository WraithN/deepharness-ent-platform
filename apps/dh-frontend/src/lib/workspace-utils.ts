/**
 * 当前工作区工具函数
 *
 * 工作区 ID 是多数业务接口的必填参数，统一从此文件读取/写入 localStorage，
 * 避免各页面重复写 `localStorage.getItem('currentWorkspaceId') || 'ws-default'`
 * 导致兜底 ID 不一致或隐藏真正的未选工作区问题。
 */

export const CURRENT_WORKSPACE_ID_KEY = 'currentWorkspaceId';

/**
 * 获取当前工作区 ID。
 * 若未设置（localStorage 与 membership 均未就绪），直接抛出错误，
 * 避免用 `ws-default` 兜底掩盖问题。
 */
export function getCurrentWorkspaceId(): string {
  const id = localStorage.getItem(CURRENT_WORKSPACE_ID_KEY);
  if (!id) {
    throw new Error('No workspace selected: currentWorkspaceId is missing in localStorage');
  }
  return id;
}

/**
 * 仅在明确允许未选工作区的场景下使用，返回可能为 null。
 * 大多数业务代码应使用 {@link getCurrentWorkspaceId}。
 */
export function getCurrentWorkspaceIdOrNull(): string | null {
  return localStorage.getItem(CURRENT_WORKSPACE_ID_KEY);
}

export function setCurrentWorkspaceId(workspaceId: string): void {
  localStorage.setItem(CURRENT_WORKSPACE_ID_KEY, workspaceId);
}

export function removeCurrentWorkspaceId(): void {
  localStorage.removeItem(CURRENT_WORKSPACE_ID_KEY);
}
