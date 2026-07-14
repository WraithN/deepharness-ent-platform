import '@/lib/patch-assistant-ui';
import { AssistantRuntimeProvider, type ThreadMessageLike } from '@assistant-ui/react';
import {
  BookOpen,
  Bot,
  Box,
  Bug,
  Check, 
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Compass,
  FileText,
  FlaskConical,
  GitBranch,
  Info,
  LayoutTemplate,
  ListTodo,
  Loader2,
  MessageSquarePlus,
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
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChatThread } from '@/components/chat/ChatThread';
import { InlineFilePreview } from '@/components/chat/InlineFilePreview';
import { LivePreview, type PreviewMode } from '@/components/chat/LivePreview';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { PROTO_MAKE_PENDING_KEY } from '@/lib/constants';
import { fileApi } from '@/lib/file-api';
import { type ProductDoc, productDocApi } from '@/lib/productdoc-api';
import { sortPromptCategoriesByBuiltin } from '@/lib/prompt-categories';
import { repositoryApi, type UserRepoStatus } from '@/lib/repository-api';
import { SUB_ROLE, type SubRole } from '@/lib/role-constants';
import { teamApi } from '@/lib/team-api';
import { cn } from '@/lib/utils';
import { workspaceApi } from '@/lib/workspace-api';
import type { AvailableAgent, PromptCategory, Skill, WorkspaceAgent, WorkspacePrompt } from '@/types';

// ──────────────── Types ────────────────
type RequirementStatus = 'todo' | 'in-progress' | 'done' | 'cancelled' | 'on-hold';
type DefectStatus = 'open' | 'in-progress' | 'fixed' | 'closed';
type DefectSeverity = 'critical' | 'high' | 'medium' | 'low';
type CaseStatus = 'draft' | 'ready' | 'passed' | 'failed' | 'blocked';

type PreviewHistoryEntry =
  | { type: 'file'; path: string }
  | { type: 'project'; path: string; mode: PreviewMode };

interface ReqItem {
  id: string; title: string; description: string;
  status: RequirementStatus; assigneeId: string; reporter: string; createdAt: string;
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

// ──────────────── Mock Data ────────────────
const MOCK_HISTORY = [
  { id: '1', title: '实现登录页面UI', date: '10分钟前', type: 'ui' },
  { id: '2', title: '用户管理模块需求分析', date: '2小时前', type: 'requirement' },
  { id: '3', title: '修复API跨域问题', date: '昨天', type: 'code' },
  { id: '4', title: '重构数据库表结构', date: '昨天', type: 'code' },
  { id: '5', title: '订单模块接口设计', date: '前天', type: 'code' },
  { id: '6', title: '权限控制方案', date: '3天前', type: 'requirement' },
];

const MOCK_MESSAGES = [
  { id: 'm1', role: 'user', content: '帮我设计一个现代化的登录页面，需要包含邮箱、密码输入框，以及第三方登录选项。' },
  {
    id: 'm2', role: 'assistant',
    content: '好的，我已经为您设计了一个现代化的登录页面。这个设计采用了简洁的卡片式布局，左侧是大图展示品牌形象，右侧是登录表单。',
    artifact: { id: 'art_1', type: 'ui', title: 'Login_Page_Design.tsx' }
  },
  { id: 'm3', role: 'user', content: '能不能把主色调换成深蓝色（#1890ff）？' },
  {
    id: 'm4', role: 'assistant',
    content: '没问题，我已经将按钮、高亮链接和部分图标的主色调更新为了深蓝色（#1890ff）。这样看起来更加商务和专业。',
    artifact: { id: 'art_2', type: 'ui', title: 'Login_Page_Design_v2.tsx' }
  }
];

const MOCK_REQUIREMENTS: ReqItem[] = [
  { id: 'REQ-001', title: '实现多租户登录功能', description: '支持不同租户间的数据隔离和单点登录，需要实现OAuth2.0协议和JWT Token验证机制。', status: 'done', assigneeId: 'u1', reporter: '产品小红', createdAt: '2026-05-20' },
  { id: 'REQ-002', title: '数据大盘图表展示', description: '集成ECharts实现多维度数据可视化，支持折线图、柱状图、饼图等常见图表类型。', status: 'in-progress', assigneeId: 'u1', reporter: '产品小红', createdAt: '2026-05-22' },
  { id: 'REQ-003', title: 'UI设计对话助手', description: '基于自然语言理解，自动生成UI组件建议和设计方案，支持多轮对话迭代。', status: 'todo', assigneeId: 'u1', reporter: '设计小李', createdAt: '2026-05-25' },
  { id: 'REQ-004', title: '智能评审结果展示', description: '将代码评审结果以结构化方式展示，支持按严重程度和文件分组。', status: 'todo', assigneeId: 'u1', reporter: '设计小李', createdAt: '2026-05-27' },
  { id: 'REQ-005', title: 'API 网关限流配置', description: '基于令牌桶算法实现API限流，支持按用户、IP、接口维度配置限流规则。', status: 'todo', assigneeId: 'u1', reporter: '产品小红', createdAt: '2026-05-28' },
];

const MOCK_DEFECTS: DefectItem[] = [
  { id: 'BUG-001', title: '登录页面验证码不刷新', description: '点击验证码图片后，网络请求返回200但图片未更新，需要排查缓存策略。', status: 'open', severity: 'high', assigneeId: 'u1', reporter: '测试小刚', createdAt: '2026-05-26' },
  { id: 'BUG-002', title: '数据大盘图表数据异常', description: '当选择时间范围超过30天时，折线图数据点重叠导致渲染性能下降。', status: 'in-progress', severity: 'medium', assigneeId: 'u1', reporter: '测试小刚', createdAt: '2026-05-27' },
  { id: 'BUG-003', title: '移动端菜单无法展开', description: '在iOS Safari浏览器中，侧边栏菜单按钮点击无响应，需要检查事件绑定。', status: 'fixed', severity: 'critical', assigneeId: 'u1', reporter: '产品小红', createdAt: '2026-05-25' },
  { id: 'BUG-004', title: '导出PDF文件乱码', description: '中文字体在导出PDF时出现方块，需要嵌入字体文件并配置字体映射。', status: 'closed', severity: 'low', assigneeId: 'u1', reporter: '设计小李', createdAt: '2026-05-20' },
];

const MOCK_CASES: CaseItem[] = [
  {
    id: 'TC-001', title: '登录功能-正常登录验证', description: '验证用户使用正确的账号密码可以成功登录系统。',
    status: 'passed', assigneeId: 'u1', reporter: '测试小刚', createdAt: '2026-05-22',
    steps: ['打开登录页面', '输入正确的邮箱和密码', '点击登录按钮', '验证跳转到首页并显示用户信息']
  },
  {
    id: 'TC-002', title: '登录功能-密码错误处理', description: '验证输入错误密码时系统给出正确的错误提示。',
    status: 'passed', assigneeId: 'u1', reporter: '测试小刚', createdAt: '2026-05-22',
    steps: ['打开登录页面', '输入正确邮箱和错误密码', '点击登录按钮', '验证出现"账号或密码错误"提示']
  },
  {
    id: 'TC-003', title: '数据大盘-时间范围筛选', description: '验证时间范围选择器正确过滤图表数据。',
    status: 'failed', assigneeId: 'u1', reporter: '产品小红', createdAt: '2026-05-27',
    steps: ['进入数据大盘页面', '点击时间范围选择器', '选择"最近30天"', '验证图表数据与选中范围匹配']
  },
  {
    id: 'TC-004', title: '权限管理-角色分配', description: '验证管理员可以正确分配用户角色。',
    status: 'draft', assigneeId: 'u1', reporter: '产品小红', createdAt: '2026-05-28',
    steps: ['进入用户管理', '选中目标用户', '点击"分配角色"', '选择角色并保存', '验证角色权限生效']
  },
  {
    id: 'TC-005', title: 'API限流-超限响应验证', description: '验证超过限流阈值后接口返回429状态码。',
    status: 'ready', assigneeId: 'u1', reporter: '测试小刚', createdAt: '2026-05-28',
    steps: ['使用脚本发送超过阈值的请求', '验证响应状态码为429', '验证响应体包含限流提示']
  },
];

// 用户输入排队上限。
const MAX_INPUT_QUEUE = 3;
const CHAT_SYNC_POLL_INTERVAL_MS = 2000;

/** 后端指令配置（从 /v1/commands 加载）。 */
interface CommandConfig {
  cmd: string;
  label: string;
  desc: string;
  icon: string;
  allowTask: boolean;
  allowRepos: boolean;
  requireRepos: boolean;
  maxRepos: number;
}

// 指令 -> 图标的映射（图标为 React 组件，无法放入配置文件）。
const COMMAND_ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  '/prd-write': FileText,
  '/prd-research': Compass,
  '/proto-make': LayoutTemplate,
  '/code': Code2,
  '/debug': Bug,
  '/review': CheckCircle,
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
  { cmd: '/prd-research', title: '需求调研', desc: '对需求主题进行深度调研分析' },
  { cmd: '/proto-make', title: '制作原型', desc: '根据文档生成可预览的原型工程' },
  { cmd: '/code', title: '编写代码', desc: '基于需求和代码库编写实现代码' },
];

