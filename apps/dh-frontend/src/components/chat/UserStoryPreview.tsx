import React from 'react';
import { FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { UserStoryData, UserStoryItem } from './UserStoryCard';

interface UserStoryPreviewProps {
  data: UserStoryData;
  onClose?: () => void;
}

const PRIORITY_TAG_CLASS: Record<string, string> = {
  P0: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  P1: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  P2: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

/** 用户故事右侧预览面板。 */
export const UserStoryPreview: React.FC<UserStoryPreviewProps> = ({ data, onClose }) => {
  return (
    <div className="flex flex-col h-full bg-background animate-in fade-in duration-300">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card shrink-0">
        <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        <span className="text-sm font-medium truncate flex-1">{data.title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300">
          共 {data.total} 条
        </span>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 故事列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {data.stories.map((item, idx) => (
          <StoryItem key={idx} item={item} index={idx + 1} />
        ))}
      </div>
    </div>
  );
};

const StoryItem: React.FC<{ item: UserStoryItem; index: number }> = ({ item, index }) => (
  <div className="rounded-xl border border-border/50 p-5 bg-muted/20">
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs font-medium text-muted-foreground">#{index}</span>
      <span
        className={cn(
          'text-xs px-2.5 py-1 rounded-full font-medium',
          PRIORITY_TAG_CLASS[item.priority],
        )}
      >
        {item.priority}
      </span>
    </div>
    <p className="text-sm text-foreground leading-relaxed mb-3">
      {item.story}
    </p>
    {item.criteria.length > 0 && (
      <>
        <p className="text-xs font-medium text-muted-foreground mb-2">
          验收标准 Given / When / Then
        </p>
        <ul className="space-y-2">
          {item.criteria.map((line, ci) => (
            <li
              key={ci}
              className="text-xs text-muted-foreground leading-relaxed flex gap-2"
            >
              <span className="text-primary shrink-0 mt-0.5">&#8226;</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </>
    )}
  </div>
);
