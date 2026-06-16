import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface ThinkingPartProps {
  content: string;
}

export const ThinkingPart: React.FC<ThinkingPartProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);
  const isStreaming = content.length < 50;

  return (
    <div className="border border-amber-200 dark:border-amber-800/50 rounded-xl overflow-hidden">
      <button
        className="w-full px-3 py-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50/50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left truncate">
          {expanded ? '思考过程' : content.length > 30 ? content.slice(0, 30) + '...' : content || '思考中...'}
        </span>
        {isStreaming && (
          <span className="inline-flex">
            <span className="animate-bounce mx-0.5">.</span>
            <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.2s' }}>.</span>
            <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.4s' }}>.</span>
          </span>
        )}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 text-sm text-muted-foreground bg-amber-50/30 dark:bg-amber-900/10 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
};
