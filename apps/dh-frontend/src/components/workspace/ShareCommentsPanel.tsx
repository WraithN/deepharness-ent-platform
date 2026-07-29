import React, { useMemo, useState } from 'react';
import { Check, Loader2, LocateFixed, MessageSquare, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ShareComment } from '@/lib/productdoc-api';

/** 分享批注面板属性 */
interface ShareCommentsPanelProps {
  comments: ShareComment[];
  onResolve: (commentId: string) => Promise<void>;
  onClose: () => void;
}

/** 格式化时间戳为 MM-DD HH:mm（无效输入返回 -）。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 页面内文本查找。window.find 为非标准 API（Chrome/Firefox/Safari 均支持），
 * TS DOM 类型未声明，这里显式补充类型并做存在性兜底。
 */
function findInPage(text: string): boolean {
  const finder = (
    window as unknown as {
      find?: (s: string, caseSensitive?: boolean, backwards?: boolean, wrapAround?: boolean) => boolean;
    }
  ).find;
  return finder?.(text, false, false, true) ?? false;
}

/** 单条批注卡片：引用原文 + 内容 + 操作（定位 / 关闭）。 */
const CommentCard: React.FC<{
  comment: ShareComment;
  resolving: boolean;
  onResolve: () => void;
}> = ({ comment, resolving, onResolve }) => {
  const resolved = comment.status === 'resolved';

  /** 在文档编辑区内定位批注锚定的选中文本 */
  const handleLocate = () => {
    const found = findInPage(comment.quoteText);
    if (!found) {
      toast.error('未在文档中定位到该选中文本（内容可能已修改）');
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-2.5 space-y-1.5 transition-colors',
        resolved ? 'border-border/40 bg-muted/20 opacity-70' : 'border-border/50 bg-background'
      )}
    >
      <blockquote
        className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 line-clamp-3 break-words cursor-pointer hover:text-foreground/70"
        title="点击在文档中定位"
        onClick={handleLocate}
      >
        {comment.quoteText}
      </blockquote>
      <p className="text-xs text-foreground/85 break-words whitespace-pre-wrap">{comment.content}</p>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="font-medium text-foreground/70 truncate">{comment.authorName}</span>
        <span className="whitespace-nowrap">{formatTime(comment.createdAt)}</span>
        {resolved ? (
          <span className="ml-auto shrink-0 text-emerald-600 whitespace-nowrap">已解决</span>
        ) : (
          <span className="ml-auto shrink-0 flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" title="在文档中定位" onClick={handleLocate}>
              <LocateFixed className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
              title="关闭批注（标记已解决）"
              disabled={resolving}
              onClick={onResolve}
            >
              {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * 分享批注面板（文档页右侧栏）。
 *
 * 展示来自分享落地页的全部批注：未解决在前、已解决置灰在后；
 * 支持在文档中定位锚定文本，以及关闭（标记已解决）批注。
 */
export const ShareCommentsPanel: React.FC<ShareCommentsPanelProps> = ({ comments, onResolve, onClose }) => {
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // 未解决批注优先展示，两组内部均按时间正序
  const { openComments, resolvedComments } = useMemo(() => {
    return {
      openComments: comments.filter(c => c.status === 'open'),
      resolvedComments: comments.filter(c => c.status === 'resolved'),
    };
  }, [comments]);

  const handleResolve = async (commentId: string) => {
    setResolvingId(commentId);
    try {
      await onResolve(commentId);
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <aside className="w-80 border-l border-border/50 flex flex-col min-h-0 shrink-0 bg-muted/10">
      <div className="px-3 py-2.5 border-b border-border/50 shrink-0 flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold">分享批注</span>
        <span className="text-xs text-muted-foreground">({openComments.length})</span>
        <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" title="收起面板" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6 px-3">
            暂无批注。分享文档后，访客选中正文文本即可发表批注
          </p>
        ) : (
          <div className="p-3 space-y-2.5">
            {openComments.map(c => (
              <CommentCard
                key={c.id}
                comment={c}
                resolving={resolvingId === c.id}
                onResolve={() => handleResolve(c.id)}
              />
            ))}
            {resolvedComments.length > 0 && (
              <>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider pt-2">已解决</div>
                {resolvedComments.map(c => (
                  <CommentCard
                    key={c.id}
                    comment={c}
                    resolving={resolvingId === c.id}
                    onResolve={() => handleResolve(c.id)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
};
