import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vs, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Check, Copy, FileCode, Sun, Moon, Pencil, GitCommit, User, Clock, X } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

/** Aurora 暗色代码高亮主题：专为 IDE 代码区设计的高对比、低疲劳配色。 */
const auroraDark: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': {
    color: '#F1F5F9',
    background: 'none',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '14px',
    lineHeight: '1.7',
    textShadow: 'none',
  },
  'pre[class*="language-"]': {
    color: '#F1F5F9',
    background: '#0F172A',
    margin: 0,
    padding: '1.25rem',
    overflow: 'auto',
  },
  'comment': { color: '#64748B', fontStyle: 'italic' },
  'prolog': { color: '#64748B' },
  'doctype': { color: '#64748B' },
  'cdata': { color: '#64748B' },
  'punctuation': { color: '#94A3B8' },
  'namespace': { color: '#F59E0B' },
  'property': { color: '#3B82F6' },
  'tag': { color: '#3B82F6' },
  'boolean': { color: '#F97316' },
  'number': { color: '#F97316' },
  'constant': { color: '#F97316' },
  'symbol': { color: '#F97316' },
  'deleted': { color: '#EF4444' },
  'selector': { color: '#8B5CF6' },
  'attr-name': { color: '#10B981' },
  'string': { color: '#10B981' },
  'char': { color: '#10B981' },
  'builtin': { color: '#F59E0B' },
  'inserted': { color: '#10B981' },
  'operator': { color: '#94A3B8' },
  'entity': { color: '#F1F5F9' },
  'url': { color: '#3B82F6' },
  'atrule': { color: '#3B82F6' },
  'attr-value': { color: '#10B981' },
  'keyword': { color: '#3B82F6' },
  'function': { color: '#8B5CF6' },
  'class-name': { color: '#F59E0B' },
  'regex': { color: '#F59E0B' },
  'important': { color: '#F59E0B', fontWeight: 'bold' },
  'variable': { color: '#F1F5F9' },
  'parameter': { color: '#F1F5F9' },
};

interface BlameLine {
  commit: string;
  author: string;
  date: string;
  line: number;
  content: string;
}

