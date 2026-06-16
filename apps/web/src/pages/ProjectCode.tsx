import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Folder, File, ChevronRight, ChevronDown, GitBranch, Code2, Book, Search, X, Share2, FileText, Activity, FileCode, Eye, ShieldCheck, Sparkles, RefreshCw, Loader2, Braces, Globe, Palette, Terminal, Settings, Image, FileJson, FileType, FileCode2, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { RepositoryDTO, FileNodeDTO, FileContentDTO } from '@/lib/api-types';
import { CodeBlock } from '@/components/CodeBlock';

// 文件树节点类型（与后端 FileNodeDTO 对齐，增加本地缓存的 content）。
type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
};

// Mock markdown document
const mockMarkdownDoc = `# 前端工程架构文档

## 项目概述

本项目采用 **React 18 + TypeScript + Tailwind CSS** 技术栈，旨在构建高性能、可维护的企业级前端应用。

### 核心特性

- 组件化架构设计，支持原子设计模式
- 完整的 TypeScript 类型安全
- 响应式布局，适配多端设备
- 暗黑模式支持
- 模块化路由管理

## 目录结构

\`\`\`
frontend-web/
├── src/
│   ├── components/     # 通用组件库
│   ├── pages/          # 页面级组件
│   ├── hooks/           # 自定义 Hooks
│   ├── utils/           # 工具函数
│   └── styles/          # 全局样式
├── public/              # 静态资源
└── package.json         # 依赖管理
\`\`\`

## 开发规范

### 代码风格

1. 使用 **ESLint + Prettier** 统一代码格式
2. 组件命名采用 PascalCase
3.  hooks 命名以 \`use\` 开头
4. 常量使用全大写 + 下划线

### Git 提交规范

| 类型 | 说明 |
|------|------|
| feat | 新功能 |
| fix | 修复问题 |
| docs | 文档更新 |
| refactor | 代码重构 |
| test | 测试相关 |

## API 集成

### 请求封装

\`\`\`typescript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.VITE_API_URL,
  timeout: 10000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = \`Bearer \${token}\`;
  }
  return config;
});
\`\`\`

## 性能优化

### 1. 代码分割

使用 React.lazy 和 Suspense 实现按需加载：

\`\`\`tsx
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
\`\`\`

### 2. 状态管理

采用 React Context + useReducer 进行局部状态管理：

- 避免不必要的全局状态
- 使用 useMemo 缓存计算结果
- 使用 useCallback 稳定回调引用

### 3. 渲染优化

- 虚拟滚动处理长列表
- 图片懒加载
- CSS 动画优先于 JS 动画

## 部署流程

1. **构建**: \`pnpm run build\`
2. **测试**: \`pnpm run test\`
3. **部署**: 使用 CI/CD 流水线自动部署到生产环境

## 常见问题

### 环境变量未生效

确保以 \`VITE_\` 开头，并在 \`.env\` 文件中正确配置。

### 热更新失败

检查 Vite 配置中的 \`server.hmr\` 设置。

---

*本文档最后更新于 2024 年 12 月*`;

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
        className={`flex items-center gap-1.5 py-1.5 px-2 cursor-pointer hover:bg-accent hover:text-accent-foreground text-sm rounded-md transition-colors ${isSelected ? 'bg-primary/10 text-primary font-medium' : 'text-foreground'}`}
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
  const defaultUrl = previewUrl || 'https://example.com';
  const [inputUrl, setInputUrl] = useState(defaultUrl);
  const [loadedUrl, setLoadedUrl] = useState(defaultUrl);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [viewScale, setViewScale] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // Update URL when repo changes
  React.useEffect(() => {
    const url = previewUrl || 'https://example.com';
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

// ─── Mock review data ───
interface ReviewIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  line: number;
  message: string;
  suggestion: string;
  file: string;
}

const MOCK_REVIEW_ISSUES: ReviewIssue[] = [
  { id: 'R1', severity: 'critical', line: 42, message: '存在SQL注入风险，未对用户输入进行参数化处理', suggestion: '使用预处理语句或ORM框架的查询构建器，避免直接拼接SQL。', file: 'pkg/handler.go' },
  { id: 'R2', severity: 'high', line: 18, message: '未对密码进行加密存储', suggestion: '使用bcrypt等哈希算法对密码进行单向加密存储。', file: 'cmd/auth.go' },
  { id: 'R3', severity: 'medium', line: 88, message: '缺少错误日志记录', suggestion: '在捕获错误后添加日志记录，便于后续排查问题。', file: 'pkg/middleware.go' },
  { id: 'R4', severity: 'medium', line: 55, message: '硬编码了API密钥', suggestion: '将敏感配置移至环境变量或配置中心管理。', file: 'config/api.go' },
  { id: 'R5', severity: 'low', line: 12, message: '缺少函数注释', suggestion: '为导出函数添加godoc注释，说明函数用途和参数含义。', file: 'pkg/handler.go' },
];

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};
const SEVERITY_LABEL: Record<string, string> = {
  critical: '致命', high: '严重', medium: '一般', low: '轻微',
};

