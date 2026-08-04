/**
 * 产品空间（文档/原型文件）API 封装
 * 后端模块：apps/dh-backend/domain/productspace
 * 注意：条目与版本字段为后端 snake_case 原始 JSON；评论为 camelCase。
 */
import { api } from './api';
import type { ShareComment } from './productdoc-api';

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
  /** 被标注元素的选择器（优先 data-dh-id） */
  selector?: string;
  /** 被标注元素的文本快照 */
  targetText?: string;
  /** 标注点在页面中的 X 坐标 */
  x?: number;
  /** 标注点在页面中的 Y 坐标 */
  y?: number;
  createdAt: string;
}

export interface AddCommentRequest {
  content: string;
  selector?: string;
  targetText?: string;
  x?: number;
  y?: number;
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
  addComment: (workspaceId: string, itemId: string, req: AddCommentRequest) =>
    api.post<PrototypeComment>(`${ITEMS_PATH(workspaceId)}/${itemId}/comments`, req),

  /** 为指定产品创建免登录分享链接（PM 权限，幂等）。 */
  createPrototypeShare: (workspaceId: string, productFolder: string) =>
    api.post<PrototypeShare>(`/v1/workspaces/${workspaceId}/product-space/share`, {
      product_folder: productFolder,
    }),

  /** 将 /proto-make 生成的原型工程目录采纳到产品空间。
   * 若提供 workitemId，导入后会自动将原型关联到该需求并生成一次产品设计版本。 */
  importPrototype: (workspaceId: string, folder: string, workitemId?: string) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/product-space/import-prototype`, { folder, workitemId }),

  /** 将用户个人工作目录中的文档文件采纳到产品空间 docs 目录。
   * 若目标路径已存在则更新内容并创建新版本，否则新建 doc 条目。
   * 若提供 workitemId，会自动将文档关联到该需求并生成一次产品设计版本。 */
  importDoc: (workspaceId: string, path: string, workitemId?: string, folder?: string) =>
    api.post<ProductSpaceItem>(`/v1/workspaces/${workspaceId}/product-space/import-doc`, { path, workitemId, folder }),

  /** 查询指定源文件路径是否已被采纳到产品空间。 */
  importDocStatus: (workspaceId: string, path: string) =>
    api.get<{ adopted: boolean; item: ProductSpaceItem | null }>(
      `/v1/workspaces/${workspaceId}/product-space/import-doc/status?path=${encodeURIComponent(path)}`
    ),

  /** 按流程所有者身份导入流程交付物并创建需求级分享链接，无需 PM 权限。 */
  shareProcessDeliverable: (processId: string, req: { type: 'file' | 'project'; path: string }) =>
    api.post<RequirementShare>(`/v1/processes/${processId}/deliverables/share`, req),
};

/** 原型产品分享记录。 */
export interface PrototypeShare {
  token: string;
  workspaceId: string;
  userId: string;
  productFolder: string;
  createdAt: string;
}

/** 分享页面对外暴露的单个原型页面信息。 */
export interface SharedPrototypePage {
  itemId: string;
  title: string;
  relativePath: string;
}

/** 免登录分享落地页视图：产品名 + 该产品下全部原型页面列表。 */
export interface SharedPrototypeView {
  productFolder: string;
  pages: SharedPrototypePage[];
}

/** 原型分享公开 API（免登录）。 */
export const prototypeShareApi = {
  /** 获取分享产品信息与页面列表。 */
  getView: (token: string) =>
    api.get<SharedPrototypeView>(`/v1/prototype-shares/${token}`),

  /** 获取指定页面的批注列表。 */
  listComments: (token: string, itemId: string) =>
    api.get<PrototypeComment[]>(`/v1/prototype-shares/${token}/pages/${itemId}/comments`),

  /** 构造分享页文件的 serve URL（iframe src 直接使用，免登录）。 */
  serveUrl: (token: string, relativePath: string) =>
    `/api/v1/prototype-shares/${token}/files/${encodeURI(relativePath)}`,
};

/** 在产品空间目录树中按原型条目 ID 查找所属产品名称。 */
export function findPrototypeProductName(tree: ProductSpaceTreeNode[], itemId: string): string | null {
  const prototypesRoot = tree.find(n => n.name === 'prototypes');
  if (!prototypesRoot?.children) return null;
  for (const product of prototypesRoot.children) {
    for (const child of product.children ?? []) {
      if (child.id === itemId) return product.name;
      const found = (child.children ?? []).find(p => p.id === itemId);
      if (found) return product.name;
    }
  }
  return null;
}

/** 需求级统一分享记录。 */
export interface RequirementShare {
  token: string;
  workspaceId: string;
  userId: string;
  title: string;
  docId: string;
  productFolder: string;
  allowComments: boolean;
  createdAt: string;
}

/** 需求分享落地页中的文档信息。 */
export interface SharedDocInfo {
  title: string;
  content: string;
  version: number;
  publishedAt: string;
  createdByName?: string;
}

/** 需求分享文档批注新增请求。 */
export interface AddRequirementShareDocCommentRequest {
  authorName: string;
  quoteText: string;
  content: string;
}

/** 需求级统一分享落地页视图：文档 + 原型。 */
export interface SharedRequirementView {
  title: string;
  allowComments: boolean;
  doc?: SharedDocInfo;
  prototype?: SharedPrototypeView;
}

/** 需求级统一分享 API。 */
export const requirementShareApi = {
  /** 创建需求级统一分享链接（文档+原型，需 PM 权限）。 */
  create: (workspaceId: string, req: { title: string; docId?: string; productFolder?: string; allowComments?: boolean }) =>
    api.post<RequirementShare>(`/v1/workspaces/${workspaceId}/requirement-shares`, req),

  /** 获取或创建需求级统一分享链接（无需 PM 权限，任意成员可用）。 */
  getOrCreateView: (workspaceId: string, params: { docId?: string; productFolder?: string; protoItemId?: string; title?: string; allowComments?: boolean }) => {
    const query = new URLSearchParams();
    if (params.docId) query.set('doc_id', params.docId);
    if (params.productFolder) query.set('product_folder', params.productFolder);
    if (params.protoItemId) query.set('proto_item_id', params.protoItemId);
    if (params.title) query.set('title', params.title);
    if (params.allowComments) query.set('allow_comments', 'true');
    return api.get<RequirementShare>(`/v1/workspaces/${workspaceId}/requirement-shares/view?${query.toString()}`);
  },

  /** 免登录获取需求级统一分享视图。 */
  getView: (token: string) =>
    api.get<SharedRequirementView>(`/v1/requirement-shares/${token}`),

  /** 构造需求分享中原型文件的 serve URL。 */
  serveUrl: (token: string, relativePath: string) =>
    `/api/v1/requirement-shares/${token}/files/${encodeURI(relativePath)}`,

  /** 获取需求分享中指定原型页面的批注列表（免登录）。 */
  listComments: (token: string, itemId: string) =>
    api.get<PrototypeComment[]>(`/v1/requirement-shares/${token}/pages/${itemId}/comments`),

  /** 为需求分享中的原型页面添加批注（免登录）。 */
  addPrototypeComment: (token: string, itemId: string, req: AddCommentRequest) =>
    api.post<PrototypeComment>(`/v1/requirement-shares/${token}/pages/${itemId}/comments`, req),

  /** 获取需求分享中文档的批注列表（免登录）。 */
  listDocComments: (token: string) =>
    api.get<ShareComment[]>(`/v1/requirement-shares/${token}/doc-comments`),

  /** 为需求分享中的文档添加文本批注（免登录）。 */
  addDocComment: (token: string, req: AddRequirementShareDocCommentRequest) =>
    api.post<ShareComment>(`/v1/requirement-shares/${token}/doc-comments`, req),
};
