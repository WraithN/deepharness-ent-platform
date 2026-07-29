import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Folder, File, ChevronRight, ChevronDown, GitBranch, Code2, Book, Search, X, Share2, FileText, Activity, FileCode, Eye, ShieldCheck, Sparkles, RefreshCw, Loader2, Braces, Globe, Palette, Terminal, Settings, Image, FileJson, FileType, FileCode2, Database, Users, AlertCircle, CheckCircle, BarChart3, Code, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { repositoryApi, type UserRepoStatus } from '@/lib/repository-api';
import type { RepositoryDTO, FileNodeDTO, FileContentDTO, ScannedRepositoryDTO, RepositoryDetailsDTO, BranchInfoDTO } from '@/lib/api-types';
import { LivePreview } from '@/components/chat/LivePreview';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { detectFrontendProject } from '@/lib/project-detector';
import { CodeBlock } from '@/components/CodeBlock';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { projectApi } from '@/lib/project-api';
import { fileApi } from '@/lib/file-api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SYNC_POLL_INTERVAL_MS = 2000;

// 文件树节点类型（与后端 FileNodeDTO 对齐，增加本地缓存的 content）。
type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
};

// 项目文档内容（当前为空，后续由后端或 AI 生成后替换）
const projectDoc = '';

// Extract TOC from markdown
interface TocItem {
  level: number;
  title: string;
  id: string;
}

const extractToc = (md: string): TocItem[] => {
  const lines = md.split('\n');
  const toc: TocItem[] = [];
  let idCounter = 0;
  for (const line of lines) {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      toc.push({
        level: match[1].length,
        title: match[2].trim(),
        id: `toc-${idCounter++}`,
      });
    }
  }
  return toc;
};

