import { api } from './api';

export interface FileContent {
  path: string;
  name: string;
  content: string;
  language: string;
  encoding: string;
  size: number;
  baseName?: string;
  ext?: string;
  version?: number;
  versions?: FileVersionInfo[];
}

export interface FileVersionInfo {
  version: number;
  name: string;
  path: string;
  size: number;
}

export const fileApi = {
  /**
   * 读取指定路径的文件内容（用于预览）。
   * 响应中包含版本信息和版本列表。
   */
  content: (path: string) =>
    api.get<FileContent>(`/v1/files/content?path=${encodeURIComponent(path)}`),

  /**
   * 查询指定文件的所有版本列表。
   */
  versions: (path: string) =>
    api.get<{ versions: FileVersionInfo[] }>(`/v1/files/versions?path=${encodeURIComponent(path)}`),

  /**
   * 构造文件下载 URL。
   */
  downloadUrl: (path: string) => `/api/v1/files/download?path=${encodeURIComponent(path)}`,

  /**
   * 写入文件内容到磁盘（PUT 请求，用于 PRD 等文件的编辑保存）。
   */
  save: (path: string, content: string) =>
    api.post<{ status: string; path: string; written: number }>('/v1/files/content', { path, content }),

  /**
   * 删除指定文件（DELETE 请求）。
   */
  delete: (path: string) =>
    api.delete<{ status: string; path: string }>(`/v1/files/content?path=${encodeURIComponent(path)}`),

  /**
   * 保存文件到飞书知识库（占位接口，待接入真实飞书 API）。
   */
  saveToFeishu: (path: string) =>
    api.post<{ message: string }>(`/v1/files/save-to-feishu?path=${encodeURIComponent(path)}`),
};
