import type {
  AgentPolicy,
  PaginatedList,
  PromptCategory,
  WorkitemPlatform,
  WorkitemProject,
  Workspace,
  WorkspaceAgent,
  WorkspaceCICD,
  WorkspaceMember,
  WorkspacePrompt,
  WorkspaceStandard,
} from '@/types';
import { api } from './api';

export const workspaceApi = {
  list: (tenantId: string, page = 1, pageSize = 10) =>
    api.get<PaginatedList<Workspace>>(`/v1/workspaces?tenantId=${tenantId}&page=${page}&pageSize=${pageSize}`),
  create: (req: {
    tenantId: string;
    name: string;
    description?: string;
    ownerUserId: string;
    subRole?: string;
    sourceWorkspaceId?: string;
    agentPolicy?: AgentPolicy;
  }) => api.post<Workspace>('/v1/workspaces', req),
  get: (id: string) => api.get<Workspace>(`/v1/workspaces/${id}`),
  update: (id: string, req: Partial<Workspace> & { agentPolicy?: AgentPolicy }) =>
    api.put<Workspace>(`/v1/workspaces/${id}`, req),
  delete: (id: string) => api.delete<void>(`/v1/workspaces/${id}`),

  members: (workspaceId: string) => api.get<WorkspaceMember[]>(`/v1/workspaces/${workspaceId}/members`),
  addMember: (workspaceId: string, req: { userId: string; role: string; subRole?: string }) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/members`, req),
  updateMemberRole: (workspaceId: string, userId: string, req: { role: string; subRole?: string }) =>
    api.put<void>(`/v1/workspaces/${workspaceId}/members/${userId}`, req),
  removeMember: (workspaceId: string, userId: string, assetAssigneeId?: string) => {
    const query = assetAssigneeId ? `?assetAssigneeId=${encodeURIComponent(assetAssigneeId)}` : '';
    return api.delete<void>(`/v1/workspaces/${workspaceId}/members/${userId}${query}`);
  },

  getWorkitemProject: (workspaceId: string) =>
    api.get<WorkitemProject>(`/v1/workspaces/${workspaceId}/workitem-project`),
  /** 需求管理平台元信息（来自后端 config.yaml 的 workitem.platforms 配置）。 */
  listWorkitemPlatforms: () => api.get<WorkitemPlatform[]>('/v1/workitem-platforms'),
  setWorkitemProject: (workspaceId: string, req: Partial<WorkitemProject>) =>
    api.post<WorkitemProject>(`/v1/workspaces/${workspaceId}/workitem-project`, req),

  listAgents: (workspaceId: string) => api.get<WorkspaceAgent[]>(`/v1/workspaces/${workspaceId}/agents`),

  listStandards: (workspaceId: string, repositoryId?: string) =>
    api.get<WorkspaceStandard[]>(`/v1/workspaces/${workspaceId}/standards${repositoryId ? `?repositoryId=${repositoryId}` : ''}`),
  saveStandard: (workspaceId: string, req: Partial<WorkspaceStandard>) =>
    api.post<WorkspaceStandard>(`/v1/workspaces/${workspaceId}/standards`, req),
  deleteStandard: (workspaceId: string, id: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/standards/${id}`),
  /** 智能生成规范：根据文字描述调用默认 agent 生成 Markdown 规范文档（不落库）。 */
  generateStandard: (workspaceId: string, req: { kind: 'coding' | 'design'; prompt: string }) =>
    api.post<{ content: string }>(`/v1/workspaces/${workspaceId}/standards/generate`, req),

  getCICD: (workspaceId: string) => api.get<WorkspaceCICD>(`/v1/workspaces/${workspaceId}/cicd`),
  saveCICD: (workspaceId: string, req: Partial<WorkspaceCICD>) =>
    api.post<WorkspaceCICD>(`/v1/workspaces/${workspaceId}/cicd`, req),

  listPrompts: (workspaceId: string) => api.get<WorkspacePrompt[]>(`/v1/workspaces/${workspaceId}/prompts`),
  addPrompt: (workspaceId: string, libraryPromptId: string) =>
    api.post<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts`, { libraryPromptId }),
  removePrompt: (workspaceId: string, promptId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/prompts/${promptId}`),
  updatePromptCategories: (workspaceId: string, promptId: string, categoryIds: string[]) =>
    api.patch<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts/${promptId}`, { categoryIds }),
  updatePromptEnabled: (workspaceId: string, promptId: string, enabled: boolean) =>
    api.patch<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts/${promptId}`, { enabled }),
  // 更新自定义提示词内容（市场来源快照不可改，后端会拒绝）
  updatePromptContent: (
    workspaceId: string,
    promptId: string,
    req: { name: string; description: string; content: string; useCase: string },
  ) => api.patch<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts/${promptId}`, req),
  // 使用次数上报：空间提示词 +1，市场来源则市场提示词同步 +1
  recordPromptUsage: (workspaceId: string, promptId: string) =>
    api.post<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts/${promptId}/use`),
  // 复制为空间内可编辑的自定义副本
  copyPrompt: (workspaceId: string, promptId: string) =>
    api.post<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts/${promptId}/copy`),
  // 分享自定义提示词到市场（进入 pending_review 审核）
  sharePrompt: (workspaceId: string, promptId: string) =>
    api.post<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts/${promptId}/share`),

  listPromptCategories: (workspaceId: string) => api.get<PromptCategory[]>(`/v1/workspaces/${workspaceId}/prompt-categories`),
  createPromptCategory: (workspaceId: string, name: string) =>
    api.post<PromptCategory>(`/v1/workspaces/${workspaceId}/prompt-categories`, { name }),
  deletePromptCategory: (workspaceId: string, categoryId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/prompt-categories/${categoryId}`),
};
