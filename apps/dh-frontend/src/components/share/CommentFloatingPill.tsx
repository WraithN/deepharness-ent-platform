import React, { useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { DisplayComment } from './types';

/** 批注序号悬浮列表离开的延迟时间（毫秒），避免鼠标短暂划过导致闪烁。 */
const HOVER_LEAVE_DELAY_MS = 200;

interface CommentFloatingPillProps {
  count: number;
  comments: DisplayComment[];
  onSelect: (comment: DisplayComment) => void;
}

/**
 * 最大化等场景下使用的右下角浮动批注入口。
 *
 * 悬停时显示现有批注的序号列表，点击序号可跳转聚焦。
 */
export const CommentFloatingPill: React.FC<CommentFloatingPillProps> = ({
  count,
  comments,
  onSelect,
}) => {
  const [showList, setShowList] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowList(true);
  };

  const handleLeave = () => {
    timerRef.current = setTimeout(() => {
      setShowList(false);
    }, HOVER_LEAVE_DELAY_MS);
  };

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        type="button"
        className="h-10 px-4 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center gap-2 text-xs font-medium hover:bg-primary/90 transition-colors"
      >
        <MessageSquare className="h-4 w-4" />
        批注
        {count > 0 && (
          <span className="ml-1 bg-primary-foreground/20 px-1.5 rounded-full">{count}</span>
        )}
      </button>
      {showList && comments.length > 0 && (
        <div
          className="absolute bottom-full right-0 mb-2 z-[9999] p-2 rounded-lg border border-border bg-background shadow-xl max-w-[240px]"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div className="flex flex-wrap gap-1.5">
            {comments.map(comment => (
              <button
                key={comment.id}
                type="button"
                onClick={() => {
                  onSelect(comment);
                  setShowList(false);
                }}
                className="h-7 min-w-7 px-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
                title={`跳转到批注 ${comment.seq}`}
              >
                {comment.seq}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
