import '@/lib/patch-assistant-ui';
import { AssistantRuntimeProvider, type ThreadMessageLike } from '@assistant-ui/react';
import {
  BarChart3,
  BookOpen,
  Bot,
  Box,
  Bug,
  Check, 
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Code2,
  Eye,
  FileBarChart,
  FileText,
  Flame,
  FlaskConical,
  GitBranch,
  Globe,
  Info,
  Layers,
  Layout,
  LayoutTemplate,
  Lightbulb,
  ListChecks,
  ListTodo,
  Loader2,
  MessageSquarePlus,
  Palette,
  Paperclip,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Terminal,
  UploadCloud,
  Wand2,
  X
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ChatThread } from '@/components/chat/ChatThread';
import type { ReviewReportData } from '@/components/chat/ReviewReportCard';
import { parseIssuesFromMarkdown } from '@/components/chat/ReviewReportCard';
import { InlineFilePreview } from '@/components/chat/InlineFilePreview';
import { LivePreview, type PreviewMode } from '@/components/chat/LivePreview';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { UserStoryPreview } from '@/components/chat/UserStoryPreview';
import type { UserStoryData } from '@/components/chat/UserStoryCard';
import { RequirementBreakdownTree } from '@/components/chat/RequirementBreakdownCard';
import type { RequirementBreakdownData, RequirementItem } from '@/components/chat/RequirementBreakdownCard';
import { PrototypePreviewPanel } from '@/components/chat/PrototypePreviewPanel';
import { RequirementKanban } from '@/components/chat/RequirementKanban';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { type SendContext, useAgUiChat } from '@/hooks/use-ag-ui-chat';
import { agentConfigApi } from '@/lib/agent-config-api';
import { api } from '@/lib/api';
import type { AgentSessionDTO, WorkItemDTO } from '@/lib/api-types';
import {
  type CommandCategory,
  type CommandConfig,
  COMMAND_CATEGORY_LABELS,
  COMMAND_CATEGORY_ORDER,
  getCommandCategory,
} from '@/lib/commands';
import { PROTO_MAKE_PENDING_KEY } from '@/lib/constants';
import { fileApi } from '@/lib/file-api';
import { type ProductDoc, productDocApi } from '@/lib/productdoc-api';
import { sortPromptCategoriesByBuiltin } from '@/lib/prompt-categories';
import { getCommandSystemPrompts, SYSTEM_PROMPT_CATEGORY_NAME, type SystemPrompt } from '@/lib/system-prompts';
import { repositoryApi, type UserRepoStatus } from '@/lib/repository-api';
import { workItemApi, type RequirementWithDesignItems, type LinkedProductSpaceItem } from '@/lib/workitem-api';
import { SUB_ROLE, type SubRole } from '@/lib/role-constants';
import { teamApi } from '@/lib/team-api';
import { cn } from '@/lib/utils';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import { addSessionToHistory, getSessionHistory, removeSessionFromHistory, syncSessionHistory } from '@/lib/session-history-cache';
import { addInputHistory, getInputHistory } from '@/lib/input-history-cache';
import { workspaceApi } from '@/lib/workspace-api';
import type { AvailableAgent, PromptCategory, Skill, WorkspaceAgent, WorkspaceAgentConfig, WorkspacePrompt } from '@/types';

// ──────────────── Types ────────────────
type RequirementStatus = 'todo' | 'in-progress' | 'done' | 'cancelled' | 'on-hold';
type DefectStatus = 'open' | 'in-progress' | 'fixed' | 'closed';
type DefectSeverity = 'critical' | 'high' | 'medium' | 'low';
type CaseStatus = 'draft' | 'ready' | 'passed' | 'failed' | 'blocked';

type PreviewHistoryEntry =
  | { type: 'file'; path: string }
  | { type: 'project'; path: string; mode: PreviewMode }
  | { type: 'user_story'; data: UserStoryData }
  | { type: 'req_breakdown'; data: RequirementBreakdownData }
  | { type: 'prototype_preview'; path: string; requirementTitle?: string };

interface ReqItem {
  id: string; title: string; description: string;
  status: RequirementStatus; assigneeId: string; reporter: string; createdAt: string;
  parentId?: string;
  priority?: string;
}
interface DefectItem {
  id: string; title: string; description: string;
  status: DefectStatus; severity: DefectSeverity;
  assigneeId: string; reporter: string; createdAt: string;
}
interface CaseItem {
  id: string; title: string; description: string;
  status: CaseStatus; assigneeId: string; reporter: string; createdAt: string;
  steps: string[];
}

/** 根据需求标题在工作项列表中查找对应的需求 ID（大小写不敏感、忽略首尾空格）。 */
function resolveWorkitemIdByTitle(title: string | undefined, requirements: ReqItem[]): string | undefined {
  if (!title) return undefined;
  const normalized = title.trim().toLowerCase();
  if (!normalized) return undefined;
  return requirements.find(r => r.title.trim().toLowerCase() === normalized)?.id;
}


// 用户输入排队上限。
const MAX_INPUT_QUEUE = 3;
const CHAT_SYNC_POLL_INTERVAL_MS = 2000;
/** 预览报错注入会话时错误摘要的最大字符数（过长截断，完整版在剪贴板）。 */
const PREVIEW_FIX_EXCERPT_CHARS = 1500;

// 需求拆分优先级映射与约束：子需求优先级不得高于父需求。
const SPLIT_PRIORITY_TO_API: Record<string, WorkItemDTO['priority']> = { P0: 'high', P1: 'medium', P2: 'low' };
const API_PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const DEFAULT_SPLIT_PRIORITY: WorkItemDTO['priority'] = 'medium';

/** 将拆分优先级转换为 API 优先级，并限制不得超过父需求优先级。 */
function clampSplitPriority(itemPriority: string | undefined, parentPriority: string | undefined): WorkItemDTO['priority'] {
  const child = SPLIT_PRIORITY_TO_API[itemPriority || 'P2'] ?? DEFAULT_SPLIT_PRIORITY;
  if (!parentPriority || !(parentPriority in API_PRIORITY_RANK)) return child;
  if (API_PRIORITY_RANK[child] < API_PRIORITY_RANK[parentPriority]) {
    return parentPriority as WorkItemDTO['priority'];
  }
  return child;
}

/**
 * 从 question 字段文本中解析备选选项。
 * gatewayd 不转发 options 字段，agent 将选项内嵌在 question 正文中，格式：
 *   问题正文
 *   A. 选项标签 - 选项说明
 *   B. 选项标签 - 选项说明
 *
 * 只保留最终的问题文本，过滤掉前面的推理过程：
 * 从选项之前的文本中，找到最后一个以问号/全角问号结尾的行，并向上追溯到最近空行，
 * 中间的内容作为真正的问题展示。
 */
function parseInlineOptions(rawText: string): { questionText: string; options: { label: string; description?: string }[] } {
  const lines = rawText.split('\n');
  const questionLines: string[] = [];
  const options: { label: string; description?: string }[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Z])\.\s*(.+?)(?:\s*-\s*(.+))?$/);
    if (match) {
      options.push({ label: match[2].trim(), description: match[3]?.trim() });
    } else {
      questionLines.push(line);
    }
  }

  while (questionLines.length > 0 && questionLines[questionLines.length - 1].trim() === '') {
    questionLines.pop();
  }

  let lastQuestionIndex = -1;
  for (let i = questionLines.length - 1; i >= 0; i--) {
    if (/[?？]\s*$/.test(questionLines[i].trim())) {
      lastQuestionIndex = i;
      break;
    }
  }

  let questionText = questionLines.join('\n').trim();
  if (lastQuestionIndex >= 0) {
    let start = 0;
    for (let i = lastQuestionIndex - 1; i >= 0; i--) {
      if (questionLines[i].trim() === '') {
        start = i + 1;
        break;
      }
    }
    questionText = questionLines.slice(start, lastQuestionIndex + 1).join('\n').trim();
  }

  return { questionText, options };
}

/** 后端指令配置（从 /v1/commands 加载）。 */
// CommandConfig / 指令分类映射已抽取至 @/lib/commands 共享。

// 指令 -> 图标的映射（图标为 React 组件，无法放入配置文件）。
const COMMAND_ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  '/prd-write': FileText,
  '/prd-research': Globe,
  '/proto-make': LayoutTemplate,
  '/code': Code2,
  '/debug': Bug,
  '/review': CheckCircle,
  '/unit-test': FlaskConical,
  '/refactor': RefreshCw,
  '/dev-doc': BookOpen,
  '/arch-design': Layers,
  '/test-case': ClipboardList,
  '/auto-test': Terminal,
  '/bug-analysis': Search,
  '/test-report': FileBarChart,
  '/ui-spec': Layout,
  '/ui-design': Palette,
  '/ui-kit': Box,
  '/design-review': Eye,
  '/design-token': Palette,
  '/req-breakdown': ListChecks,
  '/data-analysis': BarChart3,
  '/grill-me': Lightbulb,
};

/** 欢迎页快捷指令卡片定义。 */
interface WelcomeCard {
  cmd: string;
  title: string;
  desc: string;
}

/** 默认快捷卡片（产品经理视角，兼容无子角色/管理员场景）。 */
const WELCOME_CARDS_DEFAULT: WelcomeCard[] = [
  { cmd: '/prd-write', title: '撰写 PRD', desc: '根据需求生成产品需求文档' },
  { cmd: '/req-breakdown', title: '需求拆分', desc: '将需求拆分为结构化需求项与验收标准' },
  { cmd: '/prd-research', title: '产品调研', desc: '输入网站链接，自动爬取并生成竞品分析报告' },
  { cmd: '/data-analysis', title: '数据分析', desc: '分析数据并生成业务洞察' },
];

/** 按职能子角色定制的快捷卡片；未命中的角色回退到默认卡片。 */
const WELCOME_CARDS_BY_ROLE: Partial<Record<SubRole, WelcomeCard[]>> = {
  [SUB_ROLE.DEVELOPER]: [
    { cmd: '/code', title: '编写代码', desc: '基于需求和代码库编写实现代码' },
    { cmd: '/debug', title: '修复 BUG', desc: '定位并修复代码中的缺陷' },
    { cmd: '/review', title: '智能评审', desc: '对变更代码进行智能评审' },
    { cmd: '/unit-test', title: '生成单测', desc: '为代码生成单元测试' },
    { cmd: '/refactor', title: '重构代码', desc: '对指定功能或模块进行重构' },
    { cmd: '/dev-doc', title: '工程文档', desc: '基于工程代码生成完整工程文档' },
    { cmd: '/arch-design', title: '技术设计', desc: '基于工程或需求生成技术设计文档' },
  ],
  [SUB_ROLE.TESTER]: [
    { cmd: '/test-case', title: '生成测试用例', desc: '根据需求生成结构化测试用例' },
    { cmd: '/auto-test', title: '自动化脚本', desc: '生成可运行的自动化测试脚本' },
    { cmd: '/bug-analysis', title: 'BUG 分析', desc: '分析缺陷根因与影响范围' },
    { cmd: '/test-report', title: '测试报告', desc: '汇总测试执行结果生成报告' },
  ],
  [SUB_ROLE.DESIGNER]: [
    { cmd: '/ui-spec', title: 'UI 规范', desc: '生成 UI 设计规范文档' },
    { cmd: '/ui-kit', title: 'UI 组件库', desc: '生成一套 UI 组件库规范与示例' },
    { cmd: '/design-review', title: '设计走查', desc: '检查设计稿与实现一致性' },
    { cmd: '/design-token', title: 'Design Token', desc: '生成设计 Token 定义' },
  ],
  [SUB_ROLE.PM]: [
    { cmd: '/prd-write', title: '撰写 PRD', desc: '根据需求生成产品需求文档' },
    { cmd: '/req-breakdown', title: '需求拆分', desc: '将需求拆分为结构化需求项与验收标准' },
    { cmd: '/grill-me', title: '头脑风暴', desc: '基于任务卡片逐步澄清需求并生成文档' },
    { cmd: '/proto-make', title: '制作原型', desc: '根据文档生成可预览的原型工程' },
    { cmd: '/prd-research', title: '产品调研', desc: '输入网站链接，自动爬取并生成竞品分析报告' },
  ],
};

/** 指令分类（用于上拉菜单按角色展示）。 */
// CommandCategory / COMMAND_CATEGORY_LABELS / COMMAND_CATEGORY_ORDER / COMMAND_CATEGORIES
// 已抽取至 @/lib/commands 共享。

/** 根据用户子角色返回默认激活的指令分类 tab。 */
const getDefaultCommandCategory = (subRole?: SubRole): CommandCategory => {
  switch (subRole) {
    case SUB_ROLE.PM: return 'product';
    case SUB_ROLE.DESIGNER: return 'design';
    case SUB_ROLE.TESTER: return 'test';
    case SUB_ROLE.DEVELOPER:
    default: return 'dev';
  }
};

// 排队输入项。
interface InputQueueItem {
  id: string;
  text: string;
  context?: SendContext;
}

/** 聊天中引用的产品文档（落盘后的工作目录相对路径）。 */
interface ReferencedDoc {
  docId: string;
  title: string;
  path: string;
}

/** 聊天中引用的原型工程路径。 */
interface ReferencedPrototype {
  path: string;
  title?: string;
}

/** 聊天中引用的评审报告，来自 ReviewReportCard 的"修复"操作。 */
interface ReferencedReport {
  fileName: string;
  fullPath: string;
}

// 发送消息时附加的引用文档说明头，引导 agent 先读文档再按用户要求处理。
const DOC_REF_HEADER = '[引用的产品文档（相对工作目录路径，请先读取文档内容，再按用户要求修改或处理）]';

// 发送消息时附加的引用原型说明头，引导 agent 在已有原型基础上微调。
const PROTO_REF_HEADER = '[引用的原型工程路径（相对工作目录路径，请先读取现有原型，再按用户要求进行调整或优化）]';

// @提及 在输入框中的完整文本形式（@标题+尾随空格），作为一个原子块整体插入/删除。
const docMentionToken = (title: string) => `@${title} `;

// 原型路径 @提及 在输入框中的完整文本形式，作为一个原子块整体插入/删除。
const protoMentionToken = (path: string) => `@${path} `;

// 评审报告 @提及 token，作为一个原子块整体插入/删除。
const reportRefToken = (fileName: string) => `@${fileName} `;

// 提示词模板参数原子块正则：{{参数名}}，作为整体删除/高亮。
const PARAM_BLOCK_REGEX = /\{\{[^}]+\}\}/g;

/** 从输入文本中提取所有模板参数 token。 */
const extractParamTokens = (text: string): string[] => {
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  // 必须每次重新创建正则，避免 global 标志导致连续调用跳过匹配。
  const regex = new RegExp(PARAM_BLOCK_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
};

/** 查找所有模板参数块在文本中的区间。 */
const findParamBlockRanges = (text: string): { start: number; end: number }[] => {
  const ranges: { start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(PARAM_BLOCK_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
};

// 查找光标所处（或紧邻）的原子块区间（@文档提及 /code 指令 /{{参数}} 共用）；
// mode 区分退格/前删的边界判定，找不到返回 null。
const findAtomicRange = (
  text: string,
  cursor: number,
  tokens: string[],
  mode: 'backspace' | 'delete',
): { start: number; end: number } | null => {
  for (const token of tokens) {
    let idx = text.indexOf(token);
    while (idx !== -1) {
      const end = idx + token.length;
      // backspace：光标在块内或紧邻块尾；delete：光标在块内或紧邻块首
      const hit = mode === 'backspace' ? cursor > idx && cursor <= end : cursor >= idx && cursor < end;
      if (hit) return { start: idx, end };
      idx = text.indexOf(token, idx + 1);
    }
  }
  return null;
};

// 智能体 tab 项。每个 tab 对应一个独立的后端 session（一个智能体实例），
// 不同实例之间的会话完全隔离。
type AgentStatus = 'error' | 'idle' | 'running' | 'active';

interface AgentTab {
  sessionId: string;
  pluginKey: string;
  title: string;
  instanceId?: string;
  status: AgentStatus;
  lastAssistantAt?: string;
}

// 可选的智能体插件，从后端 /available-agents 动态加载。
const DEFAULT_AGENT_OPTIONS: AvailableAgent[] = [
  { agentKey: 'claude-code', name: 'Claude Code', description: '', model: '' },
  { agentKey: 'opencode', name: 'OpenCode', description: '', model: '' },
];

// 新会话创建时默认智能体的优先级，取第一个可用的。
const DEFAULT_AGENT_PRIORITY = ['claude-code', 'opencode', 'codex'];

const resolveDefaultAgentKey = (configs: WorkspaceAgentConfig[], options: AvailableAgent[]): string | undefined => {
  const enabled = configs.filter(c => c.enabled && options.some(o => o.agentKey === c.agentKey));
  if (enabled.length === 0) return undefined;
  const defaultCfg = enabled.find(c => c.isDefault);
  if (defaultCfg) return defaultCfg.agentKey;
  return enabled[0].agentKey;
};

const getAgentLabel = (key: string, options: AvailableAgent[]): string => options.find(o => o.agentKey === key)?.name ?? key;

/** 根据历史会话项生成智能体展示文本（完整版本，截断由 CSS 控制）。 */
function getHistoryAgentLabel(item: { pluginKey?: string; instanceId?: string }, options: AvailableAgent[]) {
  const label = getAgentLabel(item.pluginKey || 'claude-code', options);
  if (!item.instanceId) return { label, full: label };
  return { label, full: `${label} · ${item.instanceId}` };
}

/** 智能体实例标签：超出容器时显示省略号，hover 展示完整内容。 */
function AgentInstanceLabel({
  title,
  instanceId,
  className,
}: {
  title: string;
  instanceId?: string;
  className?: string;
}) {
  const text = instanceId ? `${title} · ${instanceId}` : title;
  return (
    <span className={cn('truncate', className)} title={text}>
      {text}
    </span>
  );
}

// 当前工作空间 ID 从 workspace-utils 读取，避免多处重复兜底。
const CHAT_TABS_STORAGE_KEY = 'dh-chat-tabs';
const CHAT_ACTIVE_TAB_STORAGE_KEY = 'dh-chat-active-tab';
// 按工作区 + 用户隔离存储，避免切换用户后恢复其他用户的 tab 配置
const getChatStorageUserId = (): string => localStorage.getItem('token') ?? '';
const getChatTabsStorageKey = (workspaceId: string) => `${CHAT_TABS_STORAGE_KEY}:${workspaceId}:${getChatStorageUserId()}`;
const getChatActiveTabStorageKey = (workspaceId: string) => `${CHAT_ACTIVE_TAB_STORAGE_KEY}:${workspaceId}:${getChatStorageUserId()}`;

/** 为无标题的历史会话生成友好占位标题，避免展示 session ID。 */
const formatSessionTitle = (
  s: AgentSessionDTO & { context?: Record<string, unknown> },
  options: AvailableAgent[]
): string => {
  if (s.title) return s.title;
  const pluginKey = typeof s.context?.pluginKey === 'string' ? s.context.pluginKey : (s.agentId || 'claude-code');
  const agentName = getAgentLabel(pluginKey, options);
  const date = s.createdAt
    ? new Date(s.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  return date ? `${agentName} · 未命名会话 · ${date}` : `${agentName} · 未命名会话`;
};

/** 详情弹窗中的字段项：浅灰标签 + 值 */
function ChatDetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm text-foreground font-medium">{value}</div>
    </div>
  );
}

const AGENT_STATUS_COLORS: Record<AgentStatus, string> = {
  error: 'bg-red-500',
  idle: 'bg-gray-400',
  running: 'bg-yellow-400',
  active: 'bg-green-500',
};

const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  error: '连接失败',
  idle: '无活跃会话',
  running: '进行中',
  active: '活跃',
};

const ACTIVE_SESSION_THRESHOLD_MS = 60 * 60 * 1000;

function isActiveWithinHour(lastAssistantAt?: string): boolean {
  if (!lastAssistantAt) return false;
  return Date.now() - new Date(lastAssistantAt).getTime() <= ACTIVE_SESSION_THRESHOLD_MS;
}

function getLastAssistantTimestamp(messages: ThreadMessageLike[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      if (msg.createdAt) return new Date(msg.createdAt).toISOString();
      return new Date().toISOString();
    }
  }
  return undefined;
}

// ──────────────── Label / Color Maps ────────────────
// 需求状态文案：与产品空间看板一致的五个状态
const REQ_STATUS_LABELS: Record<RequirementStatus, string> = { todo: '待处理', 'in-progress': '进行中', done: '已完成', cancelled: '已取消', 'on-hold': '已挂起' };
const DEF_STATUS_LABELS: Record<DefectStatus, string> = { open: '待修复', 'in-progress': '修复中', fixed: '已修复', closed: '已关闭' };
const CASE_STATUS_LABELS: Record<CaseStatus, string> = { draft: '草稿', ready: '待执行', passed: '通过', failed: '失败', blocked: '阻塞' };
const SEVERITY_LABELS: Record<DefectSeverity, string> = { critical: '致命', high: '严重', medium: '一般', low: '轻微' };

// 后端状态使用下划线（如 in_progress），前端 UI 使用连字符（如 in-progress）。
// 待办（backlog）已合并到待处理（todo）。
const toUiStatus = (status: string): string => {
  const ui = status.replace(/_/g, '-');
  return ui === 'backlog' ? 'todo' : ui;
};
const toApiStatus = (status: string): string => status.replace(/-/g, '_');

