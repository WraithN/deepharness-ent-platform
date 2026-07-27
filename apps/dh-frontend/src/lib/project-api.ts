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
  htmlCount: number;
  dirSize: number;
  projectName: string;
}

/** 单个文件的 diff 信息（用于 side-by-side 对比视图） */
export interface FileDiffEntry {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  oldContent: string;
  newContent: string;
}

/** 工程 diff 响应 */
export interface ProjectDiffResponse {
  diff: string;
  hasChanges: boolean;
  files?: FileDiffEntry[];
}

/** 同步工程请求 */
export interface ProjectSyncRequest {
  path: string;
  workspaceId?: string;
  commitMsg?: string;
  remoteUrl?: string;
  remoteBranch?: string;
  sshKey?: string;
  remoteName?: string;
}

/** 同步工程响应 */
export interface ProjectSyncResponse {
  status: string;
  path: string;
  projectName: string;
  commitHash: string;
  message: string;
  pushed?: boolean;
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

  /** 启动项目预览（dev server） */
  startPreview: (path: string) =>
    api.post<{ port: number; isFrontend: boolean }>('/v1/preview/start', { path }),

  /** 停止项目预览 */
  stopPreview: (path: string) =>
    api.post<void>('/v1/preview/stop', { path }),

  /** 查询项目预览状态 */
  previewStatus: (path: string) =>
    api.get<{ running: boolean; port: number }>(`/v1/preview/status?path=${encodeURIComponent(path)}`),
};
