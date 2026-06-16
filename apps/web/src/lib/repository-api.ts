import { api } from './api';
import type { WorkspaceRepository } from '@/types';

export interface CreateRepositoryRequest {
  name: string;
  url: string;
  type: WorkspaceRepository['type'];
  defaultBranch?: string;
  sshKey?: string;
}

export interface UpdateRepositoryRequest {
  name?: string;
  url?: string;
  type?: WorkspaceRepository['type'];
  defaultBranch?: string;
  sshKey?: string;
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
};
