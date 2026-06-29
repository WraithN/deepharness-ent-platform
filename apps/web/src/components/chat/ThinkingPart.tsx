import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Brain } from 'lucide-react';

interface ThinkingPartProps {
  content: string;
}

export const ThinkingPart: React.FC<ThinkingPartProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(content.length > 0);
  // Sync expanded state when content changes (e.g. empty placeholder replaced with real content)
  useEffect(() => {
    if (content.length > 0) {
      setExpanded(true);
    }
  }, [content]);
  const isStreaming = content.length < 50;

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden bg-muted/30">
      <button
        className="w-full px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" />
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
        <div className="px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap border-t border-border/30">
          {content}
        </div>
      )}
    </div>
  );
};
