import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vs, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Check, Copy, FileCode, Sun, Moon, Pencil, GitCommit, User, Clock, X } from 'lucide-react';
import { Button } from './ui/button';

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
}) => {
  const [copied, setCopied] = useState(false);
  const [localDark, setLocalDark] = useState(false);
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
  const theme = localDark ? vscDarkPlus : vs;
  const lineNumberColor = localDark ? '#5c6370' : '#a0a0a0';
  const isMarkdown = lang === 'markdown';

  const handleModeChange = (mode: 'code' | 'preview' | 'blame') => {
    onViewModeChange?.(mode);
  };

  // Mock blame data if none provided
  const displayBlameData = blameData.length > 0 ? blameData :
    content.split('\n').map((line, idx) => ({
      commit: 'abc1234',
      author: '开发者',
      date: '2024-01-15',
      line: idx + 1,
      content: line,
    }));

  return (
    <div className={`rounded-xl overflow-hidden border border-border/50 ${localDark ? 'bg-[#1e1e1e] text-[#d4d4d4] border-[#333]' : 'bg-card text-foreground'}`}>
      {/* View Mode Tabs - Header */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${localDark ? 'bg-[#252526] border-[#333]' : 'bg-muted/30 border-border/50'}`}>
        <div className="flex items-center gap-4">
          {/* View Mode Tabs */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleModeChange('preview')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'preview'
                  ? localDark ? 'bg-[#333] text-[#fff]' : 'bg-primary text-primary-foreground'
                  : localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'text-muted-foreground hover:bg-muted'
              } ${!isMarkdown ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!isMarkdown}
            >
              PREVIEW
            </button>
            <button
              onClick={() => handleModeChange('code')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'code'
                  ? localDark ? 'bg-[#333] text-[#fff]' : 'bg-primary text-primary-foreground'
                  : localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              CODE
            </button>
            <button
              onClick={() => handleModeChange('blame')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'blame'
                  ? localDark ? 'bg-[#333] text-[#fff]' : 'bg-primary text-primary-foreground'
                  : localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              BLAME
            </button>
          </div>

          {/* Language badge */}
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${localDark ? 'bg-[#333] text-[#999]' : 'text-muted-foreground bg-muted'}`}>{lang}</span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'hover:bg-muted'}`} onClick={() => handleThemeChange(!localDark)} title={localDark ? '浅色模式' : '深色模式'}>
            {localDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </Button>
          {editable && viewMode === 'code' && !editMode && (
            <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'hover:bg-muted'}`} onClick={() => setEditMode(true)} title="编辑">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
          {editable && viewMode === 'code' && editMode && (
            <>
              <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'hover:bg-muted'}`} onClick={() => { setEditContent(content); setEditMode(false); }} title="取消">
                <X className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs text-green-500 hover:text-green-600 ${localDark ? 'hover:bg-[#333]' : 'hover:bg-muted'}`} onClick={handleSave} title="保存">
                <Check className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className={`h-7 w-7 text-xs ${localDark ? 'text-[#999] hover:bg-[#333] hover:text-[#ccc]' : 'hover:bg-muted'}`} onClick={handleCopy} title="复制">
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
      
      {/* Content area */}
      <div className={`relative ${localDark ? 'bg-[#1e1e1e]' : ''}`}>
        {/* PREVIEW - Markdown only */}
        {viewMode === 'preview' && isMarkdown ? (
          <div className="p-6 prose dark:prose-invert max-w-none text-sm leading-relaxed" style={{ color: localDark ? '#d4d4d4' : undefined }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {trimmedContent}
            </ReactMarkdown>
          </div>
        ) : viewMode === 'blame' ? (
          <div className="flex h-full">
            {/* Blame sidebar */}
            <div className={`w-64 border-r ${localDark ? 'border-[#333] bg-[#1e1e1e]' : 'border-border/30 bg-muted/10'}`}>
              <div className={`px-4 py-2.5 border-b ${localDark ? 'border-[#333]' : 'border-border/50'}`}>
                <div className="flex items-center gap-2 text-xs font-medium">
                  <GitCommit className="w-3.5 h-3.5" />
                  Git Blame
                </div>
              </div>
              <div className="overflow-auto max-h-[500px]">
                {displayBlameData.slice(0, 50).map((blame, idx) => (
                  <div
                    key={idx}
                    className={`px-3 py-2 border-b text-xs ${localDark ? 'border-[#333] hover:bg-[#2a2a2a]' : 'border-border/20 hover:bg-muted/20'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <GitCommit className="w-3 h-3 text-blue-500" />
                      <span className="font-mono text-blue-500 font-medium">{blame.commit}</span>
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
                ))}
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