// ─── Review Panel ───
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

const PreviewEffectToolbar: React.FC = () => {
  const [effect, setEffect] = useState<'none' | 'blur' | 'dark' | 'zoom'>('none');
  return (
    <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-lg">
      {([
        { key: 'none' as const, label: '正常' },
        { key: 'blur' as const, label: '模糊' },
        { key: 'dark' as const, label: '暗色' },
        { key: 'zoom' as const, label: '放大' },
      ]).map(e => (
        <button
          key={e.key}
          onClick={() => setEffect(e.key)}
          className={`px-2 py-1 rounded-md text-xs transition-all ${effect === e.key ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {e.label}
        </button>
      ))}
    </div>
  );
};

const ReviewPanel: React.FC = () => {
  const [reviewing, setReviewing] = useState(false);
  const [issues, setIssues] = useState<ReviewIssue[]>(MOCK_REVIEW_ISSUES);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const startReview = () => {
    setReviewing(true);
    setTimeout(() => {
      setReviewing(false);
      setIssues(prev => {
        // simulate a new issue being found
        if (prev.length <= MOCK_REVIEW_ISSUES.length) {
          return [
            ...prev,
            { id: `R${prev.length + 1}`, severity: 'low', line: 30, message: '检测到未使用的导入包', suggestion: '移除未使用的 import 语句，保持代码整洁。', file: 'cmd/main.go' }
          ];
        }
        return prev;
      });
    }, 2000);
  };

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
          <span className="text-xs text-muted-foreground">({issues.length} 个问题)</span>
        </div>
        <Button size="sm" onClick={startReview} disabled={reviewing} className="h-7 text-xs gap-1.5">
          {reviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {reviewing ? '评审中...' : '智能评审'}
        </Button>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* 总览 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
              <p className="text-lg font-bold text-foreground">{issues.length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">总问题数</p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{issues.filter(i => i.severity === 'critical' || i.severity === 'high').length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">严重/致命</p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{issues.filter(i => i.severity === 'medium').length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">一般问题</p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-3 text-center">
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{issues.filter(i => i.severity === 'low').length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">轻微问题</p>
            </div>
          </div>

          {/* 问题列表 */}
          {issues.map(issue => (
            <div key={issue.id} className="rounded-xl border border-border/50 bg-card p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${SEVERITY_BADGE[issue.severity]}`}>
                  {SEVERITY_LABEL[issue.severity]}
                </span>
                <span className="text-xs text-muted-foreground">{issue.file} · 第 {issue.line} 行</span>
                <button
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                  onClick={() => toggleExpand(issue.id)}
                >
                  {expanded.has(issue.id) ? '收起' : '展开'}
                  <ChevronDown className={`h-3 w-3 transition-transform ${expanded.has(issue.id) ? 'rotate-180' : ''}`} />
                </button>
              </div>
              <p className="text-sm font-medium text-foreground mb-1">{issue.message}</p>
              {expanded.has(issue.id) && (
                <div className="mt-2 p-2.5 rounded-lg bg-muted/30 text-xs text-foreground leading-relaxed border border-border/30">
                  <span className="font-semibold text-muted-foreground">建议：</span>{issue.suggestion}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

export const ProjectCode: React.FC = () => {
  const [repositories, setRepositories] = useState<RepositoryDTO[]>([]);
  const [fileSystem, setFileSystem] = useState<Record<string, FileNode[]>>({});
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [repoType, setRepoType] = useState<'dev' | 'case' | 'product'>('dev');
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);

  // Tabs management
  const [openFiles, setOpenFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // View mode tabs
  const [viewMode, setViewMode] = useState<'code' | 'graph' | 'review' | 'doc' | 'preview'>('code');

  // Document TOC
  const toc = useMemo(() => extractToc(mockMarkdownDoc), []);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const [tocSearchQuery, setTocSearchQuery] = useState('');

  // 加载仓库列表
  useEffect(() => {
    setLoadingRepos(true);
    api.get<RepositoryDTO[]>('/v1/repositories')
      .then(repos => {
        setRepositories(repos);
        if (repos.length > 0) {
          const first = repos.find(r => r.type === 'dev') ?? repos[0];
          setSelectedRepoId(first.id);
          setSelectedBranch(first.defaultBranch ?? '');
          setRepoType(first.type as 'dev' | 'case' | 'product');
        }
      })
      .catch(() => toast.error('加载仓库列表失败'))
      .finally(() => setLoadingRepos(false));
  }, []);

  // 仓库或分支切换时加载文件树
  useEffect(() => {
    if (!selectedRepoId || !selectedBranch) return;
    setLoadingTree(true);
    api.get<FileNodeDTO[]>(`/v1/repositories/${selectedRepoId}/tree?branch=${encodeURIComponent(selectedBranch)}`)
      .then(nodes => {
        setFileSystem(prev => ({ ...prev, [selectedRepoId]: dtoToFileNodes(nodes) }));
      })
      .catch(() => toast.error('加载文件树失败'))
      .finally(() => setLoadingTree(false));
  }, [selectedRepoId, selectedBranch]);

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
      setRepoType(repo.type as 'dev' | 'case' | 'product');
      if (repo.type === 'product' && viewMode !== 'doc') setViewMode('doc');
      if (repo.type === 'case' && viewMode === 'preview') setViewMode('doc');
    }
    setOpenFiles([]);
    setActiveFile(null);
    setSearchQuery('');
  };

  const handleBranchChange = (val: string) => {
    setSelectedBranch(val);
    setOpenFiles([]);
    setActiveFile(null);
    setSearchQuery('');
  };

  const handleSelectFile = async (node: FileNode) => {
    if (node.type !== 'file') return;

    let fileNode = node;
    if (!node.content && selectedRepoId && selectedBranch) {
      try {
        const content = await api.get<FileContentDTO>(
          `/v1/repositories/${selectedRepoId}/content?branch=${encodeURIComponent(selectedBranch)}&path=${encodeURIComponent(node.path)}`
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
    // Also update activeFile reference so content is fresh
    setActiveFile(prev => prev ? { ...prev, content: newContent } : prev);
    // Update openFiles references too
    setOpenFiles(prev => prev.map(f => f.path === activeFile.path ? { ...f, content: newContent } : f));
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
    { key: 'graph' as const, label: '图谱模式', icon: Share2 },
    { key: 'review' as const, label: '评审模式', icon: ShieldCheck },
    { key: 'doc' as const, label: '文档模式', icon: FileText },
    { key: 'preview' as const, label: '预览模式', icon: Eye },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px] gap-4 max-w-7xl mx-auto w-full pb-8">
      {/* Top Header - Repository Selection */}
      <Card className="shrink-0 border-none claude-card">
        <CardContent className="p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap hidden sm:inline">仓库:</span>
              <Select value={repoType} onValueChange={(val: 'dev' | 'case' | 'product') => {
                setRepoType(val);
                const filteredRepos = repositories.filter(r => r.type === val);
                if (filteredRepos.length > 0) {
                  setSelectedRepoId(filteredRepos[0].id);
                  setSelectedBranch(filteredRepos[0].defaultBranch ?? '');
                }
                if (val === 'case' && viewMode === 'preview') {
                  setViewMode('code');
                }
                if (val === 'product') {
                  setViewMode('doc');
                }
              }}>
                <SelectTrigger className="w-[100px] h-9 bg-muted/10 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">开发库</SelectItem>
                  <SelectItem value="case">用例库</SelectItem>
                  <SelectItem value="product">产品库</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedRepoId} onValueChange={handleRepoChange}>
                <SelectTrigger className="w-[160px] sm:w-[200px] h-9">
                  <SelectValue placeholder="选择仓库" />
                </SelectTrigger>
                <SelectContent>
                  {repositories.filter(r => r.type === repoType).map(repo => (
                    <SelectItem key={repo.id} value={repo.id}>
                      <div className="flex items-center">
                        <Book className="h-4 w-4 mr-2 text-muted-foreground" />
                        <span className="truncate">{repo.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground whitespace-nowrap hidden sm:inline">分支:</span>
              <Select value={selectedBranch} onValueChange={handleBranchChange}>
                <SelectTrigger className="w-[120px] sm:w-[160px] h-9">
                  <SelectValue placeholder="选择分支" />
                </SelectTrigger>
                <SelectContent>
                  {currentRepo?.defaultBranch && (
                    <SelectItem key={currentRepo.defaultBranch} value={currentRepo.defaultBranch}>
                      <div className="flex items-center">
                        <GitBranch className="h-4 w-4 mr-2 text-muted-foreground" />
                        <span className="truncate">{currentRepo.defaultBranch}</span>
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" size="icon" className="h-9 w-9 hidden md:flex text-muted-foreground hover:text-foreground" onClick={() => toast.success('分支已同步')} title="同步分支">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* View Mode Tabs */}
      <div className="flex items-center w-full justify-between gap-2 self-start flex-wrap">
        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl">
          {tabs.map(tab => {
            if (repoType === 'case' && tab.key === 'preview') return null;
            if (repoType === 'product' && tab.key !== 'doc') return null;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setViewMode(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  viewMode === tab.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
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
      <Card className="flex-1 overflow-hidden border-none claude-card flex flex-col relative">
        {viewMode === 'code' && (
          <ResizablePanelGroup direction="horizontal" className="h-full rounded-xl border border-border/50">
            {/* Left Panel - File Tree */}
            <ResizablePanel defaultSize={20} minSize={15} maxSize={40} className="bg-muted/10">
              <div className="h-full flex flex-col">
                <div className="p-3 border-b border-border/50 bg-muted/20 flex flex-col gap-2 shrink-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">资源管理器</span>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="搜索文件..."
                      className="h-8 pl-8 pr-8 text-xs bg-background"
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
                      <Folder className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="truncate">{currentRepo?.name}</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 pb-2 mb-2 border-b border-border/50 text-xs text-muted-foreground">
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
                    <div className="flex items-center h-10 border-b border-border/50 bg-muted/10 shrink-0 overflow-x-auto whitespace-nowrap scrollbar-none">
                      {openFiles.map((file, idx) => (
                        <div
                          key={`${file.name}-${idx}`}
                          className={`flex items-center gap-2 h-full px-4 border-r border-border/50 cursor-pointer ${
                            activeFile === file
                              ? 'bg-background border-b-2 border-b-primary text-foreground'
                              : 'text-muted-foreground hover:bg-muted/50 border-b-2 border-b-transparent'
                          }`}
                          onClick={() => setActiveFile(file)}
                        >
                          <File className="h-3.5 w-3.5" />
                          <span className="text-sm font-medium">{file.name}</span>
                          <button
                            className="p-0.5 rounded-sm opacity-50 hover:opacity-100 hover:bg-muted ml-1"
                            onClick={(e) => handleCloseTab(e, file)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {activeFile && (
                      <ScrollArea className="flex-1">
                        <div className="p-4 md:p-6 h-full">
                          <CodeBlock
                            content={activeFile.content || ''}
                            filename={activeFile.name}
                            editable
                            onChange={handleUpdateFileContent}
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
              
              {/* SVG Code Graph Mock with Draggable nodes simulation via CSS */}
              <div className="tech-border rounded-xl p-8 bg-muted/10 relative overflow-hidden aspect-video flex items-center justify-center cursor-move">
                <svg className="absolute inset-0 w-full h-full opacity-60 dark:opacity-40" viewBox="0 0 800 400" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="line-grad-1" x1="150" y1="100" x2="400" y2="200" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.8" />
                    </linearGradient>
                    <linearGradient id="line-grad-2" x1="150" y1="300" x2="400" y2="200" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.8" />
                    </linearGradient>
                    <linearGradient id="line-grad-3" x1="400" y1="200" x2="650" y2="150" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
                    </linearGradient>
                    <linearGradient id="line-grad-4" x1="400" y1="200" x2="650" y2="250" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity="0.8" />
                    </linearGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {/* Lines */}
                  <path d="M 150 100 Q 275 100 400 200" stroke="url(#line-grad-1)" strokeWidth="3" fill="none" strokeDasharray="6 6" className="animate-[dash_2s_linear_infinite]" />
                  <path d="M 150 300 Q 275 300 400 200" stroke="url(#line-grad-2)" strokeWidth="3" fill="none" strokeDasharray="6 6" className="animate-[dash_2s_linear_infinite]" />
                  <path d="M 400 200 Q 525 150 650 150" stroke="url(#line-grad-3)" strokeWidth="3" fill="none" className="animate-[dash_3s_linear_infinite]" strokeDasharray="8 8" />
                  <path d="M 400 200 Q 525 250 650 250" stroke="url(#line-grad-4)" strokeWidth="3" fill="none" className="animate-[dash_3s_linear_infinite]" strokeDasharray="8 8" />
                  <path d="M 650 250 Q 525 350 400 400" stroke="url(#line-grad-2)" strokeWidth="2" fill="none" strokeDasharray="4 4" className="animate-[dash_4s_linear_infinite]" />
                  <path d="M 400 400 Q 275 350 150 300" stroke="url(#line-grad-1)" strokeWidth="2" fill="none" strokeDasharray="4 4" className="animate-[dash_4s_linear_infinite]" />
                  <path d="M 650 150 Q 750 100 800 200" stroke="url(#line-grad-3)" strokeWidth="2" fill="none" strokeDasharray="5 5" className="animate-[dash_2s_linear_infinite]" />
                  <path d="M 800 200 Q 750 300 650 250" stroke="url(#line-grad-4)" strokeWidth="2" fill="none" strokeDasharray="5 5" className="animate-[dash_2s_linear_infinite]" />
                  
                  {/* Additional detailed lines */}
                  <path d="M 150 100 Q 275 -50 650 150" stroke="url(#line-grad-1)" strokeWidth="1" fill="none" strokeDasharray="3 3" className="animate-[dash_5s_linear_infinite]" />
                  <path d="M 150 300 Q 275 450 650 250" stroke="url(#line-grad-2)" strokeWidth="1" fill="none" strokeDasharray="3 3" className="animate-[dash_5s_linear_infinite]" />
                  <path d="M 400 400 Q 600 400 650 250" stroke="url(#line-grad-3)" strokeWidth="1.5" fill="none" strokeDasharray="4 4" className="animate-[dash_3s_linear_infinite]" />

                  {/* Nodes */}
                  <g transform="translate(150, 100)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中前端UI模块')}>
                    <circle r="30" fill="#eff6ff" stroke="#3b82f6" strokeWidth="3" filter="url(#glow)" className="dark:fill-blue-950 dark:stroke-blue-500" />
                    <text y="5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#1e3a8a" className="dark:fill-blue-200">UI</text>
                  </g>
                  
                  <g transform="translate(150, 300)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中API服务层')}>
                    <circle r="30" fill="#f0fdf4" stroke="#10b981" strokeWidth="3" filter="url(#glow)" className="dark:fill-emerald-950 dark:stroke-emerald-500" />
                    <text y="5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#064e3b" className="dark:fill-emerald-200">API</text>
                  </g>

                  <g transform="translate(400, 200)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中核心数据存储')}>
                    <circle r="40" fill="#f5f3ff" stroke="#8b5cf6" strokeWidth="4" filter="url(#glow)" className="dark:fill-purple-950 dark:stroke-purple-500" />
                    <text y="5" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#4c1d95" className="dark:fill-purple-200">Store</text>
                  </g>

                  <g transform="translate(650, 150)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中认证鉴权服务')}>
                    <circle r="30" fill="#fffbeb" stroke="#f59e0b" strokeWidth="3" filter="url(#glow)" className="dark:fill-amber-950 dark:stroke-amber-500" />
                    <text y="5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#78350f" className="dark:fill-amber-200">Auth</text>
                  </g>

                  <g transform="translate(650, 250)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中底层数据库')}>
                    <circle r="30" fill="#fdf2f8" stroke="#ec4899" strokeWidth="3" filter="url(#glow)" className="dark:fill-pink-950 dark:stroke-pink-500" />
                    <text y="5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#831843" className="dark:fill-pink-200">DB</text>
                  </g>
                  
                  <g transform="translate(400, 400)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中缓存服务')}>
                    <circle r="30" fill="#f0f9ff" stroke="#0ea5e9" strokeWidth="3" filter="url(#glow)" className="dark:fill-sky-950 dark:stroke-sky-500" />
                    <text y="5" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#0c4a6e" className="dark:fill-sky-200">Redis</text>
                  </g>

                  <g transform="translate(800, 200)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中外部日志系统')}>
                    <circle r="25" fill="#f8fafc" stroke="#64748b" strokeWidth="3" filter="url(#glow)" className="dark:fill-slate-950 dark:stroke-slate-500" />
                    <text y="4" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#334155" className="dark:fill-slate-200">Logger</text>
                  </g>
                  
                  <g transform="translate(400, 50)" className="cursor-pointer hover:opacity-80 transition-opacity" onClick={() => toast.info('已选中消息队列')}>
                    <circle r="25" fill="#fff1f2" stroke="#f43f5e" strokeWidth="3" filter="url(#glow)" className="dark:fill-rose-950 dark:stroke-rose-500" />
                    <text y="4" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#881337" className="dark:fill-rose-200">MQ</text>
                  </g>
                  
                  {/* Particles */}
                  <circle r="4" fill="#3b82f6">
                    <animateMotion dur="2s" repeatCount="indefinite" path="M 150 100 Q 275 100 400 200" />
                  </circle>
                  <circle r="4" fill="#10b981">
                    <animateMotion dur="2.5s" repeatCount="indefinite" path="M 150 300 Q 275 300 400 200" />
                  </circle>
                  <circle r="4" fill="#8b5cf6">
                    <animateMotion dur="2s" repeatCount="indefinite" path="M 400 200 Q 525 150 650 150" />
                  </circle>
                  <circle r="4" fill="#f59e0b">
                    <animateMotion dur="2.2s" repeatCount="indefinite" path="M 400 200 Q 525 250 650 250" />
                  </circle>
                  <circle r="3" fill="#ec4899">
                    <animateMotion dur="3s" repeatCount="indefinite" path="M 650 250 Q 525 350 400 400" />
                  </circle>
                  <circle r="3" fill="#0ea5e9">
                    <animateMotion dur="3s" repeatCount="indefinite" path="M 400 400 Q 275 350 150 300" />
                  </circle>
                  <circle r="3" fill="#f43f5e">
                    <animateMotion dur="2.5s" repeatCount="indefinite" path="M 650 150 Q 750 100 800 200" />
                  </circle>
                </svg>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'review' && (
          <ReviewPanel />
        )}

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
                        className="h-7 pl-7 text-xs bg-background/50 border-border/50"
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
                    <MarkdownRenderer content={mockMarkdownDoc} />
                  </div>
                </ScrollArea>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}

        {viewMode === 'preview' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">预览模式</span>
                <span className="text-xs text-muted-foreground">效果预览 · {currentRepo?.name} / {selectedBranch}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => toast.success('已刷新预览')}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  刷新预览
                </Button>
                <PreviewEffectToolbar />
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <PreviewPanel repoId={selectedRepoId} branch={selectedBranch} repoName={currentRepo?.name || ''} repoUrl={currentRepo?.url || ''} />
            </div>
          </div>
        )}
        <TerminalDrawer />
      </Card>
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
