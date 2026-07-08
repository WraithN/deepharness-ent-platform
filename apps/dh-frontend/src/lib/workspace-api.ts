import { api } from './api';
import type {
  Workspace,
  WorkspaceMember,
  WorkitemProject,
  WorkspaceStandard,
  WorkspaceCICD,
  WorkspaceAgent,
  WorkspacePrompt,
  PromptCategory,
  AgentPolicy,
  PaginatedList,
} from '@/types';

export const workspaceApi = {
  list: (tenantId: string, page = 1, pageSize = 10) =>
    api.get<PaginatedList<Workspace>>(`/v1/workspaces?tenantId=${tenantId}&page=${page}&pageSize=${pageSize}`),
  create: (req: {
    tenantId: string;
    name: string;
    description?: string;
    ownerUserId: string;
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
  setWorkitemProject: (workspaceId: string, req: Partial<WorkitemProject>) =>
    api.post<WorkitemProject>(`/v1/workspaces/${workspaceId}/workitem-project`, req),

  listAgents: (workspaceId: string) => api.get<WorkspaceAgent[]>(`/v1/workspaces/${workspaceId}/agents`),

  listStandards: (workspaceId: string, repositoryId?: string) =>
    api.get<WorkspaceStandard[]>(`/v1/workspaces/${workspaceId}/standards${repositoryId ? `?repositoryId=${repositoryId}` : ''}`),
  saveStandard: (workspaceId: string, req: Partial<WorkspaceStandard>) =>
    api.post<WorkspaceStandard>(`/v1/workspaces/${workspaceId}/standards`, req),
  deleteStandard: (workspaceId: string, id: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/standards/${id}`),

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

  listPromptCategories: (workspaceId: string) => api.get<PromptCategory[]>(`/v1/workspaces/${workspaceId}/prompt-categories`),
  createPromptCategory: (workspaceId: string, name: string) =>
    api.post<PromptCategory>(`/v1/workspaces/${workspaceId}/prompt-categories`, { name }),
  deletePromptCategory: (workspaceId: string, categoryId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/prompt-categories/${categoryId}`),
};
