import { api } from './api';

/** Agent 运行时状态。 */
export type RuntimeStatus = 'running' | 'error' | 'stopped' | 'resource_warning';

/** 智能体实例状态。 */
export type AgentInstanceStatus = 'running' | 'error' | 'idle';

/** 运行时内部的一个智能体实例。 */
export interface AgentInstance {
  type: string;
  name: string;
  status: AgentInstanceStatus;
  callsToday: number;
  version: string;
  lastActive: string;
}

/** Agent 运行时记录。 */
export interface AgentRuntime {
  runtimeId: string;
  tenantId: string;
  tenantName: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  userName: string;
  userDisplayName: string;
  status: RuntimeStatus;
  uptimeSeconds: number;
  cpuPercent: number;
  memPercent: number;
  sandboxSpec: string;
  agents: AgentInstance[];
  reportedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** 管理后台查询运行时列表的过滤条件。 */
export interface RuntimeListFilter {
  tenantId?: string;
  workspaceId?: string;
  userId?: string;
  agentType?: string;
  page?: number;
  pageSize?: number;
}

/** 运行时列表分页结果。 */
export interface ListAgentRuntimesResult {
  list: AgentRuntime[];
  total: number;
  page: number;
  pageSize: number;
}

/** 默认分页大小。 */
export const DEFAULT_RUNTIME_PAGE_SIZE = 10;

const AGENT_RUNTIME_API_PATH = '/v1/agent-runtimes';

export const agentRuntimeApi = {
  /** 查询运行时列表（分页）。 */
  list: (filter: RuntimeListFilter = {}) => {
    const params = new URLSearchParams();
    if (filter.tenantId) params.set('tenantId', filter.tenantId);
    if (filter.workspaceId) params.set('workspaceId', filter.workspaceId);
    if (filter.userId) params.set('userId', filter.userId);
    if (filter.agentType) params.set('agentType', filter.agentType);
    params.set('page', String(filter.page ?? 1));
    params.set('pageSize', String(filter.pageSize ?? DEFAULT_RUNTIME_PAGE_SIZE));
    return api.get<ListAgentRuntimesResult>(`${AGENT_RUNTIME_API_PATH}?${params.toString()}`);
  },

  /** 查询单个运行时详情。 */
  get: (runtimeId: string) =>
    api.get<AgentRuntime>(`${AGENT_RUNTIME_API_PATH}/${encodeURIComponent(runtimeId)}`),
};

/** 状态展示映射。 */
export const RUNTIME_STATUS_LABELS: Record<RuntimeStatus, string> = {
  running: '运行中',
  error: '异常',
  stopped: '已停止',
  resource_warning: '资源告警',
};

/** 智能体类型展示映射。 */
export const AGENT_TYPE_LABELS: Record<string, string> = {
  opencode: 'OpenCode',
  codex: 'Codex',
  'claude-code': 'Claude Code',
};
