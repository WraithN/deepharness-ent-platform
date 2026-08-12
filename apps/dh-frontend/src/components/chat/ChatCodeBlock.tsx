import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { MermaidBlock } from './MermaidBlock';
import { isMermaidDiagramCode } from '@/lib/mermaid-utils';

interface ChatCodeBlockProps {
  code: string;
  language?: string;
}

export const ChatCodeBlock: React.FC<ChatCodeBlockProps> = ({ code, language = 'typescript' }) => {
  // 兜底：如果代码块被识别为普通语言但内容是 Mermaid，直接渲染 MermaidBlock。
  if (language !== 'mermaid' && isMermaidDiagramCode(code)) {
    return <MermaidBlock code={code} />;
  }

  return (
    <div className="rounded-xl overflow-x-auto border border-border/50 my-1">
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
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '14px', maxHeight: '400px', maxWidth: '100%' }}
        showLineNumbers
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};
