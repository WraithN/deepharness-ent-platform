import React, { useEffect, useState } from 'react';
import { CalendarDays, FileText, Github, Loader2 } from 'lucide-react';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

interface KanbanCard {
  id: string;
  title: string;
  status: string;
  owner: string;
  priority: string;
  createdAt: string;
}

/**
 * 通用需求看板组件。
 *
 * 数据来自 /v1/workitems?type=requirement，支持拖拽更新状态。
 * 点击卡片弹出居中详情弹窗。
 */
export const KanbanWorkspace: React.FC = () => {
  const [items, setItems] = useState<WorkItemDTO[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);

  const [detailItem, setDetailItem] = useState<WorkItemDTO | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5 h-full overflow-y-auto p-5">
        {STATUSES.map(status => {
          const columnCards = cards.filter(c => c.status === status);
          const colStyle = COLUMN_STYLES[status] ?? DEFAULT_COLUMN_STYLE;
          const isDoneCol = DONE_STATUSES.includes(status);
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
                {columnCards.map(card => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={e => handleDragStart(e, card.id)}
                    onClick={() => openDetail(card.id)}
                    className={`relative bg-card border border-border/50 rounded-xl pl-5 pr-4 py-4 cursor-pointer transition-all duration-200 active:cursor-grabbing hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-black/30 ${
                      draggedCardId === card.id ? 'opacity-50 border-primary' : ''
                    } ${isDoneCol ? 'opacity-75' : ''}`}
                  >
                    <span className={`absolute left-0 top-0 h-full w-1 rounded-l-xl ${PRIORITY_BAR_COLORS[card.priority] ?? DEFAULT_PRIORITY_BAR}`} />
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h4 className={`text-base font-medium leading-snug line-clamp-2 ${isDoneCol ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {card.title}
                      </h4>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_TAG_COLORS[card.priority] ?? DEFAULT_PRIORITY_TAG}`}>
                        {card.priority}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1.5">{card.owner || '未分配'}</p>
                    <p className="text-xs text-muted-foreground/80 flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {card.createdAt}
                    </p>
                  </div>
                ))}
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
                    <ResourceCard icon={<FileText className="h-4 w-4 text-primary" />} label="需求文档" />
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

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm text-foreground font-medium">{value}</div>
    </div>
  );
}

function ResourceCard({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="border border-border/50 rounded-lg px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-muted/40 transition-colors">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <span className="text-muted-foreground">›</span>
    </div>
  );
}
