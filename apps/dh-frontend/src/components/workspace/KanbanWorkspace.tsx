import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Github,
  Info,
  LayoutTemplate,
  Loader2,
  PenLine,
  Split,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { workItemDocApi } from '@/lib/workitem-doc-api';
import { workItemApi } from '@/lib/workitem-api';
import { productSpaceApi, requirementShareApi, findPrototypeProductName } from '@/lib/productspace-api';
import type { WorkItemDTO, WorkItemCommitDTO } from '@/lib/api-types';
import {
  type KanbanViewMode,
  MAX_KANBAN_DEPTH,
  buildDisplayTitle,
  canSplitMore,
  getChildren,
  getDepth,
  getDescendantIds,
  hasChildren,
} from '@/lib/kanban-utils';

const API_STATUS_TO_UI: Record<string, string> = {
  backlog: '待处理',
  todo: '待处理',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
  on_hold: '已挂起',
};

const UI_STATUS_TO_API: Record<string, string> = {
  '待处理': 'todo',
  '进行中': 'in_progress',
  '已完成': 'done',
  '已取消': 'cancelled',
  '已挂起': 'on_hold',
};

const API_PRIORITY_TO_UI: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const STATUSES = ['待处理', '进行中', '已完成', '已取消', '已挂起'];

// 看板列配色（对齐 DESIGN.md §5.8）：pastel 列头 + 同色实心圆形计数
const COLUMN_STYLES: Record<string, { header: string; title: string; count: string }> = {
  '待处理': {
    header: 'bg-blue-100/70 dark:bg-blue-900/25',
    title: 'text-blue-700 dark:text-blue-300',
    count: 'bg-blue-600',
  },
  '进行中': {
    header: 'bg-amber-100/70 dark:bg-amber-900/25',
    title: 'text-amber-700 dark:text-amber-300',
    count: 'bg-amber-500',
  },
  '已完成': {
    header: 'bg-green-100/70 dark:bg-green-900/25',
    title: 'text-green-700 dark:text-green-300',
    count: 'bg-green-500',
  },
  '已取消': {
    header: 'bg-zinc-100/70 dark:bg-zinc-800/40',
    title: 'text-zinc-600 dark:text-zinc-300',
    count: 'bg-zinc-500',
  },
  '已挂起': {
    header: 'bg-orange-100/70 dark:bg-orange-900/25',
    title: 'text-orange-700 dark:text-orange-300',
    count: 'bg-orange-500',
  },
};
const DEFAULT_COLUMN_STYLE = {
  header: 'bg-muted/60',
  title: 'text-foreground',
  count: 'bg-muted-foreground',
};

// 优先级配色：卡片左侧优先级条 + 胶囊标签
const PRIORITY_BAR_COLORS: Record<string, string> = {
  '高': 'bg-red-500',
  '中': 'bg-amber-500',
  '低': 'bg-blue-500',
};
const PRIORITY_TAG_COLORS: Record<string, string> = {
  '高': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  '中': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  '低': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};
const DEFAULT_PRIORITY_BAR = 'bg-muted-foreground/40';
const DEFAULT_PRIORITY_TAG = 'bg-muted text-muted-foreground';

// 状态圆点配色
const STATUS_DOT_COLORS: Record<string, string> = {
  '待处理': 'bg-gray-400',
  '进行中': 'bg-blue-500',
  '已完成': 'bg-green-500',
  '已取消': 'bg-red-500',
};

// 完成态列：卡片降低不透明度且标题划线
const DONE_STATUSES = ['已完成', '已取消'];

// 看板视图模式本地持久化键
const VIEW_MODE_STORAGE_KEY = 'kanban-workspace-view-mode';

/** AI 指令对应的斜杠命令名 */
const AI_COMMANDS = {
  split: 'req-breakdown',
  prototype: 'proto-make',
  document: 'prd-write',
} as const;

interface KanbanCard {
  id: string;
  title: string;
  status: string;
  owner: string;
  priority: string;
  createdAt: string;
  type: string;
  description: string;
  reporter: string;
  parentId?: string;
}

