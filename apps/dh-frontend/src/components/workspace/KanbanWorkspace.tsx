import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { WorkItemDTO } from '@/lib/api-types';

const API_STATUS_TO_UI: Record<string, string> = {
  backlog: '待处理',
  todo: '待处理',
  in_progress: '进行中',
  done: '已完成',
};

const UI_STATUS_TO_API: Record<string, string> = {
  '待处理': 'todo',
  '进行中': 'in_progress',
  '已完成': 'done',
};

const API_PRIORITY_TO_UI: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const STATUSES = ['待处理', '进行中', '已完成'];

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

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case '已完成':
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-200 border-green-200 shadow-none">已完成</Badge>;
      case '进行中':
        return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 shadow-none">进行中</Badge>;
      default:
        return <Badge className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border-zinc-200 shadow-none">待处理</Badge>;
    }
  };

  const renderPriorityBadge = (priority: string) => {
    switch (priority) {
      case '高':
        return <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20 shadow-none">高</Badge>;
      case '中':
        return <Badge className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 border-orange-500/20 shadow-none">中</Badge>;
      case '低':
        return <Badge className="bg-zinc-500/10 text-zinc-600 hover:bg-zinc-500/20 border-zinc-500/20 shadow-none">低</Badge>;
      default:
        return <Badge variant="outline">{priority}</Badge>;
    }
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
    <div className="flex gap-4 h-full overflow-x-auto pb-4 items-start">
      {STATUSES.map(status => {
        const columnCards = cards.filter(c => c.status === status);
        return (
          <div
            key={status}
            className="w-80 shrink-0 flex flex-col max-h-full bg-muted/10 rounded-xl transition-colors border border-border/50 soft-shadow"
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, status)}
          >
            <div className="p-4 font-medium flex items-center justify-between shrink-0 border-b border-border/50 bg-background/50 rounded-t-xl">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{status}</span>
                <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-xs bg-background shadow-none">
                  {columnCards.length}
                </Badge>
              </div>
            </div>
            <div className="p-3 flex-1 overflow-y-auto space-y-3 min-h-[150px]">
              {columnCards.map(card => (
                <Card
                  key={card.id}
                  draggable
                  onDragStart={e => handleDragStart(e, card.id)}
                  className={`cursor-pointer soft-shadow transition-all active:cursor-grabbing hover:border-primary/50 ${
                    draggedCardId === card.id ? 'opacity-50 border-primary scale-95' : 'opacity-100 border-border/50'
                  }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm font-medium leading-snug line-clamp-2">{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="flex flex-col gap-3 mt-2">
                      <div className="text-xs text-muted-foreground flex items-center justify-between">
                        <span>{card.owner || '未分配'}</span>
                        {renderPriorityBadge(card.priority)}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px]">
                            {card.owner.charAt(0)}
                          </div>
                          <span className="text-xs text-muted-foreground">{card.owner}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{card.createdAt}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {columnCards.length === 0 && (
                <div className="text-center p-4 text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg bg-background/50">
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
