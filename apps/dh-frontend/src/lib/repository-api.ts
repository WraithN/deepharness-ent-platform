import type { WorkspaceRepository } from '@/types';
import { api } from './api';
import type { BranchInfoDTO } from './api-types';

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

/** 仓库规范文件（AGENTS.md / DESIGN.md）状态与内容。 */
export interface RepoStandardFiles {
  cloned: boolean;
  hasFrontend: boolean;
  hasAgentsMd: boolean;
  hasDesignMd: boolean;
  agentsMd?: string;
  designMd?: string;
  /** 智能检测/生成过程中单个文件失败的降级提示。 */
  warnings?: string[];
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
   * 设置仓库远程 origin URL 并同步更新本地仓库 remote。
   */
  setRemoteURL: (workspaceId: string, repoId: string, url: string) =>
    api.post<{ status: string }>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/remote`, { url }),
  /**
   * 推送仓库当前分支到远程 origin。
   */
  push: (workspaceId: string, repoId: string) =>
    api.post<{ status: string }>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/push`),
  /**
   * 获取本地仓库尚未推送到远程的提交数量。
   */
  unpushedCommits: (workspaceId: string, repoId: string) =>
    api.get<{ count: number }>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/unpushed`),
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
  /**
   * 强制从 git 远端刷新仓库分支列表并更新缓存。
   * 与 branches 接口不同，此接口始终触发 git fetch。
   */
  refreshBranches: (workspaceId: string, repoId: string) =>
    api.post<BranchInfoDTO[]>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/branches/refresh`),
  /** 获取仓库规范文件（AGENTS.md / DESIGN.md）状态与内容。 */
  standardFiles: (workspaceId: string, repoId: string) =>
    api.get<RepoStandardFiles>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/standard-files`),
  /** 智能检测/生成：确保克隆后调用 agent init 生成 AGENTS.md 与 DESIGN.md，返回最新状态。 */
  initStandardFiles: (workspaceId: string, repoId: string) =>
    api.post<RepoStandardFiles>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/standard-files/init`),
  /** 保存仓库内单个文件（不提交）。 */
  saveFileContent: (workspaceId: string, repoId: string, path: string, content: string) =>
    api.post<{ status: string; path: string }>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/save`, { path, content }),
  /** 提交仓库工作区全部更改（git add . + commit）。 */
  commit: (workspaceId: string, repoId: string, message: string) =>
    api.post<{ hash: string; message: string }>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/commit`, { message }),
};
