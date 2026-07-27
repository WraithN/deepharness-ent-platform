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
  folderId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 产品文档目录（一级目录 parentId 为空，最多 6 层；isDefault 为默认“未分类”目录，不可删除）。 */
export interface ProductDocFolder {
  id: string;
  workspaceId: string;
  parentId?: string;
  name: string;
  pinned: boolean;
  isDefault?: boolean;
  sortOrder: number;
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

/** 文档分享短链对象 */
export interface ProductDocShare {
  token: string;
  docId: string;
  createdAt: string;
}

/** 免登录分享落地页的文档视图 */
export interface SharedDocView {
  title: string;
  content: string;
  version: number;
  publishedAt: string;
  /** 文档创建人姓名（后端 JOIN users 解析；用户已删除时为空） */
  createdByName?: string;
}

/** 分享文档批注（选中任意文本锚定，免登录填写昵称） */
export interface ShareComment {
  id: string;
  shareToken: string;
  docId: string;
  workspaceId: string;
  authorName: string;
  /** 批注锚定的选中文本 */
  quoteText: string;
  content: string;
  /** open = 未解决，resolved = 已关闭 */
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface AddShareCommentRequest {
  authorName: string;
  quoteText: string;
  content: string;
}

export interface CreateProductDocRequest {
  title: string;
  slug?: string;
  content?: string;
  category?: string;
  folderId?: string;
  status?: DocStatus;
  createdBy?: string;
}

export interface UpdateProductDocRequest {
  title?: string;
  content?: string;
  status?: DocStatus;
  category?: string;
  /** 传入时表示移动文档：空字符串移到根目录，否则移到指定目录 */
  folderId?: string;
}

export interface PublishProductDocRequest {
  changeSummary?: string;
  createdBy?: string;
}

/** 全局版本列表项：版本信息 + 所属文档的标题与状态 + 操作人姓名 */
export interface WorkspaceVersionItem extends ProductDocVersion {
  docTitle: string;
  docStatus: DocStatus;
  /** 操作人姓名（后端 JOIN users 解析；用户已删除时为空） */
  createdByName?: string;
}

/** 全局版本列表查询参数 */
export interface WorkspaceVersionListParams {
  /** 起始时间（YYYY-MM-DD 或 RFC3339） */
  start?: string;
  /** 结束时间 */
  end?: string;
  /** 限定文档 ID 集合；为空表示全部文档 */
  docIds?: string[];
  /** 按文档状态筛选 */
  status?: DocStatus;
  /** 按操作人（用户 ID）筛选 */
  createdBy?: string;
  /** 关键词：匹配文档标题 / 版本备注 */
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface WorkspaceVersionList {
  items: WorkspaceVersionItem[];
  total: number;
  page: number;
  pageSize: number;
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

  /** 为已发布文档创建分享短链（幂等，同一文档返回同一 token） */
  createShare: (workspaceId: string, docId: string) =>
    api.post<ProductDocShare>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/share`, {}),

  /** 免登录查看分享文档（最新已发布版本） */
  getSharedDoc: (token: string) => api.get<SharedDocView>(`/v1/shares/${token}`),

  /** 将文档内容按需落盘到工作目录（products/docs/），返回 agent 可读的相对路径 */
  materializeDoc: (workspaceId: string, docId: string) =>
    api.post<{ path: string }>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/materialize`, {}),

  /** 免登录列出分享文档的批注（按时间正序） */
  listShareComments: (token: string) => api.get<ShareComment[]>(`/v1/shares/${token}/comments`),

  /** 免登录为分享文档新增批注 */
  addShareComment: (token: string, req: AddShareCommentRequest) =>
    api.post<ShareComment>(`/v1/shares/${token}/comments`, req),

  /** 登录态：列出文档的全部分享批注 */
  listDocShareComments: (workspaceId: string, docId: string) =>
    api.get<ShareComment[]>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/share-comments`),

  /** 登录态：为文档新增分享批注（产品空间内直接批注）。 */
  addDocShareComment: (workspaceId: string, docId: string, req: AddShareCommentRequest) =>
    api.post<ShareComment>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/share-comments`, req),

  /** 登录态：关闭（标记已解决）指定批注 */
  resolveShareComment: (workspaceId: string, docId: string, commentId: string) =>
    api.post<ShareComment>(
      `/v1/workspaces/${workspaceId}/product-docs/${docId}/share-comments/${commentId}/resolve`,
      {}
    ),

  /**
   * 全局版本列表：跨文档查询工作空间内的版本记录，支持时间/文档/状态/操作人/关键词筛选与分页。
   */
  listWorkspaceVersions: (workspaceId: string, params?: WorkspaceVersionListParams) => {
    const search = new URLSearchParams();
    if (params?.start) search.append('start', params.start);
    if (params?.end) search.append('end', params.end);
    if (params?.docIds && params.docIds.length > 0) search.append('docIds', params.docIds.join(','));
    if (params?.status) search.append('status', params.status);
    if (params?.createdBy) search.append('createdBy', params.createdBy);
    if (params?.keyword) search.append('keyword', params.keyword);
    if (params?.page) search.append('page', String(params.page));
    if (params?.pageSize) search.append('pageSize', String(params.pageSize));
    const query = search.toString();
    return api.get<WorkspaceVersionList>(
      `/v1/workspaces/${workspaceId}/product-doc-versions${query ? `?${query}` : ''}`
    );
  },

  /**
   * 版本回滚：以指定历史版本的内容生成一个新版本（不覆盖历史记录）。
   */
  restoreVersion: (workspaceId: string, docId: string, version: number) =>
    api.post<ProductDocVersion>(
      `/v1/workspaces/${workspaceId}/product-docs/${docId}/versions/${version}/restore`,
      {}
    ),

  /**
   * 删除指定历史版本（仅管理员；文档至少保留一个版本）。
   */
  deleteVersion: (workspaceId: string, docId: string, version: number) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/versions/${version}`),

  /**
   * 编辑版本备注（changeSummary）。
   */
  updateVersionSummary: (workspaceId: string, docId: string, version: number, changeSummary: string) =>
    api.patch<ProductDocVersion>(`/v1/workspaces/${workspaceId}/product-docs/${docId}/versions/${version}`, {
      changeSummary,
    }),

  /**
   * 列出工作空间下的文档目录。
   */
  listFolders: (workspaceId: string) =>
    api.get<ProductDocFolder[]>(`/v1/workspaces/${workspaceId}/product-doc-folders`),

  /**
   * 创建目录；传 parentId 时创建二级目录。
   */
  createFolder: (workspaceId: string, req: { name: string; parentId?: string }) =>
    api.post<ProductDocFolder>(`/v1/workspaces/${workspaceId}/product-doc-folders`, req),

  /**
   * 更新目录（重命名 / 置顶）。
   */
  updateFolder: (workspaceId: string, folderId: string, req: { name?: string; pinned?: boolean }) =>
    api.patch<ProductDocFolder>(`/v1/workspaces/${workspaceId}/product-doc-folders/${folderId}`, req),

  /**
   * 删除目录（目录内文档回到根目录）。
   */
  deleteFolder: (workspaceId: string, folderId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/product-doc-folders/${folderId}`),
};
