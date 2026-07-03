import { api } from './api';

/** 工程文件树节点 */
export interface ProjectFileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: ProjectFileNode[];
}

/** 工程检查响应 */
export interface ProjectCheckResponse {
  isNew: boolean;
  hasDiff: boolean;
  fileCount: number;
  dirSize: number;
  projectName: string;
}

/** 工程 diff 响应 */
export interface ProjectDiffResponse {
  diff: string;
  hasChanges: boolean;
}

/** 同步工程请求 */
export interface ProjectSyncRequest {
  path: string;
  workspaceId?: string;
  commitMsg?: string;
}

/** 同步工程响应 */
export interface ProjectSyncResponse {
  status: string;
  path: string;
  projectName: string;
  commitHash: string;
  message: string;
}

export const projectApi = {
  /** 获取工程文件树 */
  tree: (path: string) =>
    api.get<ProjectFileNode[]>(`/v1/projects/tree?path=${encodeURIComponent(path)}`),

  /** 获取工程 git diff */
  diff: (path: string) =>
    api.get<ProjectDiffResponse>(`/v1/projects/diff?path=${encodeURIComponent(path)}`),

  /**
   * 检查工程状态：新建或已有。
   * 新建工程会自动初始化 git 仓库并提交基线。
   */
  check: (path: string) =>
    api.get<ProjectCheckResponse>(`/v1/projects/check?path=${encodeURIComponent(path)}`),

  /** 同步工程：提交所有更改并初始化 git（如果尚未初始化） */
  sync: (req: ProjectSyncRequest) =>
    api.post<ProjectSyncResponse>('/v1/projects/sync', req),
};
