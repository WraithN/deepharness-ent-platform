import React from 'react';
import { Loader2, MessageSquare, MessageSquarePlus, Plus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import type { DisplayComment } from './types';

/** 右侧面板固定宽度（像素）。 */
export const COMMENT_PANEL_WIDTH = 320;

interface CommentPanelProps {
  title: string;
  comments: DisplayComment[];
  loading: boolean;
  activeId?: string;
  allowComments?: boolean;
  emptyHint: string;
  onAdd?: () => void;
  onSelect: (comment: DisplayComment) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cn(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * 非最大化模式下的右侧批注列表面板。
 * 头部保留 + 按钮作为添加批注入口之一，与顶栏批注按钮、右下角浮动批注 pill 互为独立入口。
 */
export const CommentPanel: React.FC<CommentPanelProps> = ({
  title,
  comments,
  loading,
  activeId,
  allowComments,
  emptyHint,
  onAdd,
  onSelect,
}) => {
  return (
    <aside
      className="border-l border-border/50 flex flex-col min-h-0 shrink-0 bg-muted/10"
      style={{ width: COMMENT_PANEL_WIDTH }}
    >
      <div className="px-3 py-2.5 text-xs font-semibold border-b border-border/50 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
          <span>{title}</span>
          <span className="text-muted-foreground font-normal">({comments.length})</span>
        </div>
        {allowComments && onAdd && (
          <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1" onClick={onAdd} title="添加批注">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-3 gap-2">
            <MessageSquarePlus className="h-5 w-5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground text-center">{emptyHint}</p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {comments.map(comment => (
              <div
                key={comment.id}
                onClick={() => onSelect(comment)}
                className={cn(
                  'text-xs rounded-lg border p-3 cursor-pointer transition-colors',
                  activeId === comment.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border/50 hover:bg-muted/50'
                )}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
                    {comment.seq}
                  </span>
                  <span className="font-medium truncate">{comment.author || '匿名'}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatTime(comment.createdAt)}
                  </span>
                </div>
                {comment.targetText && (
                  <blockquote className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 line-clamp-2 break-words mb-1.5">
                    {comment.targetText}
                  </blockquote>
                )}
                <p className="text-foreground/80 whitespace-pre-wrap break-words">{comment.content}</p>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
};
