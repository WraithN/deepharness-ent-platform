import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThinkingCardProps {
  children: React.ReactNode;
  isRunning?: boolean;
  defaultOpen?: boolean;
  /** 思考次数，用于标题展示。 */
  thinkingCount?: number;
  /** 工具调用统计：{ 工具显示名: 次数 }。 */
  toolStats?: Record<string, number>;
}

/**
 * 轻量可折叠的思考过程面板。
 *
 * 去掉厚重边框，只保留一行折叠按钮；展开后内容区以浅灰背景和左侧时间线呈现，
 * 与 Kimi/Claude 等产品的思考过程风格保持一致。
 */
export const ThinkingCard: React.FC<ThinkingCardProps> = ({
  children,
  isRunning = false,
  defaultOpen = false,
  thinkingCount = 1,
  toolStats,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const stats: string[] = [];
  if (thinkingCount > 0) {
    stats.push(`思考 ${thinkingCount} 次`);
  }
  if (toolStats) {
    Object.entries(toolStats).forEach(([name, count]) => {
      stats.push(`${name} ${count} 次`);
    });
  }

  const summary = stats.join('，') || (isRunning ? '思考中' : '思考完成');
  const statusLabel = isRunning ? '思考中' : '思考完成';

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
        <Sparkles className="h-3 w-3 shrink-0" />
        <span>{statusLabel}</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{summary}</span>
      </button>
      {isOpen && (
        <div className="mt-2 rounded-lg bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <div className="text-xs font-medium text-muted-foreground/70 mb-1.5">思考过程</div>
          {children}
        </div>
      )}
    </div>
  );
};
