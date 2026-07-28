import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  Github,
  GitBranch,
  LayoutTemplate,
  ListTree,
  Loader2,
  PenLine,
  Split,
  Layers,
} from 'lucide-react';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { workItemDocApi } from '@/lib/workitem-doc-api';
import { productSpaceApi, requirementShareApi, findPrototypeProductName } from '@/lib/productspace-api';
import type { WorkItemDTO } from '@/lib/api-types';

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
 * 通用需求看板组件。
 *
 * 数据来自 /v1/workitems?type=requirement，支持拖拽更新状态。
 * 点击卡片弹出居中详情弹窗。
 * 卡片底部提供6个快捷操作按钮：查看详情、查看设计、查看子需求、AI拆分子需求、AI原型设计、AI写文档。
 */
interface KanbanWorkspaceProps {
  /** 点击"需求文档"等关联资源时回调，跳转到需求设计视图 */
  onNavigateToDesign?: (workitemId: string) => void;
}

export const KanbanWorkspace: React.FC<KanbanWorkspaceProps> = ({ onNavigateToDesign }) => {
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
  // 当前在看板卡片中展开显示子需求的需求 ID 集合。
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set());

  // 获取指定卡片的直接子需求卡片。
  const getChildCards = (parentId: string) => cards.filter(c => c.parentId === parentId);

  // 切换父需求的子需求展开/折叠；无子需求时给出提示。
  const toggleChildren = (card: KanbanCard, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const children = getChildCards(card.id);
    if (children.length === 0) {
      toast.info('该需求暂无子需求');
      return;
    }
    setExpandedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  };

  useEffect(() => {
    setLoading(true);
    api
      .get<WorkItemDTO[]>('/v1/workitems?type=requirement')
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
  }, []);

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
        toast.success(`需求 ${id} 已更新为 ${targetStatus}`);
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

  // 递归渲染需求卡片。depth 用于控制缩进与子需求的样式。
  const renderCard = (card: KanbanCard, depth = 0) => {
    const childCards = getChildCards(card.id);
    const hasChildren = childCards.length > 0;
    const isExpanded = expandedCardIds.has(card.id);
    const isDoneCol = DONE_STATUSES.includes(card.status);

    return (
      <div key={card.id} className={`flex flex-col ${depth > 0 ? 'ml-3 pl-3 border-l border-border/40' : ''}`}>
        <div
          draggable={depth === 0}
          onDragStart={depth === 0 ? e => handleDragStart(e, card.id) : undefined}
          onClick={() => openDetail(card.id)}
          className={`relative bg-card border border-border/50 rounded-xl pl-5 pr-3 py-3 cursor-pointer transition-all duration-200 active:cursor-grabbing hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-black/30 ${
            draggedCardId === card.id ? 'opacity-50 border-primary' : ''
          } ${isDoneCol ? 'opacity-75' : ''}`}
        >
          <span className={`absolute left-0 top-0 h-full w-1 rounded-l-xl ${PRIORITY_BAR_COLORS[card.priority] ?? DEFAULT_PRIORITY_BAR}`} />
          {/* 标题行：类型图标 + 展开按钮 + 标题 + 优先级标签 */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-start gap-1.5 min-w-0 flex-1">
              <TypeIcon type={card.type} parentId={card.parentId} />
              {depth === 0 && (
                <button
                  type="button"
                  className="mt-0.5 text-muted-foreground hover:text-foreground"
                  onClick={e => toggleChildren(card, e)}
                  title={isExpanded ? '收起子需求' : '展开子需求'}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
              <h4 className={`text-sm font-medium leading-snug line-clamp-2 ${isDoneCol ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                {card.title}
              </h4>
            </div>
            <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${PRIORITY_TAG_COLORS[card.priority] ?? DEFAULT_PRIORITY_TAG}`}>
              {card.priority}
            </span>
          </div>
          {/* 信息行：负责人 + 创建日期 */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground truncate">{card.owner || '未分配'}</p>
            <p className="text-xs text-muted-foreground/80 flex items-center gap-1 shrink-0">
              <CalendarDays className="h-3 w-3" />
              {card.createdAt}
            </p>
          </div>
          {/* 快捷操作按钮：仅顶层父需求展示，阻止冒泡以免触发卡片点击 */}
          {depth === 0 && (
            <div
              className="flex items-center gap-0.5 pt-2 border-t border-border/30"
              onClick={e => e.stopPropagation()}
            >
              <CardActionBtn icon={<FileText className="h-3.5 w-3.5" />} title="查看详情" onClick={() => openDetail(card.id)} />
              <CardActionBtn icon={<Layers className="h-3.5 w-3.5" />} title="查看设计" onClick={() => onNavigateToDesign?.(card.id)} />
              <CardActionBtn
                icon={<ListTree className="h-3.5 w-3.5" />}
                title={hasChildren ? (isExpanded ? '收起子需求' : '展开子需求') : '查看子需求'}
                onClick={() => toggleChildren(card)}
              />
              <div className="w-px h-4 bg-border/40 mx-0.5 shrink-0" />
              <CardActionBtn icon={<Split className="h-3.5 w-3.5" />} title="AI拆分子需求" ai onClick={() => goToChat(card, AI_COMMANDS.split)} />
              <CardActionBtn icon={<LayoutTemplate className="h-3.5 w-3.5" />} title="AI原型设计" ai onClick={() => goToChat(card, AI_COMMANDS.prototype)} />
              <CardActionBtn icon={<PenLine className="h-3.5 w-3.5" />} title="AI写文档" ai onClick={() => goToChat(card, AI_COMMANDS.document)} />
            </div>
          )}
        </div>
        {/* 子需求：递归渲染，所有层级默认展开 */}
        {(depth > 0 || isExpanded) && hasChildren && (
          <div className="flex flex-col gap-2 mt-2">
            {childCards.map(child => renderCard(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 h-full overflow-y-auto p-5">
        {STATUSES.map(status => {
          // 列中只展示顶层需求，子需求折叠在父需求卡片内部。
          const columnCards = cards.filter(c => !c.parentId && c.status === status);
          const colStyle = COLUMN_STYLES[status] ?? DEFAULT_COLUMN_STYLE;
          return (
            <div
              key={status}
              className="flex flex-col min-w-0"
              onDragOver={handleDragOver}
              onDrop={e => handleDrop(e, status)}
            >
              <div className={`flex items-center justify-between px-4 py-3 mb-4 rounded-xl shrink-0 ${colStyle.header}`}>
                <h3 className={`text-lg font-semibold ${colStyle.title}`}>{status}</h3>
                <span className={`h-7 w-7 rounded-full grid place-items-center text-sm font-bold text-white ${colStyle.count}`}>
                  {columnCards.length}
                </span>
              </div>
              <div className="flex flex-col gap-3 flex-1 overflow-y-auto pr-1 min-h-[150px]">
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

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-full max-w-[760px] p-0 flex flex-col max-h-[85vh] overflow-hidden">
          {detailItem && (
            <>
              <DialogHeader className="px-6 py-5 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-primary" />
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
                    <ResourceCard icon={<Github className="h-4 w-4 text-orange-500" />} label="代码仓库" />
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
    </>
  );
};

/** 类型图标：需求用 FileText，子需求用 GitBranch，其他类型用对应图标 */
function TypeIcon({ type, parentId }: { type: string; parentId?: string }) {
  if (parentId) {
    return (
      <span title="子需求">
        <GitBranch className="h-3.5 w-3.5 shrink-0 mt-0.5 text-purple-500" />
      </span>
    );
  }
  if (type === 'defect') {
    return (
      <span title="缺陷">
        <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-500" />
      </span>
    );
  }
  return (
    <span title="需求">
      <FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
    </span>
  );
}

/** 卡片快捷操作按钮 */
function CardActionBtn({
  icon,
  title,
  onClick,
  ai,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  ai?: boolean;
}) {
  return (
    <button
      className={`h-7 w-7 flex items-center justify-center rounded-md transition-colors shrink-0 ${
        ai
          ? 'text-primary hover:bg-primary/10 hover:text-primary/80'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      onClick={onClick}
      title={title}
    >
      {icon}
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
