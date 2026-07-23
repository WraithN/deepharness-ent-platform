/**
 * 原型工程模版 API：管理后台「元数据管理 > 原型模版管理」使用。
 * 模版源码存放在服务端 ${workspace_root}/shares/prototypes-templates/{id}/，元数据存数据库。
 */

import { api } from './api';

/** 原型工程模版 API 基础路径。 */
const PROTO_TEMPLATES_API_PATH = '/v1/proto-templates';

/** 模版状态。 */
export type PrototypeTemplateStatus = 'pending' | 'installing' | 'ready' | 'error';

export interface PrototypeTemplate {
  id: number;
  name: string;
  description: string;
  tags: string;
  dirPath: string;
  status: PrototypeTemplateStatus;
  hasNodeModules: boolean;
  installLog: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePrototypeTemplateRequest {
  name: string;
  description: string;
  tags: string;
}

/** 状态 -> 中文标签。 */
export const STATUS_LABELS: Record<PrototypeTemplateStatus, string> = {
  pending: '待安装',
  installing: '安装中',
  ready: '就绪',
  error: '失败',
};

export const prototypeTemplateApi = {
  list: () => api.get<PrototypeTemplate[]>(PROTO_TEMPLATES_API_PATH),
  get: (id: number) => api.get<PrototypeTemplate>(`${PROTO_TEMPLATES_API_PATH}/${id}`),
  /** 上传 zip 源码包并创建模版（multipart/form-data）。 */
  upload: (form: FormData) => api.postForm<PrototypeTemplate>(PROTO_TEMPLATES_API_PATH, form),
  update: (id: number, req: UpdatePrototypeTemplateRequest) =>
    api.put<PrototypeTemplate>(`${PROTO_TEMPLATES_API_PATH}/${id}`, req),
  delete: (id: number) => api.delete<void>(`${PROTO_TEMPLATES_API_PATH}/${id}`),
  /** 安装/更新依赖（同步返回，含 installLog）。 */
  install: (id: number) => api.post<PrototypeTemplate>(`${PROTO_TEMPLATES_API_PATH}/${id}/install`),
};
