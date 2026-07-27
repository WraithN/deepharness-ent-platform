/**
 * 工作项（需求/缺陷/用例）通用 API 封装
 * 后端模块：apps/dh-backend/domain/workitem
 */
import { api } from './api';
import type { WorkItemDTO, WorkItemStatus } from './api-types';

export const workItemApi = {
  /** 更新工作项状态 */
  updateStatus: (id: string, status: WorkItemStatus) =>
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/status`, { status }),

  /** 更新工作项受理人（assigneeId 为空字符串表示清空） */
  updateAssignee: (id: string, assigneeId: string) =>
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/assignee`, { assigneeId }),
};