// Simple markdown renderer
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let listItems: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeContent: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(<ul key={`ul-${i}`} className="list-disc pl-6 my-3 space-y-1 text-sm leading-relaxed">{listItems}</ul>);
      listItems = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushList();
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        codeContent = [];
      } else {
        inCodeBlock = false;
        const lang = codeLang || 'text';
        elements.push(
          <div key={`code-${i}`} className="my-4">
            <CodeBlock content={codeContent.join('\n')} filename={`example.${lang === 'typescript' ? 'ts' : lang}`} language={lang} />
          </div>
        );
        codeLang = '';
        codeContent = [];
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      flushList();
      const title = line.slice(3).trim();
      elements.push(<h2 key={`h2-${i}`} className="text-xl font-bold mt-8 mb-4 text-foreground scroll-mt-20">{title}</h2>);
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      flushList();
      const title = line.slice(4).trim();
      elements.push(<h3 key={`h3-${i}`} className="text-lg font-semibold mt-6 mb-3 text-foreground scroll-mt-20">{title}</h3>);
      i++;
      continue;
    }

    if (line.startsWith('- ')) {
      const text = line.slice(2).trim();
      listItems.push(<li key={`li-${i}`} className="text-sm">{renderInline(text)}</li>);
      i++;
      continue;
    }

    if (line.startsWith('| ')) {
      flushList();
      // Skip table separator lines
      if (line.includes('|-') || line.includes('|:-')) {
        i++;
        continue;
      }
      // Simple table rendering - collect rows
      const tableRows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!lines[i].includes('|-')) {
          tableRows.push(lines[i]);
        }
        i++;
      }
      if (tableRows.length > 0) {
        elements.push(
          <div key={`table-${i}`} className="overflow-x-auto my-4">
            <table className="w-full text-sm border-collapse">
              <tbody>
                {tableRows.map((row, ri) => {
                  const cells = row.split('|').filter(c => c.trim() !== '');
                  return (
                    <tr key={ri} className={ri === 0 ? 'border-b border-border font-medium bg-muted/30' : 'border-b border-border/50'}>
                      {cells.map((cell, ci) => (
                        <td key={ci} className="px-4 py-2">{cell.trim()}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    if (line.trim() === '') {
      flushList();
      i++;
      continue;
    }

    if (line.trim() === '---') {
      flushList();
      elements.push(<hr key={`hr-${i}`} className="my-6 border-border" />);
      i++;
      continue;
    }

    flushList();
    elements.push(<p key={`p-${i}`} className="my-3 text-sm leading-relaxed text-foreground/90">{renderInline(line)}</p>);
    i++;
  }

  flushList();

  return <div className="max-w-none">{elements}</div>;
};

// Inline markdown rendering (bold, italic, code, links)
const renderInline = (text: string): React.ReactNode => {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const patterns = [
    { regex: /\*\*([^*]+)\*\*/g, wrapper: (m: string) => <strong key={key++} className="font-semibold text-foreground">{m}</strong> },
    { regex: /`([^`]+)`/g, wrapper: (m: string) => <code key={key++} className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono text-primary">{m}</code> },
  ];

  // Simple approach: split by bold and code patterns
  const segments = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return segments.map((seg, idx) => {
    if (seg.startsWith('**') && seg.endsWith('**')) {
      return <strong key={idx} className="font-semibold text-foreground">{seg.slice(2, -2)}</strong>;
    }
    if (seg.startsWith('`') && seg.endsWith('`')) {
      return <code key={idx} className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono text-primary">{seg.slice(1, -1)}</code>;
    }
    return seg;
  });
};

const getFileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return { Icon: Braces, color: 'text-blue-500' };
    case 'ts':
    case 'js':
      return { Icon: FileType, color: 'text-blue-400' };
    case 'json':
      return { Icon: FileJson, color: 'text-amber-500' };
    case 'md':
    case 'txt':
      return { Icon: FileText, color: 'text-slate-500' };
    case 'go':
      return { Icon: Terminal, color: 'text-cyan-500' };
    case 'css':
    case 'scss':
    case 'less':
      return { Icon: Palette, color: 'text-pink-400' };
    case 'html':
    case 'htm':
      return { Icon: Globe, color: 'text-orange-400' };
    case 'py':
      return { Icon: FileCode2, color: 'text-yellow-500' };
    case 'sql':
    case 'db':
      return { Icon: Database, color: 'text-indigo-400' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'gif':
      return { Icon: Image, color: 'text-purple-400' };
    case 'yml':
    case 'yaml':
    case 'conf':
    case 'config':
      return { Icon: Settings, color: 'text-gray-400' };
    default:
      return { Icon: File, color: 'text-muted-foreground' };
  }
};

const FileTreeItem = ({
  node,
  level = 0,
  onSelectFile,
  selectedFile,
  forceOpen = false
}: {
  node: FileNode;
  level?: number;
  onSelectFile: (node: FileNode) => void;
  selectedFile: FileNode | null;
  forceOpen?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = selectedFile === node;

  const effectivelyOpen = isOpen || forceOpen;

  const handleClick = () => {
    if (node.type === 'folder') {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node);
    }
  };

  const fileIcon = node.type === 'file' ? getFileIcon(node.name) : null;

  return (
    <div className="w-full">
      <div
        className={`flex items-center gap-1.5 py-1.5 px-2 cursor-pointer text-sm transition-all duration-150 ${isSelected ? 'bg-accent text-foreground border-l-2 border-primary' : 'text-foreground/70 hover:bg-accent hover:text-foreground rounded-md'}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        {node.type === 'folder' ? (
          <>
            {effectivelyOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <Folder className="h-4 w-4 shrink-0 text-blue-400" />
          </>
        ) : (
          <>
            <span className="w-4 shrink-0" />
            {fileIcon && <fileIcon.Icon className={`h-4 w-4 shrink-0 ${fileIcon.color}`} />}
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.type === 'folder' && effectivelyOpen && node.children && (
        <div className="flex flex-col">
          {node.children.map((child, idx) => (
            <FileTreeItem
              key={`${child.name}-${idx}`}
              node={child}
              level={level + 1}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
              forceOpen={forceOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Mock preview URLs per repo
const PreviewPanel: React.FC<{ repoId: string; branch: string; repoName: string; repoUrl: string; previewUrl?: string }> = ({
  repoId,
  branch,
  repoName,
  repoUrl,
  previewUrl,
}) => {
  const defaultUrl = previewUrl || '';
  const [inputUrl, setInputUrl] = useState(defaultUrl);
  const [loadedUrl, setLoadedUrl] = useState(defaultUrl);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [viewScale, setViewScale] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // Update URL when repo changes
  React.useEffect(() => {
    const url = previewUrl || '';
    setInputUrl(url);
    setLoadedUrl(url);
    setLoadFailed(false);
  }, [repoId, previewUrl]);

  const handleNavigate = () => {
    let url = inputUrl.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    setInputUrl(url);
    setLoadedUrl(url);
    setLoading(true);
    setLoadFailed(false);
  };

  const handleReload = () => {
    setLoading(true);
    setLoadFailed(false);
    setLoadedUrl((prev) => prev + (prev.includes('?') ? '&' : '?') + '__r=' + Date.now());
  };

  const scaleConfigs = {
    desktop: { width: '100%', label: '桌面端', icon: '🖥️' },
    tablet: { width: '768px', label: '平板', icon: '📱' },
    mobile: { width: '390px', label: '移动端', icon: '📲' },
  };

  return (
    <div className="h-full flex flex-col">
      {/* Preview Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/10 shrink-0 flex-wrap">
        {/* Device toggles */}
        <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-lg">
          {(Object.keys(scaleConfigs) as Array<keyof typeof scaleConfigs>).map((key) => (
            <button
              key={key}
              onClick={() => setViewScale(key)}
              title={scaleConfigs[key].label}
              className={`px-2 py-1 rounded-md text-sm transition-all ${
                viewScale === key
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="mr-1">{scaleConfigs[key].icon}</span>
              <span className="hidden sm:inline text-xs">{scaleConfigs[key].label}</span>
            </button>
          ))}
        </div>

        {/* URL bar */}
        <div className="flex items-center flex-1 min-w-0 gap-1 bg-background border border-border/50 rounded-lg px-2 h-8">
          {loading && <Activity className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
          {!loading && (
            <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
            placeholder="输入预览地址..."
            className="flex-1 min-w-0 bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <button
          onClick={handleNavigate}
          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          前往
        </button>
        <button
          onClick={handleReload}
          className="h-8 px-3 rounded-lg border border-border/50 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          刷新
        </button>
      </div>

      {/* Branch info bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-muted/5 border-b border-border/30 shrink-0">
        <GitBranch className="w-3 h-3" />
        <span>{repoName}</span>
        <span>/</span>
        <span className="text-primary font-medium">{branch}</span>
        <span className="ml-auto opacity-50 truncate max-w-[40%]">{repoUrl}</span>
      </div>

      {/* Preview Frame Area */}
      <div className="flex-1 overflow-auto bg-muted/20 flex items-start justify-center py-4 px-2">
        <div
          className="relative bg-background rounded-lg border border-border/50 shadow-lg overflow-hidden transition-all duration-300"
          style={{
            width: scaleConfigs[viewScale].width,
            minHeight: '400px',
            height: 'calc(100% - 0px)',
          }}
        >
          {loadFailed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-4 p-8">
              <Eye className="w-12 h-12 opacity-20" />
              <div className="text-center">
                <p className="font-medium text-foreground mb-1">无法加载预览</p>
                <p className="text-sm">该页面禁止被 iframe 嵌入（X-Frame-Options）</p>
                <p className="text-xs mt-1 opacity-70">可在新标签页中打开查看</p>
              </div>
              <a
                href={loadedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                在新标签页打开
              </a>
            </div>
          ) : (
            <>
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                  <Activity className="w-8 h-8 animate-spin text-primary" />
                </div>
              )}
              <iframe
                ref={iframeRef}
                src={loadedUrl}
                className="w-full h-full border-none"
                style={{ minHeight: '400px', height: '100%' }}
                title={`preview-${repoId}`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setLoadFailed(true);
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Review Panel ───

/** 历史评审报告摘要 */
interface ReviewReportSummary {
  fileName: string;
  filePath: string;
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  content: string;
}

/** 从评审报告 Markdown 内容中解析问题数量 */
function parseIssueCounts(content: string): { critical: number; high: number; medium: number; low: number } {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const patterns: Array<[keyof typeof counts, RegExp]> = [
    ['critical', /致命[：:]\s*(\d+)/],
    ['high', /严重[：:]\s*(\d+)/],
    ['medium', /一般[：:]\s*(\d+)/],
    ['low', /轻微[：:]\s*(\d+)/],
  ];
  for (const [key, regex] of patterns) {
    const match = content.match(regex);
    if (match?.[1]) counts[key] = parseInt(match[1], 10) || 0;
  }
  return counts;
}

/** 从文件名解析日期（review-YYYY-MM-DD-HHmmss.md -> YYYY-MM-DD HH:mm:ss） */
function parseDateFromFileName(fileName: string): string {
  const match = fileName.match(/review-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!match) return fileName;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
}

const DocGenButton: React.FC = () => {
  const [generating, setGenerating] = useState(false);
  const handleClick = () => {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      toast.success('文档已重新生成');
    }, 2000);
  };
  return (
    <Button size="sm" onClick={handleClick} disabled={generating} className="h-7 text-xs gap-1.5">
      {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {generating ? '生成中...' : '生成文档'}
    </Button>
  );
};

interface ReviewPanelProps {
  repoPath?: string;
  repoName?: string;
  repoId?: string;
  branch?: string;
}

const ReviewPanel: React.FC<ReviewPanelProps> = ({ repoPath, repoName, repoId, branch }) => {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReviewReportSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ReviewReportSummary | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 智能评审：跳转到智能会话，预填 /review 指令并预选当前工程
  const handleSmartReview = () => {
    if (!repoId || !repoName) {
      toast.error('请先选择一个工程');
      return;
    }
    navigate('/chat', {
      state: {
        initialInput: '/review ',
        selectedRepos: [{ id: repoId, name: repoName }],
      },
    });
  };

  // 加载 .review/ 目录下的历史评审报告
  useEffect(() => {
    if (!repoPath) {
      setReports([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const reviewDir = `${repoPath}/.review`;
    projectApi
      .tree(reviewDir)
      .then(async (files) => {
        if (cancelled) return;
        const reviewFiles = files.filter(f => f.type === 'file' && f.name.endsWith('.md'));
        const summaries = await Promise.all(
          reviewFiles.slice(0, 20).map(async (f) => {
            try {
              const content = await fileApi.content(f.path);
              const counts = parseIssueCounts(content.content);
              return {
                fileName: f.name,
                filePath: f.path,
                date: parseDateFromFileName(f.name),
                ...counts,
                content: content.content,
              } as ReviewReportSummary;
            } catch {
              return null;
            }
          })
        );
        if (!cancelled) {
          setReports(summaries.filter((s): s is ReviewReportSummary => s !== null));
        }
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [repoPath]);

  const totalIssues = reports.reduce((sum, r) => sum + r.critical + r.high + r.medium + r.low, 0);
  const totalCritical = reports.reduce((sum, r) => sum + r.critical + r.high, 0);
  const totalMedium = reports.reduce((sum, r) => sum + r.medium, 0);
  const totalLow = reports.reduce((sum, r) => sum + r.low, 0);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">代码评审</span>
          {repoName && <span className="text-xs text-muted-foreground">· {repoName}</span>}
          {branch && <span className="text-xs text-muted-foreground">· {branch}</span>}
        </div>
        <Button size="sm" onClick={handleSmartReview} className="h-7 text-xs gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          智能评审
        </Button>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}

          {!loading && reports.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">暂无评审报告</p>
              <p className="text-xs mt-1">点击右上角"智能评审"按钮开始代码评审</p>
            </div>
          )}

          {/* 总览统计 */}
          {reports.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
                <p className="text-lg font-bold text-foreground">{totalIssues}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">总问题数</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
                <p className="text-lg font-bold text-red-600 dark:text-red-400">{totalCritical}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">严重/致命</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{totalMedium}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">一般问题</p>
              </div>
              <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
                <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{totalLow}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">轻微问题</p>
              </div>
            </div>
          )}

          {/* 历史评审报告列表 */}
          {reports.map(report => {
            const reportId = report.filePath;
            const reportCritical = report.critical + report.high;
            return (
              <div key={reportId} className="rounded-xl border border-border/50 bg-card p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">{report.date}</span>
                  <button
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 shrink-0"
                    onClick={() => toggleExpand(reportId)}
                  >
                    {expanded.has(reportId) ? '收起' : '展开'}
                    <ChevronDown className={`h-3 w-3 transition-transform ${expanded.has(reportId) ? 'rotate-180' : ''}`} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {reportCritical > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                      致命/严重 {reportCritical}
                    </span>
                  )}
                  {report.medium > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      一般 {report.medium}
                    </span>
                  )}
                  {report.low > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      轻微 {report.low}
                    </span>
                  )}
                  {reportCritical + report.medium + report.low === 0 && (
                    <span className="text-[10px] text-emerald-600 font-semibold">未发现问题</span>
                  )}
                  <button
                    className="text-xs text-primary hover:underline ml-auto"
                    onClick={() => setSelectedReport(report)}
                  >
                    查看全文
                  </button>
                </div>
                {expanded.has(reportId) && (
                  <div className="mt-2 p-2.5 rounded-lg bg-muted/30 text-xs text-foreground leading-relaxed border border-border/30 max-h-60 overflow-y-auto">
                    <MarkdownView content={report.content} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 报告全文预览弹窗 */}
      <Dialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {selectedReport?.date} 评审报告
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-1">
            {selectedReport && <MarkdownView content={selectedReport.content} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const ProjectCode: React.FC = () => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const location = useLocation();

  const [repositories, setRepositories] = useState<RepositoryDTO[]>([]);
  const [fileSystem, setFileSystem] = useState<Record<string, FileNode[]>>({});
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [repoType, setRepoType] = useState<'dev' | 'case'>('dev');
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);

  // 从 ReviewReportCard "采纳" 按钮导航过来的状态
  const [reviewRepoPath, setReviewRepoPath] = useState<string>('');

  // 用户仓库同步检测状态
  const [syncChecking, setSyncChecking] = useState(true);
  const [userRepoStatuses, setUserRepoStatuses] = useState<UserRepoStatus[]>([]);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);

  // Scan functionality
  const [scannedRepos, setScannedRepos] = useState<ScannedRepositoryDTO[]>([]);
  const [loadingScan, setLoadingScan] = useState(false);
  const [showScanPanel, setShowScanPanel] = useState(false);

  // Repository details
  const [repoDetails, setRepoDetails] = useState<RepositoryDetailsDTO | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Branches
  const [branches, setBranches] = useState<BranchInfoDTO[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [refreshingBranches, setRefreshingBranches] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);

  // Tabs management
  const [openFiles, setOpenFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // View mode tabs
  const [viewMode, setViewMode] = useState<'code' | 'graph' | 'review' | 'doc' | 'preview' | 'details'>('code');

  // 处理从 ReviewReportCard "采纳" 按钮导航过来的情况：切换到评审模式并设置仓库路径
  useEffect(() => {
    const navState = location.state as { viewMode?: string; repoPath?: string; repoName?: string } | null;
    if (navState?.viewMode === 'review' && navState.repoPath) {
      setViewMode('review');
      setReviewRepoPath(navState.repoPath);
    }
  }, [location.state]);

  // Code view mode for file viewer
  const [codeViewMode, setCodeViewMode] = useState<'code' | 'preview' | 'blame'>('code');
  // 代码编辑器主题跟随全局主题，暗色下使用 Aurora IDE 主题，亮色下使用清爽浅色主题。
  const { resolvedTheme } = useTheme();
  const [codeDarkMode, setCodeDarkMode] = useState(resolvedTheme === 'dark');
  useEffect(() => {
    setCodeDarkMode(resolvedTheme === 'dark');
  }, [resolvedTheme]);

  // Document TOC
  const toc = useMemo(() => extractToc(projectDoc), []);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const [tocSearchQuery, setTocSearchQuery] = useState('');

  // 用户仓库同步检测：检查用户 projects 目录下是否已有 settings 配置的仓库
  const checkUserRepoSync = useCallback(async () => {
    if (!workspaceId) return;
    setSyncChecking(true);
    try {
      const statuses = await repositoryApi.listUserRepos(workspaceId);
      setUserRepoStatuses(statuses);
    } catch {
      toast.error('检查仓库同步状态失败');
    } finally {
      setSyncChecking(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    checkUserRepoSync();
  }, [checkUserRepoSync]);

  // 同步单个仓库到用户 projects 目录
  const handleSyncRepo = async (repoId: string) => {
    setSyncingRepoId(repoId);
    try {
      await repositoryApi.syncUserRepo(workspaceId, repoId);
      toast.info('正在同步仓库，请稍候...');
      // 轮询同步状态
      const poll = setInterval(async () => {
        try {
          const statuses = await repositoryApi.listUserRepos(workspaceId);
          setUserRepoStatuses(statuses);
          const target = statuses.find(s => s.repositoryId === repoId);
          if (target?.synced || target?.syncStatus === 'failed') {
            clearInterval(poll);
            setSyncingRepoId(null);
          }
        } catch {
          // 轮询失败时继续尝试
        }
      }, SYNC_POLL_INTERVAL_MS);
      // 超时清理（5 分钟）
      setTimeout(() => { clearInterval(poll); setSyncingRepoId(null); }, 300000);
    } catch (err) {
      setSyncingRepoId(null);
      toast.error('同步仓库失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  };

  // 加载仓库列表（仅在同步检测完成且有已同步仓库时执行）
  useEffect(() => {
    if (syncChecking || userRepoStatuses.length === 0) return;
    const hasSynced = userRepoStatuses.some(s => s.synced);
    if (!hasSynced) return;

    const loadRepos = async () => {
      setLoadingRepos(true);
      try {
        const repos = await api.get<RepositoryDTO[]>(
          `/v1/workspaces/${workspaceId}/repositories`
        );
        setRepositories(repos);
        if (repos.length > 0) {
          const first = repos.find(r => r.type === 'dev') ?? repos[0];
          setSelectedRepoId(first.id);
          setRepoType(first.type as 'dev' | 'case');

          // Load branches for first repo
          const branchList = await api.get<BranchInfoDTO[]>(
            `/v1/workspaces/${workspaceId}/repositories/${first.id}/branches`
          );
          setBranches(branchList);
          if (branchList.length > 0) {
            const current = branchList.find(b => b.isCurrent) || branchList[0];
            setSelectedBranch(current.name);
          } else {
            setSelectedBranch(first.defaultBranch ?? '');
          }
        }
      } catch {
        toast.error('加载仓库列表失败');
      } finally {
        setLoadingRepos(false);
      }
    };
    loadRepos();
  }, [workspaceId, syncChecking, userRepoStatuses]);

  // 加载仓库详情
  const loadRepositoryDetails = async (repoId: string) => {
    if (!repoId) return;
    setLoadingDetails(true);
    try {
      const details = await api.get<RepositoryDetailsDTO>(
        `/v1/workspaces/${workspaceId}/repositories/${repoId}/details`
      );
      setRepoDetails(details);
    } catch {
      toast.error('加载仓库详情失败');
    } finally {
      setLoadingDetails(false);
    }
  };

  // 加载仓库分支列表：先从缓存读取（快速显示），同时异步刷新（获取最新分支）。
  const loadBranches = async (repoId: string) => {
    if (!repoId) return;
    setLoadingBranches(true);
    try {
      // 第一步：从缓存读取分支（后端不触发 git fetch，毫秒级响应）。
      const cached = await api.get<BranchInfoDTO[]>(
        `/v1/workspaces/${workspaceId}/repositories/${repoId}/branches`
      );
      setBranches(cached);
      if (cached.length > 0 && !selectedBranch) {
        const current = cached.find(b => b.isCurrent) || cached[0];
        setSelectedBranch(current.name);
      }
    } catch {
      toast.error('加载分支列表失败');
    } finally {
      setLoadingBranches(false);
    }

    // 第二步：异步从 git 远端刷新分支（触发 git fetch），刷新完成前按钮显示旋转动效。
    setRefreshingBranches(true);
    try {
      const fresh = await repositoryApi.refreshBranches(workspaceId, repoId);
      setBranches(fresh);
      if (fresh.length > 0 && !selectedBranch) {
        const current = fresh.find(b => b.isCurrent) || fresh[0];
        setSelectedBranch(current.name);
      }
    } catch {
      // 刷新失败时静默处理，已展示缓存数据。
      console.error('[ProjectCode] refresh branches failed');
    } finally {
      setRefreshingBranches(false);
    }
  };

  // 同时刷新仓库详情与分支（合并刷新功能）
  const refreshRepoData = async (repoId: string) => {
    if (!repoId) return;
    await Promise.all([
      loadRepositoryDetails(repoId),
      loadBranches(repoId),
    ]);
  };

  // 扫描本地仓库
  const handleScanRepositories = async () => {
    setLoadingScan(true);
    try {
      // Scan and auto-import to DB
      await api.get<ScannedRepositoryDTO[]>(
        `/v1/workspaces/${workspaceId}/repositories/scan`
      );

      // Refresh repo list after scan
      const repos = await api.get<RepositoryDTO[]>(
        `/v1/workspaces/${workspaceId}/repositories`
      );
      setRepositories(repos);

      // Auto-select first repo and load branches
      if (repos.length > 0) {
        const first = repos.find(r => r.type === 'dev') ?? repos[0];
        setSelectedRepoId(first.id);
        setSelectedBranch(first.defaultBranch ?? '');
        setRepoType(first.type as 'dev' | 'case');
        loadBranches(first.id);
      }

      toast.success(`扫描完成，共 ${repos.length} 个仓库`);
    } catch {
      toast.error('扫描仓库失败');
    } finally {
      setLoadingScan(false);
    }
  };

  // 仓库或分支切换时加载文件树
  useEffect(() => {
    if (!selectedRepoId || !selectedBranch) return;
    setLoadingTree(true);
    api.get<FileNodeDTO[]>(`/v1/workspaces/${workspaceId}/repositories/${selectedRepoId}/tree?branch=${encodeURIComponent(selectedBranch)}`)
      .then(nodes => {
        setFileSystem(prev => ({ ...prev, [selectedRepoId]: dtoToFileNodes(nodes) }));
      })
      .catch(() => toast.error('加载文件树失败'))
      .finally(() => setLoadingTree(false));
  }, [selectedRepoId, selectedBranch, workspaceId]);

  const dtoToFileNodes = (nodes: FileNodeDTO[]): FileNode[] =>
    nodes.map(n => ({
      name: n.name,
      path: n.path,
      type: n.type,
      children: n.children ? dtoToFileNodes(n.children) : undefined,
    }));

  const filteredToc = useMemo(() => {
    if (!tocSearchQuery.trim()) return toc;
    const lowerQuery = tocSearchQuery.toLowerCase();
    return toc.filter(item => item.title.toLowerCase().includes(lowerQuery));
  }, [toc, tocSearchQuery]);

  const currentFileSystem = fileSystem[selectedRepoId] || [];
  const currentRepo = repositories.find(r => r.id === selectedRepoId);
  const filteredRepos = useMemo(() => repositories.filter(r => r.type === repoType), [repositories, repoType]);

  // 根据当前仓库文件树自动检测是否为前端项目，用于控制预览模式是否展示。
  const isFrontendProject = useMemo(
    () => detectFrontendProject(currentFileSystem),
    [currentFileSystem]
  );

  // 当检测到当前仓库为非前端项目时，若当前处于预览模式则自动切换到代码模式。
  useEffect(() => {
    console.log('[ProjectCode] frontend detect effect', { repoType, isFrontendProject, viewMode });
    if (repoType === 'dev' && isFrontendProject === false && viewMode === 'preview') {
      console.log('[ProjectCode] auto switch preview -> code');
      setViewMode('code');
    }
  }, [repoType, isFrontendProject, viewMode]);

  // Filter file tree based on search query
  const filterFileTree = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query) return nodes;

    const lowerQuery = query.toLowerCase();
    const result: FileNode[] = [];

    for (const node of nodes) {
      if (node.type === 'file') {
        if (node.name.toLowerCase().includes(lowerQuery)) {
          result.push(node);
        }
      } else if (node.type === 'folder' && node.children) {
        if (node.name.toLowerCase().includes(lowerQuery)) {
          result.push(node);
        } else {
          const filteredChildren = filterFileTree(node.children, query);
          if (filteredChildren.length > 0) {
            result.push({ ...node, children: filteredChildren });
          }
        }
      }
    }
    return result;
  };

  const filteredFileSystem = useMemo(() => filterFileTree(currentFileSystem, searchQuery), [currentFileSystem, searchQuery]);

  const handleRepoChange = (val: string) => {
    setSelectedRepoId(val);
    const repo = repositories.find(r => r.id === val);
    if (repo) {
      setSelectedBranch(repo.defaultBranch ?? '');
      setRepoType(repo.type as 'dev' | 'case');
      if (repo.type === 'case' && viewMode === 'preview') setViewMode('doc');
      loadRepositoryDetails(val);
      loadBranches(val);
    }
    setOpenFiles([]);
    setActiveFile(null);
    setSearchQuery('');
  };

  const handleBranchChange = async (val: string) => {
    if (val === selectedBranch) return;
    
    setSwitchingBranch(true);
    try {
      await api.post(`/v1/workspaces/${workspaceId}/repositories/${selectedRepoId}/switch-branch`, {
        branch: val,
      });
      setSelectedBranch(val);
      setOpenFiles([]);
      setActiveFile(null);
      setSearchQuery('');
      toast.success(`已切换到分支: ${val}`);
    } catch {
      toast.error('切换分支失败');
    } finally {
      setSwitchingBranch(false);
    }
  };

  const handleSelectFile = async (node: FileNode) => {
    if (node.type !== 'file') return;

    let fileNode = node;
    if (!node.content && selectedRepoId && selectedBranch) {
      try {
        const content = await api.get<FileContentDTO>(
          `/v1/workspaces/${workspaceId}/repositories/${selectedRepoId}/content?branch=${encodeURIComponent(selectedBranch)}&path=${encodeURIComponent(node.path)}`
        );
        fileNode = { ...node, content: content.content };
        setFileSystem(prev => ({
          ...prev,
          [selectedRepoId]: updateNodeContent(prev[selectedRepoId] || [], node.path, content.content),
        }));
      } catch {
        toast.error('加载文件内容失败');
        return;
      }
    }

    let newOpenFiles = [...openFiles];
    const existingIndex = newOpenFiles.findIndex(f => f.path === fileNode.path);

    if (existingIndex === -1) {
      newOpenFiles.push(fileNode);
      if (newOpenFiles.length > 8) {
        newOpenFiles.shift();
      }
      setOpenFiles(newOpenFiles);
    } else {
      newOpenFiles[existingIndex] = fileNode;
      setOpenFiles(newOpenFiles);
    }
    setActiveFile(fileNode);
    setViewMode('code');
  };

  const handleCloseTab = (e: React.MouseEvent, node: FileNode) => {
    e.stopPropagation();
    const newOpenFiles = openFiles.filter(f => f.path !== node.path);
    setOpenFiles(newOpenFiles);

    if (activeFile?.path === node.path) {
      setActiveFile(newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null);
    }
  };

  // Recursively update file content in the tree
  const updateNodeContent = (nodes: FileNode[], targetPath: string, newContent: string): FileNode[] => {
    return nodes.map(node => {
      if (node.type === 'file' && node.path === targetPath) {
        return { ...node, content: newContent };
      }
      if (node.type === 'folder' && node.children) {
        return { ...node, children: updateNodeContent(node.children, targetPath, newContent) };
      }
      return node;
    });
  };

  const handleUpdateFileContent = (newContent: string) => {
    if (!activeFile) return;
    setFileSystem(prev => ({
      ...prev,
      [selectedRepoId]: updateNodeContent(prev[selectedRepoId] || [], activeFile.path, newContent),
    }));
    setActiveFile(prev => prev ? { ...prev, content: newContent } : prev);
    setOpenFiles(prev => prev.map(f => f.path === activeFile.path ? { ...f, content: newContent } : f));
  };

  const handleSaveFileContent = async (newContent: string) => {
    if (!activeFile || !selectedRepoId) return;
    try {
      await api.post(`/v1/workspaces/${workspaceId}/repositories/${selectedRepoId}/save`, {
        path: activeFile.path,
        content: newContent,
      });
      handleUpdateFileContent(newContent);
      toast.success('文件已保存');
    } catch (err) {
      toast.error('保存失败');
    }
  };

  const handleTocClick = (id: string) => {
    setActiveTocId(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const tabs = [
    { key: 'code' as const, label: '代码模式', icon: FileCode },
    { key: 'review' as const, label: '评审模式', icon: ShieldCheck },
    { key: 'preview' as const, label: '预览模式', icon: Eye },
    { key: 'details' as const, label: '仓库详情', icon: Activity },
  ];

  // 同步检测阶段：转菊花
  if (syncChecking) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">正在检测仓库同步状态...</p>
      </div>
    );
  }

  // 无配置仓库
  if (userRepoStatuses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] gap-4">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">请先在设置中配置代码仓库</p>
      </div>
    );
  }

  // 有配置仓库但未同步
  const hasSyncedRepo = userRepoStatuses.some(s => s.synced);
  if (!hasSyncedRepo) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] gap-4">
        <AlertCircle className="h-8 w-8 text-amber-500" />
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">检测到以下仓库尚未同步到您的工程目录</p>
          <p className="text-xs text-muted-foreground">同步后即可浏览代码</p>
        </div>
        <div className="space-y-2 w-full max-w-md">
          {userRepoStatuses.map(repo => {
            const isSyncing = syncingRepoId === repo.repositoryId || repo.syncStatus === 'syncing';
            const progress = repo.progress ?? 0;
            return (
            <div key={repo.repositoryId} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{repo.name}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleSyncRepo(repo.repositoryId)}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{progress > 0 ? `同步中 ${progress}%` : '同步中'}</>
                ) : (
                  <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />同步</>
                )}
              </Button>
            </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px] gap-4 w-full pb-8">
      {/* Top Header - Repository Selection (Level-1 Aurora tabs) */}
      <div className="aurora-tab-bar level-1">
        <Select value={repoType} onValueChange={(val: 'dev' | 'case') => {
          setRepoType(val);
          const nextRepos = repositories.filter(r => r.type === val);
          if (nextRepos.length > 0) {
            const first = nextRepos[0];
            setSelectedRepoId(first.id);
            setSelectedBranch(first.defaultBranch ?? '');
            loadRepositoryDetails(first.id);
            loadBranches(first.id);
          } else {
            setSelectedRepoId('');
            setSelectedBranch('');
            setBranches([]);
            setRepoDetails(null);
          }
          if (val === 'case' && viewMode === 'preview') {
            setViewMode('code');
          }
        }}>
          <SelectTrigger className="aurora-tab-select-trigger aurora-tab-item level-1 !w-[140px] shrink-0">
            <span className="aurora-tab-label">仓库:</span>
            <SelectValue className="flex-1 min-w-0" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="dev">开发库</SelectItem>
            <SelectItem value="case">用例库</SelectItem>
          </SelectContent>
        </Select>

        <div className="aurora-tab-divider" />

        <Select value={selectedRepoId} onValueChange={handleRepoChange} disabled={filteredRepos.length === 0}>
          <SelectTrigger className="aurora-tab-select-trigger aurora-tab-item level-1 !w-[220px] shrink-0">
            <Book className="h-4 w-4 text-primary shrink-0" />
            <SelectValue placeholder="选择仓库" className="flex-1 min-w-0">
              {currentRepo ? <span className="truncate">{currentRepo.name}</span> : <span className="text-muted-foreground">选择仓库</span>}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {filteredRepos.map(repo => (
              <SelectItem key={repo.id} value={repo.id} textValue={repo.name}>
                <div className="flex items-center">
                  <Book className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span className="truncate">{repo.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="aurora-tab-divider" />

        <Select value={selectedBranch} onValueChange={handleBranchChange} disabled={switchingBranch || branches.length === 0 || !selectedRepoId}>
          <SelectTrigger className="aurora-tab-select-trigger aurora-tab-item level-1 !w-[200px] shrink-0">
            <GitBranch className="h-4 w-4 text-success shrink-0" />
            <SelectValue placeholder="选择分支" className="flex-1 min-w-0">
              {selectedBranch ? <span className="truncate">{selectedBranch}</span> : <span className="text-muted-foreground">选择分支</span>}
            </SelectValue>
            {branches.find(b => b.name === selectedBranch)?.isCurrent && (
              <span className="aurora-tab-badge">当前</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch.name} value={branch.name} textValue={branch.name}>
                <div className="flex items-center gap-2">
                  <GitBranch className={`h-4 w-4 ${branch.isCurrent ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="truncate">{branch.name}</span>
                  {branch.isRemote && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">远程</span>
                  )}
                  {branch.isCurrent && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary">当前</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {switchingBranch && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleScanRepositories}
          disabled={loadingScan}
          className="aurora-tab-icon-btn"
          title="刷新本地仓库"
        >
          {loadingScan ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {/* View Mode Tabs (Level-2 Aurora tabs) */}
      <div className="flex items-center w-full justify-between gap-2 self-start flex-wrap">
        <div className="aurora-tab-bar level-2">
          {tabs.map(tab => {
            if (tab.key === 'preview' && (repoType === 'case' || isFrontendProject === false)) return null;
            const Icon = tab.icon;
            const isActive = viewMode === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setViewMode(tab.key);
                  if (tab.key === 'details' && selectedRepoId) {
                    refreshRepoData(selectedRepoId);
                  }
                }}
                className={`aurora-tab-item level-2 ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
        
        {repoType === 'case' && (
          <Button size="sm" variant="default" className="shadow-sm" onClick={() => {
            toast.success('开始执行部署');
            const event = new CustomEvent('open-terminal-deploy');
            window.dispatchEvent(event);
          }}>
            <Terminal className="h-4 w-4 mr-1.5" />
            一键执行
          </Button>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden rounded-xl border border-border/15 bg-panel flex flex-col relative">
        {viewMode === 'code' && (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left Panel - File Tree */}
            <ResizablePanel defaultSize={20} minSize={15} maxSize={40} className="bg-panel">
              <div className="h-full flex flex-col">
                <div className="p-3 border-b border-border/15 bg-panel flex flex-col gap-2 shrink-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">资源管理器</span>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="搜索文件..."
                      className="h-8 pl-8 pr-8 text-xs bg-muted/50 border-border/30 text-foreground placeholder:text-muted-foreground"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setSearchQuery('')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <ScrollArea className="flex-1 p-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 px-2 py-1.5 mb-1 font-medium text-sm text-foreground">
                      <Folder className="h-4 w-4 text-warning shrink-0" />
                      <span className="truncate">{currentRepo?.name}</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 pb-2 mb-2 border-b border-border/15 text-xs text-muted-foreground">
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedBranch}</span>
                    </div>
                    {filteredFileSystem.map((node, idx) => (
                      <FileTreeItem
                        key={`${node.name}-${idx}`}
                        node={node}
                        onSelectFile={handleSelectFile}
                        selectedFile={activeFile}
                        forceOpen={!!searchQuery}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right Panel - Code Viewer */}
            <ResizablePanel defaultSize={80}>
              <div className="h-full flex flex-col bg-background">
                {openFiles.length > 0 ? (
                  <>
                    <div className="flex items-center h-10 border-b border-border/15 bg-panel shrink-0 overflow-x-auto whitespace-nowrap scrollbar-none">
                      {openFiles.map((file, idx) => (
                        <div
                          key={`${file.name}-${idx}`}
                          className={`flex items-center gap-2 h-full px-4 border-r border-border/15 cursor-pointer transition-colors duration-150 ${
                            activeFile === file
                              ? 'bg-background border-b-2 border-b-primary text-foreground'
                              : 'text-muted-foreground hover:bg-accent border-b-2 border-b-transparent'
                          }`}
                          onClick={() => setActiveFile(file)}
                        >
                          <File className="h-3.5 w-3.5" />
                          <span className="text-sm font-medium">{file.name}</span>
                          <button
                            className="p-0.5 rounded-sm ml-1 text-muted-foreground hover:text-foreground hover:bg-muted opacity-70 hover:opacity-100 transition-colors"
                            onClick={(e) => handleCloseTab(e, file)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Breadcrumb path navigation */}
                    {activeFile && (
                      <div className="flex items-center h-8 px-4 border-b border-border/15 bg-panel shrink-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          {activeFile.path.split('/').map((segment, idx, arr) => (
                            <React.Fragment key={idx}>
                              <button
                                className={`hover:text-foreground transition-colors ${
                                  idx === arr.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'
                                }`}
                              >
                                {segment}
                              </button>
                              {idx < arr.length - 1 && (
                                <ChevronRight className="w-3 h-3 text-muted-foreground/60" />
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeFile && (
                      <ScrollArea className="flex-1">
                        <div className="h-full">
                          <CodeBlock
                            content={activeFile.content || ''}
                            filename={activeFile.name}
                            editable
                            variant="editor"
                            onChange={handleUpdateFileContent}
                            onSave={handleSaveFileContent}
                            viewMode={codeViewMode}
                            onViewModeChange={setCodeViewMode}
                            onThemeChange={setCodeDarkMode}
                            darkMode={codeDarkMode}
                          />
                        </div>
                      </ScrollArea>
                    )}
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                    <Code2 className="h-12 w-12 mb-4 opacity-20" />
                    <p>在左侧选择一个文件进行查看</p>
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {viewMode === 'graph' && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
            <div className="w-full max-w-3xl text-center">
              <Share2 className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <h3 className="text-lg font-semibold text-foreground mb-2">代码关系图谱</h3>
              <p className="text-sm mb-6 max-w-md mx-auto">可视化展示代码模块间的依赖关系、调用链路和架构层级。该功能将由 CodeGraph 引擎驱动。</p>
            </div>
          </div>
        )}

        {viewMode === 'review' && (() => {
          const selectedRepo = repositories.find(r => r.id === selectedRepoId);
          return (
            <ReviewPanel
              repoPath={reviewRepoPath || selectedRepo?.localPath}
              repoName={selectedRepo?.name}
              repoId={selectedRepoId}
              branch={selectedBranch}
            />
          );
        })()}

        {viewMode === 'doc' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">文档模式</span>
                <span className="text-xs text-muted-foreground">前端工程架构文档</span>
              </div>
              <DocGenButton />
            </div>
            <ResizablePanelGroup direction="horizontal" className="flex-1">
              <ResizablePanel defaultSize={22} minSize={18} maxSize={35} className="bg-muted/10 border-r border-border/50">
                <div className="h-full flex flex-col">
                  <div className="p-3 border-b border-border/50 bg-muted/20 shrink-0 flex flex-col gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">文档目录</span>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="搜索目录..."
                        value={tocSearchQuery}
                        onChange={(e) => setTocSearchQuery(e.target.value)}
                        className="h-7 pl-7 text-xs"
                      />
                    </div>
                  </div>
                  <ScrollArea className="flex-1 p-3">
                    <div className="flex flex-col gap-1">
                      {filteredToc.length > 0 ? (
                        filteredToc.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => handleTocClick(item.id)}
                            className={`text-left text-sm py-1.5 px-2 rounded-md transition-colors ${
                              item.level === 2 ? 'font-medium text-foreground' : 'text-muted-foreground pl-5'
                            } ${activeTocId === item.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`}
                          >
                            {item.title}
                          </button>
                        ))
                      ) : (
                        <div className="text-center text-xs text-muted-foreground py-4">未找到匹配的目录</div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={78}>
                <ScrollArea className="h-full">
                  <div className="p-6 md:p-10 max-w-3xl">
                    <div className="mb-8 pb-6 border-b border-border/50">
                      <h1 className="text-2xl md:text-3xl font-bold text-foreground">前端工程架构文档</h1>
                      <p className="text-sm text-muted-foreground mt-2">版本 2.0 · 最后更新 2024-12</p>
                    </div>
                    <MarkdownRenderer content={projectDoc} />
                  </div>
                </ScrollArea>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}

        {viewMode === 'preview' && (
          <div className="h-full flex flex-col">
            {/* preview branch render debug removed */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">预览模式</span>
                <span className="text-xs text-muted-foreground">效果预览 · {currentRepo?.name} / {selectedBranch}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => toast.success('已刷新预览')}>
                <RefreshCw className="h-3.5 w-3.5" />
                刷新预览
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              {currentRepo?.localPath ? (
                <LivePreview projectPath={currentRepo.localPath} previewOnly />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  仓库尚未克隆，无法预览
                </div>
              )}
            </div>
          </div>
        )}

        {viewMode === 'details' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">{currentRepo?.name} 仓库总览</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => selectedRepoId && refreshRepoData(selectedRepoId)} disabled={loadingDetails || refreshingBranches}>
                {loadingDetails || refreshingBranches ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                刷新
              </Button>
            </div>
            <ScrollArea className="flex-1 p-6">
              <div className="space-y-6">
                {loadingDetails ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : repoDetails ? (
                  <>
                    {/* 顶部基础信息 */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">主语言: </span>
                        <span className="font-medium">{repoDetails.language || '未知'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">仓库大小: </span>
                        <span className="font-medium">{(repoDetails.sizeBytes / 1024).toFixed(2)}KB</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">克隆状态: </span>
                        <span className={
                          repoDetails.repository.cloneStatus === 'cloned'
                            ? 'font-medium text-emerald-600 dark:text-emerald-400'
                            : repoDetails.repository.cloneStatus === 'failed'
                            ? 'font-medium text-destructive'
                            : 'font-medium text-muted-foreground'
                        }>
                          {repoDetails.repository.cloneStatus === 'cloned'
                            ? '已克隆'
                            : repoDetails.repository.cloneStatus === 'cloning'
                            ? '克隆中'
                            : repoDetails.repository.cloneStatus === 'failed'
                            ? '失败'
                            : '待处理'}
                        </span>
                      </div>
                    </div>

                    {/* 统计卡片 */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-foreground">{repoDetails.commitStats.totalCommits}</p>
                          <p className="text-xs text-muted-foreground mt-1">总提交</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{repoDetails.branches.length}</p>
                          <p className="text-xs text-muted-foreground mt-1">分支</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                            {repoDetails.effectiveLinesOfCode.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">代码行</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{repoDetails.fileCount}</p>
                          <p className="text-xs text-muted-foreground mt-1">文件</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{repoDetails.commitStats.lastWeek}</p>
                          <p className="text-xs text-muted-foreground mt-1">本周</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{repoDetails.commitStats.lastMonth}</p>
                          <p className="text-xs text-muted-foreground mt-1">本月</p>
                        </CardContent>
                      </Card>
                    </div>

                    {/* 语言分布 */}
                    {repoDetails.languageStats.length > 0 && (
                      <Card className="p-5">
                        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                          <Code className="h-4 w-4 text-primary" />
                          语言分布
                        </h3>
                        <div className="space-y-3">
                          {repoDetails.languageStats.slice(0, 4).map((lang, idx) => (
                            <div key={idx}>
                              <div className="flex items-center justify-between text-sm mb-1">
                                <span className="font-medium">{lang.name}</span>
                                <span className="text-muted-foreground">
                                  {lang.percentage.toFixed(1)}% · {lang.files}
                                </span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${lang.percentage}%`, backgroundColor: lang.color || 'hsl(var(--primary))' }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        {repoDetails.languageStats.length > 4 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {repoDetails.languageStats.slice(4).map((lang, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground"
                              >
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: lang.color || 'hsl(var(--primary))' }} />
                                {lang.name} {lang.percentage.toFixed(1)}% · {lang.files}
                              </span>
                            ))}
                          </div>
                        )}
                      </Card>
                    )}

                    {/* 分支信息 + 贡献者分布 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Card className="p-5">
                        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                          <GitBranch className="h-4 w-4 text-primary" />
                          分支信息
                        </h3>
                        <div className="space-y-3">
                          {repoDetails.branches.map((branch, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{branch.name}</span>
                                {branch.isCurrent && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">当前</span>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">最后提交: {branch.lastCommit.substring(0, 7)}</span>
                            </div>
                          ))}
                        </div>
                      </Card>

                      {repoDetails.committerStats.length > 0 && (
                        <Card className="p-5">
                          <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary" />
                            贡献者分布
                          </h3>
                          <div className="space-y-4">
                            {repoDetails.committerStats.slice(0, 5).map((c, idx) => {
                              const total = repoDetails.commitStats.totalCommits || 1;
                              const initial = (c.name || c.email || '?').charAt(0).toUpperCase();
                              return (
                                <div key={idx} className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
                                    {initial}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="font-medium truncate">{c.name || c.email}</span>
                                      <span className="text-muted-foreground whitespace-nowrap ml-2">
                                        {c.commits}次 · {((c.commits / total) * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">贡献</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </Card>
                      )}
                    </div>

                    {/* 近 7 日提交趋势 */}
                    {repoDetails.weeklyCommits.length > 0 && (
                      <Card className="p-5">
                        <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-primary" />
                          近7日提交趋势
                        </h3>
                        <div className="h-64 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={repoDetails.weeklyCommits}>
                              <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} />
                              <YAxis allowDecimals={false} />
                              <Tooltip />
                              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                {repoDetails.weeklyCommits.map((_, idx) => (
                                  <Cell key={idx} fill="hsl(var(--primary))" />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    请选择一个仓库查看详情
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
        <TerminalDrawer />
      </div>
    </div>
  );
};

const TerminalDrawer = () => {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  
  useEffect(() => {
    const handleOpen = () => {
      setOpen(true);
      setLines([]);
      
      const commands = [
        { text: '$ ssh deploy@prod-server.company.com', color: 'text-zinc-500', delay: 100 },
        { text: '$ cd /opt/app/services', color: 'text-zinc-300', delay: 400 },
        { text: '$ git pull origin main', color: 'text-zinc-300', delay: 800 },
        { text: 'From https://gitlab.com/org/repo\n * branch            main       -> FETCH_HEAD\nAlready up to date.', color: 'text-zinc-400', delay: 1500 },
        { text: '$ docker-compose down', color: 'text-zinc-300', delay: 1800 },
        { text: 'Stopping app-service ... done\nRemoving app-service ... done', color: 'text-zinc-400', delay: 2500 },
        { text: '$ docker-compose up -d --build', color: 'text-zinc-300', delay: 3000 },
        { text: 'Building app-service\n[+] Building 10.5s (14/14) FINISHED\nCreating app-service ... done', color: 'text-zinc-400', delay: 4500 },
        { text: '$ sleep 5 && curl -s http://localhost:8080/health', color: 'text-zinc-500', delay: 4800 },
        { text: '{ "status": "ok", "version": "v2.4.1" }', color: 'text-green-400', delay: 5500 },
        { text: '$ echo "部署完成于 $(date)"', color: 'text-zinc-300', delay: 5800 },
        { text: `部署完成于 ${new Date().toString()}`, color: 'text-green-400', delay: 6000 },
      ];

      let timeoutIds: ReturnType<typeof setTimeout>[] = [];
      
      commands.forEach((cmd) => {
        const id = setTimeout(() => {
          setLines(prev => [...prev, `<span class="${cmd.color}">${cmd.text.replace(/\n/g, '<br/>')}</span>`]);
        }, cmd.delay);
        timeoutIds.push(id);
      });

      return () => {
        timeoutIds.forEach(clearTimeout);
      };
    };
    window.addEventListener('open-terminal-deploy', handleOpen);
    return () => window.removeEventListener('open-terminal-deploy', handleOpen);
  }, []);

  if (!open) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-64 bg-black text-zinc-50 font-mono text-xs p-4 overflow-y-auto border-t border-zinc-800 soft-shadow z-50 animate-in slide-in-from-bottom-full duration-300 transition-all rounded-t-xl">
      <div className="flex items-center justify-between mb-3 sticky top-0 bg-black pb-2 border-b border-zinc-800 z-10">
        <div className="flex items-center text-zinc-400">
          <Terminal className="w-4 h-4 mr-2" />
          部署终端
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-zinc-500 hover:text-white hover:bg-zinc-800"
          onClick={() => setOpen(false)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="space-y-1.5 opacity-90 pb-4">
        {lines.map((line, idx) => (
          <p key={idx} dangerouslySetInnerHTML={{ __html: line }} />
        ))}
        <span className="inline-block w-2 h-3.5 bg-zinc-400 animate-pulse ml-1 align-middle"></span>
      </div>
    </div>
  );
};