/**
 * 通用需求追踪组件。
 *
 * 数据来自 /v1/workitems?type=requirement，支持拖拽更新状态。
 * 点击卡片弹出居中详情弹窗。
 * 卡片底部提供快捷操作按钮：分配、评审、AI 操作，右侧为文档/原型状态按钮。
 */
interface KanbanWorkspaceProps {
  /** 点击文档/原型状态按钮跳转到需求设计视图 */
  onNavigateToDesign?: (workitemId: string, tab?: 'doc' | 'prototype') => void;
  /** 分配需求给开发人员 */
  onAssign?: (req: WorkItemDTO) => void;
  /** 评审需求设计 */
  onReview?: (req: WorkItemDTO) => void;
  /** AI 设计引导（跳转到 /prd-write） */
  onAiDesign?: (req: WorkItemDTO) => void;
  /** 无设计时点击文档/原型按钮，弹出 AI 设计引导 */
  onAiDesignPrompt?: (workitemId: string, type: 'doc' | 'prototype') => void;
}

export const KanbanWorkspace: React.FC<KanbanWorkspaceProps> = ({ onNavigateToDesign, onAssign, onReview, onAiDesign, onAiDesignPrompt }) => {
  const navigate = useNavigate();
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const [items, setItems] = useState<WorkItemDTO[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);

  const [detailItem, setDetailItem] = useState<WorkItemDTO | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [productDesignLoading, setProductDesignLoading] = useState(false);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const [commits, setCommits] = useState<WorkItemCommitDTO[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);

  const [designInfoMap, setDesignInfoMap] = useState<Record<string, { hasDoc: boolean; hasPrototype: boolean }>>({});
  // 无设计引导弹窗：分配/评审时发现需求无设计，询问是否先进行 AI 设计
  const [noDesignDialog, setNoDesignDialog] = useState<{ open: boolean; req: WorkItemDTO | null }>({
    open: false,
    req: null,
  });
  const [designChecking, setDesignChecking] = useState(false);
  // 当前在看板卡片中展开显示子需求的需求 ID 集合（仅在收缩模式下生效）。
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());
  // 被数字徽章选中的子需求 ID 集合（展开模式下蓝框圈选）。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 看板视图模式：展开（平铺）/ 收缩（层级树）。
  const [viewMode, setViewMode] = useState<KanbanViewMode>(() => {
    try {
      return (localStorage.getItem(VIEW_MODE_STORAGE_KEY) as KanbanViewMode) || 'collapse';
    } catch {
      return 'collapse';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // 忽略无痕模式等写入失败场景
    }
  }, [viewMode]);

  // 切换父需求的子需求展开/折叠；无子需求时给出提示。
  const toggleChildren = (card: KanbanCard, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const children = getChildren(cards, card.id);
    if (children.length === 0) {
      return;
    }
    setExpandedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  };

  // 点击子需求数量徽章：蓝框圈选/取消圈选所有后代需求。
  const toggleSelectDescendants = (card: KanbanCard, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const descendants = getDescendantIds(cards, card.id);
    if (descendants.size === 0) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = Array.from(descendants).every(id => next.has(id));
      if (allSelected) {
        descendants.forEach(id => next.delete(id));
      } else {
        descendants.forEach(id => next.add(id));
      }
      return next;
    });
  };

  useEffect(() => {
    setLoading(true);
    api
      .get<WorkItemDTO[]>(`/v1/workitems?type=requirement&workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(fetched => {
        setItems(fetched);
        setCards(
          fetched.map(item => ({
            id: item.id,
            title: item.title,
            status: API_STATUS_TO_UI[item.status] ?? '待处理',
            owner: item.assigneeName ?? item.reporter ?? '',
            priority: API_PRIORITY_TO_UI[item.priority] ?? '中',
            createdAt: item.createdAt.slice(0, 10),
            type: item.type ?? 'requirement',
            description: item.description ?? '',
            reporter: item.reporter ?? '',
            parentId: item.parentId,
          }))
        );
      })
      .catch(() => toast.error('加载需求失败'))
      .finally(() => setLoading(false));

    if (workspaceId) {
      workItemApi.listRequirementsWithDesignItems(workspaceId).then(designItems => {
        const map: Record<string, { hasDoc: boolean; hasPrototype: boolean }> = {};
        for (const d of designItems) {
          map[d.workitemId] = { hasDoc: !!d.doc, hasPrototype: !!d.prototype };
        }
        setDesignInfoMap(map);
      }).catch(() => {});
    }
  }, [workspaceId]);

  const openDetail = (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setDetailItem(item);
    setDetailOpen(true);
  };

  /** 打开需求的产品设计独立分享页（文档+原型）。 */
  const openProductDesignShare = async (item: WorkItemDTO) => {
    if (!workspaceId) return;
    setProductDesignLoading(true);
    try {
      const links = await workItemDocApi.list(item.id);
      const docLink = links.find(l => l.itemType === 'doc');
      const protoLink = links.find(l => l.itemType === 'prototype');
      const docId = docLink?.productSpaceItemId ?? '';
      let productFolder = '';
      if (protoLink?.productSpaceItemId) {
        const tree = await productSpaceApi.tree(workspaceId);
        productFolder = findPrototypeProductName(tree, protoLink.productSpaceItemId) ?? '';
      }
      if (!docId && !productFolder) {
        toast.error('该需求暂无产品设计（文档或原型）');
        return;
      }
      const share = await requirementShareApi.create(workspaceId, {
        title: item.title,
        docId: docId || undefined,
        productFolder: productFolder || undefined,
        allowComments: true,
      });
      window.open(`/share/requirement/${share.token}`, '_blank');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '打开产品设计失败');
    } finally {
      setProductDesignLoading(false);
    }
  };

  const handleOpenCodeRepo = async () => {
    if (!detailItem) return;
    setCommitsOpen(true);
    setCommitsLoading(true);
    try {
      const data = await workItemApi.listCommits(detailItem.id);
      setCommits(data);
    } catch {
      toast.error('获取提交记录失败');
    } finally {
      setCommitsLoading(false);
    }
  };

  /** 跳转到智能会话页面，使用斜杠指令并附带需求卡片作为上下文 */
  const goToChat = (card: KanbanCard, command: string) => {
    const cardType = card.type === 'defect' ? 'defect' : card.type === 'case' ? 'case' : 'req';
    navigate('/chat', {
      state: {
        initialInput: `/${command} ${card.title}`,
        quotedCard: { type: cardType, id: card.id, title: card.title, reporter: card.reporter },
      },
    });
  };

  /**
   * 检查需求是否有设计（文档/原型关联），无设计时弹出引导对话框。
   * 返回 true 表示有设计可以继续操作，false 表示无设计已弹出引导。
   */
  const checkDesignBeforeAction = async (card: KanbanCard): Promise<boolean> => {
    setDesignChecking(true);
    try {
      const links = await workItemDocApi.list(card.id);
      if (links.length > 0) return true;
    } catch {
      // 查询失败时保守处理，视为无设计
    } finally {
      setDesignChecking(false);
    }
    const req = items.find(i => i.id === card.id);
    if (!req) return false;
    setNoDesignDialog({ open: true, req });
    return false;
  };

  /** 点击分配：先检查设计，有设计才打开分配对话框 */
  const handleAssignClick = async (card: KanbanCard) => {
    const hasDesign = await checkDesignBeforeAction(card);
    if (!hasDesign) return;
    const req = items.find(i => i.id === card.id);
    if (req) onAssign?.(req);
  };

  /** 点击评审：先检查设计，有设计才打开评审对话框 */
  const handleReviewClick = async (card: KanbanCard) => {
    const hasDesign = await checkDesignBeforeAction(card);
    if (!hasDesign) return;
    const req = items.find(i => i.id === card.id);
    if (req) onReview?.(req);
  };

  /** 无设计弹窗确认：跳转到 AI 设计 */
  const confirmNoDesignAiDesign = () => {
    const { req } = noDesignDialog;
    if (!req) return;
    onAiDesign?.(req);
    setNoDesignDialog({ open: false, req: null });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedCardId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) {
      setDraggedCardId(null);
      return;
    }

    const card = cards.find(c => c.id === id);
    if (!card || card.status === targetStatus) {
      setDraggedCardId(null);
      return;
    }

    api
      .patch<WorkItemDTO>(`/v1/workitems/${id}/status`, { status: UI_STATUS_TO_API[targetStatus] })
      .then(item => {
        setCards(prev =>
          prev.map(c =>
            c.id === id
              ? { ...c, status: API_STATUS_TO_UI[item.status] ?? targetStatus }
              : c
          )
        );
        setItems(prev =>
          prev.map(i => (i.id === id ? { ...i, status: item.status } : i))
        );
      })
      .catch(() => toast.error('状态更新失败'));
    setDraggedCardId(null);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        加载看板数据…
      </div>
    );
  }

  // 递归渲染需求卡片。
  // 展开模式：所有需求平铺，子需求标题显示父需求路径。
  // 收缩模式：仅展示顶层父需求，点击后逐级展开子需求，最多支持 MAX_KANBAN_DEPTH 层。
  const renderCard = (card: KanbanCard, depth = 0) => {
    const childCards = getChildren(cards, card.id);
    const childCount = childCards.length;
    const hasChildren = childCount > 0;
    const isExpanded = expandedCardIds.has(card.id);
    const isSelected = selectedIds.has(card.id);
    const isDoneCol = DONE_STATUSES.includes(card.status);
    const isCollapseMode = viewMode === 'collapse';
    const displayTitle = isCollapseMode ? card.title : buildDisplayTitle(cards, card.id);

    return (
      <div key={card.id} className={`flex flex-col ${isCollapseMode && depth > 0 ? 'ml-3 pl-3 border-l border-border/40' : ''}`}>
        <div
          draggable={!card.parentId}
          onDragStart={!card.parentId ? e => handleDragStart(e, card.id) : undefined}
          onClick={() => openDetail(card.id)}
          className={`relative bg-card border border-border/50 rounded-xl pl-5 pr-3 py-2.5 cursor-pointer transition-all duration-200 active:cursor-grabbing hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-black/30 ${
            draggedCardId === card.id ? 'opacity-50 border-primary' : ''
          } ${isSelected ? 'ring-2 ring-blue-500 border-blue-500' : ''} ${isDoneCol ? 'opacity-75' : ''}`}
        >
          <span className={`absolute left-0 top-0 h-full w-1 rounded-l-xl ${PRIORITY_BAR_COLORS[card.priority] ?? DEFAULT_PRIORITY_BAR}`} />
          {/* 标题行：类型图标 + 展开按钮 + 标题 + 子需求数量 + 优先级标签 */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-start gap-1.5 min-w-0 flex-1">
              <button
                type="button"
                className="shrink-0 mt-0.5"
                onClick={e => { e.stopPropagation(); openDetail(card.id); }}
                title="查看详情"
              >
                <Info className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
              </button>
              {isCollapseMode && (
                <button
                  type="button"
                  disabled={!hasChildren}
                  className={`mt-0.5 ${hasChildren ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground/30 cursor-default'}`}
                  onClick={hasChildren ? e => toggleChildren(card, e) : undefined}
                  title={hasChildren ? (isExpanded ? '收起子需求' : '展开子需求') : '暂无子需求'}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
              <h4 className={`text-sm font-medium leading-snug line-clamp-2 ${isDoneCol ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                {displayTitle}
              </h4>
              {hasChildren && (
                <button
                  type="button"
                  onClick={e => toggleSelectDescendants(card, e)}
                  className={`shrink-0 h-4 min-w-[1rem] px-1 rounded-full text-[10px] font-medium flex items-center justify-center ${
                    Array.from(getDescendantIds(cards, card.id)).every(id => selectedIds.has(id))
                      ? 'bg-blue-500 text-white'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}
                  title="点击圈选/取消圈选所有子需求"
                >
                  {childCount}
                </button>
              )}
            </div>
            <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_TAG_COLORS[card.priority] ?? DEFAULT_PRIORITY_TAG}`}>
              {card.priority}
            </span>
          </div>
          {/* 信息行：负责人 + 创建日期 */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-1.5 mb-1.5">
            <p className="text-xs text-muted-foreground">{card.owner || '未分配'}</p>
            <p className="text-xs text-muted-foreground/80 flex items-center gap-1 shrink-0 ml-auto">
              <CalendarDays className="h-3 w-3" />
              {card.createdAt}
            </p>
          </div>
          {/* 快捷操作按钮：仅顶层父需求展示，阻止冒泡以免触发卡片点击 */}
          {!card.parentId && (
            <div
              className="flex items-center gap-0.5 pt-1.5 border-t border-border/30"
              onClick={e => e.stopPropagation()}
            >
              <CardActionBtn
                icon={<UserPlus className="h-3.5 w-3.5" />}
                title="分配人员"
                onClick={() => handleAssignClick(card)}
              />
              <CardActionBtn
                icon={<ClipboardCheck className="h-3.5 w-3.5" />}
                title="评审设计"
                onClick={() => handleReviewClick(card)}
              />
              {/* AI 操作下拉菜单 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-7 w-7 flex items-center justify-center rounded-md transition-colors shrink-0 text-primary hover:bg-primary/10 hover:text-primary/80"
                    title="AI 操作"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => goToChat(card, AI_COMMANDS.split)} disabled={!canSplitMore(cards, card.id)}>
                    <Split className="h-4 w-4 mr-2" />
                    AI 拆分子需求
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => goToChat(card, AI_COMMANDS.prototype)}>
                    <LayoutTemplate className="h-4 w-4 mr-2" />
                    AI 原型设计
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => goToChat(card, AI_COMMANDS.document)}>
                    <PenLine className="h-4 w-4 mr-2" />
                    AI 写文档
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* 空白占位，将文档/原型按钮推到最右 */}
              <div className="flex-1" />
              <DesignStatusBtn
                hasDesign={designInfoMap[card.id]?.hasDoc ?? false}
                type="doc"
                onClick={() => {
                  if (designInfoMap[card.id]?.hasDoc) {
                    onNavigateToDesign?.(card.id, 'doc');
                  } else {
                    onAiDesignPrompt?.(card.id, 'doc');
                  }
                }}
              />
              <DesignStatusBtn
                hasDesign={designInfoMap[card.id]?.hasPrototype ?? false}
                type="prototype"
                onClick={() => {
                  if (designInfoMap[card.id]?.hasPrototype) {
                    onNavigateToDesign?.(card.id, 'prototype');
                  } else {
                    onAiDesignPrompt?.(card.id, 'prototype');
                  }
                }}
              />
            </div>
          )}
        </div>
        {/* 子需求：仅在收缩模式下按展开状态递归渲染 */}
        {isCollapseMode && isExpanded && hasChildren && (
          <div className="flex flex-col gap-2 mt-2">
            {childCards.map(child => renderCard(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col h-full min-w-0">
        <div className="flex items-center justify-end px-5 pt-4 pb-2 shrink-0">
          <div className="inline-flex items-center rounded-lg border border-border/50 bg-muted/40 p-0.5">
            <button
              type="button"
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${viewMode === 'collapse' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setViewMode('collapse')}
              title="收缩：按父需求层级展示"
            >
              收缩
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${viewMode === 'expand' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setViewMode('expand')}
              title="展开：平铺所有需求"
            >
              展开
            </button>
          </div>
        </div>
        <div className="flex gap-3 flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-hidden p-4 pt-2">
          {STATUSES.map(status => {
            // 展开模式下列中展示所有需求；收缩模式下列中只展示顶层需求，子需求折叠在父需求卡片内部。
            const columnCards = cards.filter(c => c.status === status && (viewMode === 'expand' || !c.parentId));
            const colStyle = COLUMN_STYLES[status] ?? DEFAULT_COLUMN_STYLE;
            return (
              <div
                key={status}
                className="flex flex-col w-[240px] shrink-0"
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, status)}
              >
                <div className={`flex items-center justify-between px-4 py-3 mb-4 rounded-xl shrink-0 ${colStyle.header}`}>
                  <h3 className={`text-lg font-semibold ${colStyle.title}`}>{status}</h3>
                  <span className={`h-7 w-7 rounded-full grid place-items-center text-sm font-bold text-white ${colStyle.count}`}>
                    {columnCards.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 flex-1 overflow-y-auto pr-1 min-h-[150px]">
                  {columnCards.map(card => renderCard(card))}
                  {columnCards.length === 0 && (
                    <div className="flex items-center justify-center py-8 text-xs text-muted-foreground opacity-60 border border-dashed border-border/40 rounded-xl">
                      拖拽需求到此处
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-full max-w-[760px] p-0 flex flex-col max-h-[85vh] overflow-hidden">
          {detailItem && (
            <>
              <DialogHeader className="px-6 py-5 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Info className="h-4 w-4 text-primary" />
                  </div>
                  <div className="text-left">
                    <DialogTitle className="text-lg font-semibold">需求详情</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground mt-0.5 font-mono">
                      {detailItem.id}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 modal-content-scroll">
                {/* 基本信息 */}
                <section>
                  <h4 className="text-sm font-medium text-foreground mb-3">基本信息</h4>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <DetailField label="标题" value={detailItem.title} />
                    <DetailField label="提出人" value={detailItem.reporter || '-'} />
                    <DetailField label="优先级" value={API_PRIORITY_TO_UI[detailItem.priority] ?? detailItem.priority} />
                    <DetailField label="状态" value={
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${STATUS_DOT_COLORS[API_STATUS_TO_UI[detailItem.status] ?? '待处理']}`} />
                        {API_STATUS_TO_UI[detailItem.status] ?? detailItem.status}
                      </span>
                    } />
                    <DetailField label="来源" value={detailItem.source ?? '-'} />
                    <DetailField label="负责人" value={detailItem.assigneeName || detailItem.assigneeId || '-'} />
                    <DetailField label="创建时间" value={detailItem.createdAt.slice(0, 10)} />
                  </div>
                </section>

                <div className="w-full h-px bg-border/50" />

                {/* 任务描述 */}
                <section>
                  <h4 className="text-sm font-medium text-foreground mb-3">任务描述</h4>
                  <div className="h-[240px] overflow-y-auto rounded-xl p-4 bg-muted/40">
                    <MarkdownView content={detailItem.description || '暂无描述'} collapsible={false} />
                  </div>
                </section>

                <div className="w-full h-px bg-border/50" />

                {/* 相关资源 */}
                <section>
                  <h4 className="text-sm font-medium text-foreground mb-3">相关资源</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <ResourceCard
                      icon={<FileText className="h-4 w-4 text-primary" />}
                      label="产品设计"
                      loading={productDesignLoading}
                      onClick={detailItem ? () => openProductDesignShare(detailItem) : undefined}
                    />
                    <ResourceCard icon={<Github className="h-4 w-4 text-orange-500" />} label="代码仓库" onClick={handleOpenCodeRepo} />
                    <ResourceCard icon={<FileText className="h-4 w-4 text-primary" />} label="测试用例" />
                  </div>
                </section>
              </div>

              <DialogFooter className="px-6 py-4 border-t border-border/50 flex justify-between items-center">
                <button className="text-sm text-muted-foreground hover:text-foreground transition-colors" onClick={() => setDetailOpen(false)}>
                  返回
                </button>
                <div className="flex gap-3">
                  <Button variant="outline" size="sm" onClick={() => setDetailOpen(false)}>关闭</Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 开发提交记录弹窗 */}
      <Dialog open={commitsOpen} onOpenChange={setCommitsOpen}>
        <DialogContent className="sm:max-w-lg p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-orange-500" />
              <div className="text-left">
                <DialogTitle className="text-base font-semibold">开发提交记录</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                  {detailItem?.title ?? '-'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="px-6 py-4 max-h-[360px] overflow-y-auto">
            {commitsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : commits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无提交记录</p>
            ) : (
              <div className="space-y-2">
                {commits.map((c) => (
                  <div key={c.id} className="flex flex-col gap-1 border border-border/50 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20 px-1.5 py-0.5 rounded">
                        {c.commitHash.slice(0, 7)}
                      </code>
                      <span className="text-sm text-foreground truncate">{c.commitMessage || '-'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {c.author && <span>{c.author}</span>}
                      <span>{formatDateTime(c.committedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border/50">
            <Button variant="outline" size="sm" onClick={() => setCommitsOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 无设计引导弹窗：分配/评审时发现需求无设计，引导用户先进行 AI 设计 */}
      <Dialog open={noDesignDialog.open} onOpenChange={(open) => setNoDesignDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-left">
                <DialogTitle className="text-base font-semibold">该需求尚无设计文档</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                  该需求还没有对应的产品设计（PRD/原型），请先通过 AI 生成设计后再操作。
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-6 py-4">
            <p className="text-sm text-muted-foreground">
              是否让 AI 先生成产品设计文档？AI 将根据需求标题、描述以及空间上下文自动生成产品设计文档。
            </p>
          </div>

          <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setNoDesignDialog({ open: false, req: null })}
            >
              稍后再说
            </Button>
            <Button onClick={confirmNoDesignAiDesign}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              AI 生成文档
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/** 卡片快捷操作按钮 */
function CardActionBtn({
  icon,
  title,
  onClick,
  ai,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  ai?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors shrink-0 ${
        disabled
          ? 'text-muted-foreground/30 cursor-default'
          : ai
            ? 'text-primary hover:bg-primary/10 hover:text-primary/80'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      onClick={disabled ? undefined : onClick}
      title={disabled ? `${title}（已达最大层级）` : title}
    >
      {icon}
    </button>
  );
}

/** 设计状态按钮（文档/原型），有设计时彩色可跳转，无设计时灰色可触发 AI 引导 */
function DesignStatusBtn({
  hasDesign,
  type,
  onClick,
}: {
  hasDesign: boolean;
  type: 'doc' | 'prototype';
  onClick: () => void;
}) {
  const isDoc = type === 'doc';
  const activeClass = isDoc
    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50'
    : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50';
  const mutedClass = 'bg-muted/50 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground';

  return (
    <button
      className={`h-6 shrink-0 inline-flex items-center gap-0.5 px-1.5 rounded text-[10px] font-medium transition-colors ${
        hasDesign ? activeClass : mutedClass
      }`}
      onClick={onClick}
      title={hasDesign ? (isDoc ? '查看产品文档' : '查看产品原型') : (isDoc ? '暂无文档，点击生成' : '暂无原型，点击生成')}
    >
      {isDoc ? <FileText className="h-2.5 w-2.5" /> : <LayoutTemplate className="h-2.5 w-2.5" />}
      {isDoc ? '文档' : '原型'}
    </button>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm text-foreground font-medium">{value}</div>
    </div>
  );
}

function ResourceCard({ icon, label, onClick, loading }: { icon: React.ReactNode; label: string; onClick?: () => void; loading?: boolean }) {
  return (
    <div
      className={`border border-border/50 rounded-lg px-4 py-3 flex items-center justify-between transition-colors ${
        onClick ? 'cursor-pointer hover:bg-muted/40' : 'opacity-60'
      }`}
      onClick={!loading ? onClick : undefined}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-foreground">{label}</span>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : onClick ? (
        <span className="text-muted-foreground">›</span>
      ) : null}
    </div>
  );
}