interface CodeBlockProps {
  content: string;
  filename?: string;
  language?: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  showHeader?: boolean;
  showViewMode?: boolean;
  viewMode?: 'code' | 'preview' | 'blame';
  onViewModeChange?: (mode: 'code' | 'preview' | 'blame') => void;
  onThemeChange?: (dark: boolean) => void;
  blameData?: BlameLine[];
  variant?: 'default' | 'editor';
  darkMode?: boolean;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  content,
  filename = 'code',
  language,
  editable = false,
  onChange,
  onSave,
  showHeader = true,
  showViewMode = true,
  viewMode = 'code',
  onViewModeChange,
  onThemeChange,
  blameData = [],
  variant = 'default',
  darkMode,
}) => {
  const [copied, setCopied] = useState(false);
  const [localDark, setLocalDark] = useState(darkMode ?? false);

  React.useEffect(() => {
    if (typeof darkMode === 'boolean') {
      setLocalDark(darkMode);
    }
  }, [darkMode]);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState(content);

  React.useEffect(() => {
    setEditContent(content);
  }, [content]);

  const handleSave = () => {
    onSave?.(editContent);
    setEditMode(false);
  };

  const handleThemeChange = (dark: boolean) => {
    setLocalDark(dark);
    onThemeChange?.(dark);
  };

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
      case 'yaml': case 'yml': return 'yaml';
      case 'sh': case 'bash': case 'shell': return 'bash';
      case 'sql': return 'sql';
      case 'rs': return 'rust';
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

  // Trim leading empty lines
  const trimmedContent = content.replace(/^\s*\n/, '');

  const lang = getLanguage(filename);
  const theme = localDark ? auroraDark : vs;
  const lineNumberColor = localDark ? '#475569' : 'hsl(var(--muted-foreground))';
  const isMarkdown = lang === 'markdown';
  const isEditor = variant === 'editor';

  const handleModeChange = (mode: 'code' | 'preview' | 'blame') => {
    onViewModeChange?.(mode);
  };

  // 无 blame 数据时 blame 模式不可用，由调用方提供真实数据。
  const hasBlameData = blameData.length > 0;

  return (
    <div className={cn(
      'overflow-hidden border',
      isEditor ? 'rounded-none h-full flex flex-col' : 'rounded-xl',
      localDark
        ? 'bg-[#0F172A] text-[#F1F5F9] border-[rgba(148,163,184,0.15)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]'
        : 'bg-card text-foreground border-border/50'
    )}>
      {/* View Mode Tabs - Header */}
      <div className={cn(
        'flex items-center justify-between px-4 py-2 border-b shrink-0',
        localDark
          ? 'bg-[#1E293B] border-[rgba(148,163,184,0.15)]'
          : 'bg-muted/30 border-border/50'
      )}>
        <div className="flex items-center gap-4">
          {/* View Mode Tabs */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleModeChange('preview')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'preview'
                  ? localDark ? 'bg-primary text-primary-foreground' : 'bg-primary text-primary-foreground'
                  : localDark ? 'text-[#94A3B8] hover:bg-[#2A374B] hover:text-[#F1F5F9]' : 'text-muted-foreground hover:bg-muted'
              } ${!isMarkdown ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!isMarkdown}
            >
              PREVIEW
            </button>
            <button
              onClick={() => handleModeChange('code')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'code'
                  ? localDark ? 'bg-primary text-primary-foreground' : 'bg-primary text-primary-foreground'
                  : localDark ? 'text-[#94A3B8] hover:bg-[#2A374B] hover:text-[#F1F5F9]' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              CODE
            </button>
            <button
              onClick={() => handleModeChange('blame')}
              disabled={!hasBlameData}
              title={hasBlameData ? 'Git Blame' : '暂无 blame 数据'}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'blame'
                  ? localDark ? 'bg-primary text-primary-foreground' : 'bg-primary text-primary-foreground'
                  : localDark ? 'text-[#94A3B8] hover:bg-[#2A374B] hover:text-[#F1F5F9]' : 'text-muted-foreground hover:bg-muted'
              } ${!hasBlameData ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              BLAME
            </button>
          </div>

          {/* Language badge */}
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${localDark ? 'bg-muted text-muted-foreground' : 'text-muted-foreground bg-muted'}`}>{lang}</span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#94A3B8] hover:bg-[#2A374B] hover:text-[#F1F5F9]' : 'hover:bg-muted'}`} onClick={() => handleThemeChange(!localDark)} title={localDark ? '浅色模式' : '深色模式'}>
            {localDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
          {editable && viewMode === 'code' && !editMode && (
            <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#94A3B8] hover:bg-[#2A374B] hover:text-[#F1F5F9]' : 'hover:bg-muted'}`} onClick={() => setEditMode(true)} title="编辑">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
          {editable && viewMode === 'code' && editMode && (
            <>
              <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#94A3B8] hover:bg-[#2A374B] hover:text-[#F1F5F9]' : 'hover:bg-muted'}`} onClick={() => { setEditContent(content); setEditMode(false); }} title="取消">
                <X className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs text-green-500 hover:text-green-600 ${localDark ? 'hover:bg-muted' : 'hover:bg-muted'}`} onClick={handleSave} title="保存">
                <Check className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#94A3B8] hover:bg-[#2A374B] hover:text-[#F1F5F9]' : 'hover:bg-muted'}`} onClick={handleCopy} title="复制">
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
      
      {/* Content area */}
      <div className={cn('relative flex-1', localDark ? 'bg-[#0F172A] shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]' : '')}>
        {/* PREVIEW - Markdown only */}
        {viewMode === 'preview' && isMarkdown ? (
          <div className="p-6 prose dark:prose-invert max-w-none text-sm leading-relaxed" >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {trimmedContent}
            </ReactMarkdown>
          </div>
        ) : viewMode === 'blame' ? (
          <div className="flex h-full">
            {/* Blame sidebar */}
            <div className={`w-64 border-r ${localDark ? 'border-[rgba(148,163,184,0.15)] bg-[#1E293B]' : 'border-border/30 bg-muted/10'}`}>
              <div className={`px-4 py-2.5 border-b ${localDark ? 'border-[rgba(148,163,184,0.15)]' : 'border-border/50'}`}>
                <div className="flex items-center gap-2 text-xs font-medium">
                  <GitCommit className="w-3.5 h-3.5" />
                  Git Blame
                </div>
              </div>
              <div className="overflow-auto max-h-[500px]">
                {blameData.length > 0 ? (
                  blameData.slice(0, 50).map((blame, idx) => (
                    <div
                      key={idx}
                      className={`px-3 py-2 border-b text-xs ${'border-border/20 hover:bg-muted/20'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <GitCommit className="w-3 h-3 text-primary" />
                        <span className="font-mono text-primary font-medium">{blame.commit}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <User className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground truncate">{blame.author}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{blame.date}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-6 text-xs text-muted-foreground text-center">暂无 blame 数据</div>
                )}
              </div>
            </div>
            {/* Code content */}
            <div className="flex-1 overflow-auto">
              <SyntaxHighlighter
                language={lang}
                style={theme}
                customStyle={{
                  margin: 0,
                  padding: '1.25rem',
                  paddingTop: editable ? '3.5rem' : '1.25rem',
                  fontSize: '14px',
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
                  fontSize: '13px',
                }}
              >
                {trimmedContent || '/* 空文件 */'}
              </SyntaxHighlighter>
            </div>
          </div>
        ) : (
          /* CODE mode */
          <SyntaxHighlighter
            language={lang}
            style={theme}
            customStyle={{
              margin: 0,
              padding: '1.25rem',
              paddingTop: editable ? '3.5rem' : '1.25rem',
              fontSize: '14px',
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
              fontSize: '13px',
            }}
          >
            {trimmedContent || '/* 空文件 */'}
          </SyntaxHighlighter>
        )}

        {/* Editable textarea */}
        {editable && viewMode === 'code' && editMode && (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            spellCheck={false}
            className="absolute inset-0 w-full h-full resize-none border-0 rounded-none bg-transparent text-transparent caret-foreground focus-visible:ring-0 font-mono text-[13px] leading-[1.7]"
            style={{
              padding: '1.25rem 1.25rem 1.25rem 3.75rem',
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            }}
          />
        )}
      </div>
    </div>
  );
};
