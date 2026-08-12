/**
 * 工作项（需求/缺陷/用例）通用 API 封装
 * 后端模块：apps/dh-backend/domain/workitem
 */
import { api } from './api';
import type { WorkItemDTO, WorkItemCommitDTO, WorkItemStatus } from './api-types';

/** 需求关联的产品空间条目（文档或原型） */
export interface LinkedProductSpaceItem {
  id: string;
  type: 'doc' | 'prototype';
  title: string;
  relativePath: string;
  status: string;
  currentVersion: number;
  updatedAt: string;
}

/** 按需求聚合的文档/原型，供智能会话「设计」菜单使用 */
export interface RequirementWithDesignItems {
  workitemId: string;
  workitemTitle: string;
  status: string;
  updatedAt: string;
  doc?: LinkedProductSpaceItem;
  prototype?: LinkedProductSpaceItem;
}

export const workItemApi = {
  /** 按空间列出工作项（支持可选的 type/status 过滤） */
  listByWorkspace: (workspaceId: string, params?: { type?: string; status?: string; assigneeId?: string }) => {
    const query = new URLSearchParams({ workspaceId });
    if (params?.type) query.set('type', params.type);
    if (params?.status) query.set('status', params.status);
    if (params?.assigneeId) query.set('assigneeId', params.assigneeId);
    return api.get<WorkItemDTO[]>(`/v1/workitems?${query.toString()}`);
  },

  /** 更新工作项状态 */
  updateStatus: (id: string, status: WorkItemStatus) =>
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/status`, { status }),

  /** 更新工作项受理人（assigneeId 为空字符串表示清空） */
  updateAssignee: (id: string, assigneeId: string) =>
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/assignee`, { assigneeId }),

  /** 列出工作空间下包含文档或原型关联的需求（按需求更新时间倒序） */
  listRequirementsWithDesignItems: (workspaceId: string) =>
    api.get<RequirementWithDesignItems[]>(`/v1/workspaces/${workspaceId}/workitems-with-design-items`),

  /** 按需求 ID 查询开发提交列表，按提交时间倒序 */
  listCommits: (workitemId: string) =>
    api.get<{ commits: WorkItemCommitDTO[] }>(`/v1/workitems/${workitemId}/commits`).then(res => res.commits),
};
