import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ChatCodeBlock } from './ChatCodeBlock';
import { MermaidBlock } from './MermaidBlock';
import { TreeDirBlock, isTreeDirContent } from './TreeDirBlock';
import { sanitizeWorkspacePaths } from '@/lib/utils';

const COLLAPSE_LINE_THRESHOLD = 12;
const COLLAPSE_CHAR_THRESHOLD = 600;
const MERMAID_LANGUAGE = 'mermaid';

interface MarkdownViewProps {
  content: string;
  collapsible?: boolean;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, collapsible = true }) => {
  const [expanded, setExpanded] = useState(false);

  const sanitizedContent = sanitizeWorkspacePaths(content);

  const lineCount = sanitizedContent.split('\n').length;
  const shouldCollapse = collapsible && (lineCount > COLLAPSE_LINE_THRESHOLD || sanitizedContent.length > COLLAPSE_CHAR_THRESHOLD);

  return (
    <div className="relative">
      <div className={`markdown-preview ${shouldCollapse && !expanded ? 'max-h-[300px] overflow-hidden' : ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '');
              const codeString = String(children).replace(/\n$/, '');

              // react-markdown v10 移除了 inline prop，通过 className（fenced 块有 language-xxx）
              // 和换行符判断是否为块级代码，避免内联代码被误判为块级。
              const isBlock = !!match || codeString.includes('\n');

              // 树形目录结构：仅块级代码检测，优先于语言判断。
              if (isBlock && isTreeDirContent(codeString)) {
                return <TreeDirBlock code={codeString} />;
              }

              if (isBlock && match) {
                if (match[1] === MERMAID_LANGUAGE) {
                  return <MermaidBlock code={codeString} />;
                }
                return <ChatCodeBlock code={codeString} language={match[1]} />;
              }
              return <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>;
            },
          }}
        >
          {sanitizedContent}
        </ReactMarkdown>
      </div>
      {shouldCollapse && !expanded && (
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />
      )}
      {shouldCollapse && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {expanded ? (
            <>
              收起 <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开全部 <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
};
