import '@/lib/patch-assistant-ui';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import {
  Send,
  Bot,
  Code2,
  Box,
  ListTodo,
  ChevronRight,
  Wand2,
  Paperclip,
  CheckCircle,
  UploadCloud,
  Puzzle,
  X,
  GitBranch,
  FileText,
  ChevronDown,
  ChevronLeft,
  LayoutTemplate,
  Info,
  Bug,
  FlaskConical,
  SlidersHorizontal,
  Plus,
  Clock,
  MessageSquarePlus,
  Search
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { teamApi } from '@/lib/team-api';
import { workspaceApi } from '@/lib/workspace-api';
import { repositoryApi } from '@/lib/repository-api';
import type { WorkItemDTO } from '@/lib/api-types';
import type { Skill, Prompt, WorkspaceAgent } from '@/types';
import { AssistantRuntimeProvider, type ThreadMessageLike } from '@assistant-ui/react';
import { useAgUiChat, type SendContext } from '@/hooks/useAgUiChat';
import { ChatThread } from '@/components/chat/ChatThread';
import { InlineFilePreview } from '@/components/chat/InlineFilePreview';
import { cn } from '@/lib/utils';

// ──────────────── Types ────────────────
type RequirementStatus = 'backlog' | 'todo' | 'in-progress' | 'done';
type DefectStatus = 'open' | 'in-progress' | 'fixed' | 'closed';
type DefectSeverity = 'critical' | 'high' | 'medium' | 'low';
type CaseStatus = 'draft' | 'ready' | 'passed' | 'failed' | 'blocked';

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
  { id: 'REQ-004', title: '智能评审结果展示', description: '将代码评审结果以结构化方式展示，支持按严重程度和文件分组。', status: 'backlog', assigneeId: 'u1', reporter: '设计小李', createdAt: '2026-05-27' },
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

// 排队输入项。
interface InputQueueItem {
  id: string;
  text: string;
  context?: SendContext;
}

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

// 可选的智能体插件。
const AGENT_OPTIONS: { key: string; label: string }[] = [
  { key: 'claude-code', label: 'Claude Code' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'codex', label: 'Codex' },
];

const getAgentLabel = (key: string): string => AGENT_OPTIONS.find(o => o.key === key)?.label ?? key;

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
const REQ_STATUS_LABELS: Record<RequirementStatus, string> = { backlog: '待办', todo: '待处理', 'in-progress': '进行中', done: '已完成' };
const DEF_STATUS_LABELS: Record<DefectStatus, string> = { open: '待修复', 'in-progress': '修复中', fixed: '已修复', closed: '已关闭' };
const CASE_STATUS_LABELS: Record<CaseStatus, string> = { draft: '草稿', ready: '待执行', passed: '通过', failed: '失败', blocked: '阻塞' };
const SEVERITY_LABELS: Record<DefectSeverity, string> = { critical: '致命', high: '严重', medium: '一般', low: '轻微' };

// 后端状态使用下划线（如 in_progress），前端 UI 使用连字符（如 in-progress）。
const toUiStatus = (status: string): string => status.replace(/_/g, '-');
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
  { key: 'backlog', label: '待办' }, { key: 'todo', label: '待处理' },
  { key: 'in-progress', label: '进行中' }, { key: 'done', label: '已完成' },
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

  const getColColorStyle = (colKey: string) => {
    const base = getColColor(colKey);
    if (base === 'muted') return 'bg-muted/50 border-border/40 text-foreground';
    if (base === 'blue') return 'bg-blue-100/50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-300';
    if (base === 'amber') return 'bg-amber-100/50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300';
    if (base === 'green') return 'bg-green-100/50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300';
    if (base === 'red') return 'bg-red-100/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300';
    if (base === 'orange') return 'bg-orange-100/50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50 text-orange-700 dark:text-orange-300';
    return 'bg-muted/50 border-border/40 text-foreground';
  };

  const getColCountStyle = (colKey: string) => {
    const base = getColColor(colKey);
    if (base === 'muted') return 'border-border/40 text-muted-foreground';
    if (base === 'blue') return 'border-blue-200 dark:border-blue-800/50 text-blue-700 dark:text-blue-300';
    if (base === 'amber') return 'border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300';
    if (base === 'green') return 'border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-300';
    if (base === 'red') return 'border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300';
    if (base === 'orange') return 'border-orange-200 dark:border-orange-800/50 text-orange-700 dark:text-orange-300';
    return 'border-border/40 text-muted-foreground';
  };

// ──────────────── Component ────────────────
export const Chat: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState('');

  // Input toolbar dropdowns
  const [selectedRepos, setSelectedRepos] = useState<{id: string; name: string}[]>([]);
  const [availableRepos, setAvailableRepos] = useState<{id: string; name: string}[]>([]);
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [availablePrompts, setAvailablePrompts] = useState<Prompt[]>([]);
  const [availableAgents, setAvailableAgents] = useState<WorkspaceAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  const [agentTabs, setAgentTabs] = useState<AgentTab[]>([]);
  const [activeAgentTabId, setActiveAgentTabId] = useState<string | null>(null);

  const activeTab = agentTabs.find(t => t.sessionId === activeAgentTabId) ?? null;
  const activePluginKey = activeTab?.pluginKey ?? 'claude-code';

  const { runtime, sessionId, wsConnected, messages, isRunning, sendMessage, switchSession, createSession, cancelRun } = useAgUiChat({ agentPluginKey: activePluginKey });

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
  const showPreview = previewPath !== null;

  const handleFilePreview = useCallback((path: string) => {
    setPreviewPath(path);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewPath(null);
  }, []);

  // File Upload
  const fileInputRef = useRef<HTMLInputElement>(null);


  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  const [compactPlusOpen, setCompactPlusOpen] = useState(false);
  const [compactPlusSubmenu, setCompactPlusSubmenu] = useState<'repo' | 'prompt' | 'skill' | null>(null);
  const [activeSkillTab, setActiveSkillTab] = useState('全部');
  const [activeTaskTab, setActiveTaskTab] = useState<'req' | 'defect' | 'case'>('req');
  const repoMenuRef = useRef<HTMLDivElement>(null);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
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
    reqStatuses: ['todo', 'backlog', 'in-progress', 'done'] as RequirementStatus[],
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
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([teamApi.listSkills(), teamApi.listPrompts()])
      .then(([loadedSkills, loadedPrompts]) => {
        if (cancelled) return;
        setAvailableSkills(loadedSkills);
        setAvailablePrompts(loadedPrompts);
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
    workspaceApi.listAgents(workspaceId)
      .then(agents => {
        if (cancelled) return;
        setAvailableAgents(agents);
        const defaultAgent = agents.find(a => a.isDefault) || agents[0];
        if (defaultAgent) {
          setSelectedAgentId(defaultAgent.id);
        }
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

  const insertPrompt = (c: string) => { setInput(p => p.trimEnd() ? p.trimEnd() + '\n' + c : c); setPromptMenuOpen(false); toast.success('已插入提示词'); };
  const toggleRepo = (repo: {id: string; name: string}) => setSelectedRepos(prev => prev.find(r => r.id === repo.id) ? prev.filter(r => r.id !== repo.id) : [...prev, repo]);
  const appendSkillTag = (name: string) => { setInput(p => p.trimEnd() ? p.trimEnd() + ` #${name} ` : `#${name} `); toast.success(`已选择：${name}`); };

  const handleSend = () => {
    if (!input.trim() && !quotedCard) return;
    const context: SendContext | undefined =
      quotedCard || selectedRepos.length > 0
        ? { quotedCard: quotedCard ?? undefined, selectedRepos: selectedRepos.length > 0 ? [...selectedRepos] : undefined }
        : undefined;

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
        text: input,
        context,
      };
      setInputQueue(prev => [...prev, item]);
      toast.info('已加入排队');
    } else {
      sendMessage(input, context);
    }

    setInput('');
    setQuotedCard(null);
    setSelectedRepos([]);
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
  const filteredHistory = historyList.filter(h => h.title.includes(historySearch));

  // 加载历史会话列表。从 session.context 中读取插件 key 与实例 id，便于归类到对应智能体。
  useEffect(() => {
    api.get<{ id: string; title?: string; createdAt?: string; agentType?: string; context?: Record<string, unknown> }[]>('/v1/sessions')
      .then(list => {
        setHistoryList(list.map(s => ({
          id: s.id,
          title: s.title || s.id.slice(0, 8),
          date: s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
          type: s.agentType || 'chat',
          pluginKey: typeof s.context?.pluginKey === 'string' ? s.context.pluginKey : undefined,
          instanceId: typeof s.context?.instanceId === 'string' ? s.context.instanceId : undefined,
        })));
      })
      .catch(err => console.warn('[Chat] load history failed:', err));
  }, [agentTabs.length]);

  // 初始化一个默认智能体 tab。
  useEffect(() => {
    if (initializedRef.current || agentTabs.length > 0) return;
    initializedRef.current = true;
    const defaultKey = 'claude-code';
    createSession(defaultKey).then(result => {
      if (!result) return;
      const tab: AgentTab = {
        sessionId: result.sessionId,
        pluginKey: defaultKey,
        title: getAgentLabel(defaultKey),
        instanceId: result.instanceId,
        status: 'idle',
      };
      setAgentTabs([tab]);
      setActiveAgentTabId(result.sessionId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (lastAssistant) {
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
        title: getAgentLabel(pluginKey),
        instanceId: result.instanceId,
        status: 'idle',
      };
      setAgentTabs(prev => [...prev, tab]);
      setActiveAgentTabId(result.sessionId);
    }, `新增：${getAgentLabel(pluginKey)}`);
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

        {/* ── Inline Preview Area ── */}
        <div
          className={cn(
            'h-full flex flex-col border-r border-border/50 bg-background overflow-hidden transition-all duration-500 ease-in-out',
            showPreview ? 'w-3/4 opacity-100' : 'w-0 opacity-0'
          )}
        >
          {previewPath && <InlineFilePreview path={previewPath} onClose={closePreview} />}
        </div>

        {/* ── Main Chat Area ── */}
        <div
          className={cn(
            'h-full flex flex-col min-w-0 bg-background relative overflow-hidden transition-all duration-500 ease-in-out',
            showPreview ? 'w-1/4' : 'flex-1 w-full'
          )}
        >

        {/* Chat Header */}
        <div className="border-b border-border/50 flex flex-col shrink-0 bg-background/80 backdrop-blur-sm z-10 w-full">
          {/* 第一层：助手标题 + 智能体 tabs + 新增智能体 */}
          <div className="h-12 flex items-center px-4 gap-2">
            <Bot className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold text-sm shrink-0">DeepHarness 助手</span>

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
                  {AGENT_OPTIONS.map(option => (
                    <div
                      key={option.key}
                      className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => {
                        addAgentTab(option.key);
                        setAgentMenuOpen(false);
                      }}
                    >
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{option.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 第二层：当前会话标题 + 历史会话 + 新建会话 */}
          <div className="h-10 border-t border-border/50 flex items-center px-4 gap-2 bg-muted/20">
            <span className="text-sm font-medium truncate">
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
                  className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={() => { setHistoryOpen(v => !v); setAgentMenuOpen(false); setTaskMenuOpen(false); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>历史会话</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
                {historyOpen && (
                  <div className="absolute top-full right-0 mt-1 w-72 bg-popover border shadow-xl rounded-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <div className="p-2 border-b border-border/50">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
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
                                title: getAgentLabel(pluginKey),
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
                          <div className="flex items-center gap-2 flex-1 min-w-0 pr-12 group-hover:pr-16 transition-all">
                            {h.type === 'ui' && <Box className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                            {h.type === 'requirement' && <ListTodo className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                            {h.type === 'code' && <Code2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                            {h.type !== 'ui' && h.type !== 'requirement' && h.type !== 'code' && <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                            <span className="flex-1 truncate text-xs">{h.title}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline-block group-hover:hidden">{h.date}</span>
                          </div>
                          <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-gradient-to-l from-accent via-accent to-transparent pl-2 transition-opacity">
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                              title="会话复盘"
                              onClick={(e) => { e.stopPropagation(); toast.success('已生成会话复盘报告'); setHistoryOpen(false); }}
                            >
                              <FileText className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                              title="总结为技能"
                              onClick={(e) => { e.stopPropagation(); toast.success('已将当前会话总结为新技能'); setHistoryOpen(false); }}
                            >
                              <Wand2 className="h-3 w-3" />
                            </Button>
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
                className="h-7 px-2.5 text-xs gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
                onClick={handleNewSession}
                title="新建会话"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                新建会话
              </Button>
            </div>
          </div>
        </div>

        {/* Chat Messages */}
        <ScrollArea id="chat-scroll-area" className="flex-1 p-4 pr-8 bg-[#f8f9fa] dark:bg-card/30">
          <div className="space-y-6">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center pt-20">
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">我是您的全能开发助手</h3>
                <p className="text-muted-foreground text-sm max-w-sm mb-6">
                  我可以帮您设计UI界面、分析产品需求、编写功能代码，或者解答任何技术问题。
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                  <Button variant="outline" className="h-auto py-3 justify-start text-left bg-background/50 hover:bg-background" onClick={() => setInput('帮我设计一个后台管理系统的数据大盘UI')}>
                    <Box className="h-4 w-4 mr-2 text-blue-500 shrink-0" />
                    <span className="text-sm">设计一个后台数据大盘UI</span>
                  </Button>
                  <Button variant="outline" className="h-auto py-3 justify-start text-left bg-background/50 hover:bg-background" onClick={() => setInput('写一个基于React和Tailwind的登录组件')}>
                    <Code2 className="h-4 w-4 mr-2 text-green-500 shrink-0" />
                    <span className="text-sm">写一个React登录组件</span>
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <ChatThread
                  openDetail={openDetail}
                  onArtifactClick={() => setCodeJumpOpen(true)}
                  onFilePreview={handleFilePreview}
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
        <div className="p-3 md:p-5 shrink-0 flex justify-center z-10 bg-gradient-to-t from-background via-background/95 to-background/50">
          <div className="w-full relative flex flex-col rounded-3xl border bg-background/80 backdrop-blur-xl soft-shadow overflow-visible">
            {(quotedCard || selectedRepos.length > 0) && (
              <div className="flex flex-wrap gap-2 px-5 pt-3 pb-2 border-b border-border/10">
                {quotedCard && (
                  <div className="flex items-center gap-2 w-56 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 shrink-0">
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
            <Textarea
              placeholder="你想让 AI 助手做什么？ 例如：开发一个小游戏、实现一个新功能、做数据分析..."
              className="min-h-[100px] w-full resize-none border-0 focus-visible:ring-0 px-5 py-4 text-base shadow-none bg-transparent"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            <div className="flex items-center justify-between px-3 pb-3 mt-auto">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 任务 */}
                <div className="relative" ref={taskMenuRef}>
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setTaskMenuOpen(!taskMenuOpen); setRepoMenuOpen(false); setPromptMenuOpen(false); setSkillPopoverOpen(false); }}>
                    <ListTodo className="h-3.5 w-3.5 mr-1.5" />任务
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

                {/* 代码库 / 提示词 / 技能 */}
                {showPreview ? (
                  <div className="relative" ref={compactPlusRef}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 rounded-full p-0"
                      onClick={() => { setCompactPlusOpen(!compactPlusOpen); setCompactPlusSubmenu(null); }}
                      title="更多工具"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    {/* 一级菜单：选择类型 */}
                    {compactPlusOpen && !compactPlusSubmenu && (
                      <div className="absolute bottom-full left-0 mb-2 bg-popover border shadow-xl rounded-xl flex items-center gap-0.5 z-50 p-1 animate-in fade-in slide-in-from-bottom-2">
                        <button
                          className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center transition-colors"
                          title="代码库"
                          onClick={() => setCompactPlusSubmenu('repo')}
                        >
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
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
                      </div>
                    )}
                    {/* 二级菜单：代码库 */}
                    {compactPlusSubmenu === 'repo' && (
                      <div className="absolute bottom-full left-0 mb-2 w-48 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                        {availableRepos.map(repo => {
                          const sel = selectedRepos.some(r => r.id === repo.id);
                          return (
                            <div key={repo.id} className="flex items-center w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer text-foreground" onClick={() => { toggleRepo(repo); setCompactPlusSubmenu(null); setCompactPlusOpen(false); }}>
                              <GitBranch className="h-4 w-4 mr-2 text-muted-foreground" />
                              <span className="flex-1 truncate">{repo.name}</span>
                              {sel && <CheckCircle className="h-4 w-4 text-primary ml-2 shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* 二级菜单：提示词 */}
                    {compactPlusSubmenu === 'prompt' && (
                      <div className="absolute bottom-full left-0 mb-2 w-72 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                        <div className="max-h-[280px] overflow-y-auto p-1">
                          {availablePrompts.map(p => (
                            <div key={p.id} className="flex flex-col w-full px-3 py-2 hover:bg-accent cursor-pointer text-foreground rounded-md transition-colors" onClick={() => { insertPrompt(p.content || p.description); setCompactPlusSubmenu(null); setCompactPlusOpen(false); }}>
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
                          <div className="px-1 pt-2 bg-muted/30">
                            <TabsList className="w-full justify-start h-auto bg-transparent p-0 overflow-x-auto flex-nowrap rounded-none border-b">
                              {['全部', '需求设计', 'UI设计', '代码开发', '测试编写', '需求上线'].map(tab => (
                                <TabsTrigger key={tab} value={tab} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">{tab}</TabsTrigger>
                              ))}
                            </TabsList>
                          </div>
                          <div className="max-h-[280px] overflow-y-auto p-2 space-y-1">
                            {availableSkills
                              .filter(s => activeSkillTab === '全部' || s.phase === activeSkillTab)
                              .map(skill => {
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
                  </div>
                ) : (
                  <>
                    {/* 代码库 */}
                    <div className="relative" ref={repoMenuRef}>
                      <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setRepoMenuOpen(!repoMenuOpen); setSkillPopoverOpen(false); setPromptMenuOpen(false); setTaskMenuOpen(false); }}>
                        <Code2 className="h-3.5 w-3.5 mr-1.5" />代码库
                      </Button>
                      {repoMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-48 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                          {availableRepos.map(repo => {
                            const sel = selectedRepos.some(r => r.id === repo.id);
                            return (
                              <div key={repo.id} className="flex items-center w-full px-3 py-2 text-sm hover:bg-accent cursor-pointer text-foreground" onClick={() => toggleRepo(repo)}>
                                <GitBranch className="h-4 w-4 mr-2 text-muted-foreground" />
                                <span className="flex-1 truncate">{repo.name}</span>
                                {sel && <CheckCircle className="h-4 w-4 text-primary ml-2 shrink-0" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* 提示词 */}
                    <div className="relative" ref={promptMenuRef}>
                      <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setPromptMenuOpen(!promptMenuOpen); setRepoMenuOpen(false); setSkillPopoverOpen(false); setTaskMenuOpen(false); }}>
                        <FileText className="h-3.5 w-3.5 mr-1.5" />提示词
                      </Button>
                      {promptMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-72 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                          <div className="max-h-[280px] overflow-y-auto p-1">
                            {availablePrompts.map(p => (
                              <div key={p.id} className="flex flex-col w-full px-3 py-2 hover:bg-accent cursor-pointer text-foreground rounded-md transition-colors" onClick={() => insertPrompt(p.content || p.description)}>
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
                      <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setSkillPopoverOpen(!skillPopoverOpen); setRepoMenuOpen(false); setPromptMenuOpen(false); setTaskMenuOpen(false); }}>
                        <Wand2 className="h-3.5 w-3.5 mr-1.5" />技能
                      </Button>
                      {skillPopoverOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 h-[360px]">
                          <Tabs value={activeSkillTab} onValueChange={setActiveSkillTab} className="w-full flex flex-col">
                            <div className="px-1 pt-2 bg-muted/30">
                              <TabsList className="w-full justify-start h-auto bg-transparent p-0 overflow-x-auto flex-nowrap rounded-none border-b">
                                {['全部', '需求设计', 'UI设计', '代码开发', '测试编写', '需求上线'].map(tab => (
                                  <TabsTrigger key={tab} value={tab} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">{tab}</TabsTrigger>
                                ))}
                              </TabsList>
                            </div>
                            <div className="max-h-[280px] overflow-y-auto p-2 space-y-1">
                              {availableSkills
                                .filter(s => activeSkillTab === '全部' || s.phase === activeSkillTab)
                                .map(skill => {
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
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground rounded-full hover:bg-muted" onClick={() => fileInputRef.current?.click()}>
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
                  <Button size="sm" className="h-9 px-4 rounded-full" disabled={!input.trim() && !quotedCard} onClick={handleSend}>
                    <span className="mr-1.5 text-sm">执行</span><Send className="h-3.5 w-3.5" />
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
                  {(['todo', 'backlog', 'in-progress', 'done'] as RequirementStatus[]).map(status => (
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
                        <div className={`flex items-center justify-between px-3 py-2 mb-2 rounded-lg border shrink-0 ${getColColorStyle(col.key)}`}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold">{col.label}</span>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border bg-background/80 ${getColCountStyle(col.key)}`}>{items.length}</span>
                        </div>
                        <div className="flex flex-col gap-2 flex-1 overflow-y-auto pb-2">
                          {items.map(item => {
                            const isHighlight = item.id === kanbanHighlightId;
                            return (
                              <div
                                key={item.id}
                                ref={el => { kanbanItemRefs.current[item.id] = el; }}
                                className={`p-3 rounded-xl border bg-card cursor-pointer transition-all ${isHighlight ? 'border-primary shadow-md ring-2 ring-primary/30' : 'border-border/50 hover:border-primary/50 hover:shadow-sm'}`}
                                onClick={() => {
                                  setKanbanHighlightId(item.id);
                                  openDetail(kanbanType, item.id);
                                }}
                              >
                                <p className="text-xs font-medium text-foreground leading-snug mb-2">{item.title}</p>
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
      </div>
    </div>
    </AssistantRuntimeProvider>
  );
};
