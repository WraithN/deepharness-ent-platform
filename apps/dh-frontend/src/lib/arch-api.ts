import { api } from './api';

// ── 架构设计图数据类型（与后端 domain/repository/arch_handler.go 响应结构对应）──

/** 节点类型：repo=业务仓库 service=微服务 domain=业务领域 infra=基础组件。 */
export type ArchNodeKind = 'repo' | 'service' | 'domain' | 'infra';

/** 依赖边类型：rpc=RPC调用 mq=MQ消息 db=DB共享。 */
export type ArchEdgeKind = 'rpc' | 'mq' | 'db';

export interface ArchNode {
  id: string;
  label: string;
  kind: ArchNodeKind;
  businessLine?: string;
  meta?: Record<string, string>;
}

export interface ArchEdge {
  source: string;
  target: string;
  label: string;
  kind: ArchEdgeKind;
}

export interface ArchView {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

/** 视图模式：project=工程全景 service=服务依赖 ddd=业务领域。 */
export type ArchViewMode = 'project' | 'service' | 'ddd';

export interface ArchDomainOption {
  key: string;
  name: string;
}

export interface ArchGraphResponse {
  configured: boolean;
  cloned: boolean;
  repoId?: string;
  repoName?: string;
  views?: Record<ArchViewMode, ArchView>;
  domains?: ArchDomainOption[];
  warnings?: string[];
}

export const archApi = {
  graph: (workspaceId: string) =>
    api.get<ArchGraphResponse>(`/v1/workspaces/${workspaceId}/arch/graph`),
};
