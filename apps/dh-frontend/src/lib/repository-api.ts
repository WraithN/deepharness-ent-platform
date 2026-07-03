import { api } from './api';
import type { WorkspaceRepository } from '@/types';

export interface CreateRepositoryRequest {
  url: string;
  type: WorkspaceRepository['type'];
  defaultBranch?: string;
}

export interface UpdateRepositoryRequest {
  url?: string;
  type?: WorkspaceRepository['type'];
  defaultBranch?: string;
}

export interface FileContent {
  path: string;
  name: string;
  content: string;
  language: string;
  encoding: string;
  size: number;
}

export interface UserRepoStatus {
  repositoryId: string;
  name: string;
  url: string;
  type: string;
  defaultBranch: string;
  synced: boolean;
  syncStatus: string;
  progress: number;
}

export const repositoryApi = {
  list: (workspaceId: string) =>
    api.get<WorkspaceRepository[]>(`/v1/workspaces/${workspaceId}/repositories`),
  get: (workspaceId: string, repoId: string) =>
    api.get<WorkspaceRepository>(`/v1/workspaces/${workspaceId}/repositories/${repoId}`),
  create: (workspaceId: string, req: CreateRepositoryRequest) =>
    api.post<WorkspaceRepository>(`/v1/workspaces/${workspaceId}/repositories`, req),
  update: (workspaceId: string, repoId: string, req: UpdateRepositoryRequest) =>
    api.patch<WorkspaceRepository>(`/v1/workspaces/${workspaceId}/repositories/${repoId}`, req),
  delete: (workspaceId: string, repoId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/repositories/${repoId}`),
  sync: (workspaceId: string, repoId: string) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/sync`),
  /**
   * 获取仓库指定路径的文件内容。
   */
  content: (workspaceId: string, repoId: string, path: string) =>
    api.get<FileContent>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/content?path=${encodeURIComponent(path)}`),
  /**
   * 列出工作空间下所有配置仓库在当前用户 projects 目录中的同步状态。
   */
  listUserRepos: (workspaceId: string) =>
    api.get<UserRepoStatus[]>(`/v1/workspaces/${workspaceId}/user-repos`),
  /**
   * 将指定仓库同步到当前用户的 projects 目录。
   */
  syncUserRepo: (workspaceId: string, repoId: string) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/user-repos/${repoId}/sync`),
};
