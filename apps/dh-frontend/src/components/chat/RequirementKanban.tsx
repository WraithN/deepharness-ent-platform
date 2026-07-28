import { ChevronDown, ChevronRight, FileText, GitBranch } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  type KanbanViewMode,
  MAX_KANBAN_DEPTH,
  buildDisplayTitle,
  getChildren,
  getDepth,
  getDescendantIds,
  hasChildren,
} from '@/lib/kanban-utils';

export interface ChatReqItem {
  id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done' | 'cancelled' | 'on-hold';
  reporter?: string;
  parentId?: string;
  priority?: string;
}

interface RequirementKanbanProps {
  items: ChatReqItem[];
  highlightId?: string | null;
  onOpenDetail: (id: string) => void;
  setItemRef?: (id: string, el: HTMLDivElement | null) => void;
}

const COLUMNS: { key: ChatReqItem['status']; label: string }[] = [
  { key: 'todo', label: '待处理' },
  { key: 'in-progress', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'cancelled', label: '已取消' },
  { key: 'on-hold', label: '已挂起' },
];

const DONE_STATUSES: ChatReqItem['status'][] = ['done', 'cancelled'];

const PRIORITY_LABELS: Record<string, string> = { high: '高', medium: '中', low: '低' };

const COLUMN_STYLES: Record<ChatReqItem['status'], { header: string; title: string; count: string }> = {
  todo: { header: 'bg-blue-100/70 dark:bg-blue-900/25', title: 'text-blue-700 dark:text-blue-300', count: 'bg-blue-600' },
  'in-progress': { header: 'bg-amber-100/70 dark:bg-amber-900/25', title: 'text-amber-700 dark:text-amber-300', count: 'bg-amber-500' },
  done: { header: 'bg-green-100/70 dark:bg-green-900/25', title: 'text-green-700 dark:text-green-300', count: 'bg-green-500' },
  cancelled: { header: 'bg-zinc-100/70 dark:bg-zinc-800/40', title: 'text-zinc-600 dark:text-zinc-300', count: 'bg-zinc-500' },
  'on-hold': { header: 'bg-orange-100/70 dark:bg-orange-900/25', title: 'text-orange-700 dark:text-orange-300', count: 'bg-orange-500' },
};

const VIEW_MODE_STORAGE_KEY = 'chat-requirement-kanban-view-mode';

/** 智能会话中的需求看板：支持展开/收缩与父子层级展示。 */
export const RequirementKanban: React.FC<RequirementKanbanProps> = ({ items, highlightId, onOpenDetail, setItemRef }) => {
  const [viewMode, setViewMode] = useState<KanbanViewMode>(() => {
    try {
      return (localStorage.getItem(VIEW_MODE_STORAGE_KEY) as KanbanViewMode) || 'collapse';
    } catch {
      return 'collapse';
    }
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // 忽略写入失败
    }
  }, [viewMode]);

  const toggleChildren = (item: ChatReqItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const children = getChildren(items, item.id);
    if (children.length === 0) return;
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const toggleSelectDescendants = (item: ChatReqItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const descendants = getDescendantIds(items, item.id);
    if (descendants.size === 0) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = Array.from(descendants).every(id => next.has(id));
      if (allSelected) descendants.forEach(id => next.delete(id));
      else descendants.forEach(id => next.add(id));
      return next;
    });
  };

  const renderCard = (item: ChatReqItem, depth = 0) => {
    const childCards = getChildren(items, item.id);
    const childCount = childCards.length;
    const hasChildCards = childCount > 0;
    const isExpanded = expandedIds.has(item.id);
    const isSelected = selectedIds.has(item.id);
    const isHighlight = item.id === highlightId;
    const isDone = DONE_STATUSES.includes(item.status);
    const isCollapseMode = viewMode === 'collapse';
    const displayTitle = isCollapseMode ? item.title : buildDisplayTitle(items, item.id);
    const depthLimitReached = getDepth(items, item.id) >= MAX_KANBAN_DEPTH - 1;

    return (
      <div key={item.id} className={`flex flex-col ${isCollapseMode && depth > 0 ? 'ml-2 pl-2 border-l border-border/40' : ''}`}>
        <div
          ref={el => setItemRef?.(item.id, el)}
          onClick={() => onOpenDetail(item.id)}
          className={`relative p-3 pl-4 rounded-xl border bg-card cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-md ${
            isHighlight ? 'border-primary shadow-md ring-2 ring-primary/30' : 'border-border'
          } ${isSelected ? 'ring-2 ring-blue-500 border-blue-500' : ''} ${isDone ? 'opacity-75' : ''}`}
        >
          <span className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-blue-500" />
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="flex items-start gap-1.5 min-w-0 flex-1">
              {item.parentId ? (
                <span title="子需求"><GitBranch className="h-3.5 w-3.5 shrink-0 mt-0.5 text-purple-500" /></span>
              ) : (
                <span title="需求"><FileText className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" /></span>
              )}
              {isCollapseMode && (
                <button
                  type="button"
                  disabled={!hasChildCards}
                  className={`mt-0.5 ${hasChildCards ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground/30 cursor-default'}`}
                  onClick={hasChildCards ? e => toggleChildren(item, e) : undefined}
                  title={hasChildCards ? (isExpanded ? '收起子需求' : '展开子需求') : '暂无子需求'}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              )}
              <p className={`text-xs font-medium leading-snug ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                {displayTitle}
              </p>
              {hasChildCards && (
                <button
                  type="button"
                  onClick={e => toggleSelectDescendants(item, e)}
                  className={`shrink-0 h-4 min-w-[1rem] px-1 rounded-full text-[10px] font-medium flex items-center justify-center ${
                    Array.from(getDescendantIds(items, item.id)).every(id => selectedIds.has(id))
                      ? 'bg-blue-500 text-white'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}
                  title="点击圈选/取消圈选所有子需求"
                >
                  {childCount}
                </button>
              )}
            </div>
            {item.priority && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                {PRIORITY_LABELS[item.priority] ?? item.priority}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{item.id}</span>
            {depthLimitReached && (
              <span className="text-[10px] text-muted-foreground/60">已达最大层级</span>
            )}
          </div>
          {item.reporter && <p className="text-[10px] text-muted-foreground mt-1">{item.reporter} 提</p>}
        </div>
        {isCollapseMode && isExpanded && hasChildCards && (
          <div className="flex flex-col gap-2 mt-2">
            {childCards.map(child => renderCard(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end px-4 pt-3 pb-2 shrink-0">
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
      <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
        <div className="flex h-full gap-3 p-4 pt-2 min-w-max">
          {COLUMNS.map(col => {
            const columnItems = items.filter(i => i.status === col.key && (viewMode === 'expand' || !i.parentId));
            const style = COLUMN_STYLES[col.key];
            return (
              <div key={col.key} className="flex flex-col w-56 shrink-0">
                <div className={`flex items-center justify-between px-3 py-2.5 mb-3 rounded-xl shrink-0 ${style.header}`}>
                  <span className={`text-sm font-semibold ${style.title}`}>{col.label}</span>
                  <span className={`h-6 w-6 rounded-full grid place-items-center text-xs font-bold text-white ${style.count}`}>{columnItems.length}</span>
                </div>
                <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto pb-2">
                  {columnItems.map(item => renderCard(item))}
                  {columnItems.length === 0 && (
                    <div className="flex-1 flex items-center justify-center py-8 text-xs text-muted-foreground opacity-60 border border-dashed border-border/40 rounded-xl">暂无</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
