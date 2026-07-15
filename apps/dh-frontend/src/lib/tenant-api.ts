import { api } from './api';
import type { Tenant, TenantMember, AgentPolicy } from '@/types';

export const tenantApi = {
  list: () => api.get<Tenant[]>('/v1/tenants'),
  get: (id: string) => api.get<Tenant>(`/v1/tenants/${id}`),
  create: (req: { name: string; agentPolicy?: AgentPolicy }) =>
    api.post<Tenant>('/v1/tenants', req),
  update: (id: string, req: { name: string; agentPolicy?: AgentPolicy }) =>
    api.put<Tenant>(`/v1/tenants/${id}`, req),
  delete: (id: string) => api.delete<void>(`/v1/tenants/${id}`),

  members: (tenantId: string) => api.get<TenantMember[]>(`/v1/tenants/${tenantId}/members`),
  addMember: (tenantId: string, req: { email: string; name: string }) =>
    api.post<TenantMember>(`/v1/tenants/${tenantId}/members`, req),
  setAdmin: (tenantId: string, userId: string, isAdmin: boolean) =>
    api.put<void>(`/v1/tenants/${tenantId}/members/${userId}`, { isAdmin }),
};
