import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  MessageSquarePlus,
  Search,
  Send,
  Bot,
  User,
  Code2,
  Box,
  ListTodo,
  FileCode2,
  ChevronRight,
  Wand2,
  Mic,
  CheckCircle,
  CheckCircle2,
  UploadCloud,
  X,
  GitBranch,
  FileText,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  LayoutTemplate,
  Info,
  Bug,
  FlaskConical,
  Wrench,
  Flag,
  FolderKanban,
  Settings2,
  SlidersHorizontal
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

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
  },
  { id: 'm5', role: 'assistant', type: 'summary_card' }
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

// ──────────────── Label / Color Maps ────────────────
const REQ_STATUS_LABELS: Record<RequirementStatus, string> = { backlog: '待办', todo: '待处理', 'in-progress': '进行中', done: '已完成' };
const DEF_STATUS_LABELS: Record<DefectStatus, string> = { open: '待修复', 'in-progress': '修复中', fixed: '已修复', closed: '已关闭' };
const CASE_STATUS_LABELS: Record<CaseStatus, string> = { draft: '草稿', ready: '待执行', passed: '通过', failed: '失败', blocked: '阻塞' };
const SEVERITY_LABELS: Record<DefectSeverity, string> = { critical: '致命', high: '严重', medium: '一般', low: '轻微' };

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

// ──────────────── SectionPanel helper ────────────────
interface SectionPanelProps {
  icon: React.ReactNode;
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onKanban?: () => void;
  children: React.ReactNode;
}
const SectionPanel: React.FC<SectionPanelProps> = ({ icon, title, count, expanded, onToggle, onKanban, children }) => (
  <div className="flex flex-col min-h-0" style={{ flex: expanded ? '1 1 0' : '0 0 auto' }}>
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50 bg-background/50 shrink-0">
      {icon}
      <span className="text-xs font-semibold flex-1 truncate">{title}</span>
      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full shrink-0">{count}</span>
      {onKanban && (
        <button title="看板视图" className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={onKanban}>
          <LayoutTemplate className="h-3 w-3" />
        </button>
      )}
      <button title={expanded ? '收起' : '展开'} className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" onClick={onToggle}>
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
    </div>
    {expanded && (
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1.5 space-y-0.5">{children}</div>
      </ScrollArea>
    )}
  </div>
);

