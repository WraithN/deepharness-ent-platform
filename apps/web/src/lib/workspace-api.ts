import { api } from './api';
import type {
  Workspace,
  WorkspaceMember,
  DemandProject,
  WorkspaceStandard,
  WorkspaceCICD,
  WorkspaceAgent,
} from '@/types';

export const workspaceApi = {
  list: (tenantId: string) => api.get<Workspace[]>(`/v1/workspaces?tenantId=${tenantId}`),
  create: (req: { tenantId: string; name: string; description?: string; ownerUserId: string }) =>
    api.post<Workspace>('/v1/workspaces', req),
  get: (id: string) => api.get<Workspace>(`/v1/workspaces/${id}`),

  members: (workspaceId: string) => api.get<WorkspaceMember[]>(`/v1/workspaces/${workspaceId}/members`),
  addMember: (workspaceId: string, req: { userId: string; role: string; subRole?: string }) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/members`, req),
  removeMember: (workspaceId: string, userId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/members/${userId}`),

  getDemandProject: (workspaceId: string) =>
    api.get<DemandProject>(`/v1/workspaces/${workspaceId}/demand-project`),
  setDemandProject: (workspaceId: string, req: Partial<DemandProject>) =>
    api.post<DemandProject>(`/v1/workspaces/${workspaceId}/demand-project`, req),

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
};
