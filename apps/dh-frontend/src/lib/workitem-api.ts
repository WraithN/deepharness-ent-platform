/**
 * 工作项（需求/缺陷/用例）通用 API 封装
 * 后端模块：apps/dh-backend/domain/workitem
 */
import { api } from './api';
import type { WorkItemDTO, WorkItemStatus } from './api-types';

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
  /** 更新工作项状态 */
  updateStatus: (id: string, status: WorkItemStatus) =>
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/status`, { status }),

  /** 更新工作项受理人（assigneeId 为空字符串表示清空） */
  updateAssignee: (id: string, assigneeId: string) =>
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/assignee`, { assigneeId }),

  /** 列出工作空间下包含文档或原型关联的需求（按需求更新时间倒序） */
  listRequirementsWithDesignItems: (workspaceId: string) =>
    api.get<RequirementWithDesignItems[]>(`/v1/workspaces/${workspaceId}/workitems-with-design-items`),
};
