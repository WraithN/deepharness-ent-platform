import React from 'react';
import type { DisplayComment } from './types';

/** 悬浮卡片的最大宽度（像素）。 */
const HOVER_CARD_MAX_WIDTH = 320;

/** 悬浮卡片相对于鼠标的水平偏移（像素）。 */
const HOVER_CARD_OFFSET_X = 12;

/** 悬浮卡片相对于鼠标的垂直偏移（像素）。 */
const HOVER_CARD_OFFSET_Y = 16;

interface CommentHoverCardProps {
  comment: DisplayComment | null;
  x: number;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 鼠标悬停时显示的批注详情浮动卡片。 */
export const CommentHoverCard: React.FC<CommentHoverCardProps> = ({
  comment,
  x,
  y,
  onMouseEnter,
  onMouseLeave,
}) => {
  if (!comment) return null;

  const left = Math.min(x + HOVER_CARD_OFFSET_X, window.innerWidth - HOVER_CARD_MAX_WIDTH - 8);
  const top = y + HOVER_CARD_OFFSET_Y;

  return (
    <div
      className="fixed z-[100] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl text-xs"
      style={{ left, top, maxWidth: HOVER_CARD_MAX_WIDTH }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
        <blockquote className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 line-clamp-3 break-words mb-1.5">
          {comment.targetText}
        </blockquote>
      )}
      <p className="text-foreground/80 whitespace-pre-wrap break-words">{comment.content}</p>
    </div>
  );
};
