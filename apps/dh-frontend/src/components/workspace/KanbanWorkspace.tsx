import React, { useEffect, useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
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
 */
export const KanbanWorkspace: React.FC = () => {
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<WorkItemDTO[]>('/v1/workitems?type=requirement')
      .then(items => {
        setCards(
          items.map(item => ({
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
  );
};
