import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { MermaidBlock } from './MermaidBlock';

interface ChatCodeBlockProps {
  code: string;
  language?: string;
}

// 简单的 Mermaid 语法检测，作为 MarkdownView 检测失败后的兜底。
const MERMAID_KEYWORDS = [
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'erDiagram', 'gantt', 'pie', 'journey', 'gitGraph', 'mindmap', 'timeline',
  'quadrantChart', 'xychart-beta', 'architecture-beta', 'block-beta',
  'packet-beta', 'sankey-beta', 'treemap-beta', 'requirementDiagram',
  'kanban', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment',
];
const MERMAID_ARROW_PATTERN = /(-->|--\.|==>|-.->|\.->|\|\|)/;

function looksLikeMermaid(code: string): boolean {
  const firstLine = code.trim().split('\n')[0]?.trim() ?? '';
  if (MERMAID_KEYWORDS.some(kw => firstLine.startsWith(kw))) return true;
  if (MERMAID_ARROW_PATTERN.test(code)) return true;
  return false;
}

export const ChatCodeBlock: React.FC<ChatCodeBlockProps> = ({ code, language = 'typescript' }) => {
  // 兜底：如果代码块被识别为普通语言但内容是 Mermaid，直接渲染 MermaidBlock。
  if (looksLikeMermaid(code)) {
    return <MermaidBlock code={code} />;
  }

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 my-1">
      <div className="px-3 py-1 bg-muted/80 border-b border-border/30 text-xs text-muted-foreground flex items-center justify-between">
        <span>{language}</span>
        <button
          className="hover:text-foreground transition-colors"
          onClick={() => { navigator.clipboard.writeText(code); }}
        >
          复制
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '14px', maxHeight: '400px' }}
        showLineNumbers
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};
