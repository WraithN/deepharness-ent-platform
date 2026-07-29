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

/**
 * 已知 Mermaid 图表类型关键字，用于在代码块未声明语言时启发式识别 Mermaid 内容。
 * 检查代码 trim 后首行是否以这些关键字开头。
 */
const MERMAID_KEYWORDS = [
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'erDiagram', 'gantt', 'pie', 'journey', 'gitGraph', 'mindmap', 'timeline',
  'quadrantChart', 'xychart-beta', 'architecture-beta', 'block-beta',
  'packet-beta', 'sankey-beta', 'treemap-beta', 'requirementDiagram',
  'kanban', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
];

/**
 * 启发式判断代码块是否为 Mermaid 图表内容。
 * 当代码块未显式声明 language-mermaid 时，通过首行关键字识别。
 */
function isMermaidContent(code: string): boolean {
  const firstLine = code.trim().split('\n')[0]?.trim() ?? '';
  return MERMAID_KEYWORDS.some(kw => firstLine.startsWith(kw));
}

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

              // Mermaid 图表：优先检测，避免含 / <br/> 等字符的 Mermaid 代码被
              // isTreeDirContent 误判为目录树结构。
              const isMermaid = isBlock && (match?.[1] === MERMAID_LANGUAGE || isMermaidContent(codeString));
              if (isMermaid) {
                return <MermaidBlock code={codeString} />;
              }

              // 树形目录结构：仅块级代码检测。
              if (isBlock && isTreeDirContent(codeString)) {
                return <TreeDirBlock code={codeString} />;
              }

              if (isBlock && match) {
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
