import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThinkingCardProps {
  children: React.ReactNode;
  isRunning?: boolean;
  defaultOpen?: boolean;
}

const THINKING_LABEL_RUNNING = '思考中';
const THINKING_LABEL_DONE = '思考过程';

/**
 * 可折叠的思考过程卡片。
 *
 * 用于把 reasoning 文本、工具调用等模型内部过程折叠展示，
 * 实际给用户的最终输出放在卡片外部，保持界面整洁。
 */
export const ThinkingCard: React.FC<ThinkingCardProps> = ({
  children,
  isRunning = false,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const label = isRunning ? THINKING_LABEL_RUNNING : THINKING_LABEL_DONE;

  return (
    <div className="my-2 rounded-xl border border-border/50 bg-muted/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 transition-colors"
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{label}</span>
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />}
      </button>
      <div
        className={cn(
          'px-3 pb-3 text-sm text-muted-foreground border-t border-border/30',
          !isOpen && 'hidden'
        )}
      >
        {children}
      </div>
    </div>
  );
};
