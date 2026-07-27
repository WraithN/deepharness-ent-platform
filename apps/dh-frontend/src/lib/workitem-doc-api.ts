/**
 * 需求-文档关联 API 封装
 * 后端模块：apps/dh-backend/domain/workitem (doc-links)
 */
import { api } from './api';

/** 需求与产品空间条目的关联类型 */
export interface WorkItemDocLink {
  id: string;
  workitemId: string;
  productSpaceItemId: string;
  workspaceId: string;
  /** 条目类型：doc | prototype */
  itemType: 'doc' | 'prototype';
  createdAt: string;
}

export interface CreateDocLinkRequest {
  productSpaceItemId: string;
  workspaceId: string;
  itemType: 'doc' | 'prototype';
}

export const workItemDocApi = {
  /** 列出需求关联的全部文档/原型 */
  list: (workitemId: string) =>
    api.get<WorkItemDocLink[]>(`/v1/workitems/${workitemId}/doc-links`),

  /** 创建需求-文档关联（幂等） */
  create: (workitemId: string, req: CreateDocLinkRequest) =>
    api.post<WorkItemDocLink>(`/v1/workitems/${workitemId}/doc-links`, req),

  /** 删除需求-文档关联 */
  delete: (workitemId: string, productSpaceItemId: string) =>
    api.delete<void>(`/v1/workitems/${workitemId}/doc-links/${productSpaceItemId}`),
};
