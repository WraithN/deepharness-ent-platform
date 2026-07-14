/**
 * 产品空间（文档/原型文件）API 封装
 * 后端模块：apps/dh-backend/domain/productspace
 * 注意：条目与版本字段为后端 snake_case 原始 JSON；评论为 camelCase。
 */
import { api } from './api';

/** 条目类型：文档 | 原型 */
export type ProductSpaceItemType = 'doc' | 'prototype';

/** 目录树节点类型：文件夹 | 文档 | 原型 */
export type ProductSpaceNodeType = 'folder' | ProductSpaceItemType;

export interface ProductSpaceItem {
  id: string;
  workspace_id: string;
  user_id: string;
  type: ProductSpaceItemType;
  title: string;
  relative_path: string;
  current_version: number;
  file_ext: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** 目录树节点；文件节点的 id 为条目 ID（后端在树构建时回填）。 */
export interface ProductSpaceTreeNode {
  /** 文件节点为条目 ID，文件夹节点为空 */
  id?: string;
  name: string;
  /** 相对路径，含分类前缀，如 prototypes/产品A/分组1/页面.html */
  path: string;
  type: ProductSpaceNodeType;
  children?: ProductSpaceTreeNode[];
}

/** GetItem 响应：条目元数据 + 内容（原型为 base64，文档为纯文本） */
export interface ProductSpaceItemDetail extends ProductSpaceItem {
  content: string;
}

export interface ProductSpaceVersion {
  id: string;
  doc_id: string;
  version: number;
  title: string;
  file_path: string;
  file_ext: string;
  mime_type: string;
  size_bytes: number;
  change_summary: string;
  created_by: string;
  created_at: string;
}

/** 原型页面批注评论 */
export interface PrototypeComment {
  id: string;
  itemId: string;
  workspaceId: string;
  userId: string;
  /** 评论人姓名（后端 LEFT JOIN users 解析，用户缺失时为空） */
  userName: string;
  content: string;
  createdAt: string;
}

export interface CreatePrototypeRequest {
  /** 页面标题（即文件名，不含扩展名） */
  title: string;
  /** 子目录路径，支持多级，如 "产品A/分组1" */
  folder?: string;
  /** HTML 文本内容（前端编码为 base64 后随 file_data 发送） */
  html: string;
}

const ITEMS_PATH = (workspaceId: string) => `/v1/workspaces/${workspaceId}/product-space/items`;

/** UTF-8 文本编码为 base64（btoa 仅支持 Latin1，需先转义）。 */
export function encodeBase64Utf8(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/** base64 解码为 UTF-8 文本。 */
export function decodeBase64Utf8(base64: string): string {
  return decodeURIComponent(escape(atob(base64)));
}

const HTML_EXT = '.html';

/** 确保原型标题带 .html 扩展名（后端要求 prototype 必须能从标题解析扩展名）。 */
function ensureHtmlExt(title: string): string {
  return title.toLowerCase().endsWith(HTML_EXT) ? title : `${title}${HTML_EXT}`;
}

export const productSpaceApi = {
  /** 获取产品空间目录树（docs / prototypes 两个根节点）。 */
  tree: (workspaceId: string) =>
    api.get<ProductSpaceTreeNode[]>(`/v1/workspaces/${workspaceId}/product-space/tree`),

  /** 创建原型页面（HTML）。返回创建后的条目。 */
  createPrototype: (workspaceId: string, req: CreatePrototypeRequest) =>
    api.post<ProductSpaceItem>(ITEMS_PATH(workspaceId), {
      type: 'prototype',
      title: ensureHtmlExt(req.title),
      folder: req.folder,
      file_data: encodeBase64Utf8(req.html),
    }),

  /** 获取条目详情；原型内容的 content 为 base64 编码。 */
  getItem: (workspaceId: string, itemId: string) =>
    api.get<ProductSpaceItemDetail>(`${ITEMS_PATH(workspaceId)}/${itemId}`),

  /** 删除条目（同时删除文件与全部版本）。 */
  deleteItem: (workspaceId: string, itemId: string) =>
    api.delete<void>(`${ITEMS_PATH(workspaceId)}/${itemId}`),

  /** 更新原型内容（HTML 文本），产生新版本。 */
  updateContent: (workspaceId: string, itemId: string, html: string, changeSummary?: string) =>
    api.put<ProductSpaceItem>(`${ITEMS_PATH(workspaceId)}/${itemId}/content`, {
      content: encodeBase64Utf8(html),
      change_summary: changeSummary,
    }),

  /** 创建文件夹；category 固定为 prototypes / docs，name 支持多级路径。 */
  createFolder: (workspaceId: string, category: 'docs' | 'prototypes', name: string) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/product-space/folders`, { category, name }),

  /** 删除文件夹（DELETE 使用 query 参数）。 */
  deleteFolder: (workspaceId: string, category: 'docs' | 'prototypes', name: string) => {
    const search = new URLSearchParams({ category, name });
    return api.delete<void>(`/v1/workspaces/${workspaceId}/product-space/folders?${search.toString()}`);
  },

  /** 列出版本（按版本号倒序）。 */
  listVersions: (workspaceId: string, itemId: string) =>
    api.get<ProductSpaceVersion[]>(`${ITEMS_PATH(workspaceId)}/${itemId}/versions`),

  /** 恢复至指定版本。 */
  restoreVersion: (workspaceId: string, itemId: string, version: number) =>
    api.post<ProductSpaceItem>(`${ITEMS_PATH(workspaceId)}/${itemId}/versions/${version}/restore`),

  /** 列出某原型页面的批注评论（按时间倒序，最新在上）。 */
  listComments: (workspaceId: string, itemId: string) =>
    api.get<PrototypeComment[]>(`${ITEMS_PATH(workspaceId)}/${itemId}/comments`),

  /** 新增批注评论。 */
  addComment: (workspaceId: string, itemId: string, content: string) =>
    api.post<PrototypeComment>(`${ITEMS_PATH(workspaceId)}/${itemId}/comments`, { content }),
};
