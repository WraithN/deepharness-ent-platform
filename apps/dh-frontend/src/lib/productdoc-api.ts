import { api } from './api';

export type DocStatus = 'draft' | 'published' | 'archived';

export interface ProductDoc {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  content: string;
  status: DocStatus;
  category: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDocVersion {
  id: string;
  docId: string;
  version: number;
  title: string;
  content: string;
  changeSummary: string;
  createdBy: string;
  createdAt: string;
}

export interface CreateProductDocRequest {
  title: string;
  slug?: string;
  content?: string;
  category?: string;
  status?: DocStatus;
  createdBy?: string;
}

export interface UpdateProductDocRequest {
  title?: string;
  content?: string;
  status?: DocStatus;
  category?: string;
}

export interface PublishProductDocRequest {
  changeSummary?: string;
  createdBy?: string;
}

export const productDocApi = {
  /**
   * 列出工作空间下的产品文档。
   */
  list: (workspaceId: string, params?: { status?: DocStatus; category?: string }) => {
    const search = new URLSearchParams();
    if (params?.status) search.append('status', params.status);
    if (params?.category) search.append('category', params.category);
    const query = search.toString();
    return api.get<ProductDoc[]>(
      `/v1/workspaces/${workspaceId}/product-docs${query ? `?${query}` : ''}`
    );
  },

  /**
   * 创建产品文档。
   */
  create: (workspaceId: string, req: CreateProductDocRequest) =>
    api.post<ProductDoc>(`/v1/workspaces/${workspaceId}/product-docs`, req),

  /**
   * 获取产品文档详情。
   */
  get: (workspaceId: string, docId: string) =>
    api.get<ProductDoc>(`/v1/workspaces/${workspaceId}/product-docs/${docId}`),

  /**
   * 更新产品文档。
   */
  update: (workspaceId: string, docId: string, req: UpdateProductDocRequest) =>
    api.patch<ProductDoc>(`/v1/workspaces/${workspaceId}/product-docs/${docId}`, req),

  /**
   * 删除产品文档。
   */
  delete: (workspaceId: string, docId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/product-docs/${docId}`),

  /**
   * 获取版本历史。
   */
  versions: (workspaceId: string, docId: string) =>
    api.get<ProductDocVersion[]>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/versions`),

  /**
   * 发布新版本。
   */
  publish: (workspaceId: string, docId: string, req?: PublishProductDocRequest) =>
    api.post<ProductDocVersion>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/publish`, req ?? {}),
};