// ──────────────── Component ────────────────
export const Chat: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(MOCK_MESSAGES);

  // History session dropdown
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);

  // Input toolbar dropdowns
  const [selectedRepos, setSelectedRepos] = useState<{id: string; name: string}[]>([]);
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [promptMenuOpen, setPromptMenuOpen] = useState(false);
  const [activeSkillTab, setActiveSkillTab] = useState('全部');
  const repoMenuRef = useRef<HTMLDivElement>(null);
  const promptMenuRef = useRef<HTMLDivElement>(null);
  const skillMenuRef = useRef<HTMLDivElement>(null);

  // Sidebar panels expand state
  const [reqExpanded, setReqExpanded] = useState(true);
  const [defectExpanded, setDefectExpanded] = useState(true);
  const [caseExpanded, setCaseExpanded] = useState(true);

  // Data state
  const [requirements, setRequirements] = useState<ReqItem[]>(MOCK_REQUIREMENTS);
  const [defects, setDefects] = useState<DefectItem[]>(MOCK_DEFECTS);
  const [cases, setCases] = useState<CaseItem[]>(MOCK_CASES);

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

  // Kanban
  const [kanbanType, setKanbanType] = useState<'req' | 'defect' | 'case' | null>(null);
  const [kanbanHighlightId, setKanbanHighlightId] = useState<string | null>(null);
  const kanbanItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const detailReq = requirements.find(r => r.id === detailId) ?? null;
  const detailDef = defects.find(d => d.id === detailId) ?? null;
  const detailCase = cases.find(c => c.id === detailId) ?? null;
  const detailOpen = detailType !== null;
  const kanbanOpen = kanbanType !== null;

  // Close all dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (historyRef.current && !historyRef.current.contains(t)) setHistoryOpen(false);
      if (repoMenuRef.current && !repoMenuRef.current.contains(t)) setRepoMenuOpen(false);
      if (promptMenuRef.current && !promptMenuRef.current.contains(t)) setPromptMenuOpen(false);
      if (skillMenuRef.current && !skillMenuRef.current.contains(t)) setSkillPopoverOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (location.state?.initialInput) setInput(location.state.initialInput);
  }, [location.state]);

  // Scroll kanban highlight into view
  useEffect(() => {
    if (kanbanHighlightId && kanbanItemRefs.current[kanbanHighlightId]) {
      setTimeout(() => {
        kanbanItemRefs.current[kanbanHighlightId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [kanbanHighlightId, kanbanOpen]);

  const availableRepos = [
    { id: '1', name: 'frontend-web' },
    { id: '2', name: 'backend-api' },
    { id: '3', name: 'ui-components' },
  ];
  const availablePrompts = [
    { id: '1', title: '编写PRD文档模板', content: '请作为产品经理，根据以下需求生成一份结构化的PRD文档，包含：1. 背景与目标 2. 用户场景 3. 功能详情 4. 业务流程图 5. 数据埋点要求。当前需求：' },
    { id: '2', title: '竞品分析框架', content: '请帮我对【功能模块】进行竞品分析，主要对比对象包括：... 比较维度应包含用户体验、功能完整度、商业模式等。' },
    { id: '3', title: 'React组件生成标准', content: '请生成一个React组件，要求：使用TypeScript，TailwindCSS进行样式编写，遵循响应式设计，分离逻辑与视图，并添加适当的JSDoc注释。' },
    { id: '4', title: 'Go API 接口规范', content: '实现一个RESTful API端点，语言为Go，使用Gin框架。要求包含参数验证、统一的错误处理封装、以及完整的Swagger注释。' },
  ];

  const insertPrompt = (c: string) => { setInput(p => p.trimEnd() ? p.trimEnd() + '\n' + c : c); setPromptMenuOpen(false); toast.success('已插入提示词'); };
  const toggleRepo = (repo: {id: string; name: string}) => setSelectedRepos(prev => prev.find(r => r.id === repo.id) ? prev.filter(r => r.id !== repo.id) : [...prev, repo]);
  const appendSkillTag = (name: string) => { setInput(p => p.trimEnd() ? p.trimEnd() + ` #${name} ` : `#${name} `); toast.success(`已选择：${name}`); };

  const handleSend = () => {
    if (!input.trim() && !quotedCard) return;
    const um = { 
      id: Date.now().toString(), 
      role: 'user' as const, 
      content: input || '请帮我处理这个引用的内容',
      quotedCard: quotedCard ? { ...quotedCard } : undefined,
      selectedRepos: selectedRepos.length > 0 ? [...selectedRepos] : undefined
    };
    setMessages(prev => [...prev, um]);
    setInput('');
    setQuotedCard(null);
    setSelectedRepos([]);

    // 模拟信息流：思考 → 工具使用 → 工具结果 → 最终回复 → 会话结束
    const baseTime = Date.now();
    const addMsg = (delay: number, msg: any) => {
      setTimeout(() => setMessages(prev => [...prev, msg]), delay);
    };

    addMsg(800, {
      id: `${baseTime}_think`, role: 'assistant' as const,
      content: '正在分析您的需求...', type: 'thinking' as const,
    });

    addMsg(1800, {
      id: `${baseTime}_tool`, role: 'assistant' as const,
      content: '调用代码检索工具查找相关文件...', type: 'tool_use' as const,
    });

    addMsg(2800, {
      id: `${baseTime}_result`, role: 'assistant' as const,
      content: '找到 3 个相关文件：src/components/Login.tsx、src/hooks/useAuth.ts、src/utils/validator.ts', type: 'tool_result' as const,
    });

    addMsg(3500, {
      id: `${baseTime + 1}`, role: 'assistant' as const,
      content: '我已经为您生成了登录页面的完整实现代码，包含邮箱/密码输入框和第三方登录选项。您可以在右侧查看生成的组件文件。',
      artifact: { id: `art_${baseTime}`, type: 'code', title: 'Login_Page.tsx' }
    });

    addMsg(4500, {
      id: `${baseTime}_end`, role: 'assistant' as const,
      content: '会话已结束，如有需要可以继续提问。', type: 'session_end' as const,
    });
  };

  const closeDetail = () => {
    setDetailType(null); setDetailId(null);
  };

  const openDetail = (type: 'req' | 'defect' | 'case', id: string) => {
    if (detailType === type && detailId === id) {
      closeDetail();
      return;
    }
    setDetailType(type); setDetailId(id);
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
    setRequirements(prev => prev.map(r => r.id === id ? { ...r, status } : r)); toast.success('状态已更新');
  };
  const updateDefStatus = (id: string, status: DefectStatus) => {
    setDefects(prev => prev.map(d => d.id === id ? { ...d, status } : d)); toast.success('状态已更新');
  };
  const updateCaseStatus = (id: string, status: CaseStatus) => {
    setCases(prev => prev.map(c => c.id === id ? { ...c, status } : c)); toast.success('状态已更新');
  };

  const filteredHistory = MOCK_HISTORY.filter(h => h.title.includes(historySearch));

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  // ──────────────── Render ────────────────
  return (
    <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-4rem)] flex flex-row border-0 md:border md:border-border/50 rounded-none md:rounded-2xl overflow-hidden bg-background soft-shadow max-w-full mx-auto w-full relative">

      {/* ── My Tasks Left Sidebar ── */}
      <div className={`hidden md:flex flex-col shrink-0 bg-muted/10 border-r border-border/50 overflow-hidden transition-all duration-300 relative ${sidebarCollapsed ? 'w-12' : 'w-[260px]'}`}>
        <button 
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute top-3 -right-3 h-6 w-6 bg-background border border-border rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground z-10 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ transform: sidebarCollapsed ? 'translateX(-12px)' : 'none' }}
        >
          {sidebarCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
        
        {!sidebarCollapsed ? (
          <>
            {/* 我的需求 */}
            <SectionPanel
              icon={<ListTodo className="h-3.5 w-3.5 text-primary shrink-0" />}
              title="我的需求"
          count={visibleRequirements.length}
          expanded={reqExpanded}
          onToggle={() => setReqExpanded(v => !v)}
          onKanban={() => openKanban('req')}
        >
          {visibleRequirements.map(req => (
            <div
              key={req.id}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${detailType === 'req' && detailId === req.id ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-accent/60'}`}
            >
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail('req', req.id)}>
                <p className={`text-xs font-medium leading-snug truncate ${detailType === 'req' && detailId === req.id ? 'text-primary' : 'text-foreground'}`}>{req.title}</p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[req.status]}`}>
                    {REQ_STATUS_LABELS[req.status]}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">{req.reporter} 提</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuotedCard({ type: 'req', id: req.id, title: req.title, reporter: req.reporter });
                    toast.success('已引用需求到会话');
                  }}
                  title="引用到会话"
                >
                  <Send className="h-3 w-3" />
                </button>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDetail('req', req.id);
                  }}
                  title="查看详情"
                >
                  <Info className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </SectionPanel>

        <div className="border-t border-border/50 shrink-0" />

        {/* 我的缺陷 */}
        <SectionPanel
          icon={<Bug className="h-3.5 w-3.5 text-destructive shrink-0" />}
          title="我的缺陷"
          count={visibleDefects.length}
          expanded={defectExpanded}
          onToggle={() => setDefectExpanded(v => !v)}
          onKanban={() => openKanban('defect')}
        >
          {visibleDefects.map(def => (
            <div
              key={def.id}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${detailType === 'defect' && detailId === def.id ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-accent/60'}`}
            >
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail('defect', def.id)}>
                <p className={`text-xs font-medium leading-snug truncate ${detailType === 'defect' && detailId === def.id ? 'text-primary' : 'text-foreground'}`}>{def.title}</p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[def.status]}`}>
                    {DEF_STATUS_LABELS[def.status]}
                  </span>
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[def.severity]}`}>
                    {SEVERITY_LABELS[def.severity]}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">{def.reporter} 提</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuotedCard({ type: 'defect', id: def.id, title: def.title, reporter: def.reporter });
                    toast.success('已引用缺陷到会话');
                  }}
                  title="引用到会话"
                >
                  <Send className="h-3 w-3" />
                </button>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDetail('defect', def.id);
                  }}
                  title="查看详情"
                >
                  <Info className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </SectionPanel>

        <div className="border-t border-border/50 shrink-0" />

        {/* 我的用例 */}
        <SectionPanel
          icon={<FlaskConical className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
          title="我的用例"
          count={visibleCases.length}
          expanded={caseExpanded}
          onToggle={() => setCaseExpanded(v => !v)}
          onKanban={() => openKanban('case')}
        >
          {visibleCases.map(tc => (
            <div
              key={tc.id}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${detailType === 'case' && detailId === tc.id ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-accent/60'}`}
            >
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail('case', tc.id)}>
                <p className={`text-xs font-medium leading-snug truncate ${detailType === 'case' && detailId === tc.id ? 'text-primary' : 'text-foreground'}`}>{tc.title}</p>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[tc.status]}`}>
                    {CASE_STATUS_LABELS[tc.status]}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">{tc.reporter} 提</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuotedCard({ type: 'case', id: tc.id, title: tc.title, reporter: tc.reporter });
                    toast.success('已引用用例到会话');
                  }}
                  title="引用到会话"
                >
                  <Send className="h-3 w-3" />
                </button>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDetail('case', tc.id);
                  }}
                  title="查看详情"
                >
                  <Info className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </SectionPanel>

        {/* Status Bar */}
        <div className="shrink-0 border-t border-border/50 bg-background/80 px-3 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>总任务: <span className="font-semibold text-foreground">{allTasks.length}</span></span>
            <span>已完成: <span className="font-semibold text-green-600 dark:text-green-400">{completedCount}</span></span>
            <span>未完成: <span className="font-semibold text-amber-600 dark:text-amber-400">{uncompletedCount}</span></span>
          </div>
          <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="筛选配置">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>侧边栏筛选配置</DialogTitle>
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
        </div>

        </>
        ) : null}
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex flex-col flex-1 min-w-0 bg-background relative overflow-hidden">

        {/* Chat Header */}
        <div className="h-12 border-b border-border/50 flex items-center px-4 shrink-0 gap-2 bg-background/80 backdrop-blur-sm z-10 w-full">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-sm">DeepHarness 助手</span>

          {/* History dropdown */}
          <div className="relative ml-2" ref={historyRef}>
            <button
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border/60 bg-background/80 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              onClick={() => setHistoryOpen(v => !v)}
            >
              <span>历史会话</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {historyOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-popover border border-border/60 shadow-xl rounded-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
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
                    <div key={h.id} className="group relative w-full flex items-center px-3 py-2 text-sm rounded-lg hover:bg-accent text-left transition-colors cursor-pointer" onClick={() => { setMessages([]); setHistoryOpen(false); toast.success(`切换到：${h.title}`); }}>
                      <div className="flex items-center gap-2 flex-1 min-w-0 pr-12 group-hover:pr-16 transition-all">
                        {h.type === 'ui' && <Box className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                        {h.type === 'requirement' && <ListTodo className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                        {h.type === 'code' && <Code2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                        <span className="flex-1 truncate text-xs">{h.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline-block group-hover:hidden">{h.date}</span>
                      </div>
                      
                      {/* Action buttons (shown on hover) */}
                      <div className="absolute right-2 opacity-0 group-hover:opacity-100 flex items-center gap-1 bg-gradient-to-l from-accent via-accent to-transparent pl-2 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                          title="会话复盘"
                          onClick={(e) => { e.stopPropagation(); toast.success('已生成会话复盘报告'); setHistoryOpen(false); }}
                        >
                          <FileText className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
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

          {/* New session */}
          <Button
            variant="ghost" size="sm"
            className="h-7 px-2.5 ml-auto text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => { setMessages([]); toast.success('已开启新会话'); }}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            新建会话
          </Button>
        </div>

        {/* Chat Messages */}
        <ScrollArea className="flex-1 p-4 bg-[#f8f9fa] dark:bg-card/30">
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
              messages.map(msg => {
                const isThinking = (msg as any).type === 'thinking';
                const isToolUse = (msg as any).type === 'tool_use';
                const isToolResult = (msg as any).type === 'tool_result';
                const isSessionEnd = (msg as any).type === 'session_end';
                const isSummaryCard = (msg as any).type === 'summary_card';
                const isInfoFlow = isThinking || isToolUse || isToolResult || isSessionEnd;

                if (isSummaryCard) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <div className="w-full max-w-2xl p-4 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 soft-shadow">
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-foreground mb-2">会话任务已完成</h4>
                            <p className="text-xs text-muted-foreground mb-3">
                              本次会话中，我为您设计了一个现代化的登录页面，并根据您的反馈调整了主色调为深蓝色（#1890ff）。页面采用卡片式布局，左侧展示品牌形象，右侧为登录表单，支持邮箱、密码输入及第三方登录选项。
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { navigate('/code'); toast.success('已跳转到工程代码窗口'); }}>
                                <Code2 className="h-3 w-3 mr-1.5" />
                                查看代码
                              </Button>
                              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => toast.success('已生成会话复盘报告')}>
                                <FileText className="h-3 w-3 mr-1.5" />
                                会话复盘
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && !isInfoFlow && (
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    {msg.role === 'assistant' && isInfoFlow && (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                        {isThinking && <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />}
                        {isToolUse && <Wrench className="h-4 w-4 text-blue-500" />}
                        {isToolResult && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                        {isSessionEnd && <Flag className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    )}
                    <div className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {msg.role === 'user' && (msg as any).quotedCard && (
                        <div className="mb-2 p-2 rounded-xl border border-primary/20 bg-primary/10 flex items-center gap-2 w-fit max-w-full">
                          {(msg as any).quotedCard.type === 'req' && <ListTodo className="h-4 w-4 text-primary shrink-0" />}
                          {(msg as any).quotedCard.type === 'defect' && <Bug className="h-4 w-4 text-destructive shrink-0" />}
                          {(msg as any).quotedCard.type === 'case' && <FlaskConical className="h-4 w-4 text-violet-500 shrink-0" />}
                          <div className="flex-1 min-w-0 text-left">
                            <p className="text-xs font-medium text-foreground truncate">{(msg as any).quotedCard.title}</p>
                            <p className="text-[10px] text-muted-foreground">引用{(msg as any).quotedCard.type === 'req' ? '需求' : (msg as any).quotedCard.type === 'defect' ? '缺陷' : '用例'} · {(msg as any).quotedCard.id}</p>
                          </div>
                        </div>
                      )}
                      {msg.role === 'user' && (msg as any).selectedRepos && (msg as any).selectedRepos.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2 w-fit max-w-full justify-end">
                          {(msg as any).selectedRepos.map((repo: any) => (
                            <div key={repo.id} className="p-1.5 px-3 rounded-full border border-primary/20 bg-primary/10 flex items-center gap-1.5">
                              <GitBranch className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-[10px] font-medium text-foreground">{repo.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className={`px-4 py-3 text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm' : isInfoFlow ? 'bg-muted/30 rounded-2xl rounded-tl-sm border border-border/30 text-muted-foreground italic' : 'bg-muted/60 rounded-2xl rounded-tl-sm border border-border/50 shadow-sm'}`}>
                        {msg.content}
                        {isThinking && <span className="inline-flex ml-1">
                          <span className="animate-bounce mx-0.5">.</span>
                          <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.2s' }}>.</span>
                          <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.4s' }}>.</span>
                        </span>}
                      </div>
                      {msg.artifact && (
                        <div className="mt-2 p-3 rounded-xl border border-border/50 bg-card cursor-pointer hover:border-primary transition-colors flex items-center gap-3 w-full max-w-sm soft-shadow" onClick={() => toast.success('已打开详情')}>
                          <div className="h-10 w-10 rounded bg-secondary flex items-center justify-center shrink-0">
                            {msg.artifact.type === 'ui' && <Box className="h-5 w-5 text-blue-500" />}
                            {msg.artifact.type === 'code' && <FileCode2 className="h-5 w-5 text-green-500" />}
                            {msg.artifact.type === 'requirement' && <ListTodo className="h-5 w-5 text-amber-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{msg.artifact.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center">点击查看详情 <ChevronRight className="h-3 w-3 ml-1" /></p>
                          </div>
                        </div>
                      )}
                    </div>
                    {msg.role === 'user' && (
                      <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                        <User className="h-4 w-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Chat Input */}
        <div className="p-3 md:p-5 shrink-0 flex justify-center z-10 bg-gradient-to-t from-background via-background/95 to-background/50">
          <div className="w-full relative flex flex-col rounded-3xl border bg-background/80 backdrop-blur-xl soft-shadow overflow-visible">
            {(quotedCard || selectedRepos.length > 0) && (
              <div className="flex flex-col gap-2 px-5 pt-3 pb-2 border-b border-border/10">
                {quotedCard && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20">
                      {quotedCard.type === 'req' && <ListTodo className="h-3.5 w-3.5 text-primary shrink-0" />}
                      {quotedCard.type === 'defect' && <Bug className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      {quotedCard.type === 'case' && <FlaskConical className="h-3.5 w-3.5 text-violet-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{quotedCard.title}</p>
                        <p className="text-[10px] text-muted-foreground">{quotedCard.reporter} 提 · {quotedCard.id}</p>
                      </div>
                    </div>
                    <button
                      className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors shrink-0"
                      onClick={() => setQuotedCard(null)}
                      title="移除引用"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {selectedRepos.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-wrap items-center gap-2 flex-1">
                      {selectedRepos.map(repo => (
                        <div key={repo.id} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border/50 max-w-full">
                          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-[11px] font-medium text-foreground truncate">{repo.name}</span>
                          <button
                            className="ml-1 h-4 w-4 flex items-center justify-center rounded-full hover:bg-muted-foreground/20 text-muted-foreground"
                            onClick={() => toggleRepo(repo)}
                            title="移除引用"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground transition-colors shrink-0"
                      onClick={() => setSelectedRepos([])}
                      title="清除所有引用代码库"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
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
                {/* 代码库 */}
                <div className="relative" ref={repoMenuRef}>
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setRepoMenuOpen(!repoMenuOpen); setSkillPopoverOpen(false); setPromptMenuOpen(false); }}>
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
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setPromptMenuOpen(!promptMenuOpen); setRepoMenuOpen(false); setSkillPopoverOpen(false); }}>
                    <FileText className="h-3.5 w-3.5 mr-1.5" />提示词
                  </Button>
                  {promptMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-72 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden py-1 animate-in fade-in slide-in-from-bottom-2">
                      <div className="max-h-[280px] overflow-y-auto p-1">
                        {availablePrompts.map(p => (
                          <div key={p.id} className="flex flex-col w-full px-3 py-2 hover:bg-accent cursor-pointer text-foreground rounded-md transition-colors" onClick={() => insertPrompt(p.content)}>
                            <span className="font-medium text-sm mb-1">{p.title}</span>
                            <span className="text-xs text-muted-foreground line-clamp-2">{p.content}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 技能 */}
                <div className="relative" ref={skillMenuRef}>
                  <Button variant="outline" size="sm" className="h-8 rounded-full text-xs hover:bg-muted px-3" onClick={() => { setSkillPopoverOpen(!skillPopoverOpen); setRepoMenuOpen(false); setPromptMenuOpen(false); }}>
                    <Wand2 className="h-3.5 w-3.5 mr-1.5" />技能
                  </Button>
                  {skillPopoverOpen && (
                    <div className="absolute bottom-full left-0 mb-2 w-80 bg-popover border shadow-xl rounded-xl flex flex-col z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                      <Tabs value={activeSkillTab} onValueChange={setActiveSkillTab} className="w-full flex flex-col">
                        <div className="px-1 pt-2 bg-muted/30">
                          <TabsList className="w-full justify-start h-auto bg-transparent p-0 overflow-x-auto flex-nowrap rounded-none border-b">
                            {['全部', '需求设计', 'UI设计', '代码开发', '测试编写', '需求上线'].map(tab => (
                              <TabsTrigger key={tab} value={tab} className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-2 px-3 text-xs">{tab}</TabsTrigger>
                            ))}
                          </TabsList>
                        </div>
                        <div className="max-h-[280px] overflow-y-auto p-2 space-y-1">
                          {[
                            { id: '1', name: '需求设计', desc: '通过对话梳理并生成结构化需求文档', phase: '需求设计', icon: ListTodo },
                            { id: '2', name: 'UI设计', desc: '根据需求生成UI组件或页面结构', phase: 'UI设计', icon: Box },
                            { id: '3', name: '代码开发', desc: '根据设计规范和需求编写代码', phase: '代码开发', icon: Code2 },
                            { id: '4', name: '单元测试', desc: '生成单元测试用例', phase: '测试编写', icon: CheckCircle },
                            { id: '5', name: '自动化部署', desc: '将完成的代码提交并部署上线', phase: '需求上线', icon: UploadCloud },
                          ].filter(s => activeSkillTab === '全部' || s.phase === activeSkillTab).map(skill => (
                            <div key={skill.id} className="flex items-start gap-3 p-2.5 rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors" onClick={() => { appendSkillTag(skill.name); setSkillPopoverOpen(false); }}>
                              <div className="h-8 w-8 rounded-md bg-background flex items-center justify-center border shrink-0"><skill.icon className="h-4 w-4 text-muted-foreground" /></div>
                              <div className="flex flex-col flex-1 min-w-0">
                                <span className="font-medium text-sm leading-none mb-1 text-foreground">{skill.name}</span>
                                <span className="text-xs text-muted-foreground line-clamp-2">{skill.desc}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Tabs>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground rounded-full hover:bg-muted" onClick={() => toast.success('语音输入')}>
                  <Mic className="h-4 w-4" />
                </Button>
                <Button size="sm" className="h-9 px-4 rounded-full" disabled={!input.trim()} onClick={handleSend}>
                  <span className="mr-1.5 text-sm">执行</span><Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

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
      </div>
    </div>
  );
};
