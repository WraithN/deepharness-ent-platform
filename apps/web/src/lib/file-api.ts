import { api } from './api';

export interface FileContent {
  path: string;
  name: string;
  content: string;
  language: string;
  encoding: string;
  size: number;
}

export const fileApi = {
  /**
   * 读取指定路径的文件内容（用于预览）。
   */
  content: (path: string) =>
    api.get<FileContent>(`/v1/files/content?path=${encodeURIComponent(path)}`),

  /**
   * 构造文件下载 URL。
   */
  downloadUrl: (path: string) => `/api/v1/files/download?path=${encodeURIComponent(path)}`,

  /**
   * 保存文件到飞书知识库（占位接口，待接入真实飞书 API）。
   */
  saveToFeishu: (path: string) =>
    api.post<{ message: string }>(`/v1/files/save-to-feishu?path=${encodeURIComponent(path)}`),
};
