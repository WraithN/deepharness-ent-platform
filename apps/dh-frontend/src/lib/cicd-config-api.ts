import { api } from './api';
import type { CICDConfig } from '@/types';

export interface CICDConfigRequest {
  name: string;
  triggerBranches: string;
  webhookUrl: string;
  script: string;
  config?: Record<string, unknown>;
}

export const cicdConfigApi = {
  list: () => api.get<CICDConfig[]>('/v1/cicd-configs'),
  get: (id: string) => api.get<CICDConfig>(`/v1/cicd-configs/${id}`),
  create: (req: CICDConfigRequest) => api.post<CICDConfig>('/v1/cicd-configs', req),
  update: (id: string, req: CICDConfigRequest) => api.put<CICDConfig>(`/v1/cicd-configs/${id}`, req),
  delete: (id: string) => api.delete<void>(`/v1/cicd-configs/${id}`),
};