/** 按职能子角色定制的快捷卡片；未命中的角色回退到默认卡片。 */
const WELCOME_CARDS_BY_ROLE: Partial<Record<SubRole, WelcomeCard[]>> = {
  [SUB_ROLE.DEVELOPER]: [
    { cmd: '/code', title: '编写代码', desc: '基于需求和代码库编写实现代码' },
    { cmd: '/debug', title: 'BUG 解决', desc: '定位并修复代码中的缺陷' },
    { cmd: '/review', title: '代码评审', desc: '对变更代码进行智能评审' },
    { cmd: '/proto-make', title: '制作原型', desc: '根据文档生成可预览的原型工程' },
  ],
  [SUB_ROLE.TESTER]: [
    { cmd: '/debug', title: 'BUG 定位', desc: '分析现象并定位缺陷根因' },
    { cmd: '/review', title: '代码评审', desc: '对变更代码进行智能评审' },
    { cmd: '/prd-research', title: '需求调研', desc: '对需求主题进行深度调研分析' },
    { cmd: '/code', title: '编写测试脚本', desc: '基于需求编写自动化测试代码' },
  ],
  [SUB_ROLE.DESIGNER]: [
    { cmd: '/proto-make', title: '制作原型', desc: '根据文档生成可预览的原型工程' },
    { cmd: '/prd-research', title: '需求调研', desc: '对需求主题进行深度调研分析' },
    { cmd: '/prd-write', title: '撰写 PRD', desc: '根据需求生成产品需求文档' },
    { cmd: '/code', title: '编写代码', desc: '基于需求和代码库编写实现代码' },
  ],
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

// 发送消息时附加的引用文档说明头，引导 agent 先读文档再按用户要求处理。
const DOC_REF_HEADER = '[引用的产品文档（相对工作目录路径，请先读取文档内容，再按用户要求修改或处理）]';

// @提及 在输入框中的完整文本形式（@标题+尾随空格），作为一个原子块整体插入/删除。
const docMentionToken = (title: string) => `@${title} `;

// 查找光标所处（或紧邻）的原子块区间（@文档提及 /code 指令 token 共用）；
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

const resolveDefaultAgentKey = (options: AvailableAgent[]): string | undefined => {
  const priorityKey = DEFAULT_AGENT_PRIORITY.find(key => options.some(o => o.agentKey === key));
  if (priorityKey) return priorityKey;
  return options[0]?.agentKey;
};

const getAgentLabel = (key: string, options: AvailableAgent[]): string => options.find(o => o.agentKey === key)?.name ?? key;

/** 根据历史会话项生成智能体展示文本（完整与截断版本）。 */
function getHistoryAgentLabel(item: { pluginKey?: string; instanceId?: string }, options: AvailableAgent[]) {
  const label = getAgentLabel(item.pluginKey || 'claude-code', options);
  if (!item.instanceId) return { label, full: label, short: label };
  return { label, full: `${label} · ${item.instanceId}`, short: `${label} · ${item.instanceId.slice(0, 8)}` };
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
const REQ_KANBAN_COLS: { key: RequirementStatus; label: string }[] = [
  { key: 'todo', label: '待处理' },
  { key: 'in-progress', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
  { key: 'on-hold', label: '已挂起' },
];
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
  const { membership } = useAuth();
  // 按职能子角色选择欢迎页快捷卡片（无子角色时使用默认）
  const welcomeCards =
    (membership?.subRole && WELCOME_CARDS_BY_ROLE[membership.subRole]) || WELCOME_CARDS_DEFAULT;
  // 文档引用仅面向产品职能（文档是产品空间的产物，其他角色无文档概念）；
  // 无子角色（管理员等场景）沿用产品默认视图，与欢迎卡片回退逻辑一致。
  const canUseDocs = !membership?.subRole || membership.subRole === SUB_ROLE.PM;
  const [input, setInput] = useState('');

  // Input toolbar dropdowns
  const [selectedRepos, setSelectedRepos] = useState<{id: string; name: string}[]>([]);
  const [availableRepos, setAvailableRepos] = useState<{id: string; name: string}[]>([]);
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

  const [agentTabs, setAgentTabs] = useState<AgentTab[]>([]);
  const [activeAgentTabId, setActiveAgentTabId] = useState<string | null>(null);

  const activeTab = agentTabs.find(t => t.sessionId === activeAgentTabId) ?? null;
  const defaultPluginKey = resolveDefaultAgentKey(availableAgentOptions);
  const activePluginKey = activeTab?.pluginKey ?? defaultPluginKey;

  const { runtime, sessionId, wsConnected, messages, isRunning, sendMessage, switchSession, createSession, cancelRun, tryRestoreSession } = useAgUiChat({ agentPluginKey: activePluginKey });

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
  const showPreview = previewPath !== null || projectPreview !== null;

  // 预览历史栈：支持前/后退导航。
  const [previewHistory, setPreviewHistory] = useState<PreviewHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isNavigatingHistory = useRef(false);

  // 可拖拽分割线的 imperative panel API。
  const previewPanelRef = useRef<ImperativePanelHandle>(null);

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
    setPreviewPath(path);
    pushPreviewHistory({ type: 'file', path });
  }, [previewPath]);

  const handleProjectPreview = useCallback((path: string, previewMode: PreviewMode) => {
    setPreviewPath(null);
    setProjectPreview({ path, mode: previewMode });
    pushPreviewHistory({ type: 'project', path, mode: previewMode });
  }, []);

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

  // navigatePreview 在历史栈中前进或后退，恢复对应的预览状态。
  const navigatePreview = useCallback((direction: 'back' | 'forward') => {
    const newIndex = direction === 'back' ? historyIndex - 1 : historyIndex + 1;
    if (newIndex < 0 || newIndex >= previewHistory.length) return;
    const entry = previewHistory[newIndex];
    isNavigatingHistory.current = true;
    setHistoryIndex(newIndex);
    if (entry.type === 'file') {
      setProjectPreview(null);
      setPreviewPath(entry.path);
    } else {
      setPreviewPath(null);
      setProjectPreview({ path: entry.path, mode: entry.mode });
    }
  }, [historyIndex, previewHistory]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < previewHistory.length - 1;

  const closePreview = useCallback(() => {
    setPreviewPath(null);
    setProjectPreview(null);
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
  const handleProtoMake = useCallback((filePath: string, title: string) => {
    const fileName = filePath.split('/').pop() || filePath;
    setQuotedCard({
      type: 'req',
      id: `doc-${Date.now()}`,
      title,
      reporter: '当前用户',
    });
    setInput(prev => prev.trimEnd() ? `${prev.trimEnd()}\n/proto-make ` : '/proto-make ');
    toast.success('已添加文档卡片并选择 /proto-make 指令');
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
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  const [docMenuSearch, setDocMenuSearch] = useState('');
  // @ 触发的内联文档菜单：start/end 为 @query 在输入框中的区间，query 为检索词
  const [docMention, setDocMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [docMentionIndex, setDocMentionIndex] = useState(0);
  // 产品空间文档菜单数据与已引用文档（发送时附带路径）
  const [availableDocs, setAvailableDocs] = useState<ProductDoc[]>([]);
  const [referencedDocs, setReferencedDocs] = useState<ReferencedDoc[]>([]);
  const [materializingDocId, setMaterializingDocId] = useState<string | null>(null);
  const [commandConfigs, setCommandConfigs] = useState<CommandConfig[]>([]);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [compactPlusOpen, setCompactPlusOpen] = useState(false);
  const [compactPlusSubmenu, setCompactPlusSubmenu] = useState<'repo' | 'prompt' | 'skill' | 'cmd' | null>(null);
  const [activeSkillTab, setActiveSkillTab] = useState('全部');
  const [activeTaskTab, setActiveTaskTab] = useState<'req' | 'defect' | 'case'>('req');
  const repoMenuRef = useRef<HTMLDivElement>(null);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const cmdMenuRef = useRef<HTMLDivElement>(null);
  const docMenuRef = useRef<HTMLDivElement>(null);
  const docMentionMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionOverlayRef = useRef<HTMLDivElement>(null);
  const compactPlusRef = useRef<HTMLDivElement>(null);

  // Sidebar panels expand state

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

  // Auto-scroll: scroll to bottom when new messages arrive (if locked)
  useEffect(() => {
    if (isAtBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
      if (docMenuRef.current && !docMenuRef.current.contains(t)) setDocMenuOpen(false);
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
  }, [location.state]);

  // 从后端 API 加载工作项数据
  useEffect(() => {
    let cancelled = false;
    api.get<WorkItemDTO[]>('/v1/workitems')
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
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
    repositoryApi.list(workspaceId)
      .then(repos => {
        if (cancelled) return;
        setAvailableRepos(repos.map(r => ({ id: r.id, name: r.name })));
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
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
    Promise.all([
      teamApi.listSkills(1, 100).then(res => res.list),
      workspaceApi.listPrompts(workspaceId).catch((): WorkspacePrompt[] => []),
      workspaceApi.listPromptCategories(workspaceId).catch((): PromptCategory[] => []),
      // 产品空间文档（后端已按 updated_at 倒序）
      productDocApi.list(workspaceId).catch((): ProductDoc[] => []),
    ])
      .then(([loadedSkills, loadedPrompts, loadedCategories, loadedDocs]) => {
        if (cancelled) return;
        setAvailableSkills(loadedSkills);
        setAvailablePrompts(loadedPrompts);
        setPromptCategories(loadedCategories);
        setAvailableDocs(loadedDocs);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load skills/prompts:', err);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
    Promise.all([
      workspaceApi.listAgents(workspaceId).catch((): WorkspaceAgent[] => []),
      agentConfigApi.listAvailableAgents(workspaceId).catch((): AvailableAgent[] => []),
    ])
      .then(([agents, runtimeAgents]) => {
        if (cancelled) return;
        setAvailableAgents(agents);
        const defaultAgent = agents.find(a => a.isDefault) || agents[0];
        if (defaultAgent) {
          setSelectedAgentId(defaultAgent.id);
        }
        setAvailableAgentOptions(runtimeAgents);
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

  // 插入提示词到输入框，并上报使用次数（空间提示词 +1；市场来源则市场提示词同步 +1）。
  // 上报为 fire-and-forget：失败不影响插入动作本身。
  const insertPrompt = (p: WorkspacePrompt) => {
    const c = p.content || p.description;
    setInput(prev => prev.trimEnd() ? prev.trimEnd() + '\n' + c : c);
    setPromptMenuOpen(false); setCompactPlusSubmenu(null); setCompactPlusOpen(false);
    toast.success('已插入提示词');
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
    workspaceApi.recordPromptUsage(workspaceId, p.id)
      .then(updated => setAvailablePrompts(prev => prev.map(item => item.id === updated.id ? updated : item)))
      .catch(err => console.warn('上报提示词使用次数失败:', err));
  };

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

  const toggleRepo = (repo: {id: string; name: string}) => setSelectedRepos(prev => prev.find(r => r.id === repo.id) ? prev.filter(r => r.id !== repo.id) : [...prev, repo]);
  const appendSkillTag = (name: string) => { setInput(p => p.trimEnd() ? p.trimEnd() + ` #${name} ` : `#${name} `); toast.success(`已选择：${name}`); };

  // 文档菜单：按标题搜索过滤（列表已由后端按修改时间倒序）。
  // @ 内联触发时检索词来自输入框 @ 后的文本，按钮触发时来自菜单内搜索框。
  const docFilterQuery = docMention ? docMention.query : docMenuSearch;
  const filteredDocs = useMemo(() => {
    const q = docFilterQuery.trim().toLowerCase();
    if (!q) return availableDocs;
    return availableDocs.filter(d => d.title.toLowerCase().includes(q));
  }, [availableDocs, docFilterQuery]);

  // 文档按钮角标：输入框中仍存在的 @提及 数量（随整体删除实时变化）
  const activeRefCount = referencedDocs.filter(d => input.includes(docMentionToken(d.title))).length;

  // 指令原子块 token 列表（/code 形式，尾随空格保证前缀安全，如 /code 不会误匹配 /code-review）。
  const commandTokens = useMemo(() => commandConfigs.map(c => `${c.cmd} `), [commandConfigs]);
  // 所有原子块 token：@文档提及 + 指令；用于整体删除判定。
  const atomicTokens = useMemo(
    () => [...referencedDocs.map(d => docMentionToken(d.title)), ...commandTokens],
    [referencedDocs, commandTokens],
  );

  // 输入框高亮渲染：仍存在的 @提及（主色）与指令块（紫色）包成高亮+阴影片段，其余为普通文本。
  // 叠放在透明文字的 textarea 下方，二者字体/内边距保持一致以对齐字形。
  // 注意：高亮 span 用 px-0.5 + -mx-0.5 组合，获得视觉留白的同时不改变文本步进宽度，
  // 否则提及块后的文字会与 textarea 光标位置错位（光标看起来落在字中间）。
  const highlightedInput = useMemo((): React.ReactNode => {
    const ranges: { start: number; end: number; kind: 'mention' | 'command' }[] = [];
    const collectRanges = (token: string, kind: 'mention' | 'command') => {
      let idx = input.indexOf(token);
      while (idx !== -1) {
        ranges.push({ start: idx, end: idx + token.length, kind });
        idx = input.indexOf(token, idx + 1);
      }
    };
    for (const d of referencedDocs) collectRanges(docMentionToken(d.title), 'mention');
    for (const token of commandTokens) collectRanges(token, 'command');
    ranges.sort((a, b) => a.start - b.start);
    const nodes: React.ReactNode[] = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.start < pos) continue; // 防御：重叠区间跳过
      if (r.start > pos) nodes.push(input.slice(pos, r.start));
      const cls =
        r.kind === 'mention'
          ? 'bg-primary/10 text-primary shadow-[0_1px_3px_hsl(var(--primary)/0.35)]'
          : 'bg-violet-500/10 text-violet-600 dark:text-violet-400 shadow-[0_1px_3px_rgba(139,92,246,0.35)]';
      nodes.push(
        <span key={r.start} className={`rounded-md px-0.5 -mx-0.5 ${cls}`}>
          {input.slice(r.start, r.end)}
        </span>,
      );
      pos = r.end;
    }
    if (pos < input.length) nodes.push(input.slice(pos));
    return nodes;
  }, [input, referencedDocs, commandTokens]);

  // 选中文档：先落盘拿到 agent 可读路径，再在输入框插入 @文档名 原子块。
  // 重复判定以输入框中是否仍存在该原子块为准（删除后可重新引用）。
  const handleSelectDoc = async (doc: ProductDoc) => {
    const token = docMentionToken(doc.title);
    if (input.includes(token)) {
      toast.info('该文档已引用');
      setDocMenuOpen(false);
      setDocMention(null);
      return;
    }
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
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
        setDocMenuOpen(false);
      }
      toast.success(`已引用文档：${doc.title}`);
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
  // 插入指令到输入框开头（斜杠指令通常作为前缀），若已有内容则追加空格分隔。
  // 指令成为原子块（/code 整体删除），插入后光标定位到块尾。
  // 若指令不支持代码库且当前已选代码库，提示用户并清空选择。
  const insertCommand = (cmd: string) => {
    setInput(p => p.trimEnd() ? `${cmd} ${p}` : `${cmd} `);
    setCmdMenuOpen(false);
    const cfg = commandConfigs.find(c => c.cmd === cmd);
    if (cfg && !cfg.allowRepos && selectedRepos.length > 0) {
      toast.warning(`指令 ${cmd} 不支持代码库，已清空选择`);
      setSelectedRepos([]);
    }
    toast.success(`已插入指令：${cmd}`);
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

  // 选择斜杠菜单中的指令：替换输入框内容为 {cmd} 原子块，保留后面的内容，光标定位到块尾。
  const selectSlashCommand = (cmd: string) => {
    const rest = input.replace(/^\/\S*/, '').trimStart();
    setInput(rest ? `${cmd} ${rest}` : `${cmd} `);
    setSlashMenuOpen(false);
    setSlashIndex(0);
    const cfg = commandConfigs.find(c => c.cmd === cmd);
    if (cfg && !cfg.allowRepos && selectedRepos.length > 0) {
      toast.warning(`指令 ${cmd} 不支持代码库，已清空选择`);
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
    // 已完成的引用块（@标题 ）中的 @ 不再重复触发菜单
    const isCompletedMention = atIdx >= 0 && referencedDocs.some(d => val.startsWith(docMentionToken(d.title), atIdx));
    if (canUseDocs && atIdx >= 0 && atPrevOk && !/\s/.test(atQuery) && !isCompletedMention) {
      setDocMention({ start: atIdx, end: cursor, query: atQuery });
      setDocMentionIndex(0);
      setDocMenuOpen(false);
    } else {
      setDocMention(null);
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
    // 原子块整体删除（@文档提及 /code 指令）：光标在块内部或紧邻边界时，Backspace/Delete 整体移除该块
    if ((e.key === 'Backspace' || e.key === 'Delete') && atomicTokens.length > 0) {
      const ta = e.currentTarget;
      const range = ta.selectionStart === ta.selectionEnd
        ? findAtomicRange(input, ta.selectionStart, atomicTokens, e.key === 'Backspace' ? 'backspace' : 'delete')
        : null;
      if (range) {
        e.preventDefault();
        const nextInput = input.slice(0, range.start) + input.slice(range.end);
        setInput(nextInput);
        // 同步清理已不在输入框中的引用记录，使该文档可再次引用
        setReferencedDocs(prev => prev.filter(d => nextInput.includes(docMentionToken(d.title))));
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
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
    setSyncingRepoId(repoId);
    repositoryApi.syncUserRepo(workspaceId, repoId)
      .then(() => {
        toast.info('正在同步仓库，请稍候...');
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

    const context: SendContext | undefined =
      quotedCard || effectiveRepos
        ? { quotedCard: quotedCard ?? undefined, selectedRepos: effectiveRepos }
        : undefined;

    // 引用文档：仅保留输入框中仍存在 @标签 的文档，将其落盘路径附在消息尾部，
    // agent 收到后按路径读取文档内容再执行用户指令。
    const activeRefDocs = referencedDocs.filter(d => input.includes(docMentionToken(d.title)));
    let finalInput = input;
    if (activeRefDocs.length > 0) {
      const docLines = activeRefDocs.map(d => `- ${d.title}: ${d.path}`).join('\n');
      finalInput = `${input}\n\n${DOC_REF_HEADER}\n${docLines}`;
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
      toast.info('已加入排队');
    } else {
      sendMessage(finalInput, context);
    }

    setInput('');
    setQuotedCard(null);
    setSelectedRepos([]);
    setReferencedDocs([]);
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
    } else {
      toast.info('已经是第一条了');
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
    } else {
      toast.info('已经是最后一条了');
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
        toast.success('状态已更新');
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
        toast.success('状态已更新');
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
        toast.success('状态已更新');
      })
      .catch(() => toast.error('状态更新失败'));
  };

  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);

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

  // 加载历史会话列表。从 session.context 中读取插件 key 与实例 id，便于归类到对应智能体。
  useEffect(() => {
    api.get<(AgentSessionDTO & { context?: Record<string, unknown> })[]>('/v1/sessions')
      .then(list => {
        setHistoryList(list.map(s => {
          const pluginKey = typeof s.context?.pluginKey === 'string' ? s.context.pluginKey : (s.agentId || 'claude-code');
          const instanceId = typeof s.context?.instanceId === 'string' ? s.context.instanceId : undefined;
          return {
            id: s.id,
            title: s.title || s.id.slice(0, 8),
            date: s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
            type: s.agentType || 'chat',
            pluginKey,
            instanceId,
          };
        }));
      })
      .catch(err => console.warn('[Chat] load history failed:', err));
  }, [agentTabs.length]);

  // 初始化一个默认智能体 tab。
  // 必须等 /available-agents 加载完成后再决定默认插件 key，
  // 否则初始值会是 DEFAULT_AGENT_OPTIONS 里的 claude-code，
  // 若当前空间未启用该智能体，createSession 会收到 403。
  useEffect(() => {
    if (initializedRef.current || !availableAgentsLoaded || agentTabs.length > 0) return;
    initializedRef.current = true;

    const defaultKey = resolveDefaultAgentKey(availableAgentOptions);
    if (!defaultKey) {
      toast.error('当前没有可用的智能体，请联系管理员。');
      return;
    }

    tryRestoreSession().then(savedId => {
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
      createSession(defaultKey).then(result => {
        if (!result) return;
        const tab: AgentTab = {
          sessionId: result.sessionId,
          pluginKey: defaultKey,
          title: getAgentLabel(defaultKey, availableAgentOptions),
          instanceId: result.instanceId,
          status: 'idle',
        };
        setAgentTabs([tab]);
        setActiveAgentTabId(result.sessionId);
      });
    });
  }, [availableAgentsLoaded, availableAgentOptions]);

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
      api.delete(`/v1/sessions/${tab.sessionId}`).catch(err => {
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
  }, [activeAgentTabId, agentTabs, runIfIdleOrConfirm, switchSession]);

  // 为当前智能体新建一个实例（替换当前 tab 的会话）。
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
      api.delete(`/v1/sessions/${oldSessionId}`).catch(err => {
        console.warn('[handleNewSession] delete old session failed:', err);
      });
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
    }, '新建会话');
  }, [activeAgentTabId, agentTabs, createSession, runIfIdleOrConfirm, switchSession, updateAgentTab]);

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
    }, `新增：${getAgentLabel(pluginKey, availableAgentOptions)}`);
  }, [createSession, runIfIdleOrConfirm]);

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
                    toast.success('已引用到会话');
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

  // ──────────────── Render ────────────────
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)] flex flex-row border-0 md:border md:border-border/50 rounded-none md:rounded-2xl overflow-hidden bg-background soft-shadow max-w-full mx-auto w-full relative">

        <ResizablePanelGroup direction="horizontal" className="h-full w-full">
          {/* ── Inline Preview Area ── */}
          <ResizablePanel
            ref={previewPanelRef}
            defaultSize={0}
            minSize={20}
            collapsible={true}
            collapsedSize={0}
            className={cn(
              'h-full flex flex-col bg-background overflow-hidden',
              !showPreview && 'pointer-events-none'
            )}
          >
            {showPreview && (
              <div className="h-full flex flex-col border-r border-border/50">
                {/* 预览历史导航栏 */}
                {(canGoBack || canGoForward) && (
                  <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30 bg-muted/20 shrink-0">
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
                  {previewPath && <InlineFilePreview path={previewPath} onClose={closePreview} onProtoMake={handleProtoMake} />}
                  {projectPreview && (
                    <LivePreview
                      key={projectPreview.path}
                      projectPath={projectPreview.path}
                      mode={projectPreview.mode}
                      onModeChange={(nextMode) => setProjectPreview({ path: projectPreview.path, mode: nextMode })}
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
          <ResizablePanel defaultSize={100} minSize={25} className="h-full flex flex-col min-w-0 bg-background relative overflow-hidden">

        {/* Chat Header */}
        <div className="border-b border-border/50 flex flex-col shrink-0 bg-background/80 backdrop-blur-sm z-10 w-full">
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
                      {tab.instanceId ? `${tab.title} · ${tab.instanceId.slice(0, 6)}` : tab.title}
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
                          : 'bg-background border-border/50 text-foreground hover:bg-accent'
                      }`}
                      title={`${tab.title} · ${AGENT_STATUS_LABELS[tab.status]}${tab.instanceId ? ' · ' + tab.instanceId : ''}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${AGENT_STATUS_COLORS[tab.status]}`} />
                      <Bot className="h-3 w-3 shrink-0" />
                      <span className="truncate flex-1">{tab.instanceId ? `${tab.title} · ${tab.instanceId.slice(0, 6)}` : tab.title}</span>
                      <button
                        className="h-4 w-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                        title="关闭智能体"
                        onClick={(e) => closeAgentTab(tab, e)}
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
              >
                <Plus className="h-4 w-4" />
              </Button>
              {agentMenuOpen && (
                <div className="absolute top-full right-0 mt-1 w-40 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-top-2">
                  {availableAgentOptions.map(option => (
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
          <div className={cn('border-t border-border/50 flex items-center gap-2 bg-muted/20', showPreview ? 'h-8 px-2' : 'h-10 px-4')}>
            <span className={cn('font-medium truncate', showPreview ? 'text-xs' : 'text-sm')}>
              {activeTab
                ? (activeTab.instanceId ? `${activeTab.title} · ${activeTab.instanceId.slice(0, 6)}` : activeTab.title)
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
                    <div className="p-2 border-b border-border/50">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="搜索历史会话..."
                          className="pl-8 h-7 text-xs bg-muted/30 border-border/50 rounded-lg"
                          value={historySearch}
                          onChange={e => setHistorySearch(e.target.value)}
                          autoFocus
                        />
                      </div>
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
                            const existing = agentTabs.find(t => t.sessionId === h.id);
                            if (existing) {
                              switchAgentTab(existing);
                              toast.success(`切换到：${h.title}`);
                              return;
                            }
                            const pluginKey = h.pluginKey || 'claude-code';
                            runIfIdleOrConfirm(() => {
                              const tab: AgentTab = {
                                sessionId: h.id,
                                pluginKey,
                                title: getAgentLabel(pluginKey, availableAgentOptions),
                                instanceId: h.instanceId,
                                status: 'idle',
                              };
                              setAgentTabs(prev => [...prev, tab]);
                              setActiveAgentTabId(h.id);
                              switchSession(h.id);
                              toast.success(`已打开：${h.title}`);
                            }, `打开历史：${h.title}`);
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
                              {getHistoryAgentLabel(h, availableAgentOptions).short}
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
        <ScrollArea id="chat-scroll-area" className={cn('flex-1 bg-[#f8f9fa] dark:bg-card/30', showPreview ? 'p-2' : 'p-4 pr-8')}>
          <div className="space-y-6">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center pt-20">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-1">DeepHarness 智能助手</h3>
                <p className="text-muted-foreground text-sm max-w-md mb-6">
                  我可以帮你撰写 PRD、调研需求、制作原型、编写代码。选择下方指令快速开始，或直接输入你的问题。
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {welcomeCards.map(card => {
                    const Icon = COMMAND_ICON_MAP[card.cmd] ?? Terminal;
                    return (
                      <Button
                        key={card.cmd}
                        variant="outline"
                        className="h-auto py-3 justify-start text-left bg-background/50 hover:bg-background"
                        onClick={() => insertCommand(card.cmd)}
                      >
                        <Icon className="h-4 w-4 mr-2 text-primary shrink-0" />
                        <div className="flex flex-col items-start">
                          <span className="text-sm font-medium">{card.title}</span>
                          <span className="text-xs text-muted-foreground">{card.desc}</span>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                <ChatThread
                  openDetail={openDetail}
                  onArtifactClick={() => setCodeJumpOpen(true)}
                  onFilePreview={handleFilePreview}
                  onProjectPreview={handleProjectPreview}
                  onEditMessage={(text) => setInput(text)}
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
        <div className={cn('shrink-0 flex justify-center z-10 bg-gradient-to-t from-background via-background/95 to-background/50', showPreview ? 'p-2' : 'p-3 md:p-5')}>
          <div className="w-full relative flex flex-col rounded-3xl border bg-background/80 backdrop-blur-xl soft-shadow overflow-visible">
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
                      <p className="text-[10px] text-muted-foreground truncate">引用工程代码</p>
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
            <div className="relative">
            {/* @提及 高亮层：与 textarea 同字体/内边距叠放；textarea 文字透明仅显示光标与选区 */}
            <div
              ref={mentionOverlayRef}
              aria-hidden
              className={cn('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-5 text-base md:text-sm', showPreview ? 'py-3 text-sm' : 'py-4')}
            >
              {highlightedInput}
            </div>
            <Textarea
              ref={textareaRef}
              placeholder="你想让 AI 助手做什么？ 例如：开发一个小游戏、实现一个新功能、做数据分析..."
              className={cn('relative w-full resize-none border-0 focus-visible:ring-0 px-5 py-4 shadow-none bg-transparent text-transparent caret-foreground', showPreview ? 'min-h-[60px] text-sm py-3' : 'min-h-[100px] text-base')}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onScroll={e => { if (mentionOverlayRef.current) mentionOverlayRef.current.scrollTop = e.currentTarget.scrollTop; }}
            />
            {slashMenuOpen && filteredSlashCommands.length > 0 && (
              <div className="absolute bottom-full left-4 mb-1 w-64 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                {filteredSlashCommands.map((item, idx) => {
                  const Icon = COMMAND_ICON_MAP[item.cmd] ?? Terminal;
                  return (
                    <div
                      key={item.cmd}
                      className={cn('flex items-center gap-3 px-3 py-2 cursor-pointer text-foreground transition-colors', idx === slashIndex ? 'bg-accent' : 'hover:bg-accent')}
                      onClick={() => selectSlashCommand(item.cmd)}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-sm leading-none">{item.cmd}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{item.label} · {item.desc}</span>
                      </div>
                      {item.requireRepos && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 shrink-0">需代码库</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* @ 内联文档菜单：检索词即输入框中 @ 后的文本，上下键选择、回车确认 */}
            {docMention && (
              <div ref={docMentionMenuRef} className="absolute bottom-full left-4 mb-1 w-72 max-h-72 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-border/50 shrink-0">选择要引用的文档</div>
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
              <div className={cn('flex items-center gap-1.5 flex-wrap', showPreview && 'gap-1')}>
                {/* 任务 */}
                <div className="relative" ref={taskMenuRef}>
                  <Button variant="outline" size="sm" className={cn('rounded-full text-xs hover:bg-muted', showPreview ? 'h-7 px-2' : 'h-8 px-3')} onClick={() => { setTaskMenuOpen(!taskMenuOpen); setCmdMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}>
                    <ListTodo className={cn('mr-1.5', showPreview ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{showPreview ? '' : '任务'}
                    {uncompletedCount > 0 && (
                      <span className="ml-1.5 h-4 min-w-4 px-1 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center">
                        {uncompletedCount}
                      </span>
                    )}
                  </Button>
                  {taskMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-[360px] bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                      {/* 任务统计与操作 */}
                      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/30 shrink-0">
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
                          <TabsList className="w-full justify-start h-auto bg-transparent p-0 overflow-x-auto flex-nowrap rounded-none border-b">
                            <TabsTrigger value="req" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">需求</TabsTrigger>
                            <TabsTrigger value="defect" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">缺陷</TabsTrigger>
                            <TabsTrigger value="case" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">用例</TabsTrigger>
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

                {/* 文档：引用产品空间文档，发送时附带落盘路径供 agent 读取（仅产品职能可见） */}
                {canUseDocs && (
                <div className="relative" ref={docMenuRef}>
                  <Button variant="outline" size="sm" className={cn('rounded-full text-xs hover:bg-muted', showPreview ? 'h-7 px-2' : 'h-8 px-3')} onClick={() => { setDocMenuOpen(!docMenuOpen); setDocMention(null); setTaskMenuOpen(false); setCmdMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}>
                    <BookOpen className={cn('mr-1.5', showPreview ? 'h-3 w-3' : 'h-3.5 w-3.5')} />{showPreview ? '' : '文档'}
                    {activeRefCount > 0 && (
                      <span className="ml-1.5 h-4 min-w-4 px-1 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center">
                        {activeRefCount}
                      </span>
                    )}
                  </Button>
                  {docMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                      <div className="p-2 border-b border-border/50 shrink-0">
                        <Input
                          placeholder="搜索文档..."
                          value={docMenuSearch}
                          onChange={e => setDocMenuSearch(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto p-1">
                        {filteredDocs.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-6">暂无文档</p>
                        ) : (
                          filteredDocs.map(doc => {
                            const referenced = referencedDocs.some(d => d.docId === doc.id);
                            return (
                              <button
                                key={doc.id}
                                disabled={materializingDocId === doc.id}
                                className={cn('flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-left text-sm transition-colors', referenced ? 'opacity-50 cursor-default' : 'hover:bg-accent')}
                                onClick={() => handleSelectDoc(doc)}
                              >
                                {materializingDocId === doc.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                                ) : (
                                  <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                                )}
                                <span className="flex-1 truncate">{doc.title}</span>
                                {referenced && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
                )}

                {/* 代码库 / 指令 / 提示词 / 技能 */}
                {showPreview ? (
                  <div className="relative" ref={compactPlusRef}>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn('rounded-full p-0', showPreview ? 'h-7 w-7' : 'h-8 w-8')}
                      onClick={() => { setCompactPlusOpen(!compactPlusOpen); setCompactPlusSubmenu(null); setCmdMenuOpen(false); }}
                      title="更多工具"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {/* 一级菜单：选择类型 */}
                    {compactPlusOpen && !compactPlusSubmenu && (
                      <div className="absolute bottom-full left-0 mb-2 bg-popover border shadow-xl rounded-xl flex items-center gap-0.5 z-50 p-1 animate-in fade-in slide-in-from-bottom-2">
                        <button
                          className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                          title="指令"
                          onClick={() => setCompactPlusSubmenu('cmd')}
                        >
                          <Terminal className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button
                          className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                          title="提示词"
                          onClick={() => setCompactPlusSubmenu('prompt')}
                        >
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button
                          className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                          title="技能"
                          onClick={() => setCompactPlusSubmenu('skill')}
                        >
                          <Wand2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                        {availableRepos.length > 0 && (
                        <button
                          className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                          title="代码库"
                          onClick={() => setCompactPlusSubmenu('repo')}
                        >
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                        </button>
                        )}
                      </div>
                    )}
                    {/* 二级菜单：代码库 */}
                    {compactPlusSubmenu === 'repo' && (
                      <div className="absolute bottom-full left-0 mb-2 w-56 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                        {availableRepos.map(repo => {
                          const sel = selectedRepos.some(r => r.id === repo.id);
                          const syncStatus = userRepoStatuses.find(s => s.repositoryId === repo.id);
                          const synced = syncStatus?.synced ?? false;
                          const isSyncing = syncingRepoId === repo.id || syncStatus?.syncStatus === 'syncing';
                          const syncProgress = syncStatus?.progress ?? 0;
                          return (
                            <div key={repo.id} className={`flex items-center w-full px-3 py-2 text-sm text-foreground ${synced ? 'hover:bg-accent cursor-pointer' : 'opacity-50 cursor-not-allowed'}`} onClick={() => { if (synced) { toggleRepo(repo); setCompactPlusSubmenu(null); setCompactPlusOpen(false); } }}>
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
                    )}
                    {/* 二级菜单：提示词 */}
                    {compactPlusSubmenu === 'prompt' && (
                      <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                        <div className="p-2 border-b space-y-2">
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
                            {['全部', ...sortPromptCategoriesByBuiltin(promptCategories).map(c => c.name)].map(cat => (
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
                        <div className="flex-1 overflow-y-auto p-1">
                          {filteredAvailablePrompts.length === 0 && (
                            <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无匹配提示词</div>
                          )}
                          {filteredAvailablePrompts.map(p => (
                            <div key={p.id} className="flex flex-col w-full px-3 py-2 hover:bg-accent cursor-pointer text-foreground rounded-md transition-colors" onClick={() => { insertPrompt(p); setCompactPlusSubmenu(null); setCompactPlusOpen(false); }}>
                              <span className="font-medium text-sm mb-1">{p.name}</span>
                              <span className="text-xs text-muted-foreground line-clamp-2">{p.content || p.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* 二级菜单：技能 */}
                    {compactPlusSubmenu === 'skill' && (
                      <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                        <Tabs value={activeSkillTab} onValueChange={setActiveSkillTab} className="w-full flex flex-col">
                          <div className="px-2 pt-2 bg-muted/30 border-b space-y-2">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input
                                placeholder="搜索技能..."
                                className="pl-8 h-8"
                                value={skillMenuSearch}
                                onChange={(e) => setSkillMenuSearch(e.target.value)}
                              />
                            </div>
                            <TabsList className="w-full justify-start h-auto bg-transparent p-0 overflow-x-auto flex-nowrap rounded-none">
                              {['全部', '需求设计', 'UI设计', '代码开发', '测试编写', '需求上线'].map(tab => (
                                <TabsTrigger key={tab} value={tab} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">{tab}</TabsTrigger>
                              ))}
                            </TabsList>
                          </div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {filteredAvailableSkills.length === 0 && (
                              <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无匹配技能</div>
                            )}
                            {filteredAvailableSkills.map(skill => {
                                const IconComponent = skillIconMap[skill.icon || ''] || Puzzle;
                                return (
                                  <div key={skill.id} className="flex items-start gap-3 p-2.5 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors" onClick={() => { appendSkillTag(skill.name); setCompactPlusSubmenu(null); setCompactPlusOpen(false); }}>
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
                    )}
                    {/* 二级菜单：指令 */}
                    {compactPlusSubmenu === 'cmd' && (
                      <div className="absolute bottom-full left-0 mb-2 w-64 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                        {commandConfigs.map(item => {
                          const Icon = COMMAND_ICON_MAP[item.cmd] ?? Terminal;
                          return (
                            <div
                              key={item.cmd}
                              className="flex items-center gap-3 px-3 py-2 hover:bg-accent cursor-pointer text-foreground transition-colors"
                              onClick={() => { insertCommand(item.cmd); setCompactPlusSubmenu(null); setCompactPlusOpen(false); }}
                            >
                              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="flex flex-col min-w-0">
                                <span className="font-medium text-sm leading-none">{item.cmd}</span>
                                <span className="text-xs text-muted-foreground mt-0.5">{item.label} · {item.desc}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* 代码库 — 无配置仓库时隐藏 */}
                    {availableRepos.length > 0 && (
                    <div className="relative" ref={repoMenuRef}>
                      <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setRepoMenuOpen(!repoMenuOpen); setSkillPopoverOpen(false); setPromptMenuOpen(false); setTaskMenuOpen(false); setCmdMenuOpen(false); }}>
                        <Code2 className="h-3.5 w-3.5 mr-1.5" />代码库
                      </Button>
                      {repoMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-56 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                          {availableRepos.map(repo => {
                            const sel = selectedRepos.some(r => r.id === repo.id);
                            const syncStatus = userRepoStatuses.find(s => s.repositoryId === repo.id);
                            const synced = syncStatus?.synced ?? false;
                            const isSyncing = syncingRepoId === repo.id || syncStatus?.syncStatus === 'syncing';
                            const syncProgress = syncStatus?.progress ?? 0;
                            return (
                              <div key={repo.id} className={`flex items-center w-full px-3 py-2 text-sm text-foreground ${synced ? 'hover:bg-accent cursor-pointer' : 'opacity-50 cursor-not-allowed'}`} onClick={() => synced && toggleRepo(repo)}>
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
                      )}
                    </div>
                    )}

                    {/* 指令 */}
                    <div className="relative" ref={cmdMenuRef}>
                      <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setCmdMenuOpen(!cmdMenuOpen); setTaskMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}>
                        <Terminal className="h-3.5 w-3.5 mr-1.5" />指令
                      </Button>
                      {cmdMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-64 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                          {commandConfigs.map(item => {
                            const Icon = COMMAND_ICON_MAP[item.cmd] ?? Terminal;
                            return (
                              <div
                                key={item.cmd}
                                className="flex items-center gap-3 px-3 py-2 hover:bg-accent cursor-pointer text-foreground transition-colors"
                                onClick={() => insertCommand(item.cmd)}
                              >
                                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium text-sm leading-none">{item.cmd}</span>
                                  <span className="text-xs text-muted-foreground mt-0.5">{item.label} · {item.desc}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 提示词 */}
                    <div className="relative" ref={promptMenuRef}>
                      <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setPromptMenuOpen(!promptMenuOpen); setRepoMenuOpen(false); setSkillPopoverOpen(false); setTaskMenuOpen(false); setCmdMenuOpen(false); }}>
                        <FileText className="h-3.5 w-3.5 mr-1.5" />提示词
                      </Button>
                      {promptMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                          <div className="p-2 border-b space-y-2">
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
                              {['全部', ...sortPromptCategoriesByBuiltin(promptCategories).map(c => c.name)].map(cat => (
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
                          <div className="flex-1 overflow-y-auto p-1">
                            {filteredAvailablePrompts.length === 0 && (
                              <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无匹配提示词</div>
                            )}
                            {filteredAvailablePrompts.map(p => (
                              <div key={p.id} className="flex flex-col w-full px-3 py-2 hover:bg-accent cursor-pointer text-foreground rounded-md transition-colors" onClick={() => insertPrompt(p)}>
                                <span className="font-medium text-sm mb-1">{p.name}</span>
                                <span className="text-xs text-muted-foreground line-clamp-2">{p.content || p.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 技能 */}
                    <div className="relative" ref={skillMenuRef}>
                      <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setSkillPopoverOpen(!skillPopoverOpen); setRepoMenuOpen(false); setPromptMenuOpen(false); setTaskMenuOpen(false); setCmdMenuOpen(false); }}>
                        <Wand2 className="h-3.5 w-3.5 mr-1.5" />技能
                      </Button>
                      {skillPopoverOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                          <Tabs value={activeSkillTab} onValueChange={setActiveSkillTab} className="w-full flex flex-col">
                            <div className="px-2 pt-2 bg-muted/30 border-b space-y-2">
                              <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                  placeholder="搜索技能..."
                                  className="pl-8 h-8"
                                  value={skillMenuSearch}
                                  onChange={(e) => setSkillMenuSearch(e.target.value)}
                                />
                              </div>
                              <TabsList className="w-full justify-start h-auto bg-transparent p-0 overflow-x-auto flex-nowrap rounded-none">
                                {['全部', '需求设计', 'UI设计', '代码开发', '测试编写', '需求上线'].map(tab => (
                                  <TabsTrigger key={tab} value={tab} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">{tab}</TabsTrigger>
                                ))}
                              </TabsList>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                              {filteredAvailableSkills.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无匹配技能</div>
                              )}
                              {filteredAvailableSkills.map(skill => {
                                  const IconComponent = skillIconMap[skill.icon || ''] || Puzzle;
                                  return (
                                    <div key={skill.id} className="flex items-start gap-3 p-2.5 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors" onClick={() => { appendSkillTag(skill.name); setSkillPopoverOpen(false); }}>
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
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      toast.success(`已选择文件: ${e.target.files[0].name}`);
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

        {/* ── Detail Drawer ── */}
        <div className={`absolute inset-y-0 right-0 w-80 bg-background border-l border-border/50 flex flex-col z-50 transition-transform duration-300 ${detailOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full'}`}>
          {detailOpen && (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 shrink-0">
                {detailType === 'req' && <ListTodo className="h-4 w-4 text-primary" />}
                {detailType === 'defect' && <Bug className="h-4 w-4 text-destructive" />}
                {detailType === 'case' && <FlaskConical className="h-4 w-4 text-violet-500" />}
                <span className="font-semibold text-sm flex-1 truncate">
                  {detailType === 'req' && detailReq?.id}
                  {detailType === 'defect' && detailDef?.id}
                  {detailType === 'case' && detailCase?.id}
                  {' 详情'}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground" onClick={handlePrevItem} title="上一个">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground" onClick={handleNextItem} title="下一个">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground ml-1" onClick={closeDetail} title="关闭">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <ScrollArea className="flex-1 p-4">
                {/* 需求详情 */}
                {detailType === 'req' && detailReq && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">标题</p>
                      <p className="text-sm font-medium text-foreground">{detailReq.title}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">提出人</p>
                      <p className="text-sm text-foreground">{detailReq.reporter}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">描述</p>
                      <p className="text-sm text-foreground leading-relaxed">{detailReq.description}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">状态变更</p>
                      <Select value={detailReq.status} onValueChange={(val: RequirementStatus) => updateReqStatus(detailReq.id, val)}>
                        <SelectTrigger className="w-[140px] h-8 text-xs">
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
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">创建时间</p>
                      <p className="text-sm text-foreground">{detailReq.createdAt}</p>
                    </div>
                    <button className="text-xs text-primary hover:underline flex items-center gap-1"
                      onClick={() => { openKanban('req', detailReq.id); closeDetail(); }}>
                      <LayoutTemplate className="h-3 w-3" />在看板中查看
                    </button>
                  </div>
                )}
                {/* 缺陷详情 */}
                {detailType === 'defect' && detailDef && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">标题</p>
                      <p className="text-sm font-medium text-foreground">{detailDef.title}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">提出人</p>
                      <p className="text-sm text-foreground">{detailDef.reporter}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">严重程度</p>
                      <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${SEVERITY_COLORS[detailDef.severity]}`}>
                        {SEVERITY_LABELS[detailDef.severity]}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">描述</p>
                      <p className="text-sm text-foreground leading-relaxed">{detailDef.description}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">状态变更</p>
                      <Select value={detailDef.status} onValueChange={(val: DefectStatus) => updateDefStatus(detailDef.id, val)}>
                        <SelectTrigger className="w-[140px] h-8 text-xs">
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
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">创建时间</p>
                      <p className="text-sm text-foreground">{detailDef.createdAt}</p>
                    </div>
                    <button className="text-xs text-primary hover:underline flex items-center gap-1"
                      onClick={() => { openKanban('defect', detailDef.id); closeDetail(); }}>
                      <LayoutTemplate className="h-3 w-3" />在看板中查看
                    </button>
                  </div>
                )}
                {/* 用例详情 */}
                {detailType === 'case' && detailCase && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">标题</p>
                      <p className="text-sm font-medium text-foreground">{detailCase.title}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">提出人</p>
                      <p className="text-sm text-foreground">{detailCase.reporter}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">描述</p>
                      <p className="text-sm text-foreground leading-relaxed">{detailCase.description}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">执行步骤</p>
                      <ol className="space-y-1.5">
                        {detailCase.steps.map((step, i) => (
                          <li key={i} className="flex gap-2 text-xs text-foreground">
                            <span className="h-4 w-4 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-medium text-[10px]">{i + 1}</span>
                            <span className="leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">状态变更</p>
                      <Select value={detailCase.status} onValueChange={(val: CaseStatus) => updateCaseStatus(detailCase.id, val)}>
                        <SelectTrigger className="w-[140px] h-8 text-xs">
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
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">创建时间</p>
                      <p className="text-sm text-foreground">{detailCase.createdAt}</p>
                    </div>
                    <button className="text-xs text-primary hover:underline flex items-center gap-1"
                      onClick={() => { openKanban('case', detailCase.id); closeDetail(); }}>
                      <LayoutTemplate className="h-3 w-3" />在看板中查看
                    </button>
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </div>

        {/* ── Kanban Drawer (full overlay) ── */}
        <div className={`absolute inset-0 bg-background z-40 flex flex-col transition-transform duration-300 ${kanbanOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          {kanbanOpen && (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 shrink-0">
                <LayoutTemplate className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">
                  {kanbanType === 'req' ? '需求看板' : kanbanType === 'defect' ? '缺陷看板' : '用例看板'}
                </span>
                <button className="ml-auto h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-muted-foreground" onClick={closeKanban}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <div className="flex h-full gap-3 p-4 min-w-max">
                  {(kanbanType === 'req' ? REQ_KANBAN_COLS : kanbanType === 'defect' ? DEF_KANBAN_COLS : CASE_KANBAN_COLS).map(col => {
                    let items: (ReqItem | DefectItem | CaseItem)[] = [];
                    if (kanbanType === 'req') items = requirements.filter(r => r.status === col.key);
                    else if (kanbanType === 'defect') items = defects.filter(d => d.status === col.key);
                    else items = cases.filter(c => c.status === col.key);
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
                                className={`relative p-3 pl-4 rounded-xl border bg-card cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-md ${isHighlight ? 'border-primary shadow-md ring-2 ring-primary/30' : 'border-border/50'} ${isDone ? 'opacity-75' : ''}`}
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
                                  <p className="text-[10px] text-muted-foreground mt-1">{(item as ReqItem | DefectItem | CaseItem).reporter} 提</p>
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
              </div>
            </>
          )}
        </div>
        {/* Code Jump Confirmation Dialog */}
        <AlertDialog open={codeJumpOpen} onOpenChange={setCodeJumpOpen}>
          <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>跳转到工程代码</AlertDialogTitle>
              <AlertDialogDescription>
                是否要跳转到代码库窗口，查看完整的工程代码？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setCodeJumpOpen(false); navigate('/code'); toast.success('已跳转到工程代码窗口'); }}>
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
