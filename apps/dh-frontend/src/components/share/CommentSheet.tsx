import React from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DisplayComment } from './types';

interface CommentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  comments: DisplayComment[];
  activeId?: string;
  allowComments?: boolean;
  onAdd: () => void;
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
 * 最大化模式下的底部批注 Sheet。
 * 顶部为标题和添加/切换批注按钮，主体为可点击的评论列表。
 */
export const CommentSheet: React.FC<CommentSheetProps> = ({
  open,
  onOpenChange,
  title,
  comments,
  activeId,
  allowComments,
  onAdd,
  onSelect,
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[60vh] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border/50 flex-row items-center justify-between space-y-0">
          <SheetTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            {title}
            <span className="text-sm text-muted-foreground font-normal">({comments.length})</span>
          </SheetTitle>
          {allowComments && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onAdd} title="添加批注">
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <MessageSquare className="h-6 w-6 opacity-40" />
              <p className="text-xs">{allowComments ? '暂无批注，点击右上角 + 添加' : '暂无批注'}</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
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
      </SheetContent>
    </Sheet>
  );
};
