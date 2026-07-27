/**
 * 需求级产品设计版本 API 封装
 * 后端模块：apps/dh-backend/domain/workitem (design-versions)
 */
import { api } from './api';

/** 设计版本包含的单个条目（文档或原型） */
export interface DesignVersionItem {
  id: string;
  designVersionId: string;
  productSpaceItemId: string;
  productDocVersionId: number;
  itemType: 'doc' | 'prototype';
  createdAt: string;
}

/** 需求级产品设计版本快照 */
export interface DesignVersion {
  id: string;
  workitemId: string;
  workspaceId: string;
  userId: string;
  versionNumber: number;
  changeSummary: string;
  createdBy: string;
  createdAt: string;
  items: DesignVersionItem[];
}

/** 设计版本列表响应 */
export interface ListDesignVersionsResponse {
  versions: DesignVersion[];
}

export const workItemDesignVersionApi = {
  /** 列出需求的所有产品设计版本 */
  list: (workitemId: string) =>
    api.get<ListDesignVersionsResponse>(`/v1/workitems/${workitemId}/design-versions`).then(res => res.versions),
};