// 根据后端优先级/严重度映射为前端严重度。
const mapSeverity = (priority: WorkItemDTO['priority'], severity?: WorkItemDTO['severity']): DefectSeverity => {
  if (severity) return severity as DefectSeverity;
  if (priority === 'high') return 'high';
  if (priority === 'medium') return 'medium';
  return 'low';
};

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-muted text-muted-foreground border-muted-foreground/30',
  todo: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50',
  'in-progress': 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50',
  done: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800/50',
  cancelled: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
  'on-hold': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50',
  open: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800/50',
  fixed: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800/50',
  closed: 'bg-muted text-muted-foreground border-muted-foreground/30',
  draft: 'bg-muted text-muted-foreground border-muted-foreground/30',
  ready: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50',
  passed: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800/50',
  failed: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800/50',
  blocked: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50',
};
const SEVERITY_COLORS: Record<DefectSeverity, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

// Kanban columns
const DEF_KANBAN_COLS: { key: DefectStatus; label: string }[] = [
  { key: 'open', label: '待修复' }, { key: 'in-progress', label: '修复中' },
  { key: 'fixed', label: '已修复' }, { key: 'closed', label: '已关闭' },
];
const CASE_KANBAN_COLS: { key: CaseStatus; label: string }[] = [
  { key: 'draft', label: '草稿' }, { key: 'ready', label: '待执行' },
  { key: 'passed', label: '通过' }, { key: 'failed', label: '失败' },
  { key: 'blocked', label: '阻塞' },
];

const getColColor = (colKey: string) => {
  const colorObj = STATUS_COLORS[colKey] || 'bg-muted';
  const bgMatch = colorObj.match(/bg-([a-z]+)/);
  if (!bgMatch) return 'muted';
  const baseColor = bgMatch[1];
  return baseColor;
};

  // 看板列头配色（对齐 DESIGN.md §5.8）：pastel 背景 + 同色标题 + 实心圆形计数
  const getColColorStyle = (colKey: string) => {
    const base = getColColor(colKey);
    if (base === 'blue') return 'bg-blue-100/70 dark:bg-blue-900/25';
    if (base === 'amber') return 'bg-amber-100/70 dark:bg-amber-900/25';
    if (base === 'green') return 'bg-green-100/70 dark:bg-green-900/25';
    if (base === 'red') return 'bg-red-100/70 dark:bg-red-900/25';
    if (base === 'orange') return 'bg-orange-100/70 dark:bg-orange-900/25';
    if (base === 'zinc') return 'bg-zinc-100/70 dark:bg-zinc-800/40';
    return 'bg-muted/60';
  };

  const getColTitleStyle = (colKey: string) => {
    const base = getColColor(colKey);
    if (base === 'blue') return 'text-blue-700 dark:text-blue-300';
    if (base === 'amber') return 'text-amber-700 dark:text-amber-300';
    if (base === 'green') return 'text-green-700 dark:text-green-300';
    if (base === 'red') return 'text-red-700 dark:text-red-300';
    if (base === 'orange') return 'text-orange-700 dark:text-orange-300';
    if (base === 'zinc') return 'text-zinc-600 dark:text-zinc-300';
    return 'text-foreground';
  };

  const getColCountStyle = (colKey: string) => {
    const base = getColColor(colKey);
    if (base === 'blue') return 'bg-blue-600';
    if (base === 'amber') return 'bg-amber-500';
    if (base === 'green') return 'bg-green-500';
    if (base === 'red') return 'bg-red-500';
    if (base === 'orange') return 'bg-orange-500';
    if (base === 'zinc') return 'bg-zinc-500';
    return 'bg-muted-foreground';
  };

// 完成态状态：卡片降低不透明度且标题划线
const KANBAN_DONE_STATUSES = ['done', 'closed', 'passed', 'cancelled'];

// 缺陷严重度对应的卡片左侧优先级条颜色
const SEVERITY_BAR_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
};

