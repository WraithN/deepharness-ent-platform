/**
 * 流程（Process）API 封装
 * 后端模块：apps/dh-backend/domain/process
 */
import { api } from './api';

// ── 类型定义 ──

export interface ProcessStage {
  name: string;
  label: string;
  status: string;
  stageType?: string;
  sessionId?: string;
  prompt?: string;
  inputPrompt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  operatorType?: string;
  operatorName?: string;
  operatorId?: string;
  agentRole?: string;
  inputDesc?: string;
  extraInputDesc?: string;
  extraInput?: string;
  outputDesc?: string;
  retryCount?: number;
}

export interface Process {
  id: string;
  workspaceId: string;
  workitemId: string;
  title: string;
  type: string;
  stages: ProcessStage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// ── 常量 ──

export const STAGE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export const STAGE_NAMES = {
  REQUIREMENT: 'requirement',
  REQUIREMENT_EVAL: 'requirement_eval',
  ARCH_DESIGN: 'arch_design',
  AI_EVAL: 'ai_eval',
  HUMAN_AUDIT: 'human_audit',
  DEVELOPMENT: 'development',
  REVIEW: 'review',
  HUMAN_REVIEW: 'human_review',
  DEV_COMPLETE: 'dev_complete',
  TEST_REQUIREMENT: 'test_requirement',
  TEST_PLAN_DESIGN: 'test_plan_design',
  TEST_PLAN_REVIEW: 'test_plan_review',
  TEST_CASE_GEN: 'test_case_gen',
  TEST_CASE_REVIEW: 'test_case_review',
  TEST_AUTO_EXEC: 'test_auto_exec',
  TEST_DEFECT_VERIFY: 'test_defect_verify',
  TEST_ADMISSION_REVIEW: 'test_admission_review',
  TEST_COMPLETE: 'test_complete',
  PRODUCT_BRAINSTORM: 'product_brainstorm',
  PRODUCT_BREAKDOWN: 'product_breakdown',
  PRODUCT_RESEARCH: 'product_research',
  PRODUCT_DRAFT: 'product_draft',
  PRODUCT_AI_DRAFT_REVIEW: 'product_ai_draft_review',
  PRODUCT_REVIEW: 'product_review',
  PRODUCT_AI_GATEWAY: 'product_ai_gateway',
  PRODUCT_PROTO_MAKE: 'product_proto_make',
  PRODUCT_PROTO_REVIEW: 'product_proto_review',
  PRODUCT_PRD_WRITE: 'product_prd_write',
  PRODUCT_FINAL_REVIEW: 'product_final_review',
} as const;

export const PROCESS_TYPE_LABELS: Record<string, string> = {
  ai_dev: 'AI 开发',
  auto_test: '自动化测试',
  auto_test_asset: '测试资产',
  auto_test_execution: '测试执行',
  product: 'AI 需求设计',
};

/** 流程列表轮询间隔（毫秒） */
export const PROCESS_POLL_INTERVAL_MS = 5000;

/** 流程列表每页条数 */
export const PROCESS_PAGE_SIZE = 10;

export const OPERATOR_TYPE = {
  HUMAN: 'human',
  AI: 'ai',
} as const;

export const STAGE_TYPE = {
  ACTION: 'action',
  JUDGE: 'judge',
  GATEWAY: 'gateway',
} as const;

export const AGENT_ROLE_LABELS: Record<string, string> = {
  '开发助理': 'AI开发数字分身',
  '评审助理': 'AI评审数字分身',
  '优化助理': 'AI优化数字分身',
};

// ── API ──

export interface StartProductFlowRequest {
  workspaceId: string;
  tenantId?: string;
  workitemId: string;
  workitemTitle: string;
  workitemDesc: string;
  /** 发起流程时关联的头脑风暴源文档路径（头脑风暴节点复用其内容，不实际发起头脑风暴） */
  docPath?: string;
}

export const processApi = {
  /** 列出工作空间下全部流程 */
  list: (workspaceId: string) =>
    api.get<Process[]>(`/v1/processes?workspaceId=${encodeURIComponent(workspaceId)}`),

  /** 按 ID 获取流程详情 */
  getById: (id: string) =>
    api.get<Process>(`/v1/processes/${encodeURIComponent(id)}`),

  /** 启动产品流程 */
  startProductFlow: (req: StartProductFlowRequest) =>
    api.post<{ code: number; message: string; processId: string }>('/v1/orchestrator/product-flow', req),

  /** 重试产品流程的失败节点 */
  retryProductFlow: (processId: string) =>
    api.post<{ code: number; message: string; processId: string }>(`/v1/processes/${encodeURIComponent(processId)}/retry`),

  /** 检查是否存在进行中的流程 */
  activeCheck: (workitemId: string, docPath: string) =>
    api.get<{ hasActive: boolean; activeProcess: Process | null }>(
      `/v1/processes/active-check?workitemId=${encodeURIComponent(workitemId)}&docPath=${encodeURIComponent(docPath)}`,
    ),

  /** 终止进行中的流程 */
  terminateProcess: (processId: string) =>
    api.post<Process>(`/v1/processes/${encodeURIComponent(processId)}/terminate`),

  /** AI 草案复核人工通过/拒绝 */
  aiDraftReview: (processId: string, approved: boolean) =>
    api.post<{ code: number; message: string }>(`/v1/processes/${encodeURIComponent(processId)}/ai-draft-review`, { approved }),
};

export const sessionApi = {
  /** 获取会话的历史消息 */
  getMessages: (sessionId: string, workspaceId: string) =>
    api.get<ChatMessage[]>(`/v1/sessions/${encodeURIComponent(sessionId)}/messages?workspaceId=${encodeURIComponent(workspaceId)}`),
};
