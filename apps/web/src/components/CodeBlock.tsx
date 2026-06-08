import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vs, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toast } from 'sonner';
import { Check, Copy, FileCode, Sun, Moon, Pencil } from 'lucide-react';
import { Button } from './ui/button';

interface CodeBlockProps {
  content: string;
  filename?: string;
  language?: string;
  editable?: boolean;
  onChange?: (value: string) => void;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  content,
  filename = 'code',
  language,
  editable = false,
  onChange,
}) => {
  const [copied, setCopied] = useState(false);
  const [localDark, setLocalDark] = useState(false);

  const getLanguage = (fname: string) => {
    if (language) return language;
    const ext = fname.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts': case 'tsx': return 'typescript';
      case 'js': case 'jsx': return 'javascript';
      case 'go': return 'go';
      case 'json': return 'json';
      case 'md': return 'markdown';
      case 'css': return 'css';
      case 'html': return 'html';
      case 'py': return 'python';
      case 'java': return 'java';
      default: return 'text';
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success('代码已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  const [showRaw, setShowRaw] = useState(false);

  const lang = getLanguage(filename);
  const theme = localDark ? vscDarkPlus : vs;
  const lineNumberColor = localDark ? '#5c6370' : '#a0a0a0';

  return (
    <div className={`tech-border rounded-xl overflow-hidden ${localDark ? 'bg-[#1e1e1e] text-[#d4d4d4] border-[#333]' : 'bg-card text-foreground'}`}>
      {/* Filename header */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${localDark ? 'bg-[#252526] border-[#333]' : 'bg-muted/60 border-border/50'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className={`w-4 h-4 shrink-0 ${localDark ? 'text-[#3794ff]' : 'text-primary'}`} />
          <span className={`text-sm font-medium font-mono truncate ${localDark ? 'text-[#cccccc]' : 'text-foreground'}`}>{filename}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${localDark ? 'bg-[#333] text-[#999]' : 'text-muted-foreground bg-muted'}`}>{lang}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {lang === 'markdown' && (
            <Button variant="ghost" size="sm" className={`h-7 gap-1.5 text-xs ${localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'hover:bg-muted'}`} onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? 'Formatted' : 'Raw'}
            </Button>
          )}
          <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'hover:bg-muted'}`} onClick={() => setLocalDark(!localDark)} title={localDark ? '浅色模式' : '深色模式'}>
            {localDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 gap-1.5 text-xs ${localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'hover:bg-muted'}`} onClick={handleCopy}>
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
      </div>
      {/* Code content */}
      <div className={`relative ${localDark ? 'bg-[#1e1e1e]' : ''}`}>
        {lang === 'markdown' && !showRaw ? (
          <div className="p-5 prose dark:prose-invert max-w-none text-sm leading-relaxed" style={{ color: localDark ? '#d4d4d4' : undefined }}>
            <div dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br/>') }} />
          </div>
        ) : (
          <SyntaxHighlighter
          language={lang}
          style={theme}
          customStyle={{
            margin: 0,
            padding: '1.25rem',
            paddingTop: editable ? '3.5rem' : '1.25rem',
            fontSize: '13px',
            lineHeight: '1.7',
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            background: 'transparent',
            minHeight: editable ? '200px' : undefined,
          }}
          showLineNumbers={true}
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            color: lineNumberColor,
            fontSize: '12px',
          }}
        >
          {content || '/* 空文件 */'}
        </SyntaxHighlighter>
        )}
        {editable && (!lang || lang !== 'markdown' || showRaw) && (
          <textarea
            value={content}
            onChange={(e) => onChange?.(e.target.value)}
            spellCheck={false}
            className="absolute inset-0 w-full h-full resize-none border-0 rounded-none bg-transparent text-transparent caret-foreground focus-visible:ring-0 font-mono text-[13px] leading-[1.7]"
            style={{
              padding: '3.5rem 1.25rem 1.25rem 3.75rem',
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            }}
          />
        )}
      </div>
    </div>
  );
};