// ──────────────── Component ────────────────
export const Chat: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { membership, user } = useAuth();
  // 多角色场景下取首个职能子角色用于会话欢迎卡片等默认视图；
  // 若包含产品经理，则开放文档引用能力。
  const activeSubRole = membership?.subRoles?.[0] ?? SUB_ROLE.DEVELOPER;
  const welcomeCards =
    (activeSubRole && WELCOME_CARDS_BY_ROLE[activeSubRole]) || WELCOME_CARDS_DEFAULT;
  // 文档引用仅面向产品职能（文档是产品空间的产物，其他角色无文档概念）；
  // 无子角色（管理员等场景）沿用产品默认视图，与欢迎卡片回退逻辑一致。
  const canUseDocs = !membership?.subRoles?.length || membership.subRoles.includes(SUB_ROLE.PM);
  const [input, setInput] = useState('');

  // Input toolbar dropdowns
  const [selectedRepos, setSelectedRepos] = useState<{id: string; name: string; localPath?: string; branch?: string}[]>([]);
  const [availableRepos, setAvailableRepos] = useState<{id: string; name: string; localPath?: string}[]>([]);
  const [userRepoStatuses, setUserRepoStatuses] = useState<UserRepoStatus[]>([]);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [availablePrompts, setAvailablePrompts] = useState<WorkspacePrompt[]>([]);
  const [promptCategories, setPromptCategories] = useState<PromptCategory[]>([]);
  const [promptMenuSearch, setPromptMenuSearch] = useState('');
  const [promptMenuCategory, setPromptMenuCategory] = useState<string>('全部');
  const [skillMenuSearch, setSkillMenuSearch] = useState('');
  const [availableAgents, setAvailableAgents] = useState<WorkspaceAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [availableAgentOptions, setAvailableAgentOptions] = useState<AvailableAgent[]>(DEFAULT_AGENT_OPTIONS);
  const [availableAgentsLoaded, setAvailableAgentsLoaded] = useState(false);
  const [workspaceAgentConfigs, setWorkspaceAgentConfigs] = useState<WorkspaceAgentConfig[]>([]);

  // 智能会话初始化 loading：在 agent 配置与会话恢复/创建完成前，避免先闪「不可用」再闪欢迎页。
  const [isInitializingChat, setIsInitializingChat] = useState(true);

  const [agentTabs, setAgentTabs] = useState<AgentTab[]>([]);
  const [activeAgentTabId, setActiveAgentTabId] = useState<string | null>(null);

  const activeTab = agentTabs.find(t => t.sessionId === activeAgentTabId) ?? null;
  const enabledAgentOptions = useMemo(() => {
    const enabledKeys = new Set(workspaceAgentConfigs.filter(c => c.enabled).map(c => c.agentKey));
    return availableAgentOptions.filter(o => enabledKeys.has(o.agentKey));
  }, [workspaceAgentConfigs, availableAgentOptions]);
  const defaultPluginKey = resolveDefaultAgentKey(workspaceAgentConfigs, availableAgentOptions);
  const activePluginKey = activeTab?.pluginKey ?? defaultPluginKey ?? 'claude-code';
  const chatEnabled = enabledAgentOptions.length > 0;

  const { runtime, sessionId, wsConnected, messages, isRunning, runPhase, sendMessage, switchSession, createSession, cancelRun, tryRestoreSession, pendingQuestion, respondToQuestion, dismissQuestion } = useAgUiChat({ agentPluginKey: activePluginKey });

  // 输入框历史消息回溯：按 ↑/↓ 切换当前工作区内最近发送的用户消息。
  const workspaceIdForHistory = useMemo(() => getCurrentWorkspaceId(), []);
  const [inputHistory, setInputHistory] = useState<string[]>(() => getInputHistory(workspaceIdForHistory));
  const [inputHistoryIndex, setInputHistoryIndex] = useState(-1);
  const inputHistoryDraftRef = useRef('');
  useEffect(() => {
    setInputHistory(getInputHistory(workspaceIdForHistory));
    setInputHistoryIndex(-1);
    inputHistoryDraftRef.current = '';
  }, [workspaceIdForHistory]);

  // Auto-scroll state
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Code jump dialog
  const [codeJumpOpen, setCodeJumpOpen] = useState(false);

  // 运行中切换/新建会话确认对话框。
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);
  const [switchConfirmTitle, setSwitchConfirmTitle] = useState('切换会话');
  const pendingActionRef = useRef<(() => void) | null>(null);

  // Inline file preview
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  // Inline project preview (takes priority over file preview)
  const [projectPreview, setProjectPreview] = useState<{ path: string; mode: PreviewMode } | null>(null);
  // Inline user story preview
  const [userStoryPreview, setUserStoryPreview] = useState<UserStoryData | null>(null);
  // Inline requirement breakdown preview
  const [reqBreakdownPreview, setReqBreakdownPreview] = useState<RequirementBreakdownData | null>(null);
  // Inline prototype preview (from /proto-make results)
  const [prototypePreviewPath, setPrototypePreviewPath] = useState<string | null>(null);
  const [prototypePreviewRequirementTitle, setPrototypePreviewRequirementTitle] = useState<string | undefined>(undefined);
  // 最近一次触发 /proto-make 时关联的需求标题，用于原型卡片展示。
  const [protoMakeRequirementTitle, setProtoMakeRequirementTitle] = useState<string>('');
  const showPreview = previewPath !== null || projectPreview !== null || userStoryPreview !== null || reqBreakdownPreview !== null || prototypePreviewPath !== null;

  // agent.question 内联提问卡片：显示在输入框上方，用户选择选项或自定义输入后回答。
  const [questionCustomInput, setQuestionCustomInput] = useState('');
  useEffect(() => {
    if (pendingQuestion === null) setQuestionCustomInput('');
  }, [pendingQuestion]);

  // 预览历史栈：支持前/后退导航。
  const [previewHistory, setPreviewHistory] = useState<PreviewHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isNavigatingHistory = useRef(false);

  // 可拖拽分割线的 imperative panel API。
  const previewPanelRef = useRef<ImperativePanelHandle>(null);

  // pushPreviewHistory 将一条预览记录推入历史栈，
  // 截断当前位置之后的前进记录（与浏览器历史行为一致）。
  const pushPreviewHistory = useCallback((entry: PreviewHistoryEntry) => {
    if (isNavigatingHistory.current) {
      isNavigatingHistory.current = false;
      return;
    }
    setPreviewHistory(prev => {
      const truncated = prev.slice(0, historyIndex + 1);
      return [...truncated, entry];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const handleFilePreview = useCallback(async (path: string) => {
    if (previewPath === path) {
      setPreviewPath(null);
      return;
    }
    try {
      await fileApi.content(path);
    } catch {
      toast.error('文件已被删除');
      return;
    }
    setProjectPreview(null);
    setUserStoryPreview(null);
    setReqBreakdownPreview(null);
    setPrototypePreviewPath(null);
    setPreviewPath(path);
    pushPreviewHistory({ type: 'file', path });
  }, [previewPath, pushPreviewHistory]);

  const handleUserStoryPreview = useCallback((data: UserStoryData) => {
    const isSameStory = userStoryPreview != null &&
      userStoryPreview.title === data.title &&
      userStoryPreview.total === data.total &&
      (userStoryPreview.stories[0]?.story === data.stories[0]?.story);
    if (isSameStory) {
      setPreviewPath(null);
      setProjectPreview(null);
      setUserStoryPreview(null);
      setPrototypePreviewPath(null);
      setPreviewHistory([]);
      return;
    }
    setPreviewPath(null);
    setProjectPreview(null);
    setUserStoryPreview(data);
    setPrototypePreviewPath(null);
    pushPreviewHistory({ type: 'user_story', data });
  }, [userStoryPreview, pushPreviewHistory]);

  const handleProjectPreview = useCallback((path: string, previewMode: PreviewMode) => {
    setPreviewPath(null);
    setUserStoryPreview(null);
    setReqBreakdownPreview(null);
    setPrototypePreviewPath(null);
    setProjectPreview({ path, mode: previewMode });
    pushPreviewHistory({ type: 'project', path, mode: previewMode });
  }, [pushPreviewHistory]);

  const handleReqBreakdownPreview = useCallback((data: RequirementBreakdownData) => {
    const isSame = reqBreakdownPreview != null &&
      reqBreakdownPreview.title === data.title &&
      reqBreakdownPreview.total === data.total &&
      (reqBreakdownPreview.items[0]?.title === data.items[0]?.title);
    if (isSame) {
      setPreviewPath(null);
      setProjectPreview(null);
      setUserStoryPreview(null);
      setReqBreakdownPreview(null);
      setPrototypePreviewPath(null);
      setPreviewHistory([]);
      return;
    }
    setPreviewPath(null);
    setProjectPreview(null);
    setUserStoryPreview(null);
    setReqBreakdownPreview(data);
    setPrototypePreviewPath(null);
    pushPreviewHistory({ type: 'req_breakdown', data });
  }, [reqBreakdownPreview, pushPreviewHistory]);

  const handlePrototypePreview = useCallback((path: string) => {
    if (prototypePreviewPath === path) {
      setPrototypePreviewPath(null);
      setPrototypePreviewRequirementTitle(undefined);
      return;
    }
    setPreviewPath(null);
    setProjectPreview(null);
    setUserStoryPreview(null);
    setReqBreakdownPreview(null);
    setPrototypePreviewPath(path);
    setPrototypePreviewRequirementTitle(protoMakeRequirementTitle);
    pushPreviewHistory({ type: 'prototype_preview', path, requirementTitle: protoMakeRequirementTitle });
  }, [prototypePreviewPath, pushPreviewHistory, protoMakeRequirementTitle]);

  // 评审报告采纳：调用后端 API 存储评审报告结构化数据，返回是否成功。
  // 当 issues 为空时（agent 使用旧格式 marker 未输出 issues），从评审报告文件解析兜底。
  const handleReviewAdopt = useCallback(async (data: ReviewReportData): Promise<boolean> => {
    try {
      const workspaceId = getCurrentWorkspaceId();
      let issues = data.issues || [];
      let summary = data.summary || '';

      // 兜底：agent 使用旧格式 marker 时 issues 为空，从评审报告 Markdown 文件解析
      if (issues.length === 0 && data.reportPath) {
        try {
          const resolvedReportPath = data.reportPath.startsWith('/')
            ? data.reportPath
            : `${data.projectPath}/.review/${data.reportPath}`;
          const response = await fetch(`/api/v1/files/content?path=${encodeURIComponent(resolvedReportPath)}`);
          if (response.ok) {
            const fileData = await response.json();
            const markdown = fileData.content || fileData.data?.content || '';
            if (markdown) {
              issues = parseIssuesFromMarkdown(markdown, data.projectPath);
            }
          }
        } catch {
          // 文件读取失败不阻塞采纳流程
        }
      }

      await api.post('/v1/agent-reviews/reports', {
        workspaceId,
        sessionId,
        projectPath: data.projectPath,
        projectName: data.projectName,
        branch: data.branch,
        commitHash: data.commit,
        reportPath: data.reportPath,
        summary,
        issues: issues.map((issue) => ({
          id: issue.id,
          filePath: issue.filePath,
          line: issue.line,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          suggestion: issue.suggestion,
        })),
      });
      toast.success(`评审报告已采纳${issues.length > 0 ? `（${issues.length} 个问题）` : ''}`);
      return true;
    } catch {
      toast.error('采纳失败，请重试');
      return false;
    }
  }, [sessionId]);

  // 评审报告修复：设置 /code 指令并以 @文件名 引用评审报告；发送时展开为完整路径。
  const handleReviewFix = useCallback((reportPath: string, projectName: string) => {
    const fileName = reportPath.split('/').pop() || reportPath;
    const token = reportRefToken(fileName);
    setReferencedReports(prev => [...prev.filter(r => r.fileName !== fileName), { fileName, fullPath: reportPath }]);
    const fixPrompt = `根据评审报告 ${token}修复 ${projectName} 工程中的所有问题，按严重程度从高到低逐一修复。`;
    setInput(`/code ${fixPrompt}`);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }, []);

  // 预览报错修复：把错误摘要与工程路径填入输入框（走 /debug 流程），完整错误复制到剪贴板。
  const handlePreviewFix = useCallback(({ path, excerpt }: { path: string; excerpt: string }) => {
    const projectName = path.split('/').pop() || path;
    const trimmed = excerpt.length > PREVIEW_FIX_EXCERPT_CHARS
      ? `${excerpt.slice(0, PREVIEW_FIX_EXCERPT_CHARS)}\n...（过长已截断，完整错误在剪贴板）`
      : excerpt;
    setInput(`/debug 工程 ${projectName}（路径：${path}）预览 dev server 报错，请定位并修复。错误摘要：\n${trimmed}`);
    navigator.clipboard.writeText(`工程：${projectName}（${path}）\n${excerpt}`).catch(() => {});
    toast.success('错误信息已复制并填入会话，确认后发送');
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }, []);

  // navigatePreview 在历史栈中前进或后退，恢复对应的预览状态。
  const navigatePreview = useCallback((direction: 'back' | 'forward') => {
    const newIndex = direction === 'back' ? historyIndex - 1 : historyIndex + 1;
    if (newIndex < 0 || newIndex >= previewHistory.length) return;
    const entry = previewHistory[newIndex];
    isNavigatingHistory.current = true;
    setHistoryIndex(newIndex);
    if (entry.type === 'file') {
      setProjectPreview(null);
      setUserStoryPreview(null);
      setReqBreakdownPreview(null);
      setPrototypePreviewPath(null);
      setPreviewPath(entry.path);
    } else if (entry.type === 'project') {
      setPreviewPath(null);
      setUserStoryPreview(null);
      setReqBreakdownPreview(null);
      setPrototypePreviewPath(null);
      setProjectPreview({ path: entry.path, mode: entry.mode });
    } else if (entry.type === 'user_story') {
      setPreviewPath(null);
      setProjectPreview(null);
      setReqBreakdownPreview(null);
      setPrototypePreviewPath(null);
      setUserStoryPreview(entry.data);
    } else if (entry.type === 'prototype_preview') {
      setPreviewPath(null);
      setProjectPreview(null);
      setUserStoryPreview(null);
      setReqBreakdownPreview(null);
      setPrototypePreviewPath(entry.path);
      setPrototypePreviewRequirementTitle(entry.requirementTitle);
    } else {
      setPreviewPath(null);
      setProjectPreview(null);
      setUserStoryPreview(null);
      setPrototypePreviewPath(null);
      setReqBreakdownPreview(entry.data);
    }
  }, [historyIndex, previewHistory]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < previewHistory.length - 1;

  const closePreview = useCallback(() => {
    setPreviewPath(null);
    setProjectPreview(null);
    setUserStoryPreview(null);
    setReqBreakdownPreview(null);
    setPrototypePreviewPath(null);
    setPrototypePreviewRequirementTitle(undefined);
    setPreviewHistory([]);
    setHistoryIndex(-1);
  }, []);

  // 预览开关时通过 imperative API 折叠/展开面板。
  // 展开时默认恢复到 75%（预览）/ 25%（聊天）的比例。
  useEffect(() => {
    const panel = previewPanelRef.current;
    if (!panel) return;
    if (showPreview) {
      panel.resize(75);
    } else {
      panel.collapse();
    }
  }, [showPreview]);

  // Esc 关闭预览。
  useEffect(() => {
    if (!showPreview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPreview, closePreview]);

  // 做原型：将当前预览的文档作为卡片放入输入框，并自动选择 /proto-make 指令。
  // 需求 ID 的匹配由 protoMakeRequirementTitle + requirements 的 useEffect 负责，
  // 避免本回调依赖后文才声明的 requirements 状态造成 TDZ。
  const handleProtoMake = useCallback((filePath: string, title: string) => {
    setQuotedCard(null);
    setProtoMakeRequirementTitle(title);
    setInput(prev => prev.trimEnd() ? `${prev.trimEnd()}\n/proto-make ` : '/proto-make ');
  }, []);

  // 监听 FileView 跨标签页发来的做原型请求。
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === PROTO_MAKE_PENDING_KEY && e.newValue) {
        try {
          const data = JSON.parse(e.newValue) as { path: string; title: string };
          handleProtoMake(data.path, data.title);
        } catch { /* 忽略无效数据 */ }
        localStorage.removeItem(PROTO_MAKE_PENDING_KEY);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [handleProtoMake]);

  // 从后端加载指令配置（含任务/代码库约束）。
  useEffect(() => {
    api.get<CommandConfig[]>('/v1/commands')
      .then(setCommandConfigs)
      .catch(err => console.error('[Chat] load commands failed:', err));
  }, []);

  // File Upload
  const fileInputRef = useRef<HTMLInputElement>(null);


  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false);
  // @ 触发的内联文档菜单：start/end 为 @query 在输入框中的区间，query 为检索词
  const [docMention, setDocMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [docMentionIndex, setDocMentionIndex] = useState(0);
  // 产品空间文档菜单数据与已引用文档（发送时附带路径）
  const [availableDocs, setAvailableDocs] = useState<ProductDoc[]>([]);
  const [referencedDocs, setReferencedDocs] = useState<ReferencedDoc[]>([]);
  // 已引用的原型工程路径，点击「设计」菜单中的原型时自动插入到输入框。
  const [referencedPrototypes, setReferencedPrototypes] = useState<ReferencedPrototype[]>([]);
  // 已引用的评审报告，从 ReviewReportCard「修复」按钮设置，输入框展示 @文件名。
  const [referencedReports, setReferencedReports] = useState<ReferencedReport[]>([]);
  const [materializingDocId, setMaterializingDocId] = useState<string | null>(null);
  // 「设计」按钮菜单：按需求名分组展示关联的文档与原型
  const [designMenuOpen, setDesignMenuOpen] = useState(false);
  const [designMenuSearch, setDesignMenuSearch] = useState('');
  const [designItems, setDesignItems] = useState<RequirementWithDesignItems[]>([]);
  const [commandConfigs, setCommandConfigs] = useState<CommandConfig[]>([]);

  // 欢迎页快捷卡片过滤掉后端已禁用的指令；配置尚未加载时全部展示。
  const visibleWelcomeCards = useMemo(() => {
    if (commandConfigs.length === 0) return welcomeCards;
    const enabledSet = new Set(commandConfigs.filter(c => c.enabled).map(c => c.cmd));
    return welcomeCards.filter(card => enabledSet.has(card.cmd));
  }, [welcomeCards, commandConfigs]);

  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [compactPlusOpen, setCompactPlusOpen] = useState(false);
  const [compactPlusSubmenu, setCompactPlusSubmenu] = useState<'design' | 'repo' | 'prompt' | 'skill' | 'cmd' | null>(null);
  const [activeSkillTab, setActiveSkillTab] = useState('全部');
  const [activeTaskTab, setActiveTaskTab] = useState<'req' | 'defect' | 'case'>('req');
  const [activeCommandTab, setActiveCommandTab] = useState<CommandCategory>(getDefaultCommandCategory(activeSubRole));
  const repoMenuRef = useRef<HTMLDivElement>(null);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const cmdMenuRef = useRef<HTMLDivElement>(null);
  const designMenuRef = useRef<HTMLDivElement>(null);
  const docMentionMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionOverlayRef = useRef<HTMLDivElement>(null);
  const compactPlusRef = useRef<HTMLDivElement>(null);
  // 主会话区占整个面板的百分比，由 ResizablePanel 的 onResize 提供，
  // 用于按用户指定的比例阈值决定哪些工具栏按钮直接展示、哪些收入 + 号。
  const [mainPanelSize, setMainPanelSize] = useState(100);
  // 工具栏折叠级别：0 = 仅任务可见；1 = 任务 + 工程/文档 + 指令可见；2 = 所有按钮可见。
  const [toolbarLevel, setToolbarLevel] = useState<0 | 1 | 2>(2);

  // 预览显隐切换时，直接按目标比例重置级别（无滞后）。
  useEffect(() => {
    setToolbarLevel(showPreview ? 0 : 2);
  }, [showPreview]);

  // 用户拖动分栏时，按方向做滞后（hysteresis）：
  // 扩张：>= 50% 升 1 级，>= 75% 升 2 级；
  // 收缩：<= 70% 降 1 级，<= 45% 降 2 级。
  useEffect(() => {
    setToolbarLevel(prev => {
      if (prev === 2) {
        if (mainPanelSize <= 70) return 1;
        return 2;
      }
      if (prev === 1) {
        if (mainPanelSize >= 75) return 2;
        if (mainPanelSize <= 45) return 0;
        return 1;
      }
      // prev === 0
      if (mainPanelSize >= 75) return 2;
      if (mainPanelSize >= 50) return 1;
      return 0;
    });
  }, [mainPanelSize]);

  // 工具栏自适应：根据级别决定哪些按钮直接展示。
  const collapsibleToolbarItems = useMemo(() => {
    const items: ('design' | 'repo' | 'cmd' | 'prompt' | 'skill')[] = [];
    if (canUseDocs) items.push('design');
    if (availableRepos.length > 0) items.push('repo');
    items.push('cmd', 'prompt', 'skill');
    return items;
  }, [canUseDocs, availableRepos.length]);

  const visibleToolbarCount = useMemo(
    () => {
      if (toolbarLevel === 0) return 0;
      if (toolbarLevel === 1) return Math.min(3, collapsibleToolbarItems.length);
      return collapsibleToolbarItems.length;
    },
    [toolbarLevel, collapsibleToolbarItems.length]
  );
  const collapsedToolbarItems = useMemo(
    () => collapsibleToolbarItems.slice(visibleToolbarCount),
    [collapsibleToolbarItems, visibleToolbarCount]
  );

  // Data state
  const [requirements, setRequirements] = useState<ReqItem[]>([]);
  const [defects, setDefects] = useState<DefectItem[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);

  // Detail drawer
  const [detailType, setDetailType] = useState<'req' | 'defect' | 'case' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Filter configuration
  const [filterConfig, setFilterConfig] = useState({
    reqStatuses: ['todo', 'in-progress', 'done', 'cancelled', 'on-hold'] as RequirementStatus[],
    defectStatuses: ['open', 'in-progress', 'fixed', 'closed'] as DefectStatus[],
    caseStatuses: ['draft', 'ready', 'passed', 'failed', 'blocked'] as CaseStatus[]
  });
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);

  // Quoted card above input
  const [quotedCard, setQuotedCard] = useState<{ type: 'req' | 'defect' | 'case'; id: string; title: string; reporter: string } | null>(null);
  // 记录最近一次 /req-breakdown 指令关联的父需求 ID。用户可能在提交前移除引用卡片，因此用 ref 保留根父需求。
  const lastReqBreakdownRootId = useRef<string>('');

  // 从消息历史中回溯最近一条引用了需求卡片的用户消息，返回 { id, title }。
  // 解决页面刷新或组件 remount 导致 quotedCard 状态丢失后，采纳文档/原型时 workitemId 为空的问题。
  const findLatestQuotedReqFromMessages = useCallback((msgs: ThreadMessageLike[]): { id: string; title: string } | null => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.role !== 'user') continue;
      const meta = (msg.metadata?.custom ?? {}) as { quotedCard?: { type?: string; id?: string; title?: string } };
      if (meta.quotedCard?.type === 'req' && meta.quotedCard.id) {
        return { id: meta.quotedCard.id, title: meta.quotedCard.title ?? '' };
      }
    }
    return null;
  }, []);

  // 从消息历史回溯的 quotedReq，作为 quotedCard 丢失时的兜底。
  const fallbackQuotedReq = useMemo(() => findLatestQuotedReqFromMessages(messages), [messages, findLatestQuotedReqFromMessages]);

  // 原型采纳关联的需求 ID：优先使用显式引用的需求卡片；若用户通过"做原型"或 AI 回复里的
  // [[REQ_NAME:...]] 提供了需求标题，则尝试按标题匹配已有需求。确保采纳原型时能生成设计版本。
  // 兜底：从消息历史回溯最近引用的需求卡片 ID（解决页面刷新后 quotedCard 丢失的问题）。
  const effectivePrototypeWorkitemId = useMemo(() => {
    if (quotedCard?.type === 'req') return quotedCard.id;
    const byTitle = resolveWorkitemIdByTitle(protoMakeRequirementTitle, requirements);
    if (byTitle) return byTitle;
    if (fallbackQuotedReq) return fallbackQuotedReq.id;
    return undefined;
  }, [quotedCard, protoMakeRequirementTitle, requirements, fallbackQuotedReq]);

  // 兜底需求标题：quotedCard 丢失时从消息历史回溯，确保 AssistantMessage 的 resolvedWorkitemId 标题匹配兜底有效。
  const effectiveRequirementTitle = useMemo(() => {
    return protoMakeRequirementTitle || quotedCard?.title || fallbackQuotedReq?.title || '';
  }, [protoMakeRequirementTitle, quotedCard, fallbackQuotedReq]);

  // 当“做原型”标题变化时，自动匹配并引用对应需求卡片，让 AI 和后续采纳都获得正确的需求上下文。
  // 如果用户已显式引用其他需求/缺陷/用例卡片，则保留原引用不做覆盖。
  useEffect(() => {
    if (!protoMakeRequirementTitle) return;
    if (quotedCard && quotedCard.type === 'req') return;
    const matchedId = resolveWorkitemIdByTitle(protoMakeRequirementTitle, requirements);
    if (!matchedId) return;
    const matchedReq = requirements.find(r => r.id === matchedId);
    setQuotedCard({
      type: 'req',
      id: matchedId,
      title: matchedReq?.title ?? protoMakeRequirementTitle,
      reporter: matchedReq?.reporter ?? '当前用户',
    });
  }, [protoMakeRequirementTitle, requirements, quotedCard]);

  // Input queue: when AI is running, user inputs are queued and sent automatically.
  const [inputQueue, setInputQueue] = useState<InputQueueItem[]>([]);
  const [queueMenuOpen, setQueueMenuOpen] = useState(false);
  const queueMenuRef = useRef<HTMLDivElement>(null);

  // Kanban
  const [kanbanType, setKanbanType] = useState<'req' | 'defect' | 'case' | null>(null);
  const [kanbanHighlightId, setKanbanHighlightId] = useState<string | null>(null);
  const kanbanItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const detailReq = requirements.find(r => r.id === detailId) ?? null;
  const detailDef = defects.find(d => d.id === detailId) ?? null;
  const detailCase = cases.find(c => c.id === detailId) ?? null;
  const detailOpen = detailType !== null;
  const kanbanOpen = kanbanType !== null;

  // Auto-scroll: scroll to bottom when new messages arrive (if locked).
  // 直接操作 ScrollArea viewport，避免 scrollIntoView 波及外层容器导致输入框位移。
  useEffect(() => {
    if (!isAtBottom) return;
    const viewport = document.querySelector('#chat-scroll-area [data-radix-scroll-area-viewport]') as HTMLDivElement | null;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, isAtBottom]);

  // Detect scroll position to unlock auto-scroll when user scrolls up
  const scrollBound = useRef(false);
  useEffect(() => {
    if (scrollBound.current) return;
    const viewport = document.querySelector('#chat-scroll-area [data-radix-scroll-area-viewport]') as HTMLDivElement;
    if (!viewport) return;
    scrollBound.current = true;
    scrollViewportRef.current = viewport;
    const onScroll = () => {
      const threshold = 80;
      const diff = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const atBottom = diff < threshold;
      setIsAtBottom(atBottom);
      if (atBottom) setHasNewMessage(false);
    };
    viewport.addEventListener('scroll', onScroll);
    onScroll(); // 立即检查一次当前位置
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      scrollBound.current = false;
    };
  }, [messages]);

  // Close all dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (repoMenuRef.current && !repoMenuRef.current.contains(t)) setRepoMenuOpen(false);
      if (promptMenuRef.current && !promptMenuRef.current.contains(t)) setPromptMenuOpen(false);
      if (skillMenuRef.current && !skillMenuRef.current.contains(t)) setSkillPopoverOpen(false);
      if (taskMenuRef.current && !taskMenuRef.current.contains(t)) setTaskMenuOpen(false);
      if (cmdMenuRef.current && !cmdMenuRef.current.contains(t)) setCmdMenuOpen(false);
      if (designMenuRef.current && !designMenuRef.current.contains(t)) setDesignMenuOpen(false);
      // @ 内联菜单：点击菜单与输入框以外区域时关闭（输入框内点击由 onChange 重新判定）
      if (docMentionMenuRef.current && !docMentionMenuRef.current.contains(t) && !textareaRef.current?.contains(t)) {
        setDocMention(null);
      }
      if (queueMenuRef.current && !queueMenuRef.current.contains(t)) setQueueMenuOpen(false);
      if (agentMenuRef.current && !agentMenuRef.current.contains(t)) setAgentMenuOpen(false);
      if (compactPlusRef.current && !compactPlusRef.current.contains(t)) {
        setCompactPlusOpen(false);
        setCompactPlusSubmenu(null);
      }
      if (historyRef.current && !historyRef.current.contains(t)) setHistoryOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionId]);

  useEffect(() => {
    if (location.state?.initialInput) setInput(location.state.initialInput);
    if (location.state?.quotedCard) setQuotedCard(location.state.quotedCard);
    if (location.state?.selectedRepos) setSelectedRepos(location.state.selectedRepos);
  }, [location.state]);

  // 从后端 API 加载工作项数据
  useEffect(() => {
    let cancelled = false;
    api.get<WorkItemDTO[]>(`/v1/workitems?workspaceId=${encodeURIComponent(getCurrentWorkspaceId())}`)
      .then(items => {
        if (cancelled) return;
        const reqs: ReqItem[] = [];
        const defs: DefectItem[] = [];
        const tcs: CaseItem[] = [];
        items.forEach(item => {
          const base = {
            id: item.id,
            title: item.title,
            description: item.description,
            assigneeId: item.assigneeId ?? '',
            reporter: item.reporter ?? '',
            createdAt: item.createdAt.slice(0, 10),
            parentId: item.parentId,
            priority: item.priority,
          };
          if (item.type === 'requirement') {
            reqs.push({ ...base, status: toUiStatus(item.status) as RequirementStatus });
          } else if (item.type === 'defect') {
            defs.push({ ...base, status: toUiStatus(item.status) as DefectStatus, severity: mapSeverity(item.priority, item.severity) });
          } else if (item.type === 'case') {
            tcs.push({ ...base, status: toUiStatus(item.status) as CaseStatus, steps: item.steps ?? [] });
          }
        });
        setRequirements(reqs);
        setDefects(defs);
        setCases(tcs);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load workitems:', err);
        toast.error('加载工作项失败');
      });
    return () => { cancelled = true; };
  }, []);

  // Scroll kanban highlight into view
  useEffect(() => {
    if (kanbanHighlightId && kanbanItemRefs.current[kanbanHighlightId]) {
      setTimeout(() => {
        kanbanItemRefs.current[kanbanHighlightId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [kanbanHighlightId, kanbanOpen]);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = getCurrentWorkspaceId();
    repositoryApi.list(workspaceId)
      .then(repos => {
        if (cancelled) return;
        setAvailableRepos(repos.map(r => ({ id: r.id, name: r.name, localPath: r.localPath })));
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load repositories:', err);
      });
    // 同时加载用户仓库同步状态
    repositoryApi.listUserRepos(workspaceId)
      .then(statuses => {
        if (cancelled) return;
        setUserRepoStatuses(statuses);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load user repo statuses:', err);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = getCurrentWorkspaceId();
    Promise.all([
      teamApi.listSkills(1, 100, workspaceId).then(res => res.list),
      workspaceApi.listPrompts(workspaceId).catch((): WorkspacePrompt[] => []),
      workspaceApi.listPromptCategories(workspaceId).catch((): PromptCategory[] => []),
      // 产品空间文档（后端已按 updated_at 倒序）
      productDocApi.list(workspaceId).catch((): ProductDoc[] => []),
      // 需求及其关联的文档/原型（供「设计」按钮菜单）
      workItemApi.listRequirementsWithDesignItems(workspaceId).catch((): RequirementWithDesignItems[] => []),
    ])
      .then(([loadedSkills, loadedPrompts, loadedCategories, loadedDocs, loadedDesignItems]) => {
        if (cancelled) return;
        setAvailableSkills(loadedSkills);
        setAvailablePrompts(loadedPrompts);
        setPromptCategories(loadedCategories);
        setAvailableDocs(loadedDocs);
        setDesignItems(loadedDesignItems);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load skills/prompts:', err);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = getCurrentWorkspaceId();
    Promise.all([
      workspaceApi.listAgents(workspaceId).catch((): WorkspaceAgent[] => []),
      agentConfigApi.listAvailableAgents(workspaceId).catch((): AvailableAgent[] => []),
      agentConfigApi.listWorkspaceConfigs(workspaceId).catch((): WorkspaceAgentConfig[] => []),
    ])
      .then(([agents, runtimeAgents, configs]) => {
        if (cancelled) return;
        setAvailableAgents(agents);
        const defaultAgent = agents.find(a => a.isDefault) || agents[0];
        if (defaultAgent) {
          setSelectedAgentId(defaultAgent.id);
        }
        setAvailableAgentOptions(runtimeAgents);
        setWorkspaceAgentConfigs(configs);
        setAvailableAgentsLoaded(true);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load workspace agents:', err);
      });
    return () => { cancelled = true; };
  }, []);

  const skillIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    ListTodo,
    Box,
    Code2,
    CheckCircle,
    UploadCloud,
    Puzzle,
  };

  // 插入提示词后将光标定位到第一个 {{参数}} 块并整体选中，用户可直接输入替换；
  // 无参数块时定位到文本末尾。配合 handleInputKeyDown 的左右方向键在参数块间切换。
  const focusFirstParamBlock = (text: string) => {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const ranges = findParamBlockRanges(text);
      const pos = ranges.length > 0 ? ranges[0] : { start: text.length, end: text.length };
      ta.setSelectionRange(pos.start, pos.end);
    });
  };

  // 插入提示词到输入框，并上报使用次数（空间提示词 +1；市场来源则市场提示词同步 +1）。
  // 上报为 fire-and-forget：失败不影响插入动作本身。
  const insertPrompt = (p: WorkspacePrompt) => {
    const c = p.content || p.description;
    const next = input.trimEnd() ? input.trimEnd() + '\n' + c : c;
    setInput(next);
    setPromptMenuOpen(false); setCompactPlusSubmenu(null); setCompactPlusOpen(false);
    focusFirstParamBlock(next);
    const workspaceId = getCurrentWorkspaceId();
    workspaceApi.recordPromptUsage(workspaceId, p.id)
      .then(updated => setAvailablePrompts(prev => prev.map(item => item.id === updated.id ? updated : item)))
      .catch(err => console.warn('上报提示词使用次数失败:', err));
  };

  // 输入框行首指令（与 handleSend 的解析口径一致）：仅当是已配置的指令时生效。
  const activeInputCommand = useMemo(() => {
    const match = input.trimStart().match(/^(\/\S+)/);
    if (!match) return '';
    return commandConfigs.some(c => c.cmd === match[1]) ? match[1] : '';
  }, [input, commandConfigs]);

  // 当前行首指令绑定的系统提示词；为空时提示词面板不展示「系统」分类、按钮不显示角标。
  const activeSystemPrompts = useMemo(
    () => (activeInputCommand ? getCommandSystemPrompts(activeInputCommand) : []),
    [activeInputCommand],
  );

  // 插入系统提示词到输入框。系统提示词为前端内置模板，无后端 id，不上报使用次数。
  const insertSystemPrompt = (p: SystemPrompt) => {
    const next = input.trimEnd() ? input.trimEnd() + '\n' + p.content : p.content;
    setInput(next);
    setPromptMenuOpen(false); setCompactPlusSubmenu(null); setCompactPlusOpen(false);
    focusFirstParamBlock(next);
  };

  // 输入框行首指令变为带系统提示词的指令时，自动展开提示词面板并选中「系统」分类。
  // 首次挂载仅记录不弹出，避免恢复草稿/历史输入时打扰。
  const prevInputCommandRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevInputCommandRef.current;
    prevInputCommandRef.current = activeInputCommand;
    if (prev === null || !activeInputCommand || activeInputCommand === prev || activeSystemPrompts.length === 0) return;
    setPromptMenuCategory(SYSTEM_PROMPT_CATEGORY_NAME);
    setPromptMenuOpen(true);
    setCmdMenuOpen(false); setRepoMenuOpen(false); setTaskMenuOpen(false); setSkillPopoverOpen(false);
    setCompactPlusOpen(false); setCompactPlusSubmenu(null);
  }, [activeInputCommand, activeSystemPrompts]);

  // 「系统」分类随指令从输入框移除而失效时，回退到「全部」，避免停留在已消失的分类上。
  useEffect(() => {
    if (promptMenuCategory === SYSTEM_PROMPT_CATEGORY_NAME && activeSystemPrompts.length === 0) {
      setPromptMenuCategory('全部');
    }
  }, [promptMenuCategory, activeSystemPrompts]);

  // 「系统」分类的提示词列表：仅按搜索词过滤，不参与空间提示词的分类匹配。
  const filteredSystemPrompts = useMemo(() => {
    const term = promptMenuSearch.toLowerCase().trim();
    return activeSystemPrompts.filter(p =>
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.content.toLowerCase().includes(term) ||
      p.description.toLowerCase().includes(term)
    );
  }, [activeSystemPrompts, promptMenuSearch]);

  const filteredAvailablePrompts = useMemo(() => {
    const term = promptMenuSearch.toLowerCase().trim();
    return availablePrompts.filter(p => {
      if (p.enabled === false) return false;
      const matchesSearch = !term ||
        p.name.toLowerCase().includes(term) ||
        (p.content || '').toLowerCase().includes(term) ||
        (p.description || '').toLowerCase().includes(term);
      const matchesCategory = promptMenuCategory === '全部' ||
        p.categories.some(c => c.name === promptMenuCategory);
      return matchesSearch && matchesCategory;
    });
  }, [availablePrompts, promptMenuSearch, promptMenuCategory]);

  const filteredAvailableSkills = useMemo(() => {
    const term = skillMenuSearch.toLowerCase().trim();
    return availableSkills.filter(s =>
      s.installed &&
      (activeSkillTab === '全部' || s.phase === activeSkillTab) &&
      (!term || s.name.toLowerCase().includes(term) || (s.description || '').toLowerCase().includes(term))
    );
  }, [availableSkills, activeSkillTab, skillMenuSearch]);

  const toggleRepo = (repo: {id: string; name: string; localPath?: string}) => setSelectedRepos(prev => prev.find(r => r.id === repo.id) ? prev.filter(r => r.id !== repo.id) : [...prev, repo]);
  const appendSkillTag = (name: string) => { setInput(p => p.trimEnd() ? p.trimEnd() + ` #${name} ` : `#${name} `); };

  // 文档菜单：按标题搜索过滤（列表已由后端按修改时间倒序）。
  // @ 内联触发时检索词来自输入框 @ 后的文本。
  const docFilterQuery = docMention ? docMention.query : '';
  const filteredDocs = useMemo(() => {
    const q = docFilterQuery.trim().toLowerCase();
    if (!q) return availableDocs;
    return availableDocs.filter(d => d.title.toLowerCase().includes(q));
  }, [availableDocs, docFilterQuery]);

  // 文档按钮角标：输入框中仍存在的 @提及 数量（随整体删除实时变化）
  const activeRefCount = referencedDocs.filter(d => input.includes(docMentionToken(d.title))).length;

  // 「设计」菜单：按需求标题过滤（结果已由后端按需求更新时间倒序）。
  const filteredDesignItems = useMemo(() => {
    const q = designMenuSearch.trim().toLowerCase();
    if (!q) return designItems;
    return designItems.filter(item => item.workitemTitle.toLowerCase().includes(q));
  }, [designItems, designMenuSearch]);

  // 指令原子块 token 列表：空格后缀版本用于词边界安全匹配（如 /code 不误匹配 /code-review），
  // 裸命令版本用于命令在输入末尾且无后缀参数时的着色匹配。
  const commandTokens = useMemo(() => {
    const tokens: string[] = [];
    for (const c of commandConfigs) {
      tokens.push(`${c.cmd} `);
      tokens.push(c.cmd);
    }
    return tokens;
  }, [commandConfigs]);
  // 当前输入中的模板参数 token（{{参数名}}）。
  const paramTokens = useMemo(() => extractParamTokens(input), [input]);

  // 所有原子块 token：@文档提及 + @原型路径 + @评审报告 + 指令 + 模板参数；用于整体删除判定。
  const atomicTokens = useMemo(
    () => [
      ...referencedDocs.map(d => docMentionToken(d.title)),
      ...referencedPrototypes.map(p => protoMentionToken(p.path)),
      ...referencedReports.map(r => reportRefToken(r.fileName)),
      ...commandTokens,
      ...paramTokens,
    ],
    [referencedDocs, referencedPrototypes, referencedReports, commandTokens, paramTokens],
  );

  // 输入框高亮渲染：@文档提及（主色）、@原型路径（青色）、@评审报告（翠绿色）、指令块（紫色）与模板参数块（琥珀色）
  // 包成高亮+阴影片段，其余为普通文本。
  // 叠放在透明文字的 textarea 下方，二者字体/内边距保持一致以对齐字形。
  // 注意：高亮 span 用 px-0.5 + -mx-0.5 组合，获得视觉留白的同时不改变文本步进宽度，
  // 否则提及块后的文字会与 textarea 光标位置错位（光标看起来落在字中间）。
  const highlightedInput = useMemo((): React.ReactNode => {
    const ranges: { start: number; end: number; kind: 'mention' | 'prototype' | 'report' | 'command' | 'param' }[] = [];
    const collectRanges = (token: string, kind: 'mention' | 'prototype' | 'report' | 'command' | 'param') => {
      let idx = input.indexOf(token);
      while (idx !== -1) {
        ranges.push({ start: idx, end: idx + token.length, kind });
        idx = input.indexOf(token, idx + 1);
      }
    };
    for (const d of referencedDocs) collectRanges(docMentionToken(d.title), 'mention');
    for (const p of referencedPrototypes) collectRanges(protoMentionToken(p.path), 'prototype');
    for (const r of referencedReports) collectRanges(reportRefToken(r.fileName), 'report');
    for (const token of commandTokens) collectRanges(token, 'command');
    for (const token of paramTokens) collectRanges(token, 'param');
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const nodes: React.ReactNode[] = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.start < pos) continue; // 防御：重叠区间跳过
      if (r.start > pos) nodes.push(input.slice(pos, r.start));
      const cls =
        r.kind === 'mention'
          ? 'bg-primary/10 text-primary shadow-[0_1px_3px_hsl(var(--primary)/0.35)]'
          : r.kind === 'prototype'
            ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 shadow-[0_1px_3px_rgba(20,184,166,0.35)]'
            : r.kind === 'report'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-[0_1px_3px_rgba(16,185,129,0.35)]'
              : r.kind === 'command'
                ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 shadow-[0_1px_3px_rgba(139,92,246,0.35)]'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 shadow-[0_1px_3px_rgba(245,158,11,0.35)]';
      nodes.push(
        <span key={r.start} className={`rounded-md px-0.5 -mx-0.5 ${cls}`}>
          {input.slice(r.start, r.end)}
        </span>,
      );
      pos = r.end;
    }
    if (pos < input.length) nodes.push(input.slice(pos));
    return nodes;
  }, [input, referencedDocs, referencedPrototypes, referencedReports, commandTokens, paramTokens]);

  // 选中文档：先落盘拿到 agent 可读路径，再在输入框插入 @文档名 原子块。
  // 重复判定以输入框中是否仍存在该原子块为准（删除后可重新引用）。
  const handleSelectDoc = async (doc: { id: string; title: string }, closeMenu?: () => void) => {
    const token = docMentionToken(doc.title);
    if (input.includes(token)) {
      closeMenu?.();
      setDocMention(null);
      return;
    }
    const workspaceId = getCurrentWorkspaceId();
    setMaterializingDocId(doc.id);
    try {
      const res = await productDocApi.materializeDoc(workspaceId, doc.id);
      // 同一文档重新引用时替换旧记录，避免重复
      setReferencedDocs(prev => [...prev.filter(d => d.docId !== doc.id), { docId: doc.id, title: doc.title, path: res.path }]);
      let cursorPos: number;
      if (docMention) {
        // @ 触发：用原子块替换输入中的 @query 区间，光标定位到块尾（块外）
        setInput(p => p.slice(0, docMention.start) + token + p.slice(docMention.end));
        cursorPos = docMention.start + token.length;
        setDocMention(null);
      } else {
        // 按钮触发：追加到输入框末尾，光标定位到末尾
        setInput(p => (p.trimEnd() ? p.trimEnd() + ` ${token}` : token));
        cursorPos = (input.trimEnd() ? input.trimEnd().length + 1 : 0) + token.length;
        closeMenu?.();
      }
      // 等 React 提交新值后恢复焦点并定位光标到提及块之外
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(cursorPos, cursorPos);
      });
    } catch {
      toast.error('文档落盘失败，无法引用');
    } finally {
      setMaterializingDocId(null);
    }
  };

  // 「设计」菜单：点击文档按钮，引用该需求对应的文档并关闭菜单。
  const handleDesignDoc = (doc: LinkedProductSpaceItem) => {
    handleSelectDoc({ id: doc.id, title: doc.title }, () => setDesignMenuOpen(false));
  };

  // 「设计」菜单：点击原型按钮，基于该需求标题触发 /proto-make 重新设计原型，
  // 并在输入框中 @引用对应的原型路径，方便 agent 在现有原型基础上微调。
  const handleDesignPrototype = (prototype: LinkedProductSpaceItem, requirementTitle: string) => {
    const token = protoMentionToken(prototype.relativePath);
    setProtoMakeRequirementTitle(requirementTitle);
    setReferencedPrototypes(prev => [...prev.filter(p => p.path !== prototype.relativePath), { path: prototype.relativePath, title: requirementTitle }]);
    setInput(`/proto-make ${token}`);
    setDesignMenuOpen(false);
    setCompactPlusSubmenu(null);
    setCompactPlusOpen(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const pos = `/proto-make ${token}`.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // 插入指令到输入框开头（斜杠指令通常作为前缀），若已有内容则追加空格分隔。
  // 指令成为原子块（/code 整体删除），插入后光标定位到块尾。
  // 若已存在指令，则替换为新的指令；若指令不支持代码库且当前已选代码库，清空选择。
  // 若指令已被禁用，给出提示并不插入。
  const insertCommand = (cmd: string) => {
    const cfg = commandConfigs.find(c => c.cmd === cmd);
    if (cfg && !cfg.enabled) {
      toast.error(`指令 ${cmd} 已被禁用`);
      return;
    }
    const existingCmd = commandConfigs.find(c => {
      const after = input.slice(c.cmd.length);
      return input.startsWith(c.cmd) && (after === '' || /^\s/.test(after));
    });
    const rest = existingCmd ? input.slice(existingCmd.cmd.length).replace(/^\s*/, '') : input.trimStart();
    const newInput = rest ? `${cmd} ${rest}` : `${cmd} `;
    setInput(newInput);
    setCmdMenuOpen(false);
    if (cfg && !cfg.allowRepos && selectedRepos.length > 0) {
      setSelectedRepos([]);
    }
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const pos = `${cmd} `.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // 输入框斜杠指令：过滤后的指令列表。
  const filteredSlashCommands = useMemo(() => {
    if (!slashMenuOpen) return [];
    const query = input.replace(/^\//, '').toLowerCase();
    return commandConfigs.filter(c => c.cmd.startsWith(`/${query}`));
  }, [slashMenuOpen, input, commandConfigs]);

  // 斜杠指令选择回调：替换为指令文本。
  // 若指令已被禁用，给出提示并不插入。
  const selectSlashCommand = (cmd: string) => {
    const cfg = commandConfigs.find(c => c.cmd === cmd);
    if (cfg && !cfg.enabled) {
      toast.error(`指令 ${cmd} 已被禁用`);
      setSlashMenuOpen(false);
      setSlashIndex(0);
      return;
    }
    const rest = input.replace(/^\/\S*/, '').trimStart();
    setInput(rest ? `${cmd} ${rest}` : `${cmd} `);
    setSlashMenuOpen(false);
    setSlashIndex(0);
    if (cfg && !cfg.allowRepos && selectedRepos.length > 0) {
      setSelectedRepos([]);
    }
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const pos = `${cmd} `.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // textarea onChange：检测 "/" 开头且无空格时打开斜杠菜单；检测 @ 触发内联文档菜单。
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith('/') && !val.includes(' ')) {
      setSlashMenuOpen(true);
      setSlashIndex(0);
    } else {
      setSlashMenuOpen(false);
    }
    // @ 文档提及：光标前最后一个 @ 与光标之间无空白、且 @ 位于行首或空白后时触发
    const cursor = e.target.selectionStart;
    const beforeCursor = val.slice(0, cursor);
    const atIdx = beforeCursor.lastIndexOf('@');
    const atPrevOk = atIdx === 0 || /\s/.test(val[atIdx - 1] ?? '');
    const atQuery = atIdx >= 0 ? beforeCursor.slice(atIdx + 1) : '';
    // 已完成的引用块（@标题 / @原型路径 / @评审报告）中的 @ 不再重复触发菜单
    const isCompletedMention = atIdx >= 0 && (
      referencedDocs.some(d => val.startsWith(docMentionToken(d.title), atIdx)) ||
      referencedPrototypes.some(p => val.startsWith(protoMentionToken(p.path), atIdx)) ||
      referencedReports.some(r => val.startsWith(reportRefToken(r.fileName), atIdx))
    );
    if (canUseDocs && atIdx >= 0 && atPrevOk && !/\s/.test(atQuery) && !isCompletedMention) {
      setDocMention({ start: atIdx, end: cursor, query: atQuery });
      setDocMentionIndex(0);
      setDesignMenuOpen(false);
    } else {
      setDocMention(null);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    console.log('[handlePaste] html:', html?.substring(0, 500));
    if (!html) { console.log('[handlePaste] no HTML data, returning'); return; }
    const match = html.match(/<span\s+data-dh-chat-copy=["']([^"']*)["']/i);
    console.log('[handlePaste] match:', match ? match[1].substring(0, 200) : null);
    if (!match) { console.log('[handlePaste] no match, returning'); return; }
    e.preventDefault();
    try {
      const decoded = match[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      console.log('[handlePaste] decoded:', decoded.substring(0, 200));
      const payload = JSON.parse(decoded);
      console.log('[handlePaste] payload keys:', Object.keys(payload));
      const originalText = String(payload.t ?? '');
      console.log('[handlePaste] originalText:', originalText);
      if (payload.q) setQuotedCard(payload.q as NonNullable<SendContext['quotedCard']>);
      if (payload.r) setSelectedRepos(payload.r as NonNullable<SendContext['selectedRepos']>);
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = ta.value.slice(0, start) + originalText + ta.value.slice(end);
      console.log('[handlePaste] newValue:', newValue);
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      )?.set;
      nativeSetter?.call(ta, newValue);
      setInput(newValue);
      requestAnimationFrame(() => {
        ta.setSelectionRange(start + originalText.length, start + originalText.length);
      });
    } catch (err) {
      console.log('[handlePaste] error:', err);
    }
  };

  // textarea onKeyDown：斜杠/@ 菜单键盘导航、@提及 原子删除、Enter 发送。
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(i => (i + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(i => (i - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        selectSlashCommand(filteredSlashCommands[slashIndex].cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }
    if (docMention && filteredDocs.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setDocMentionIndex(i => (i + 1) % filteredDocs.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setDocMentionIndex(i => (i - 1 + filteredDocs.length) % filteredDocs.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSelectDoc(filteredDocs[docMentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDocMention(null);
        return;
      }
    }
    // 输入框历史消息回溯：无菜单打开时，↑/↓ 切换最近发送的用户消息。
    // 触发条件：已在历史浏览态、输入框为空、或光标位于文本最开头（如 Ctrl+Home 后），避免干扰正常多行文本上下移动。
    const isMenuOpen = (slashMenuOpen && filteredSlashCommands.length > 0) || (!!docMention && filteredDocs.length > 0);
    if (!isMenuOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && inputHistory.length > 0) {
      const ta = e.currentTarget;
      if (e.key === 'ArrowUp') {
        const canRecall = inputHistoryIndex >= 0 || (input.trim() === '') || (ta.selectionStart === 0 && ta.selectionEnd === 0);
        if (canRecall) {
          e.preventDefault();
          if (inputHistoryIndex === -1) {
            inputHistoryDraftRef.current = input;
          }
          const nextIndex = Math.min(inputHistoryIndex + 1, inputHistory.length - 1);
          setInputHistoryIndex(nextIndex);
          setInput(inputHistory[nextIndex]);
          requestAnimationFrame(() => ta.setSelectionRange(ta.value.length, ta.value.length));
          return;
        }
      } else {
        if (inputHistoryIndex >= 0) {
          e.preventDefault();
          if (inputHistoryIndex === 0) {
            setInputHistoryIndex(-1);
            setInput(inputHistoryDraftRef.current);
          } else {
            const nextIndex = inputHistoryIndex - 1;
            setInputHistoryIndex(nextIndex);
            setInput(inputHistory[nextIndex]);
          }
          requestAnimationFrame(() => ta.setSelectionRange(ta.value.length, ta.value.length));
          return;
        }
      }
    }
    // 模板参数块键盘导航：左右方向键在相邻参数块之间快速跳转。
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && paramTokens.length > 0) {
      const ta = e.currentTarget;
      const ranges = findParamBlockRanges(input);
      if (ranges.length > 0) {
        const cursor = ta.selectionStart;
        if (e.key === 'ArrowLeft') {
          const prev = ranges.filter(r => r.end <= cursor).pop();
          if (prev) {
            e.preventDefault();
            ta.setSelectionRange(prev.start, prev.start);
            return;
          }
        } else {
          const next = ranges.find(r => r.start >= cursor);
          if (next) {
            e.preventDefault();
            ta.setSelectionRange(next.end, next.end);
            return;
          }
        }
      }
    }

    // 原子块整体删除（@文档提及 / @原型路径 /code 指令 /{{参数}}）：光标在块内部或紧邻边界时，Backspace/Delete 整体移除该块
    if ((e.key === 'Backspace' || e.key === 'Delete') && atomicTokens.length > 0) {
      const ta = e.currentTarget;
      const range = ta.selectionStart === ta.selectionEnd
        ? findAtomicRange(input, ta.selectionStart, atomicTokens, e.key === 'Backspace' ? 'backspace' : 'delete')
        : null;
      if (range) {
        e.preventDefault();
        const nextInput = input.slice(0, range.start) + input.slice(range.end);
        const removedToken = input.slice(range.start, range.end).trim();
        setInput(nextInput);
        // 同步清理已不在输入框中的引用记录，使该文档/原型/评审报告可再次引用
        setReferencedDocs(prev => prev.filter(d => nextInput.includes(docMentionToken(d.title))));
        setReferencedPrototypes(prev => prev.filter(p => nextInput.includes(protoMentionToken(p.path))));
        setReferencedReports(prev => prev.filter(r => nextInput.includes(reportRefToken(r.fileName))));
        // 删除 /proto-make 指令时同步清理由「做原型」自动带入的需求卡片和标题，
        // 避免需求卡片残留导致后续无法清除。
        if (removedToken === '/proto-make') {
          setProtoMakeRequirementTitle('');
          setQuotedCard(null);
        }
        requestAnimationFrame(() => ta.setSelectionRange(range.start, range.start));
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 同步仓库到用户 projects 目录
  const handleSyncRepo = (repoId: string) => {
    const workspaceId = getCurrentWorkspaceId();
    setSyncingRepoId(repoId);
    repositoryApi.syncUserRepo(workspaceId, repoId)
      .then(() => {
        const poll = setInterval(async () => {
          try {
            const statuses = await repositoryApi.listUserRepos(workspaceId);
            setUserRepoStatuses(statuses);
            const target = statuses.find(s => s.repositoryId === repoId);
            if (target?.synced || target?.syncStatus === 'failed') {
              clearInterval(poll);
              setSyncingRepoId(null);
            }
          } catch {
            // 轮询失败时继续尝试
          }
        }, CHAT_SYNC_POLL_INTERVAL_MS);
        setTimeout(() => { clearInterval(poll); setSyncingRepoId(null); }, 300000);
      })
      .catch(err => {
        setSyncingRepoId(null);
        toast.error('同步仓库失败：' + (err instanceof Error ? err.message : '未知错误'));
      });
  };

  const handleSend = () => {
    if (!input.trim() && !quotedCard) return;

    // 检查当前指令是否支持代码库；不支持时提示用户并忽略代码库。
    const trimmedInput = input.trim();
    const cmdMatch = trimmedInput.match(/^(\/\S+)/);
    const activeCmd = cmdMatch ? cmdMatch[1] : '';
    const cmdCfg = commandConfigs.find(c => c.cmd === activeCmd);
    let effectiveRepos = selectedRepos.length > 0 ? [...selectedRepos] : undefined;

    // 指令已被禁用时，拦截发送并提示用户。
    if (cmdCfg && !cmdCfg.enabled) {
      toast.error(`指令 ${activeCmd} 已被禁用，无法发送`);
      return;
    }

    // 指令不支持代码库时，提示并忽略。
    if (cmdCfg && !cmdCfg.allowRepos && selectedRepos.length > 0) {
        toast.warning(`指令 ${activeCmd} 不支持代码库，已忽略`);
      effectiveRepos = undefined;
    }

    // 指令必须选择代码库时，拦截发送。
    if (cmdCfg && cmdCfg.requireRepos && (!effectiveRepos || effectiveRepos.length === 0)) {
      toast.error(`指令 ${activeCmd} 需要选择代码库`);
      return;
    }

    // 指令必须选择任务卡片时，拦截发送。
    if (cmdCfg && cmdCfg.requireTask && !quotedCard) {
      toast.error(`指令 ${activeCmd} 需要选择任务卡片`);
      return;
    }

    // 指令需要任务卡片或非空提示词：若无任务卡片，指令后的文本不得为空。
    if (cmdCfg && !quotedCard && !cmdCfg.requireTask) {
      const textAfterCmd = trimmedInput.slice(activeCmd.length).trim();
      if (!textAfterCmd && !effectiveRepos) {
        toast.error(`指令 ${activeCmd} 需要输入提示词或选择任务卡片`);
        return;
      }
    }

    // 记录 /req-breakdown 关联的父需求，供后续提交时作为子需求 parentId，避免引用卡片被移除后丢失。
    if (activeCmd === '/req-breakdown' && quotedCard?.type === 'req') {
      lastReqBreakdownRootId.current = quotedCard.id;
    }

    const context: SendContext | undefined =
      quotedCard || effectiveRepos
        ? { quotedCard: quotedCard ?? undefined, selectedRepos: effectiveRepos }
        : undefined;

    // 引用文档：仅保留输入框中仍存在 @标签 的文档，将其落盘路径附在消息尾部，
    // agent 收到后按路径读取文档内容再执行用户指令。
    const activeRefDocs = referencedDocs.filter(d => input.includes(docMentionToken(d.title)));
    const activeRefProtos = referencedPrototypes.filter(p => input.includes(protoMentionToken(p.path)));
    let finalInput = input;
    // 评审报告 @文件名 展开为完整路径，发送给 agent。
    const activeRefReports = referencedReports.filter(r => input.includes(reportRefToken(r.fileName)));
    const reportLines = activeRefReports.map(r => `- ${r.fileName}: ${r.fullPath}`).join('\n');
    if (activeRefReports.length > 0) {
      finalInput = `${finalInput}\n\n[引用的评审报告（请先读取报告内容，再按用户要求修复问题）]\n${reportLines}`;
    }
    if (activeRefDocs.length > 0) {
      const docLines = activeRefDocs.map(d => `- ${d.title}: ${d.path}`).join('\n');
      finalInput = `${finalInput}\n\n${DOC_REF_HEADER}\n${docLines}`;
    }
    if (activeRefProtos.length > 0) {
      const protoLines = activeRefProtos.map(p => `- ${p.title || p.path}: ${p.path}`).join('\n');
      finalInput = `${finalInput}\n\n${PROTO_REF_HEADER}\n${protoLines}`;
    }

    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    // 仅在 AI 正在处理上一条用户消息时才排队；如果已经看到 AI 回复（最后一条为 assistant），
    // 说明当前没有需要等待的回复，直接发送即可，避免 isRunning 残留导致误排队。
    const isAwaitingAssistant = isRunning && lastMessage?.role === 'user';

    if (isAwaitingAssistant) {
      // AI 正在回复时，将用户输入加入排队，最多 3 个。
      if (inputQueue.length >= MAX_INPUT_QUEUE) {
        toast.error(`最多排队 ${MAX_INPUT_QUEUE} 个输入`);
        return;
      }
      const item: InputQueueItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text: finalInput,
        context,
      };
      setInputQueue(prev => [...prev, item]);
    } else {
      sendMessage(finalInput, context);
    }

    // 记录用户输入历史，供输入框内 ↑/↓ 回溯；同时退出历史浏览态。
    addInputHistory(workspaceIdForHistory, trimmedInput);
    setInputHistory(getInputHistory(workspaceIdForHistory));
    setInputHistoryIndex(-1);
    inputHistoryDraftRef.current = '';

    setInput('');
    setQuotedCard(null);
    setSelectedRepos([]);
    setReferencedDocs([]);
    setReferencedPrototypes([]);
    setReferencedReports([]);
    setDocMention(null);
  };

  // 当前对话结束后，自动发送排队中的下一条输入。
  // 以“最后一条消息是否为 user”作为是否仍在等待 AI 回复的依据，避免 isRunning 残留导致排队消息卡死。
  useEffect(() => {
    if (inputQueue.length === 0) return;
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const isAwaitingAssistant = isRunning && lastMessage?.role === 'user';
    if (isAwaitingAssistant) return;
    const [next, ...rest] = inputQueue;
    setInputQueue(rest);
    sendMessage(next.text, next.context);
  }, [isRunning, messages, inputQueue, sendMessage]);

  const closeDetail = () => {
    setDetailType(null); setDetailId(null);
  };

  const refreshWorkItemFromApi = (id: string) => {
    api.get<WorkItemDTO>(`/v1/workitems/${id}`)
      .then(item => {
        const base = {
          id: item.id,
          title: item.title,
          description: item.description,
          assigneeId: item.assigneeId ?? '',
          reporter: item.reporter ?? '',
          createdAt: item.createdAt.slice(0, 10),
          parentId: item.parentId,
          priority: item.priority,
        };
        if (item.type === 'requirement') {
          const updated: ReqItem = { ...base, status: toUiStatus(item.status) as RequirementStatus };
          setRequirements(prev => prev.map(r => r.id === id ? updated : r));
        } else if (item.type === 'defect') {
          const updated: DefectItem = { ...base, status: toUiStatus(item.status) as DefectStatus, severity: mapSeverity(item.priority, item.severity) };
          setDefects(prev => prev.map(d => d.id === id ? updated : d));
        } else if (item.type === 'case') {
          const updated: CaseItem = { ...base, status: toUiStatus(item.status) as CaseStatus, steps: item.steps ?? [] };
          setCases(prev => prev.map(c => c.id === id ? updated : c));
        }
      })
      .catch(err => {
        console.error('Failed to load workitem detail:', err);
      });
  };

  // 从消息历史中查找最近一条包含 /req-breakdown 指令且引用了需求卡片的用户消息，
  // 返回其 quotedCard.id 作为父需求 ID。
  // 解决页面刷新或组件 remount 导致 lastReqBreakdownRootId useRef 丢失的场景。
  const findReqBreakdownParentId = (msgs: ThreadMessageLike[]): string => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.role !== 'user') continue;
      const content = typeof msg.content === 'string'
        ? [{ type: 'text' as const, text: msg.content }]
        : msg.content;
      const textPart = content.find(p => p.type === 'text') as { text?: string } | undefined;
      const text = textPart?.text ?? '';
      if (!text.includes('/req-breakdown')) continue;
      const meta = (msg.metadata?.custom ?? {}) as { quotedCard?: { type?: string; id?: string } };
      if (meta.quotedCard?.type === 'req' && meta.quotedCard.id) {
        return meta.quotedCard.id;
      }
    }
    return '';
  };

  // 将需求拆分中选中的子需求提交到工作项库，并刷新需求列表。
  // 所有提交项统一作为被引用父需求的直接子需求，并限制子需求优先级不得高于父需求。
  // 提交成功后，将创建的 workitemId 回写到需求拆分 JSON 源文件，做幂等处理。
  const handleReqBreakdownSubmit = async (items: RequirementItem[], options?: { jsonFilePath?: string }) => {
    const workspaceId = getCurrentWorkspaceId();
    let projectId = 'p1';
    try {
      const proj = await workspaceApi.getWorkitemProject(workspaceId);
      if (proj?.externalKey) projectId = proj.externalKey;
      else if (proj?.id) projectId = proj.id;
    } catch {
      // 未配置工作项项目时回退到默认项目
    }

    // 优先使用发送 /req-breakdown 时缓存的父需求 ID（useRef，组件存活期间有效）；
    // 其次使用当前仍引用的需求卡片；
    // 然后兜底：从消息历史中查找最近一条包含 /req-breakdown 且引用了需求卡片的用户消息；
    // 最后兜底：从消息历史回溯最近一条引用了需求卡片的用户消息（通用回溯）。
    // 解决页面刷新或组件 remount 导致 useRef/quotedCard 丢失的场景。
    const rootParentId = lastReqBreakdownRootId.current
      || (quotedCard?.type === 'req' ? quotedCard.id : '')
      || findReqBreakdownParentId(messages)
      || fallbackQuotedReq?.id
      || '';
    console.log('[ReqBreakdownSubmit] rootParentId=', rootParentId, 'quotedCard=', quotedCard);
    let parentPriority: string | undefined;
    if (rootParentId) {
      try {
        parentPriority = (await api.get<WorkItemDTO>(`/v1/workitems/${rootParentId}`)).priority;
      } catch {
        // 获取父需求优先级失败时继续创建，仅跳过后续优先级限制
      }
    }

    if (!rootParentId) {
      console.warn('[ReqBreakdownSubmit] 未找到父需求 ID，无法建立父子关系，终止提交');
      toast.error('未找到被拆分的父需求，请先引用需求卡片再执行拆分');
      return { created: [] };
    }

    const created: { id: string; workitemId: string }[] = [];

    for (const item of items) {
      const description = [
        item.description?.role && `角色：${item.description.role}`,
        item.description?.scenario && `场景：${item.description.scenario}`,
        item.description?.action && `动作：${item.description.action}`,
        item.description?.value && `价值：${item.description.value}`,
        item.description?.constraints && `约束：${item.description.constraints}`,
      ].filter(Boolean).join('\n');

      const res = await api.post<WorkItemDTO>('/v1/workitems', {
        tenantId: user?.tenantId || '',
        projectId,
        workspaceId,
        type: 'requirement',
        title: item.title,
        description,
        status: 'backlog',
        priority: clampSplitPriority(item.priority, parentPriority),
        source: 'internal',
        reporter: user?.name || '当前用户',
        parentId: rootParentId,
      });
      created.push({ id: item.id, workitemId: res.id });
    }

    // 幂等：将创建的 workitemId 回写到需求拆分 JSON 源文件，避免刷新页面后重复提交。
    if (options?.jsonFilePath && created.length > 0) {
      try {
        const file = await fileApi.content(options.jsonFilePath);
        const parsed = JSON.parse(file.content) as RequirementBreakdownData;
        if (parsed.items && Array.isArray(parsed.items)) {
          const workitemIdByItemId = new Map(created.map(c => [c.id, c.workitemId]));
          let changed = false;
          const updatedItems = parsed.items.map(it => {
            if (workitemIdByItemId.has(it.id) && !it.workitemId) {
              changed = true;
              return { ...it, workitemId: workitemIdByItemId.get(it.id) };
            }
            return it;
          });
          if (changed) {
            await fileApi.save(options.jsonFilePath, JSON.stringify({ ...parsed, items: updatedItems }, null, 2));
          }
        }
      } catch (err) {
        console.error('Failed to write workitemIds back to req-breakdown file:', err);
      }
    }

    // 刷新需求列表，使新创建的需求立即出现在任务/看板中
    api.get<WorkItemDTO[]>(`/v1/workitems?workspaceId=${encodeURIComponent(getCurrentWorkspaceId())}`)
      .then(items => {
        const reqs: ReqItem[] = [];
        items.forEach(item => {
          if (item.type === 'requirement') {
            reqs.push({
              id: item.id,
              title: item.title,
              description: item.description,
              assigneeId: item.assigneeId ?? '',
              reporter: item.reporter ?? '',
              createdAt: item.createdAt.slice(0, 10),
              parentId: item.parentId,
              priority: item.priority,
              status: toUiStatus(item.status) as RequirementStatus,
            });
          }
        });
        setRequirements(reqs);
      })
      .catch(err => console.error('Failed to refresh requirements after submit:', err));

    return { created };
  };

  const openDetail = (type: 'req' | 'defect' | 'case', id: string) => {
    if (detailType === type && detailId === id) {
      closeDetail();
      return;
    }
    setDetailType(type); setDetailId(id);
    refreshWorkItemFromApi(id);
    if (kanbanOpen) {
      if (kanbanType !== type) {
        setKanbanType(type);
      }
      setKanbanHighlightId(id);
      setTimeout(() => {
        const el = kanbanItemRefs.current[id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      }, 100);
    }
  };

  const handlePrevItem = () => {
    if (!detailType || !detailId) return;
    let list: any[] = [];
    if (detailType === 'req') list = requirements;
    if (detailType === 'defect') list = defects;
    if (detailType === 'case') list = cases;
    
    const idx = list.findIndex(item => item.id === detailId);
    if (idx > 0) {
      setDetailId(list[idx - 1].id);
    }
  };

  const handleNextItem = () => {
    if (!detailType || !detailId) return;
    let list: any[] = [];
    if (detailType === 'req') list = requirements;
    if (detailType === 'defect') list = defects;
    if (detailType === 'case') list = cases;
    
    const idx = list.findIndex(item => item.id === detailId);
    if (idx !== -1 && idx < list.length - 1) {
      setDetailId(list[idx + 1].id);
    }
  };

  const closeKanban = () => { setKanbanType(null); setKanbanHighlightId(null); };
  const openKanban = (type: 'req' | 'defect' | 'case', highlightId?: string) => {
    if (kanbanType === type) {
      closeKanban();
    } else {
      setKanbanType(type); setKanbanHighlightId(highlightId ?? null);
    }
  };

  const updateReqStatus = (id: string, status: RequirementStatus) => {
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/status`, { status: toApiStatus(status) })
      .then(item => {
        setRequirements(prev => prev.map(r => r.id === id ? {
          ...r,
          status: toUiStatus(item.status) as RequirementStatus,
        } : r));
      })
      .catch(() => toast.error('状态更新失败'));
  };
  const updateDefStatus = (id: string, status: DefectStatus) => {
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/status`, { status: toApiStatus(status) })
      .then(item => {
        setDefects(prev => prev.map(d => d.id === id ? {
          ...d,
          status: toUiStatus(item.status) as DefectStatus,
        } : d));
      })
      .catch(() => toast.error('状态更新失败'));
  };
  const updateCaseStatus = (id: string, status: CaseStatus) => {
    api.patch<WorkItemDTO>(`/v1/workitems/${id}/status`, { status: toApiStatus(status) })
      .then(item => {
        setCases(prev => prev.map(c => c.id === id ? {
          ...c,
          status: toUiStatus(item.status) as CaseStatus,
        } : c));
      })
      .catch(() => toast.error('状态更新失败'));
  };

  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const isInitialTabsPersistRef = useRef(true);

  const updateAgentTab = useCallback((sessionId: string, patch: Partial<AgentTab>) => {
    setAgentTabs(prev => prev.map(t => t.sessionId === sessionId ? { ...t, ...patch } : t));
  }, []);

  // 历史会话下拉状态。
  const [historyList, setHistoryList] = useState<{ id: string; title: string; date: string; type: string; pluginKey?: string; instanceId?: string }[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);
  const filteredHistory = historyList.filter(h => {
    const term = historySearch.trim().toLowerCase();
    if (!term) return true;
    const agent = getHistoryAgentLabel(h, availableAgentOptions);
    return h.title.toLowerCase().includes(term)
      || agent.label.toLowerCase().includes(term)
      || (h.instanceId || '').toLowerCase().includes(term)
      || (h.pluginKey || '').toLowerCase().includes(term);
  });

  // 加载历史会话列表。按当前工作空间过滤，并从 session.context 中读取插件 key 与实例 id。
  const loadHistory = useCallback(async () => {
    const workspaceId = getCurrentWorkspaceId();
    try {
      const list = await api.get<(AgentSessionDTO & { context?: Record<string, unknown> })[]>(`/v1/sessions?workspaceId=${encodeURIComponent(workspaceId)}`);
      const mapped = list.map(s => {
        const pluginKey = typeof s.context?.pluginKey === 'string' ? s.context.pluginKey : (s.agentId || 'claude-code');
        const instanceId = typeof s.context?.instanceId === 'string' ? s.context.instanceId : undefined;
        return {
          id: s.id,
          title: formatSessionTitle(s, availableAgentOptions),
          date: s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
          type: s.agentType || 'chat',
          pluginKey,
          instanceId,
        };
      });
      setHistoryList(mapped);
      // 同步会话缓存，供方向键快速切换使用
      syncSessionHistory(workspaceId, list.map(s => ({
        sessionId: s.id,
        pluginKey: typeof s.context?.pluginKey === 'string' ? s.context.pluginKey : (s.agentId || 'claude-code'),
        title: formatSessionTitle(s, availableAgentOptions),
        instanceId: typeof s.context?.instanceId === 'string' ? s.context.instanceId : undefined,
        updatedAt: s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now(),
      })));
    } catch (err) {
      console.warn('[Chat] load history failed:', err);
    }
  }, [availableAgentOptions]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // 初始化智能体 tab：优先从 localStorage 恢复当前空间的 tab 列表，
  // 否则按默认智能体创建新会话。必须等 /available-agents 加载完成后再决定默认插件 key，
  // 否则初始值会是 DEFAULT_AGENT_OPTIONS 里的 claude-code，
  // 若当前空间未启用该智能体，createSession 会收到 403。
  // 整个恢复/创建过程通过 isInitializingChat 控制，避免先闪「会话不可用」再闪欢迎页。
  useEffect(() => {
    if (initializedRef.current || !availableAgentsLoaded || agentTabs.length > 0) return;
    initializedRef.current = true;
    setIsInitializingChat(true);

    const workspaceId = getCurrentWorkspaceId();
    const savedTabsRaw = localStorage.getItem(getChatTabsStorageKey(workspaceId));
    const savedActiveRaw = localStorage.getItem(getChatActiveTabStorageKey(workspaceId));

    const finish = () => setIsInitializingChat(false);

    // 新建默认会话流程：先尝试恢复 localStorage session，再创建新 session
    const initNewSession = async () => {
      const defaultKey = resolveDefaultAgentKey(workspaceAgentConfigs, availableAgentOptions);
      if (!defaultKey) {
        toast.error('空间管理员没有配置智能体，请联系空间管理员。');
        return;
      }
      const savedId = await tryRestoreSession();
      if (savedId) {
        const tab: AgentTab = {
          sessionId: savedId,
          pluginKey: defaultKey,
          title: getAgentLabel(defaultKey, availableAgentOptions),
          instanceId: '',
          status: 'idle',
        };
        setAgentTabs([tab]);
        setActiveAgentTabId(savedId);
        return;
      }
      const result = await createSession(defaultKey);
      if (result) {
        const tab: AgentTab = {
          sessionId: result.sessionId,
          pluginKey: defaultKey,
          title: getAgentLabel(defaultKey, availableAgentOptions),
          instanceId: result.instanceId,
          status: 'idle',
        };
        setAgentTabs([tab]);
        setActiveAgentTabId(result.sessionId);
      }
    };

    // 优先从 localStorage 恢复已保存的 tab 列表；会话失效时清除旧 tab 并新建
    if (savedTabsRaw) {
      try {
        const savedTabs = JSON.parse(savedTabsRaw) as AgentTab[];
        if (Array.isArray(savedTabs) && savedTabs.length > 0) {
          const validTabs = savedTabs.filter(t => t.sessionId && t.pluginKey);
          if (validTabs.length > 0) {
            const activeId = savedActiveRaw && validTabs.some(t => t.sessionId === savedActiveRaw)
              ? savedActiveRaw
              : validTabs[0].sessionId;
            setAgentTabs(validTabs);
            setActiveAgentTabId(activeId);
            switchSession(activeId).catch(() => {
              // 会话不存在（后端重启等），清除旧 tab 并新建会话
              localStorage.removeItem(getChatTabsStorageKey(workspaceId));
              localStorage.removeItem(getChatActiveTabStorageKey(workspaceId));
              return initNewSession();
            }).finally(finish);
            return;
          }
        }
      } catch {
        // 解析失败时回退到新建默认会话。
      }
    }

    initNewSession().finally(finish);
  }, [availableAgentsLoaded, availableAgentOptions, switchSession, workspaceAgentConfigs, createSession, tryRestoreSession]);

  const sessionFromQuery = searchParams.get('session');
  const sessionQueryHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (isInitializingChat || !sessionFromQuery || !availableAgentsLoaded) return;
    if (sessionQueryHandledRef.current === sessionFromQuery) return;
    if (agentTabs.some(t => t.sessionId === sessionFromQuery)) {
      setActiveAgentTabId(sessionFromQuery);
      switchSession(sessionFromQuery).catch(() => {});
      sessionQueryHandledRef.current = sessionFromQuery;
      return;
    }
    const defaultKey = resolveDefaultAgentKey(workspaceAgentConfigs, availableAgentOptions) ?? 'claude-code';
    const tab: AgentTab = {
      sessionId: sessionFromQuery,
      pluginKey: defaultKey,
      title: `[AI托管] ${sessionFromQuery.slice(-8)}`,
      instanceId: '',
      status: 'idle',
    };
    setAgentTabs(prev => [...prev, tab]);
    setActiveAgentTabId(sessionFromQuery);
    switchSession(sessionFromQuery).catch(() => {});
    sessionQueryHandledRef.current = sessionFromQuery;
  }, [isInitializingChat, sessionFromQuery, availableAgentsLoaded, agentTabs, workspaceAgentConfigs, availableAgentOptions, switchSession]);

  // 智能体 tab 持久化：跳过首次渲染，只在用户操作导致的状态变更后写入 localStorage。
  useEffect(() => {
    if (isInitialTabsPersistRef.current) {
      isInitialTabsPersistRef.current = false;
      return;
    }
    const workspaceId = getCurrentWorkspaceId();
    if (agentTabs.length === 0) {
      localStorage.removeItem(getChatTabsStorageKey(workspaceId));
      localStorage.removeItem(getChatActiveTabStorageKey(workspaceId));
      return;
    }
    localStorage.setItem(getChatTabsStorageKey(workspaceId), JSON.stringify(agentTabs));
    if (activeAgentTabId) {
      localStorage.setItem(getChatActiveTabStorageKey(workspaceId), activeAgentTabId);
    }
  }, [agentTabs, activeAgentTabId]);

  // 如果当前会话正在运行，先弹出确认框；确认后取消当前 run 再执行目标动作。
  const runIfIdleOrConfirm = useCallback((action: () => void, title: string) => {
    if (isRunning) {
      setSwitchConfirmTitle(title);
      pendingActionRef.current = () => {
        cancelRun();
        action();
      };
      setSwitchConfirmOpen(true);
      return;
    }
    action();
  }, [isRunning, cancelRun]);

  // 同步当前智能体 tab 的运行状态与最后 AI 输出时间。
  useEffect(() => {
    if (!activeAgentTabId) return;
    const activeTab = agentTabs.find(t => t.sessionId === activeAgentTabId);
    if (!activeTab) return;

    const lastAssistant = getLastAssistantTimestamp(messages);
    // 仅当时间戳真正变化时才更新，避免 updateAgentTab 产生新数组引用
    // 触发本 effect 依赖（agentTabs）变化，导致无限重渲染循环。
    if (lastAssistant && lastAssistant !== activeTab.lastAssistantAt) {
      updateAgentTab(activeAgentTabId, { lastAssistantAt: lastAssistant });
    }

    let nextStatus: AgentStatus = activeTab.status;
    if (activeTab.status === 'error') {
      nextStatus = 'error';
    } else if (isRunning) {
      nextStatus = 'running';
    } else if (isActiveWithinHour(lastAssistant ?? activeTab.lastAssistantAt)) {
      nextStatus = 'active';
    } else {
      nextStatus = 'idle';
    }
    if (nextStatus !== activeTab.status) {
      updateAgentTab(activeAgentTabId, { status: nextStatus });
    }
  }, [isRunning, messages, activeAgentTabId, agentTabs, updateAgentTab]);

  // 切换激活的智能体 tab 时，加载对应会话历史。
  const switchAgentTab = useCallback(async (tab: AgentTab) => {
    if (tab.sessionId === activeAgentTabId) return;
    runIfIdleOrConfirm(async () => {
      setActiveAgentTabId(tab.sessionId);
      try {
        await switchSession(tab.sessionId);
        updateAgentTab(tab.sessionId, { status: 'idle' });
      } catch {
        updateAgentTab(tab.sessionId, { status: 'error' });
      }
    }, `切换到：${tab.title}`);
  }, [activeAgentTabId, runIfIdleOrConfirm, switchSession, updateAgentTab]);

  // 关闭智能体 tab；同步删除后端会话，若关闭的是当前激活 tab，自动切换到相邻 tab。
  const closeAgentTab = useCallback(async (tab: AgentTab, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const doClose = async () => {
      const remaining = agentTabs.filter(t => t.sessionId !== tab.sessionId);
      setAgentTabs(remaining);
      removeSessionFromHistory(getCurrentWorkspaceId(), tab.sessionId);
      api.delete(`/v1/sessions/${tab.sessionId}`)
        .then(() => loadHistory())
        .catch(err => {
          console.warn('[closeAgentTab] delete session failed:', err);
        });
      if (activeAgentTabId !== tab.sessionId) return;
      if (remaining.length > 0) {
        const next = remaining[0];
        setActiveAgentTabId(next.sessionId);
        await switchSession(next.sessionId);
      } else {
        setActiveAgentTabId(null);
        await switchSession(null);
      }
    };
    runIfIdleOrConfirm(doClose, `关闭：${tab.title}`);
  }, [activeAgentTabId, agentTabs, loadHistory, runIfIdleOrConfirm, switchSession]);

  // 为当前智能体新建一个实例（替换当前 tab 的会话）。
  // 若当前会话已有消息，则保留为历史会话，不再删除；空会话直接清理。
  const handleNewSession = useCallback(async () => {
    if (!activeAgentTabId) return;
    const activeTab = agentTabs.find(t => t.sessionId === activeAgentTabId);
    if (!activeTab) return;
    runIfIdleOrConfirm(async () => {
      const oldSessionId = activeTab.sessionId;
      const result = await createSession(activeTab.pluginKey);
      if (!result) {
        updateAgentTab(activeAgentTabId, { status: 'error' });
        return;
      }
      // 只有空会话才删除，避免有对话记录的会话（包括问候/闲聊）被误清理。
      if (messages.length === 0) {
        api.delete(`/v1/sessions/${oldSessionId}`).catch(err => {
          console.warn('[handleNewSession] delete old session failed:', err);
        });
      }
      setAgentTabs(prev =>
        prev.map(t =>
          t.sessionId === oldSessionId
            ? {
                sessionId: result.sessionId,
                pluginKey: activeTab.pluginKey,
                title: activeTab.title,
                instanceId: result.instanceId,
                status: 'idle',
              }
            : t
        )
      );
      setActiveAgentTabId(result.sessionId);
      await switchSession(result.sessionId);
      loadHistory();
    }, '新建会话');
  }, [activeAgentTabId, agentTabs, createSession, loadHistory, messages.length, runIfIdleOrConfirm, switchSession, updateAgentTab]);

  // 新增一个智能体实例 tab。
  const addAgentTab = useCallback(async (pluginKey: string) => {
    setAgentMenuOpen(false);
    runIfIdleOrConfirm(async () => {
      const result = await createSession(pluginKey);
      if (!result) return;
      const tab: AgentTab = {
        sessionId: result.sessionId,
        pluginKey,
        title: getAgentLabel(pluginKey, availableAgentOptions),
        instanceId: result.instanceId,
        status: 'idle',
      };
      setAgentTabs(prev => [...prev, tab]);
      setActiveAgentTabId(result.sessionId);
      loadHistory();
    }, `新增：${getAgentLabel(pluginKey, availableAgentOptions)}`);
  }, [createSession, loadHistory, runIfIdleOrConfirm]);

  // 按 sessionId 打开会话：已开为 tab 则切换，否则新建 tab 并切换。
  // 供历史下拉点击和方向键快捷切换复用。
  const openSessionById = useCallback((sid: string, pluginKey: string, title: string, instanceId?: string) => {
    const existing = agentTabs.find(t => t.sessionId === sid);
    if (existing) {
      switchAgentTab(existing);
      return;
    }
    runIfIdleOrConfirm(() => {
      const tab: AgentTab = { sessionId: sid, pluginKey, title, instanceId, status: 'idle' };
      setAgentTabs(prev => [...prev, tab]);
      setActiveAgentTabId(sid);
      switchSession(sid);
    }, `切换到：${title}`);
  }, [agentTabs, runIfIdleOrConfirm, switchAgentTab, switchSession]);

  // 方向键快捷切换：从缓存读取最近 20 条会话，按 ↑/↓ 导航。
  const navigateSession = useCallback((direction: 'up' | 'down') => {
    const workspaceId = getCurrentWorkspaceId();
    const history = getSessionHistory(workspaceId);
    if (history.length === 0) return;
    const currentIdx = history.findIndex(h => h.sessionId === sessionId);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = 0;
    } else if (direction === 'up') {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : history.length - 1;
    } else {
      nextIdx = currentIdx < history.length - 1 ? currentIdx + 1 : 0;
    }
    const target = history[nextIdx];
    openSessionById(target.sessionId, target.pluginKey, target.title, target.instanceId);
  }, [sessionId, openSessionById]);

  // 全局方向键监听：非输入态、无弹窗时 ↑/↓ 切换会话。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateSession('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateSession('down');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigateSession]);

  // 当前会话变更时记录到缓存（供方向键导航和历史排序）。
  useEffect(() => {
    if (!sessionId) return;
    const tab = agentTabs.find(t => t.sessionId === sessionId);
    if (!tab) return;
    try {
      addSessionToHistory(getCurrentWorkspaceId(), {
        sessionId: tab.sessionId,
        pluginKey: tab.pluginKey,
        title: tab.title,
        instanceId: tab.instanceId,
        updatedAt: Date.now(),
      });
    } catch {
      // workspaceId 未就绪时忽略
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Derive task counts
  const allTasks = [...requirements, ...defects, ...cases];
  const completedCount = 
    requirements.filter(r => r.status === 'done').length + 
    defects.filter(d => d.status === 'fixed' || d.status === 'closed').length + 
    cases.filter(c => c.status === 'passed').length;
  const uncompletedCount = allTasks.length - completedCount;

  // Derive filtered lists
  const visibleRequirements = requirements.filter(r => filterConfig.reqStatuses.includes(r.status));
  const visibleDefects = defects.filter(d => filterConfig.defectStatuses.includes(d.status));
  const visibleCases = cases.filter(c => filterConfig.caseStatuses.includes(c.status));

  // 渲染需求/缺陷/用例列表（用于任务上拉菜单）。
  type TaskItem = ReqItem | DefectItem | CaseItem;
  const renderTaskList = (type: 'req' | 'defect' | 'case', items: TaskItem[]) => {
    if (items.length === 0) {
      return (
        <div className="py-6 text-center text-xs text-muted-foreground">
          暂无{type === 'req' ? '需求' : type === 'defect' ? '缺陷' : '用例'}
        </div>
      );
    }
    return (
      <div className="space-y-0.5">
        {items.map(item => {
          const isActive = detailType === type && detailId === item.id;
          return (
            <div
              key={item.id}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
                isActive ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-accent/60'
              }`}
            >
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail(type, item.id)}>
                <p className={`text-xs font-medium leading-snug truncate ${isActive ? 'text-primary' : 'text-foreground'}`}>
                  {item.title}
                </p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[item.status]}`}>
                    {type === 'req'
                      ? REQ_STATUS_LABELS[item.status as RequirementStatus]
                      : type === 'defect'
                        ? DEF_STATUS_LABELS[item.status as DefectStatus]
                        : CASE_STATUS_LABELS[item.status as CaseStatus]}
                  </span>
                  {type === 'defect' && 'severity' in item && (
                    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[item.severity]}`}>
                      {SEVERITY_LABELS[item.severity]}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground truncate">{item.reporter} 提</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuotedCard({ type, id: item.id, title: item.title, reporter: item.reporter });
                    setTaskMenuOpen(false);
                  }}
                  title="引用到会话"
                >
                  <Send className="h-3 w-3" />
                </button>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDetail(type, item.id);
                  }}
                  title="查看详情"
                >
                  <Info className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // 可复用的「设计」下拉菜单内容：按需求名分组，每个需求展示文档/原型两个操作按钮。
  const renderDesignMenu = () => (
    <div className="absolute bottom-full left-0 mb-2 w-96 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
      <div className="p-2 border-b border-border shrink-0">
        <Input
          placeholder="搜索需求..."
          value={designMenuSearch}
          onChange={e => setDesignMenuSearch(e.target.value)}
          className="h-8 text-sm"
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {filteredDesignItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">暂无可设计的需求</p>
        ) : (
          filteredDesignItems.map(item => {
            const doc = item.doc;
            const prototype = item.prototype;
            const docReferenced = doc ? referencedDocs.some(d => d.docId === doc.id) : false;
            return (
              <div
                key={item.workitemId}
                className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-left text-sm"
              >
                <Puzzle className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate font-medium">{item.workitemTitle}</span>
                <div className="flex items-center gap-1">
                  {doc && (
                    <button
                      disabled={materializingDocId === doc.id || docReferenced}
                      title={docReferenced ? '已引用该文档' : '引用文档重新设计'}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
                        docReferenced
                          ? 'opacity-50 cursor-default text-muted-foreground'
                          : 'hover:bg-accent text-foreground'
                      )}
                      onClick={() => handleDesignDoc(doc)}
                    >
                      {materializingDocId === doc.id ? (
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      ) : (
                        <BookOpen className="h-3 w-3" />
                      )}
                      文档
                    </button>
                  )}
                  {prototype && (
                    <button
                      title="基于需求重新生成原型"
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs hover:bg-accent text-foreground transition-colors"
                      onClick={() => handleDesignPrototype(prototype, item.workitemTitle)}
                    >
                      <LayoutTemplate className="h-3 w-3" />
                      原型
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const renderRepoMenu = (onSelect: (repo: { id: string; name: string; localPath?: string }) => void) => (
    <div className="absolute bottom-full left-0 mb-2 w-56 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
      {availableRepos.map(repo => {
        const sel = selectedRepos.some(r => r.id === repo.id);
        const syncStatus = userRepoStatuses.find(s => s.repositoryId === repo.id);
        const synced = syncStatus?.synced ?? false;
        const isSyncing = syncingRepoId === repo.id || syncStatus?.syncStatus === 'syncing';
        const syncProgress = syncStatus?.progress ?? 0;
        return (
          <div key={repo.id} className={`flex items-center w-full px-3 py-2 text-sm text-foreground ${synced ? 'hover:bg-accent cursor-pointer' : 'opacity-50 cursor-not-allowed'}`} onClick={() => onSelect(repo)}>
            <GitBranch className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate">{repo.name}</span>
            {isSyncing ? (
              <span className="flex items-center gap-1 ml-2 shrink-0">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {syncProgress > 0 && <span className="text-xs text-muted-foreground">{syncProgress}%</span>}
              </span>
            ) : !synced ? (
              <RefreshCw className="h-3.5 w-3.5 ml-2 shrink-0 text-muted-foreground hover:text-primary cursor-pointer" onClick={(e) => { e.stopPropagation(); handleSyncRepo(repo.id); }} />
            ) : sel ? (
              <CheckCircle className="h-4 w-4 text-primary ml-2 shrink-0" />
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const renderPromptMenu = (onSelect: (prompt: WorkspacePrompt) => void) => {
    // 「系统」分类仅在当前输入框指令绑定了系统提示词时出现，固定排在最前；
    // 空间分类中同名的「系统」被过滤，避免重复标签（系统分类为前端内置语义）。
    const categoryTabs = [
      ...(activeSystemPrompts.length > 0 ? [SYSTEM_PROMPT_CATEGORY_NAME] : []),
      '全部',
      ...sortPromptCategoriesByBuiltin(promptCategories)
        .map(c => c.name)
        .filter(name => name !== SYSTEM_PROMPT_CATEGORY_NAME),
    ];
    // 列表项统一为 { id, name, preview, onSelect }：系统分类取内置模板，其余取空间提示词。
    const isSystemCategory = promptMenuCategory === SYSTEM_PROMPT_CATEGORY_NAME && activeSystemPrompts.length > 0;
    const promptItems = isSystemCategory
      ? filteredSystemPrompts.map(p => ({ id: p.id, name: p.name, preview: p.content, onSelect: () => insertSystemPrompt(p) }))
      : filteredAvailablePrompts.map(p => ({ id: p.id, name: p.name, preview: p.content || p.description, onSelect: () => onSelect(p) }));
    return (
    <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
      <div className="p-2 border-b space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索提示词..."
            className="pl-8 h-8"
            value={promptMenuSearch}
            onChange={(e) => setPromptMenuSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {categoryTabs.map(cat => (
            <Button
              key={cat}
              variant={promptMenuCategory === cat ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs whitespace-nowrap"
              onClick={() => setPromptMenuCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        {promptItems.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无匹配提示词</div>
        )}
        {promptItems.map(p => (
          <div key={p.id} className="flex flex-col w-full px-3 py-2 hover:bg-accent cursor-pointer text-foreground rounded-md transition-colors" onClick={p.onSelect}>
            <span className="font-medium text-sm mb-1">{p.name}</span>
            <span className="text-xs text-muted-foreground line-clamp-2">{p.preview}</span>
          </div>
        ))}
      </div>
    </div>
    );
  };

  const renderSkillMenu = (onSelect: (skill: Skill) => void) => (
    <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
      <Tabs value={activeSkillTab} onValueChange={setActiveSkillTab} className="w-full h-full flex flex-col">
        <div className="px-2 pt-2 bg-muted/30 border-b space-y-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索技能..."
              className="pl-8 h-8"
              value={skillMenuSearch}
              onChange={(e) => setSkillMenuSearch(e.target.value)}
            />
          </div>
          <TabsList className="aurora-tab-bar level-2 w-full">
            {['全部', '需求设计', 'UI设计', '代码开发', '测试编写', '需求上线'].map(tab => (
              <TabsTrigger key={tab} value={tab} className="aurora-tab-item level-2">{tab}</TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {filteredAvailableSkills.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无匹配技能</div>
          )}
          {filteredAvailableSkills.map(skill => {
            const IconComponent = skillIconMap[skill.icon || ''] || Puzzle;
            return (
              <div key={skill.id} className="flex items-start gap-3 p-2.5 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors" onClick={() => onSelect(skill)}>
                <div className="h-8 w-8 rounded-md bg-background flex items-center justify-center border shrink-0"><IconComponent className="h-4 w-4 text-muted-foreground" /></div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="font-medium text-sm leading-none mb-1 text-foreground">{skill.name}</span>
                  <span className="text-xs text-muted-foreground line-clamp-2">{skill.description}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Tabs>
    </div>
  );

  const renderCmdMenu = (onSelect: (cmd: string) => void) => (
    <div className="absolute bottom-full left-0 mb-2 w-72 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
      <Tabs value={activeCommandTab} onValueChange={v => setActiveCommandTab(v as CommandCategory)} className="w-full h-full flex flex-col">
        <div className="px-2 pt-2 bg-muted/30 border-b shrink-0">
          <TabsList className="aurora-tab-bar level-2 w-full">
            {COMMAND_CATEGORY_ORDER.map(cat => (
              <TabsTrigger key={cat} value={cat} className="aurora-tab-item level-2">
                {COMMAND_CATEGORY_LABELS[cat]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-1">
          {commandConfigs
            .filter(item => getCommandCategory(item.cmd) === activeCommandTab)
            .map(item => {
              const Icon = COMMAND_ICON_MAP[item.cmd] ?? Terminal;
              const disabled = !item.enabled;
              return (
                <div
                  key={item.cmd}
                  title={disabled ? '当前指令已被禁用' : item.desc}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
                    disabled
                      ? 'opacity-50 cursor-not-allowed text-muted-foreground'
                      : 'cursor-pointer text-foreground hover:bg-accent'
                  )}
                  onClick={() => {
                    if (disabled) {
                      toast.error(`指令 ${item.cmd} 已被禁用`);
                      return;
                    }
                    onSelect(item.cmd);
                  }}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', disabled ? 'text-muted-foreground/60' : 'text-muted-foreground')} />
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('font-medium text-sm leading-none', disabled && 'line-through')}>{item.cmd}</span>
                      {disabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">
                          已禁用
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground mt-0.5">{item.label} · {item.desc}</span>
                  </div>
                </div>
              );
            })}
        </div>
      </Tabs>
    </div>
  );

  // ──────────────── Render ────────────────
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)] flex flex-row rounded-none md:rounded-2xl overflow-hidden glass-panel max-w-full mx-auto w-full relative">

        {/* agent.question 模态遮罩：半透明背景 + 禁止会话区域交互 */}
        {pendingQuestion && (
          <div className="absolute inset-0 z-30 bg-black/50 pointer-events-none" />
        )}

        <ResizablePanelGroup direction="horizontal" className="h-full w-full">
          {/* ── Inline Preview Area ── */}
          <ResizablePanel
            ref={previewPanelRef}
            defaultSize={0}
            minSize={20}
            collapsible={true}
            collapsedSize={0}
            className={cn(
              'h-full flex flex-col glass-panel overflow-hidden',
              !showPreview && 'pointer-events-none',
              pendingQuestion && 'pointer-events-none'
            )}
          >
            {showPreview && (
              <div className="h-full flex flex-col border-r border-border">
                {/* 预览历史导航栏 */}
                {(canGoBack || canGoForward) && (
                  <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/20 shrink-0">
                    <button
                      onClick={() => navigatePreview('back')}
                      disabled={!canGoBack}
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="后退"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => navigatePreview('forward')}
                      disabled={!canGoForward}
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="前进"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[10px] text-muted-foreground ml-1">{historyIndex + 1} / {previewHistory.length}</span>
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-hidden">
                  {previewPath && (
                    <InlineFilePreview
                      path={previewPath}
                      onClose={closePreview}
                      onProtoMake={handleProtoMake}
                      workitemId={effectivePrototypeWorkitemId}
                      requirementTitle={quotedCard?.type === 'req' ? quotedCard.title : protoMakeRequirementTitle}
                    />
                  )}
                  {projectPreview && (
                    <LivePreview
                      key={projectPreview.path}
                      projectPath={projectPreview.path}
                      mode={projectPreview.mode}
                      onModeChange={(nextMode) => setProjectPreview({ path: projectPreview.path, mode: nextMode })}
                      onFixRequest={handlePreviewFix}
                      onClose={closePreview}
                    />
                  )}
                  {userStoryPreview && (
                    <UserStoryPreview data={userStoryPreview} onClose={closePreview} />
                  )}
                  {reqBreakdownPreview && (
                    <RequirementBreakdownTree data={reqBreakdownPreview} />
                  )}
                  {prototypePreviewPath && (
                    <PrototypePreviewPanel
                      key={prototypePreviewPath}
                      productPath={prototypePreviewPath}
                      requirementTitle={prototypePreviewRequirementTitle}
                      workitemId={effectivePrototypeWorkitemId}
                      onClose={closePreview}
                    />
                  )}
                </div>
              </div>
            )}
          </ResizablePanel>

          {/* 拖拽分割线（预览关闭时隐藏但保留 DOM 结构） */}
          <ResizableHandle withHandle className={cn(!showPreview && 'pointer-events-none opacity-0 w-0')} />

          {/* ── Main Chat Area ── */}
          <ResizablePanel defaultSize={100} minSize={25} onResize={setMainPanelSize} className="h-full flex flex-col min-w-0 relative overflow-hidden">

        {/* Chat Header */}
        {/* z-20：使 header（及其内部 z-50 的历史会话/指令等下拉框）的层叠上下文
            高于会话消息区的折叠渐隐层(chat-bubble-fade z-10)与输入框(z-10)，
            避免未展开消息的模糊/渐隐效果遮挡从 header 下拉的历史会话项。 */}
        <div className="border-b border-border flex flex-col shrink-0 bg-panel/80 backdrop-blur-xl z-20 w-full">
          {/* 第一层：助手标题 + 智能体 tabs + 新增智能体 */}
          <div className={cn('flex items-center px-4 gap-2', showPreview ? 'h-10' : 'h-12')}>
            <Bot className={cn('text-primary shrink-0', showPreview ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
            <span className={cn('font-semibold shrink-0', showPreview ? 'text-xs' : 'text-sm')}>{showPreview ? '助手' : 'DeepHarness 助手'}</span>

            {showPreview ? (
              <Select
                value={activeAgentTabId || ''}
                onValueChange={(sid) => {
                  const existing = agentTabs.find(t => t.sessionId === sid);
                  if (existing) switchAgentTab(existing);
                }}
              >
                <SelectTrigger className="h-7 flex-1 min-w-0 text-xs" aria-label="选择智能体">
                  <Bot className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agentTabs.map(tab => (
                    <SelectItem key={tab.sessionId} value={tab.sessionId} className="text-xs">
                      <AgentInstanceLabel title={tab.title} instanceId={tab.instanceId} className="max-w-[180px]" />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto">
                {agentTabs.map(tab => {
                  const isActive = tab.sessionId === activeAgentTabId;
                  return (
                    <div
                      key={tab.sessionId}
                      data-session-id={tab.sessionId}
                      onClick={() => switchAgentTab(tab)}
                      className={`group flex items-center gap-1.5 pl-2 pr-1.5 h-7 max-w-[180px] rounded-md border text-xs cursor-pointer transition-colors shrink-0 ${
                        isActive
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'bg-panel/60 border-border text-foreground hover:bg-accent'
                      }`}
                      title={`${tab.title} · ${AGENT_STATUS_LABELS[tab.status]}${tab.instanceId ? ' · ' + tab.instanceId : ''}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${AGENT_STATUS_COLORS[tab.status]}`} />
                      <Bot className="h-3 w-3 shrink-0" />
                      <AgentInstanceLabel title={tab.title} instanceId={tab.instanceId} className="flex-1" />
                      <button
                        className="h-4 w-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-opacity shrink-0 disabled:opacity-0 disabled:cursor-not-allowed"
                        title={agentTabs.length <= 1 ? '至少保留一个智能体' : '关闭智能体'}
                        onClick={(e) => closeAgentTab(tab, e)}
                        disabled={agentTabs.length <= 1}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 新增智能体 */}
            <div className="relative shrink-0" ref={agentMenuRef}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => setAgentMenuOpen(!agentMenuOpen)}
                aria-label="新增智能体"
                title="新增智能体"
                disabled={!chatEnabled}
              >
                <Plus className="h-4 w-4" />
              </Button>
              {agentMenuOpen && (
                <div className="absolute top-full right-0 mt-1 w-40 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-2">
                  {enabledAgentOptions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">没有可用的智能体</div>
                  )}
                  {enabledAgentOptions.map(option => (
                    <div
                      key={option.agentKey}
                      className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => {
                        addAgentTab(option.agentKey);
                        setAgentMenuOpen(false);
                      }}
                    >
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{option.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 第二层：当前会话标题 + 历史会话 + 新建会话 */}
          <div className={cn('border-t border-border flex items-center gap-2 bg-muted/20', showPreview ? 'h-8 px-2' : 'h-10 px-4')}>
            <span className={cn('font-medium truncate min-w-0', showPreview ? 'text-xs' : 'text-sm')}>
              {activeTab
                ? <AgentInstanceLabel title={activeTab.title} instanceId={activeTab.instanceId} />
                : '未选择智能体'}
            </span>
            {activeTab && (
              <span className="text-xs text-muted-foreground">{AGENT_STATUS_LABELS[activeTab.status]}</span>
            )}

            <div className="ml-auto flex items-center gap-2 shrink-0">
              {/* 历史会话下拉 */}
              <div className="relative" ref={historyRef}>
                <Button
                  variant="outline" size="sm"
                  className={cn('text-xs gap-1.5', showPreview ? 'h-6 px-1.5' : 'h-7 px-2.5')}
                  onClick={() => { setHistoryOpen(v => !v); setAgentMenuOpen(false); setTaskMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); setCmdMenuOpen(false); }}
                >
                  <Clock className="h-3.5 w-3.5" />
                  {!showPreview && <span>历史会话</span>}
                  {!showPreview && <ChevronDown className="h-3 w-3" />}
                </Button>
                {historyOpen && (
                  <div className="absolute top-full right-0 mt-1 w-72 bg-popover border shadow-xl rounded-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <div className="p-2 border-b border-border">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="搜索历史会话..."
                          className="pl-8 h-7 text-xs bg-muted/30 border-border rounded-lg"
                          value={historySearch}
                          onChange={e => setHistorySearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="mt-1 px-1 text-[10px] text-muted-foreground">↑↓ 快速切换会话</div>
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                      {filteredHistory.length === 0 && (
                        <div className="py-6 text-center text-xs text-muted-foreground">暂无匹配的历史会话</div>
                      )}
                      {filteredHistory.map(h => (
                        <div
                          key={h.id}
                          className="group relative w-full flex items-center px-3 py-2 text-sm rounded-lg hover:bg-accent text-left transition-colors cursor-pointer"
                          onClick={() => {
                            setHistoryOpen(false);
                            openSessionById(h.id, h.pluginKey || 'claude-code', h.title, h.instanceId);
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {h.type === 'ui' && <Box className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                              {h.type === 'requirement' && <ListTodo className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                              {h.type === 'code' && <Code2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                              {h.type !== 'ui' && h.type !== 'requirement' && h.type !== 'code' && <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                              <span className="flex-1 truncate text-xs font-medium">{h.title}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline-block">{h.date}</span>
                            </div>
                            <div
                              className="text-[10px] text-muted-foreground truncate"
                              title={getHistoryAgentLabel(h, availableAgentOptions).full}
                            >
                              {getHistoryAgentLabel(h, availableAgentOptions).full}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 新建会话 */}
              <Button
                variant="ghost" size="sm"
                className={cn('text-muted-foreground hover:text-foreground shrink-0 gap-1.5', showPreview ? 'h-6 px-1.5' : 'h-7 px-2.5 text-xs')}
                onClick={handleNewSession}
                title="新建会话"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                {!showPreview && '新建会话'}
              </Button>
            </div>
          </div>
        </div>

        {/* Chat Messages */}
        {/* min-h-0：flex 列布局中 flex-1 子项默认 min-height:auto（内容高度），
            会导致内容超长时 ScrollArea 撑高而非滚动，把底部输入框挤出可见区被
            overflow-hidden 裁掉。min-h-0 允许其收缩到剩余空间并启用内部滚动。
            overflow-x-hidden 覆盖 ScrollArea 默认 overflow-x-visible，防止长内容把面板横向撑出会话窗口。 */}
        <ScrollArea id="chat-scroll-area" className={cn('flex-1 min-h-0 min-w-0 max-w-full overflow-x-hidden', showPreview ? 'p-2' : 'p-4 pr-8', pendingQuestion && 'pointer-events-none select-none')}
>
          <div className="space-y-6">
            {isInitializingChat ? (
              <div className="h-full flex flex-col items-center justify-center text-center pt-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                <h3 className="text-lg font-semibold mb-1">会话初始化中</h3>
                <p className="text-muted-foreground text-sm">正在恢复智能体配置与会话历史，请稍候...</p>
              </div>
            ) : !chatEnabled ? (
              <div className="h-full flex flex-col items-center justify-center text-center pt-20">
                <div className="h-14 w-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
                  <Bot className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold mb-1">智能会话不可用</h3>
                <p className="text-muted-foreground text-sm max-w-md mb-6">
                  空间管理员没有配置智能体，请联系空间管理员。
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center pt-20">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-1">DeepHarness 智能助手</h3>
                <p className="text-muted-foreground text-sm max-w-md mb-6">
                  我可以帮你撰写 PRD、调研需求、制作原型、编写代码。选择下方指令快速开始，或直接输入你的问题。
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl px-4">
                  {visibleWelcomeCards.map(card => {
                    const Icon = COMMAND_ICON_MAP[card.cmd] ?? Terminal;
                    return (
                      <Button
                        key={card.cmd}
                        variant="outline"
                        className="h-auto py-3 justify-start text-left glass-card click-card whitespace-normal"
                        onClick={() => insertCommand(card.cmd)}
                      >
                        <Icon className="h-4 w-4 mr-2 text-primary shrink-0" />
                        <div className="flex flex-col items-start min-w-0">
                          <span className="text-sm font-medium whitespace-normal break-words">{card.title}</span>
                          <span className="text-xs text-muted-foreground whitespace-normal break-words">{card.desc}</span>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                <ChatThread
                  runPhase={runPhase}
                  agentPluginKey={activePluginKey}
                  openDetail={openDetail}
                  onArtifactClick={() => setCodeJumpOpen(true)}
                  onFilePreview={handleFilePreview}
                  onProjectPreview={handleProjectPreview}
                  onUserStoryPreview={handleUserStoryPreview}
                  activeUserStoryData={userStoryPreview}
                  onReqBreakdownPreview={handleReqBreakdownPreview}
                  activeReqBreakdownData={reqBreakdownPreview}
                  onReqBreakdownSubmit={handleReqBreakdownSubmit}
                  onPrototypePreview={handlePrototypePreview}
                  onReviewReportPreview={handleFilePreview}
                  onReviewAdopt={handleReviewAdopt}
                  onReviewFix={handleReviewFix}
                  activePreviewPath={previewPath ?? undefined}
                  requirementTitle={effectiveRequirementTitle}
                  workitemId={effectivePrototypeWorkitemId}
                  requirements={requirements}
                  onEditMessage={(text, context) => {
                    setInput(text);
                    setQuotedCard(context?.quotedCard ?? null);
                    setSelectedRepos(context?.selectedRepos ?? []);
                    requestAnimationFrame(() => {
                      const ta = textareaRef.current;
                      if (!ta) return;
                      ta.focus();
                      ta.setSelectionRange(text.length, text.length);
                    });
                  }}
                  onRegenerate={() => {
                    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
                    if (lastUserMsg) {
                      const content = typeof lastUserMsg.content === 'string'
                        ? [{ type: 'text' as const, text: lastUserMsg.content }]
                        : lastUserMsg.content;
                      const textPart = content.find(p => p.type === 'text') as { text?: string } | undefined;
                      const text = textPart?.text || '';
                      const metadata = (lastUserMsg.metadata?.custom ?? {}) as { quotedCard?: any; selectedRepos?: any };
                      if (text) sendMessage(text, { quotedCard: metadata.quotedCard, selectedRepos: metadata.selectedRepos });
                    }
                  }}
                />
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Scroll-to-bottom floating button */}
        {messages.length > 0 && (
          <button
            className={`absolute right-5 bottom-48 z-50 h-8 w-8 rounded-full
              bg-white/90 border border-black/[0.08]
              shadow-[0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur
              flex items-center justify-center
              text-gray-600 hover:text-white
              hover:bg-primary/90 hover:-translate-y-px
              hover:shadow-[0_4px_12px_rgba(59,82,246,0.25)]
              active:scale-90
              transition-all duration-200 cursor-pointer
              ${!isAtBottom ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
              ${hasNewMessage ? 'animate-breathe' : ''}`}
            onClick={() => {
              setIsAtBottom(true);
              setHasNewMessage(false);
              const viewport = document.querySelector('#chat-scroll-area [data-radix-scroll-area-viewport]') as HTMLDivElement;
              if (viewport) {
                viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
              } else {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
              }
            }}
            title="滚动到最新消息"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}

        {/* Chat Input */}
        <div className={cn('shrink-0 flex justify-center bg-gradient-to-t from-background via-background/95 to-background/50', showPreview ? 'p-2' : 'p-3 md:p-5', pendingQuestion ? 'z-40' : 'z-10')}>
          <div className={cn('w-full relative flex flex-col rounded-3xl border bg-panel/80 backdrop-blur-xl soft-shadow overflow-visible', pendingQuestion && 'pointer-events-none')}>
            {(quotedCard || selectedRepos.length > 0) && (
              <div className={cn('flex flex-wrap gap-2 border-b border-border/10', showPreview ? 'px-3 pt-2 pb-1.5' : 'px-5 pt-3 pb-2')}>
                {quotedCard && (
                  <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 shrink-0', showPreview ? 'w-full' : 'w-56')}>
                    {quotedCard.type === 'req' && <ListTodo className="h-4 w-4 text-primary shrink-0" />}
                    {quotedCard.type === 'defect' && <Bug className="h-4 w-4 text-destructive shrink-0" />}
                    {quotedCard.type === 'case' && <FlaskConical className="h-4 w-4 text-violet-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{quotedCard.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{quotedCard.reporter} 提 · {quotedCard.id}</p>
                    </div>
                    <button
                      className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-primary/20 text-muted-foreground transition-colors shrink-0 -mr-1"
                      onClick={() => setQuotedCard(null)}
                      title="移除引用"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {selectedRepos.map(repo => (
                  <div key={repo.id} className="flex items-center gap-2 w-56 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 shrink-0">
                    <GitBranch className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{repo.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">引用工程仓库</p>
                    </div>
                    <button
                      className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-primary/20 text-muted-foreground transition-colors shrink-0 -mr-1"
                      onClick={() => toggleRepo(repo)}
                      title="移除引用"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* agent.question 内联提问卡片：显示在输入框上方，限制高度，只展示问题与选项。 */}
            {pendingQuestion && pendingQuestion.questions[0] && (() => {
              const q = pendingQuestion.questions[0];
              // gatewayd 不转发 options 字段，从最近的 assistant 消息文本中解析选项。
              const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
              let assistantText = '';
              if (lastAssistantMsg?.content) {
                for (const part of lastAssistantMsg.content) {
                  if (typeof part === 'object' && part.type === 'text') assistantText += (part as { text: string }).text;
                }
              }
              const { questionText: parsedQuestionText, options: parsedOptions } = parseInlineOptions(assistantText);
              const allOptions = q.options?.length ? q.options : parsedOptions;
              const displayQuestionText = parsedQuestionText || q.question || q.text || '需要你的输入';
              return (
              <div className={cn('border-b-2 border-primary/20 bg-amber-50/50 dark:bg-amber-950/20 pointer-events-auto max-h-[400px] overflow-y-auto', showPreview ? 'px-3 py-2.5' : 'px-5 py-3')}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                    <Lightbulb className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-sm font-medium text-foreground flex-1 whitespace-pre-line">{displayQuestionText}</span>
                  <button
                    type="button"
                    onClick={dismissQuestion}
                    title="关闭"
                    className="h-6 w-6 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* 选项按钮（A/B/C...） */}
                {allOptions.length > 0 && (
                  <div className="space-y-1.5 mb-2 pl-7">
                    {allOptions.map((opt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="w-full text-left px-3 py-2 rounded-lg bg-background border border-border hover:border-primary hover:bg-accent transition-colors cursor-pointer text-sm flex items-start gap-2"
                        onClick={() => respondToQuestion(opt.label, opt.label)}
                      >
                        <span className="font-bold text-primary shrink-0">{String.fromCharCode(65 + idx)}.</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-foreground">{opt.label}</span>
                          {opt.description && (
                            <span className="text-xs text-muted-foreground block mt-0.5">{opt.description}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {/* 自定义输入（始终可用） */}
                <div className="flex gap-2 items-center pl-7">
                  <Input
                    value={questionCustomInput}
                    onChange={(e) => setQuestionCustomInput(e.target.value)}
                    placeholder="输入自定义回答..."
                    className="h-8 text-sm bg-background"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && questionCustomInput.trim()) {
                        const val = questionCustomInput.trim();
                        respondToQuestion(val, val);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 shrink-0"
                    disabled={!questionCustomInput.trim()}
                    onClick={() => {
                      const val = questionCustomInput.trim();
                      if (val) respondToQuestion(val, val);
                    }}
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              );
            })()}
            <div className="relative">
            {/* @提及 高亮层：与 textarea 同字体/内边距叠放；textarea 文字透明仅显示光标与选区 */}
            <div
              ref={mentionOverlayRef}
              aria-hidden
              className={cn('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-5 text-base md:text-sm text-foreground z-0', showPreview ? 'py-3 text-sm' : 'py-4')}
            >
              {input.trim().length > 0 ? highlightedInput : null}
            </div>
            <Textarea
              ref={textareaRef}
              disabled={!chatEnabled}
              placeholder={chatEnabled ? '你想让 AI 助手做什么？ 例如：开发一个小游戏、实现一个新功能、做数据分析...' : '空间管理员没有配置智能体，请联系空间管理员。'}
              className={cn('relative w-full resize-none border-0 focus-visible:ring-0 px-5 py-4 shadow-none bg-transparent text-transparent caret-foreground focus:bg-transparent dark:bg-transparent dark:focus:bg-transparent z-10 leading-[1.5]', showPreview ? 'min-h-[60px] text-sm py-3' : 'min-h-[100px] text-base')}
              value={input}
              onChange={handleInputChange}
              onPaste={handlePaste}
              onKeyDown={handleInputKeyDown}
              onScroll={e => { if (mentionOverlayRef.current) mentionOverlayRef.current.scrollTop = e.currentTarget.scrollTop; }}
            />
            {slashMenuOpen && filteredSlashCommands.length > 0 && (
              <div className="absolute bottom-full left-4 mb-1 w-64 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                {filteredSlashCommands.map((item, idx) => {
                  const Icon = COMMAND_ICON_MAP[item.cmd] ?? Terminal;
                  const disabled = !item.enabled;
                  return (
                    <div
                      key={item.cmd}
                      title={disabled ? '当前指令已被禁用' : item.desc}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 transition-colors',
                        disabled
                          ? 'opacity-50 cursor-not-allowed text-muted-foreground'
                          : 'cursor-pointer text-foreground hover:bg-accent',
                        idx === slashIndex && !disabled && 'bg-accent'
                      )}
                      onClick={() => {
                        if (disabled) {
                          toast.error(`指令 ${item.cmd} 已被禁用`);
                          return;
                        }
                        selectSlashCommand(item.cmd);
                      }}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', disabled ? 'text-muted-foreground/60' : 'text-muted-foreground')} />
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn('font-medium text-sm leading-none', disabled && 'line-through')}>{item.cmd}</span>
                          {disabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/20">
                              已禁用
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground mt-0.5">{item.label} · {item.desc}</span>
                      </div>
                      {!disabled && item.requireRepos && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 shrink-0">需代码库</span>
                      )}
                      {!disabled && item.requireTask && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-400 shrink-0">需任务卡</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* @ 内联文档菜单：检索词即输入框中 @ 后的文本，上下键选择、回车确认 */}
            {docMention && (
              <div ref={docMentionMenuRef} className="absolute bottom-full left-4 mb-1 w-72 max-h-72 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border shrink-0">选择要引用的文档</div>
                <div className="overflow-y-auto py-1">
                  {filteredDocs.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">无匹配文档</p>
                  ) : (
                    filteredDocs.map((doc, idx) => (
                      <div
                        key={doc.id}
                        className={cn('flex items-center gap-2 px-3 py-2 cursor-pointer text-foreground transition-colors', idx === docMentionIndex ? 'bg-accent' : 'hover:bg-accent')}
                        onClick={() => handleSelectDoc(doc)}
                      >
                        {materializingDocId === doc.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                        ) : (
                          <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="flex-1 truncate text-sm">{doc.title}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            </div>
            <div className="flex items-center justify-between px-3 pb-3 mt-auto">
              <div className={cn('flex items-center gap-1.5 flex-wrap', toolbarLevel === 0 && 'gap-1')}>
                {/* 任务 */}
                <div className="relative" ref={taskMenuRef}>
                  <Button variant="outline" size="sm" className={cn('rounded-full text-xs hover:bg-muted', toolbarLevel === 0 ? 'h-7 px-2' : 'h-8 px-3')} onClick={() => { setTaskMenuOpen(!taskMenuOpen); setCmdMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}>
                    <ListTodo className={cn('mr-1.5', toolbarLevel === 0 ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{toolbarLevel === 0 ? '' : '任务'}
                    {uncompletedCount > 0 && (
                      <span className="ml-1.5 h-4 min-w-4 px-1 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center">
                        {uncompletedCount}
                      </span>
                    )}
                  </Button>
                  {taskMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-[360px] bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                      {/* 任务统计与操作 */}
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 shrink-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>总任务: <span className="font-semibold text-foreground">{allTasks.length}</span></span>
                          <span>已完成: <span className="font-semibold text-green-600 dark:text-green-400">{completedCount}</span></span>
                          <span>未完成: <span className="font-semibold text-amber-600 dark:text-amber-400">{uncompletedCount}</span></span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            title="看板视图"
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => { openKanban(activeTaskTab); setTaskMenuOpen(false); }}
                          >
                            <LayoutTemplate className="h-3 w-3" />
                          </button>
                          <button
                            title="筛选配置"
                            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => { setFilterDialogOpen(true); setTaskMenuOpen(false); }}
                          >
                            <SlidersHorizontal className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <Tabs value={activeTaskTab} onValueChange={(v) => setActiveTaskTab(v as typeof activeTaskTab)} className="w-full flex flex-col flex-1 min-h-0">
                        <div className="px-1 pt-2 bg-muted/30">
                          <TabsList className="aurora-tab-bar level-2 w-full">
                            <TabsTrigger value="req" className="aurora-tab-item level-2">需求</TabsTrigger>
                            <TabsTrigger value="defect" className="aurora-tab-item level-2">缺陷</TabsTrigger>
                            <TabsTrigger value="case" className="aurora-tab-item level-2">用例</TabsTrigger>
                          </TabsList>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                          {activeTaskTab === 'req' && renderTaskList('req', visibleRequirements)}
                          {activeTaskTab === 'defect' && renderTaskList('defect', visibleDefects)}
                          {activeTaskTab === 'case' && renderTaskList('case', visibleCases)}
                        </div>
                      </Tabs>
                    </div>
                  )}
                </div>

                {/* 直接展示的可折叠按钮：按容器宽度决定直接展示或收入 + 号菜单 */}
                {collapsibleToolbarItems.slice(0, visibleToolbarCount).map(type => {
                  if (type === 'design') {
                    return (
                      <div className="relative" key="design" ref={designMenuRef}>
                        <Button variant="outline" size="sm" className={cn('rounded-full text-xs hover:bg-muted', toolbarLevel === 0 ? 'h-7 px-2' : 'h-8 px-3')} onClick={() => { setDesignMenuOpen(!designMenuOpen); setDocMention(null); setTaskMenuOpen(false); setCmdMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}>
                          <Puzzle className={cn('mr-1.5', toolbarLevel === 0 ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{toolbarLevel === 0 ? '' : '设计'}
                          {activeRefCount > 0 && (
                            <span className="ml-1.5 h-4 min-w-4 px-1 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center">
                              {activeRefCount}
                            </span>
                          )}
                        </Button>
                        {designMenuOpen && renderDesignMenu()}
                      </div>
                    );
                  }
                  if (type === 'repo') {
                    return (
                      <div className="relative" key="repo" ref={repoMenuRef}>
                        <Button variant="outline" size="sm" className={cn('rounded-full text-xs hover:bg-muted', toolbarLevel === 0 ? 'h-7 px-2' : 'h-8 px-3')} onClick={() => { setRepoMenuOpen(!repoMenuOpen); setSkillPopoverOpen(false); setPromptMenuOpen(false); setTaskMenuOpen(false); setCmdMenuOpen(false); }}>
                          <Code2 className={cn('mr-1.5', toolbarLevel === 0 ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{toolbarLevel === 0 ? '' : '代码库'}
                        </Button>
                        {repoMenuOpen && renderRepoMenu(repo => { const syncStatus = userRepoStatuses.find(s => s.repositoryId === repo.id); if (syncStatus?.synced) toggleRepo(repo); })}
                      </div>
                    );
                  }
                  if (type === 'cmd') {
                    return (
                      <div className="relative" key="cmd" ref={cmdMenuRef}>
                        <Button variant="outline" size="sm" className={cn('rounded-full text-xs hover:bg-muted', toolbarLevel === 0 ? 'h-7 px-2' : 'h-8 px-3')} onClick={() => { setCmdMenuOpen(!cmdMenuOpen); setTaskMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}>
                          <Terminal className={cn('mr-1.5', toolbarLevel === 0 ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{toolbarLevel === 0 ? '' : '指令'}
                        </Button>
                        {cmdMenuOpen && renderCmdMenu(cmd => insertCommand(cmd))}
                      </div>
                    );
                  }
                  if (type === 'prompt') {
                    return (
                      <div className="relative" key="prompt" ref={promptMenuRef}>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            'relative rounded-full text-xs hover:bg-muted',
                            toolbarLevel === 0 ? 'h-7 px-2' : 'h-8 px-3',
                            // 当前指令有系统提示词时按钮高亮为紫色，与输入框中指令块的颜色语义一致。
                            activeSystemPrompts.length > 0 && 'border-violet-500/50 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-400',
                          )}
                          onClick={() => {
                            // 打开面板且当前指令有系统提示词时，默认选中「系统」分类。
                            if (!promptMenuOpen && activeSystemPrompts.length > 0) setPromptMenuCategory(SYSTEM_PROMPT_CATEGORY_NAME);
                            setPromptMenuOpen(!promptMenuOpen); setRepoMenuOpen(false); setSkillPopoverOpen(false); setTaskMenuOpen(false); setCmdMenuOpen(false);
                          }}
                        >
                          <FileText className={cn('mr-1.5', toolbarLevel === 0 ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{toolbarLevel === 0 ? '' : '提示词'}
                          {activeSystemPrompts.length > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-violet-500" />
                          )}
                        </Button>
                        {promptMenuOpen && renderPromptMenu(p => insertPrompt(p))}
                      </div>
                    );
                  }
                  if (type === 'skill') {
                    return (
                      <div className="relative" key="skill" ref={skillMenuRef} title="执行自定义技能功能暂未开放">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled
                          className={cn('rounded-full text-xs opacity-60 cursor-not-allowed', toolbarLevel === 0 ? 'h-7 px-2' : 'h-8 px-3')}
                                onClick={() => {}}
                        >
                          <Wand2 className={cn('mr-1.5', toolbarLevel === 0 ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{toolbarLevel === 0 ? '' : '技能'}
                        </Button>
                      </div>
                    );
                  }
                  return null;
                })}

                {/* + 号菜单：收纳因宽度不足被隐藏的工具 */}
                {collapsedToolbarItems.length > 0 && (
                  <div className="relative" ref={compactPlusRef}>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn('rounded-full p-0', toolbarLevel === 0 ? 'h-7 w-7' : 'h-8 w-8')}
                      onClick={() => { setCompactPlusOpen(!compactPlusOpen); setCompactPlusSubmenu(null); setCmdMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); setDesignMenuOpen(false); setTaskMenuOpen(false); }}
                      title="更多工具"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {compactPlusOpen && !compactPlusSubmenu && (
                      <div className="absolute bottom-full left-0 mb-2 bg-popover border shadow-xl rounded-xl flex items-center gap-0.5 z-50 p-1 animate-in fade-in slide-in-from-bottom-2">
                        {collapsedToolbarItems.map(type => {
                          if (type === 'design') {
                            return (
                              <button
                                key="design"
                                className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                                title="设计"
                                onClick={() => setCompactPlusSubmenu('design')}
                              >
                                <Puzzle className="h-4 w-4 text-muted-foreground" />
                              </button>
                            );
                          }
                          if (type === 'repo') {
                            return (
                              <button
                                key="repo"
                                className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                                title="代码库"
                                onClick={() => setCompactPlusSubmenu('repo')}
                              >
                                <GitBranch className="h-4 w-4 text-muted-foreground" />
                              </button>
                            );
                          }
                          if (type === 'cmd') {
                            return (
                              <button
                                key="cmd"
                                className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                                title="指令"
                                onClick={() => setCompactPlusSubmenu('cmd')}
                              >
                                <Terminal className="h-4 w-4 text-muted-foreground" />
                              </button>
                            );
                          }
                          if (type === 'prompt') {
                            return (
                              <button
                                key="prompt"
                                className="relative h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                                title="提示词"
                                onClick={() => {
                                  // 与工具栏提示词按钮一致：打开子菜单时默认选中「系统」分类。
                                  if (activeSystemPrompts.length > 0) setPromptMenuCategory(SYSTEM_PROMPT_CATEGORY_NAME);
                                  setCompactPlusSubmenu('prompt');
                                }}
                              >
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                {activeSystemPrompts.length > 0 && (
                                  <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-violet-500" />
                                )}
                              </button>
                            );
                          }
                          if (type === 'skill') {
                            return (
                              <button
                                key="skill"
                                disabled
                                className="h-8 w-8 rounded-md flex items-center justify-center opacity-50 cursor-not-allowed transition-colors"
                                title="执行自定义技能功能暂未开放"
                          onClick={() => {}}
                              >
                                <Wand2 className="h-4 w-4 text-muted-foreground" />
                              </button>
                            );
                          }
                          return null;
                        })}
                      </div>
                    )}
                    {compactPlusSubmenu === 'design' && renderDesignMenu()}
                    {compactPlusSubmenu === 'repo' && renderRepoMenu(repo => { const syncStatus = userRepoStatuses.find(s => s.repositoryId === repo.id); if (syncStatus?.synced) { toggleRepo(repo); setCompactPlusSubmenu(null); setCompactPlusOpen(false); } })}
                    {compactPlusSubmenu === 'cmd' && renderCmdMenu(cmd => { insertCommand(cmd); setCompactPlusSubmenu(null); setCompactPlusOpen(false); })}
                    {compactPlusSubmenu === 'prompt' && renderPromptMenu(p => { insertPrompt(p); setCompactPlusSubmenu(null); setCompactPlusOpen(false); })}
                    {compactPlusSubmenu === 'skill' && renderSkillMenu(skill => { appendSkillTag(skill.name); setCompactPlusSubmenu(null); setCompactPlusOpen(false); })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      // Reset value so same file can be selected again
                      e.target.value = '';
                    }
                  }} 
                />
                <Button variant="ghost" size="icon" className={cn('text-muted-foreground rounded-full hover:bg-muted', showPreview ? 'h-7 w-7' : 'h-8 w-8')} onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-4 w-4" />
                </Button>

                {/* Queued inputs badge */}
                {inputQueue.length > 0 && (
                  <div className="relative" ref={queueMenuRef}>
                    <button
                      className="h-8 pl-2.5 pr-1.5 rounded-full bg-primary/10 text-primary text-xs flex items-center gap-1 hover:bg-primary/20 transition-colors"
                      onClick={() => setQueueMenuOpen(!queueMenuOpen)}
                      title="查看排队输入"
                    >
                      <span>{inputQueue.length}</span>
                      <X className="h-3 w-3" />
                    </button>
                    {queueMenuOpen && (
                      <div className="absolute bottom-full right-0 mb-2 w-64 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden p-1.5 animate-in fade-in slide-in-from-bottom-2">
                        <div className="text-xs font-medium text-muted-foreground px-2 py-1">排队输入</div>
                        {inputQueue.map(item => (
                          <div key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent group">
                            <span className="text-xs truncate flex-1" title={item.text}>{item.text}</span>
                            <button
                              className="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-opacity"
                              onClick={() => setInputQueue(prev => prev.filter(i => i.id !== item.id))}
                              title="移除"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {isRunning ? (
                  <Button size="sm" variant="outline" className="h-9 px-4 rounded-full" onClick={cancelRun}>
                    <span className="mr-1.5 text-sm">取消</span><X className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" className={cn('rounded-full', showPreview ? 'h-8 px-3' : 'h-9 px-4')} disabled={!input.trim() && !quotedCard} onClick={handleSend}>
                    <span className={cn('mr-1.5', showPreview ? 'text-xs' : 'text-sm')}>执行</span><Send className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Filter Dialog */}
        <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>任务筛选配置</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold">需求状态</Label>
                <div className="space-y-1.5">
                  {(['todo', 'in-progress', 'done', 'cancelled', 'on-hold'] as RequirementStatus[]).map(status => (
                    <div key={status} className="flex items-center gap-2">
                      <Checkbox
                        id={`req-${status}`}
                        checked={filterConfig.reqStatuses.includes(status)}
                        onCheckedChange={(checked) => {
                          setFilterConfig(prev => ({
                            ...prev,
                            reqStatuses: checked
                              ? [...prev.reqStatuses, status]
                              : prev.reqStatuses.filter(s => s !== status)
                          }));
                        }}
                      />
                      <Label htmlFor={`req-${status}`} className="text-xs cursor-pointer">{REQ_STATUS_LABELS[status as RequirementStatus]}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">缺陷状态</Label>
                <div className="space-y-1.5">
                  {(['open', 'in-progress', 'fixed', 'closed'] as DefectStatus[]).map(status => (
                    <div key={status} className="flex items-center gap-2">
                      <Checkbox
                        id={`defect-${status}`}
                        checked={filterConfig.defectStatuses.includes(status)}
                        onCheckedChange={(checked) => {
                          setFilterConfig(prev => ({
                            ...prev,
                            defectStatuses: checked
                              ? [...prev.defectStatuses, status]
                              : prev.defectStatuses.filter(s => s !== status)
                          }));
                        }}
                      />
                      <Label htmlFor={`defect-${status}`} className="text-xs cursor-pointer">{DEF_STATUS_LABELS[status as DefectStatus]}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold">用例状态</Label>
                <div className="space-y-1.5">
                  {(['draft', 'ready', 'passed', 'failed', 'blocked'] as CaseStatus[]).map(status => (
                    <div key={status} className="flex items-center gap-2">
                      <Checkbox
                        id={`case-${status}`}
                        checked={filterConfig.caseStatuses.includes(status)}
                        onCheckedChange={(checked) => {
                          setFilterConfig(prev => ({
                            ...prev,
                            caseStatuses: checked
                              ? [...prev.caseStatuses, status]
                              : prev.caseStatuses.filter(s => s !== status)
                          }));
                        }}
                      />
                      <Label htmlFor={`case-${status}`} className="text-xs cursor-pointer">{CASE_STATUS_LABELS[status as CaseStatus]}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFilterDialogOpen(false)}>关闭</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Detail Dialog ── */}
        <Dialog open={detailOpen} onOpenChange={closeDetail}>
          <DialogContent hideClose className="w-full max-w-[760px] p-0 flex flex-col max-h-[85vh] overflow-hidden">
            {detailOpen && (
              <>
                <DialogHeader className="px-6 py-5 border-b border-border/50">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted">
                        {detailType === 'req' && <ListTodo className="h-4 w-4 text-primary" />}
                        {detailType === 'defect' && <Bug className="h-4 w-4 text-destructive" />}
                        {detailType === 'case' && <FlaskConical className="h-4 w-4 text-violet-500" />}
                      </div>
                      <div className="text-left">
                        <DialogTitle className="text-lg font-semibold">
                          {detailType === 'req' && '需求详情'}
                          {detailType === 'defect' && '缺陷详情'}
                          {detailType === 'case' && '用例详情'}
                        </DialogTitle>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {/* 上/下切换：小尺寸、浅灰、圆形 hover 底 */}
                      <div className="flex items-center gap-1">
                        <button
                          className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                          onClick={handlePrevItem}
                          title="上一个"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                          onClick={handleNextItem}
                          title="下一个"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                      {/* 关闭：独立分组、深色、更大 */}
                      <button
                        className="h-9 w-9 rounded-full flex items-center justify-center text-foreground hover:bg-muted transition-colors"
                        onClick={closeDetail}
                        title="关闭"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 modal-content-scroll">
                  {/* 需求详情 */}
                  {detailType === 'req' && detailReq && (
                    <>
                      <section>
                        <h4 className="text-sm font-medium text-foreground mb-3">基本信息</h4>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                          <ChatDetailField label="标题" value={detailReq.title} />
                          <ChatDetailField label="提出人" value={detailReq.reporter} />
                          <ChatDetailField label="状态" value={REQ_STATUS_LABELS[detailReq.status]} />
                          <ChatDetailField label="创建时间" value={detailReq.createdAt} />
                        </div>
                        <div className="mt-4">
                          <p className="text-xs text-muted-foreground mb-2">状态变更</p>
                          <Select value={detailReq.status} onValueChange={(val: RequirementStatus) => updateReqStatus(detailReq.id, val)}>
                            <SelectTrigger className="w-[160px] h-8 text-xs bg-white dark:bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(REQ_STATUS_LABELS) as RequirementStatus[]).map(s => (
                                <SelectItem key={s} value={s}>
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[s].split(' ')[0]}`} />
                                    {REQ_STATUS_LABELS[s]}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </section>

                      <div className="w-full h-px bg-border/50" />

                      <section>
                        <h4 className="text-sm font-medium text-foreground mb-3">任务描述</h4>
                        <div className="h-[240px] overflow-y-auto rounded-xl p-4 bg-muted/40">
                          <MarkdownView content={detailReq.description} collapsible={false} />
                        </div>
                      </section>
                    </>
                  )}

                  {/* 缺陷详情 */}
                  {detailType === 'defect' && detailDef && (
                    <>
                      <section>
                        <h4 className="text-sm font-medium text-foreground mb-3">基本信息</h4>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                          <ChatDetailField label="标题" value={detailDef.title} />
                          <ChatDetailField label="提出人" value={detailDef.reporter} />
                          <ChatDetailField label="严重程度" value={SEVERITY_LABELS[detailDef.severity]} />
                          <ChatDetailField label="状态" value={DEF_STATUS_LABELS[detailDef.status]} />
                          <ChatDetailField label="创建时间" value={detailDef.createdAt} />
                        </div>
                        <div className="mt-4">
                          <p className="text-xs text-muted-foreground mb-2">状态变更</p>
                          <Select value={detailDef.status} onValueChange={(val: DefectStatus) => updateDefStatus(detailDef.id, val)}>
                            <SelectTrigger className="w-[160px] h-8 text-xs bg-white dark:bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(DEF_STATUS_LABELS) as DefectStatus[]).map(s => (
                                <SelectItem key={s} value={s}>
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[s].split(' ')[0]}`} />
                                    {DEF_STATUS_LABELS[s]}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </section>

                      <div className="w-full h-px bg-border/50" />

                      <section>
                        <h4 className="text-sm font-medium text-foreground mb-3">缺陷描述</h4>
                        <div className="h-[240px] overflow-y-auto rounded-xl p-4 bg-muted/40">
                          <MarkdownView content={detailDef.description} collapsible={false} />
                        </div>
                      </section>
                    </>
                  )}

                  {/* 用例详情 */}
                  {detailType === 'case' && detailCase && (
                    <>
                      <section>
                        <h4 className="text-sm font-medium text-foreground mb-3">基本信息</h4>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                          <ChatDetailField label="标题" value={detailCase.title} />
                          <ChatDetailField label="提出人" value={detailCase.reporter} />
                          <ChatDetailField label="状态" value={CASE_STATUS_LABELS[detailCase.status]} />
                          <ChatDetailField label="创建时间" value={detailCase.createdAt} />
                        </div>
                        <div className="mt-4">
                          <p className="text-xs text-muted-foreground mb-2">状态变更</p>
                          <Select value={detailCase.status} onValueChange={(val: CaseStatus) => updateCaseStatus(detailCase.id, val)}>
                            <SelectTrigger className="w-[160px] h-8 text-xs bg-white dark:bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(CASE_STATUS_LABELS) as CaseStatus[]).map(s => (
                                <SelectItem key={s} value={s}>
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[s].split(' ')[0]}`} />
                                    {CASE_STATUS_LABELS[s]}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </section>

                      <div className="w-full h-px bg-border/50" />

                      <section>
                        <h4 className="text-sm font-medium text-foreground mb-3">用例描述</h4>
                        <div className="h-[180px] overflow-y-auto rounded-xl p-4 bg-muted/40">
                          <MarkdownView content={detailCase.description} collapsible={false} />
                        </div>
                      </section>

                      <div className="w-full h-px bg-border/50" />

                      <section>
                        <h4 className="text-sm font-medium text-foreground mb-3">执行步骤</h4>
                        <div className="rounded-xl p-4 bg-muted/40">
                          <ol className="space-y-2">
                            {detailCase.steps.map((step, i) => (
                              <li key={i} className="flex gap-2 text-sm text-foreground">
                                <span className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-medium text-xs">{i + 1}</span>
                                <span className="leading-relaxed">{step}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      </section>
                    </>
                  )}

                </div>

                <DialogFooter className="px-6 py-4 border-t border-border/50 flex justify-end items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => { openKanban(detailType, detailReq?.id ?? detailDef?.id ?? detailCase?.id ?? ''); closeDetail(); }}>
                    在看板中查看
                  </Button>
                  <Button size="sm" onClick={() => {
                    if (detailType === 'req' && detailReq) {
                      setQuotedCard({ type: 'req', id: detailReq.id, title: detailReq.title, reporter: detailReq.reporter });
                    } else if (detailType === 'defect' && detailDef) {
                      setQuotedCard({ type: 'defect', id: detailDef.id, title: detailDef.title, reporter: detailDef.reporter });
                    } else if (detailType === 'case' && detailCase) {
                      setQuotedCard({ type: 'case', id: detailCase.id, title: detailCase.title, reporter: detailCase.reporter });
                    }
                    closeDetail();
                  }}>
                    引用到会话
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Kanban Drawer (full overlay) ── */}
        <div className={`absolute inset-0 bg-background z-40 flex flex-col transition-transform duration-300 ${kanbanOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {kanbanOpen && (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                <LayoutTemplate className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">
                  {kanbanType === 'req' ? '需求追踪' : kanbanType === 'defect' ? '缺陷看板' : '用例看板'}
                </span>
                <button className="ml-auto h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground" onClick={closeKanban}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-x-auto overflow-y-hidden">
                {kanbanType === 'req' ? (
                  <RequirementKanban
                    items={requirements}
                    highlightId={kanbanHighlightId}
                    onOpenDetail={id => openDetail('req', id)}
                    setItemRef={(id, el) => { kanbanItemRefs.current[id] = el; }}
                  />
                ) : (
                  <div className="flex h-full gap-3 p-4 min-w-max">
                    {(kanbanType === 'defect' ? DEF_KANBAN_COLS : CASE_KANBAN_COLS).map(col => {
                      const items = kanbanType === 'defect'
                        ? defects.filter(d => d.status === col.key)
                        : cases.filter(c => c.status === col.key);
                      return (
                        <div key={col.key} className="flex flex-col w-56 shrink-0">
                          <div className={`flex items-center justify-between px-3 py-2.5 mb-3 rounded-xl shrink-0 ${getColColorStyle(col.key)}`}>
                            <span className={`text-sm font-semibold ${getColTitleStyle(col.key)}`}>{col.label}</span>
                            <span className={`h-6 w-6 rounded-full grid place-items-center text-xs font-bold text-white ${getColCountStyle(col.key)}`}>{items.length}</span>
                          </div>
                          <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto pb-2">
                            {items.map(item => {
                              const isHighlight = item.id === kanbanHighlightId;
                              const isDone = KANBAN_DONE_STATUSES.includes(item.status);
                              return (
                                <div
                                  key={item.id}
                                  ref={el => { kanbanItemRefs.current[item.id] = el; }}
                                  className={`relative p-3 pl-4 rounded-xl border bg-card cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-md ${isHighlight ? 'border-primary shadow-md ring-2 ring-primary/30' : 'border-border'} ${isDone ? 'opacity-75' : ''}`}
                                  onClick={() => {
                                    setKanbanHighlightId(item.id);
                                    openDetail(kanbanType, item.id);
                                  }}
                                >
                                  {'severity' in item && (
                                    <span className={`absolute left-0 top-0 h-full w-1 rounded-l-xl ${SEVERITY_BAR_COLORS[(item as DefectItem).severity] ?? 'bg-muted-foreground/40'}`} />
                                  )}
                                  <p className={`text-xs font-medium leading-snug mb-2 ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.title}</p>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground">{item.id}</span>
                                    {'severity' in item && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[(item as DefectItem).severity]}`}>
                                        {SEVERITY_LABELS[(item as DefectItem).severity]}
                                      </span>
                                    )}
                                  </div>
                                  {'reporter' in item && (
                                    <p className="text-[10px] text-muted-foreground mt-1">{(item as DefectItem | CaseItem).reporter} 提</p>
                                  )}
                                </div>
                              );
                            })}
                            {items.length === 0 && (
                              <div className="flex-1 flex items-center justify-center py-8 text-xs text-muted-foreground opacity-60 border border-dashed border-border/40 rounded-xl">暂无</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {/* Code Jump Confirmation Dialog */}
        <AlertDialog open={codeJumpOpen} onOpenChange={setCodeJumpOpen}>
          <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>跳转到工程仓库</AlertDialogTitle>
              <AlertDialogDescription>
                是否要跳转到代码库窗口，查看完整的工程仓库？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setCodeJumpOpen(false); navigate('/code'); }}>
                确认跳转
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 运行中切换/新建会话确认对话框 */}
        <AlertDialog open={switchConfirmOpen} onOpenChange={setSwitchConfirmOpen}>
          <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>{switchConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                当前会话正在输出内容，切换会话会取消当前会话。是否继续？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { pendingActionRef.current = null; }}>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                setSwitchConfirmOpen(false);
                pendingActionRef.current?.();
                pendingActionRef.current = null;
              }}>
                确认切换
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
         </AlertDialog>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </AssistantRuntimeProvider>
  );
};
