import { api } from './api';
import type { AgentType, WorkspaceAgentConfig, AvailableAgent } from '@/types';

export interface SaveWorkspaceAgentConfigRequest {
  agentKey: string;
  enabled: boolean;
  model: string;
  modelSource: 'builtin' | 'custom';
  baseUrl: string;
  apiKey: string;
  temperature?: number;
  advancedConfig?: {
    maxTokens?: number;
    contextWindow?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    extra?: Record<string, unknown>;
  };
}

export const agentConfigApi = {
  listAgentTypes: () => api.get<AgentType[]>('/v1/agent-types'),

  updateAgentType: (key: string, enabled: boolean) =>
    api.put<AgentType>(`/v1/agent-types/${key}`, { enabled }),

  listGlobalModels: () => api.get<string[]>('/v1/agent-models'),

  listWorkspaceConfigs: (workspaceId: string) =>
    api.get<WorkspaceAgentConfig[]>(`/v1/workspaces/${workspaceId}/agent-configs`),

  saveWorkspaceConfig: (workspaceId: string, req: SaveWorkspaceAgentConfigRequest) =>
    api.put<WorkspaceAgentConfig>(`/v1/workspaces/${workspaceId}/agent-configs/${req.agentKey}`, req),

  listAvailableAgents: (workspaceId: string) =>
    api.get<AvailableAgent[]>(`/v1/workspaces/${workspaceId}/available-agents`),
};
