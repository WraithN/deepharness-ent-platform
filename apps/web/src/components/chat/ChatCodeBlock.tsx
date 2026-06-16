import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toast } from 'sonner';

interface ChatCodeBlockProps {
  code: string;
  language?: string;
}

export const ChatCodeBlock: React.FC<ChatCodeBlockProps> = ({ code, language = 'typescript' }) => {
  return (
    <div className="rounded-xl overflow-hidden border border-border/50 my-1">
      <div className="px-3 py-1 bg-muted/80 border-b border-border/30 text-xs text-muted-foreground flex items-center justify-between">
        <span>{language}</span>
        <button
          className="hover:text-foreground transition-colors"
          onClick={() => { navigator.clipboard.writeText(code); toast.success('已复制'); }}
        >
          复制
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', maxHeight: '400px' }}
        showLineNumbers
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};
