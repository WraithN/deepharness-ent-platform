import { api } from './api';

export type ArchDrillLevel = 'libraries' | 'modules' | 'classes';

export interface ArchNode {
  id: string;
  label: string;
  kind: string;
  meta?: Record<string, string>;
}
export interface ArchEdge {
  source: string;
  target: string;
  label: string;
  kind: string;
}

export interface ArchGraphResponse {
  configured: boolean;
  cloned: boolean;
  repoId?: string;
  repoName?: string;
  drillLevel?: ArchDrillLevel;
  lib?: string;
  module?: string;
  nodes?: ArchNode[];
  edges?: ArchEdge[];
  warnings?: string[];
}

export interface ArchOverview {
  key: string;
  name: string;
  positioning: string;
  architecture: string;
  techStack: string[];
  coreModules: { key: string; role: string }[];
}

export interface ArchParseStatus {
  parsing: boolean;
  parsed: boolean;
  warnings?: string[];
}

const ARCH_GRAPH_TIMEOUT_MS = 15000;

export const archApi = {
  graph: (workspaceId: string, params: { level: ArchDrillLevel; lib?: string; module?: string }) =>
    api.get<ArchGraphResponse>(
      `/v1/workspaces/${workspaceId}/arch/graph?level=${params.level}` +
      (params.lib ? `&lib=${encodeURIComponent(params.lib)}` : '') +
      (params.module ? `&module=${encodeURIComponent(params.module)}` : ''),
      // 大图场景（L3 类视图）响应较慢，超时后中断请求避免请求悬挂。
      { signal: AbortSignal.timeout(ARCH_GRAPH_TIMEOUT_MS) },
    ),
  overview: (workspaceId: string, lib: string) =>
    api.get<ArchOverview>(`/v1/workspaces/${workspaceId}/arch/overview?lib=${encodeURIComponent(lib)}`),
  // 后端解析触发返回 202 Accepted（无 JSON body），故返回类型为 void；解析进度由 parseStatus 轮询获取。
  parse: (workspaceId: string) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/arch/parse`, {}),
  parseStatus: (workspaceId: string) =>
    api.get<ArchParseStatus>(`/v1/workspaces/${workspaceId}/arch/parse/status`),
};
