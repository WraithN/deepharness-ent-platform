import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { Loader2, RefreshCw, Code2, Eye, ExternalLink, Monitor, Tablet, Smartphone, GitCompareArrows, X, FileText, AlertTriangle } from 'lucide-react';
import { projectApi, type ProjectFileNode, type FileDiffEntry, type PreviewErrorInfo } from '@/lib/project-api';
import { fileApi } from '@/lib/file-api';
import { ApiError } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type PreviewMode = 'diff' | 'code' | 'preview';

interface LivePreviewProps {
  projectPath: string;
  /** 受控模式。未传入时组件内部自管理，默认 preview。 */
  mode?: PreviewMode;
  /** 是否仅展示页面预览，隐藏 Diff/代码 模式切换。 */
  previewOnly?: boolean;
  /** 预览报错时点击「修复」的回调：携带工程路径与错误摘要，由上层注入会话。 */
  onFixRequest?: (info: { path: string; excerpt: string }) => void;
  onClose?: () => void;
  onModeChange?: (mode: PreviewMode) => void;
}

type DeviceSize = 'desktop' | 'tablet' | 'mobile';

const DEFAULT_PREVIEW_MODE: PreviewMode = 'preview';
const DEFAULT_DEVICE_SIZE: DeviceSize = 'desktop';
/** 预览报错轮询间隔（毫秒）。 */
const PREVIEW_ERROR_POLL_MS = 4000;
/** 报错横幅中展示的错误首行最大字符数。 */
const PREVIEW_ERROR_TITLE_CHARS = 200;

const DEVICE_WIDTHS: Record<DeviceSize, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

// 文件扩展名到 Prism 语言的映射。
const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', css: 'css', scss: 'scss', html: 'html',
  md: 'markdown', go: 'go', py: 'python', rs: 'rust',
  sh: 'bash', yml: 'yaml', yaml: 'yaml', xml: 'xml',
  sql: 'sql', vue: 'vue', svelte: 'svelte',
};

// Diff 文件状态对应的展示文案。
const STATUS_LABEL: Record<string, string> = {
  modified: '修改',
  added: '新增',
  deleted: '删除',
  renamed: '重命名',
};

// Diff 文件状态对应的主题色。
const STATUS_COLOR: Record<string, string> = {
  modified: 'text-amber-600 dark:text-amber-400',
  added: 'text-green-600 dark:text-green-400',
  deleted: 'text-red-600 dark:text-red-400',
  renamed: 'text-blue-600 dark:text-blue-400',
};

// 根据文件名获取语法高亮语言。
function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_LANG_MAP[ext] || 'text';
}

/**
 * 项目预览组件。
 * 三种模式：
 * - diff: git diff 对比 master/main 分支差异（无差异时自动切换到 code）
 * - code: 文件树 + 文件内容（带语法高亮）
 * - preview: dev server iframe 实时预览（仅前端工程）
 */
export const LivePreview: React.FC<LivePreviewProps> = ({ projectPath, mode, previewOnly = false, onFixRequest, onClose, onModeChange }) => {
  // 诊断日志：记录组件挂载/更新时的关键 props
  console.log('[LivePreview] render', { projectPath, mode, previewOnly, hasOnModeChange: !!onModeChange });
  const [internalMode, setInternalMode] = useState<PreviewMode>(DEFAULT_PREVIEW_MODE);
  const effectiveMode = mode ?? internalMode;
  const setEffectiveMode = (next: PreviewMode) => {
    onModeChange?.(next);
    if (mode === undefined) {
      setInternalMode(next);
    }
  };

  const [isFrontend, setIsFrontend] = useState(false);
  const [device, setDevice] = useState<DeviceSize>(DEFAULT_DEVICE_SIZE);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // activeMode 决定实际渲染的模式；previewOnly 强制锁定为 preview。
  // 必须在 useEffect 之前定义，避免闭包捕获到未初始化的变量。
  const activeMode = previewOnly ? 'preview' : effectiveMode;

  // 代码模式状态
  const [fileTree, setFileTree] = useState<ProjectFileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState(false);

  // Diff 模式状态
  const [fileDiffs, setFileDiffs] = useState<FileDiffEntry[]>([]);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [hasDiff, setHasDiff] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  // 预览模式状态
  const [starting, setStarting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 预览报错状态（dev server 输出分析结果，仅 preview 模式轮询）
  const [previewError, setPreviewError] = useState<PreviewErrorInfo | null>(null);

  // 检测前端工程类型；若当前处于 preview 模式则同时启动 dev server。
  useEffect(() => {
    console.log('[LivePreview] preview detection effect', { projectPath, activeMode });
    setIsFrontend(false);
    setStarting(true);
    projectApi.startPreview(projectPath).then(res => {
      console.log('[LivePreview] startPreview response', { isFrontend: res.isFrontend, port: res.port, activeMode });
      setIsFrontend(res.isFrontend);
      if (res.isFrontend && res.port > 0 && activeMode === 'preview') {
        const host = window.location.hostname;
        setPreviewUrl(`http://${host}:${res.port}/`);
      }
    }).catch((err) => {
      console.error('[LivePreview] startPreview error', err);
    }).finally(() => {
      setStarting(false);
    });

    return () => {
      console.log('[LivePreview] unmount', { projectPath });
      projectApi.stopPreview(projectPath).catch(() => {});
    };
  }, [projectPath, activeMode]);

  // 加载文件树。
  const loadFileTree = useCallback(async () => {
    try {
      const tree = await projectApi.tree(projectPath);
      setFileTree(tree);
    } catch (e) {
      console.error('[LivePreview] load tree failed:', e);
      setFileTree([]);
    }
  }, [projectPath]);

  // 加载 diff 内容。
  const loadDiff = useCallback(async () => {
    setLoadingDiff(true);
    try {
      const res = await projectApi.diff(projectPath);
      setHasDiff(res.hasChanges);
      setFileDiffs(res.files || []);
      // 默认选中第一个有变更的文件。
      if (res.files && res.files.length > 0) {
        setSelectedDiffFile(res.files[0].path);
      } else {
        setSelectedDiffFile(null);
      }
      // 如果没有 diff（新工程或无修改），自动切换到代码模式。
      if (!res.hasChanges) {
        setEffectiveMode('code');
      }
    } catch (e) {
      console.error('[LivePreview] load diff failed:', e);
      setFileDiffs([]);
      setHasDiff(false);
    } finally {
      setLoadingDiff(false);
    }
  }, [projectPath]);

  // 加载文件内容（文件树返回相对路径，需拼接 projectPath 为绝对路径）。
  const loadFile = async (relativePath: string) => {
    const absPath = `${projectPath}/${relativePath}`;
    setSelectedFile(absPath);
    setLoadingFile(true);
    try {
      const content = await fileApi.content(absPath);
      setFileContent(content.content);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 'unknown';
      console.error('[LivePreview] load file failed:', absPath, 'status:', status, e);
      setFileContent(`加载文件失败 (${status})\n路径: ${absPath}`);
    } finally {
      setLoadingFile(false);
    }
  };

  // 根据当前模式按需加载数据。
  useEffect(() => {
    if (activeMode === 'code' && fileTree.length === 0) {
      loadFileTree();
    } else if (activeMode === 'diff') {
      loadDiff();
    }
  }, [activeMode, loadFileTree, loadDiff, fileTree.length]);

  // 预览模式下轮询 dev server 输出，检测构建/运行报错；
  // 离开预览或卸载时停止轮询并清空报错状态。
  useEffect(() => {
    if (activeMode !== 'preview' || !previewUrl) {
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const info = await projectApi.previewErrors(projectPath);
        if (!cancelled) setPreviewError(info);
      } catch {
        // 轮询失败（如 personal-stub 重启中）保持当前状态，下一轮自然重试。
      }
    };
    poll();
    const timer = setInterval(poll, PREVIEW_ERROR_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeMode, previewUrl, projectPath]);

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleOpenInNewTab = () => {
    if (previewUrl) window.open(previewUrl, '_blank');
  };

  const isPreviewMode = activeMode === 'preview';
  const isCodeMode = activeMode === 'code';
  const isDiffMode = activeMode === 'diff';

  console.log('[LivePreview] before render', { activeMode, isPreviewMode, isFrontend, previewUrl: previewUrl?.slice(0, 60) });

  return (
    <div className="flex flex-col h-full bg-background animate-in fade-in duration-300">
      {/* 标题栏：模式切换与预览工具 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50 bg-card shrink-0 animate-in fade-in slide-in-from-top-2 duration-300">
        {!previewOnly && (
          <>
            <Button
              variant={isDiffMode ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setEffectiveMode('diff')}
            >
              <GitCompareArrows className="h-3.5 w-3.5 mr-1" />Diff
            </Button>
            <Button
              variant={isCodeMode ? 'default' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setEffectiveMode('code')}
            >
              <Code2 className="h-3.5 w-3.5 mr-1" />代码
            </Button>
            {isFrontend && (
              <Button
                variant={isPreviewMode ? 'default' : 'ghost'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setEffectiveMode('preview')}
              >
                <Eye className="h-3.5 w-3.5 mr-1" />预览
              </Button>
            )}
          </>
        )}
        <div className="flex-1" />
        {isPreviewMode && previewUrl && (
          <>
            <div className="flex items-center gap-0.5 mr-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 transition-colors', device === 'desktop' && 'text-primary bg-primary/10')}
                onClick={() => setDevice('desktop')}
                title="桌面"
              >
                <Monitor className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 transition-colors', device === 'tablet' && 'text-primary bg-primary/10')}
                onClick={() => setDevice('tablet')}
                title="平板"
              >
                <Tablet className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 transition-colors', device === 'mobile' && 'text-primary bg-primary/10')}
                onClick={() => setDevice('mobile')}
                title="手机"
              >
                <Smartphone className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 transition-transform duration-200 hover:rotate-90" onClick={handleRefresh} title="刷新">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenInNewTab} title="新标签页打开">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 预览报错横幅：dev server 输出检测到报错时展示，提供一键修复入口 */}
      {previewError?.hasError && (
        <PreviewErrorBanner
          excerpt={previewError.excerpt}
          onFix={onFixRequest ? () => onFixRequest({ path: projectPath, excerpt: previewError.excerpt }) : undefined}
        />
      )}

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isDiffMode ? (
          <DiffView
            loading={loadingDiff}
            fileDiffs={fileDiffs}
            hasDiff={hasDiff}
            selectedFile={selectedDiffFile}
            onSelectFile={setSelectedDiffFile}
          />
        ) : isPreviewMode ? (
          <PreviewView starting={starting} previewUrl={previewUrl} iframeRef={iframeRef} device={device} />
        ) : (
          <CodeView
            fileTree={fileTree}
            selectedFile={selectedFile}
            loadingFile={loadingFile}
            fileContent={fileContent}
            onSelect={loadFile}
          />
        )}
      </div>
    </div>
  );
};

// ──────────────── Diff 视图（side-by-side 文件对比） ────────────────

const DiffView: React.FC<{
  loading: boolean;
  fileDiffs: FileDiffEntry[];
  hasDiff: boolean;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}> = ({ loading, fileDiffs, hasDiff, selectedFile, onSelectFile }) => {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground animate-in fade-in">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
        <span className="text-sm">正在加载 Diff...</span>
      </div>
    );
  }

  if (!hasDiff || fileDiffs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 animate-in fade-in">
        <GitCompareArrows className="h-10 w-10 opacity-30" />
        <p>没有检测到与 master/main 分支的差异</p>
        <p className="text-xs">已自动切换到代码模式查看</p>
      </div>
    );
  }

  const currentDiff = fileDiffs.find(f => f.path === selectedFile) || fileDiffs[0];
  const currentStatus = currentDiff.status;

  return (
    <div className="flex h-full">
      {/* 变更文件列表 */}
      <div className="w-52 shrink-0 border-r border-border/40 overflow-y-auto bg-muted/20">
        <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border/30">
          变更文件 ({fileDiffs.length})
        </div>
        {fileDiffs.map(f => {
          const baseName = f.path.split('/').pop() || f.path;
          const isActive = (selectedFile || fileDiffs[0].path) === f.path;
          return (
            <button
              key={f.path}
              className={cn(
                'w-full text-left text-xs px-2 py-1.5 hover:bg-accent transition-colors truncate flex items-center gap-1.5',
                isActive && 'bg-accent text-primary font-medium'
              )}
              onClick={() => onSelectFile(f.path)}
              title={f.path}
            >
              <span className={cn('shrink-0', STATUS_COLOR[f.status])}>
                {f.status === 'added' ? '+' : f.status === 'deleted' ? '-' : 'M'}
              </span>
              <span className="truncate">{baseName}</span>
            </button>
          );
        })}
      </div>

      {/* side-by-side diff 对比视图 */}
      <div className="flex-1 overflow-auto min-w-0">
        <div className="px-3 py-1.5 bg-muted/80 border-b border-border/30 text-xs flex items-center gap-2 sticky top-0 z-10">
          <FileText className="h-3.5 w-3.5" />
          <span className="truncate">{currentDiff.path}</span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', STATUS_COLOR[currentStatus], 'bg-current/10')}>
            {STATUS_LABEL[currentStatus] || currentStatus}
          </span>
        </div>
        <div className="min-w-fit">
          <ReactDiffViewer
            oldValue={currentDiff.oldContent}
            newValue={currentDiff.newContent}
            splitView={true}
            compareMethod={DiffMethod.WORDS}
            useDarkTheme={true}
            hideLineNumbers={false}
            styles={{
              contentText: { fontSize: '13px', fontFamily: 'monospace' },
              lineNumber: { fontSize: '11px' },
            }}
          />
        </div>
      </div>
    </div>
  );
};

// ──────────────── 预览报错横幅 ────────────────

/** 预览报错横幅：展示错误首行摘要，并在上层提供回调时显示「复制并修复」按钮。 */
const PreviewErrorBanner: React.FC<{ excerpt: string; onFix?: () => void }> = ({ excerpt, onFix }) => {
  const firstLine = excerpt.split('\n').find(l => l.trim().length > 0) || '未知错误';
  const title = firstLine.length > PREVIEW_ERROR_TITLE_CHARS
    ? `${firstLine.slice(0, PREVIEW_ERROR_TITLE_CHARS)}…`
    : firstLine;
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/30 shrink-0 animate-in fade-in">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-xs text-amber-800 dark:text-amber-200 flex-1 truncate" title={excerpt}>
        预览报错：{title}
      </span>
      {onFix && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-900/40"
          onClick={onFix}
        >
          复制并修复
        </Button>
      )}
    </div>
  );
};

// ──────────────── 预览视图 ────────────────

const PreviewView: React.FC<{
  starting: boolean;
  previewUrl: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  device: DeviceSize;
}> = ({ starting, previewUrl, iframeRef, device }) => {
  console.log('[PreviewView] render', { starting, hasUrl: !!previewUrl, device });
  const [iframeLoading, setIframeLoading] = useState(true);

  // 预览 URL 变化时重置加载状态。
  useEffect(() => {
    setIframeLoading(true);
  }, [previewUrl]);

  if (starting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground animate-in fade-in">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
        <span className="text-sm">正在启动 dev server...</span>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 animate-in fade-in">
        <Monitor className="h-10 w-10 opacity-30" />
        <p>该项目暂不支持页面预览</p>
        <p className="text-xs">仅前端工程可启动 dev server 预览</p>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-muted/20 relative">
      {iframeLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/30 z-10 animate-in fade-in">
          <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
          <span className="text-sm text-muted-foreground">正在加载预览页面...</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={previewUrl}
        className="bg-white border-0 transition-all duration-500 shadow-sm"
        style={{ width: DEVICE_WIDTHS[device], height: '100%' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="项目预览"
        onLoad={() => setIframeLoading(false)}
      />
    </div>
  );
};

// ──────────────── 代码视图 ────────────────

const CodeView: React.FC<{
  fileTree: ProjectFileNode[];
  selectedFile: string | null;
  loadingFile: boolean;
  fileContent: string;
  onSelect: (path: string) => void;
}> = ({ fileTree, selectedFile, loadingFile, fileContent, onSelect }) => {
  return (
    <div className="flex h-full">
      {/* 文件树 */}
      <div className="w-56 shrink-0 border-r border-border/40 overflow-y-auto bg-muted/20">
        <FileTreeNode nodes={fileTree} onSelect={onSelect} selectedPath={selectedFile} />
      </div>
      {/* 文件内容 */}
      <div className="flex-1 overflow-auto min-w-0">
        {loadingFile ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : selectedFile ? (
          <CodeContentView filename={selectedFile} content={fileContent} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            选择左侧文件查看内容
          </div>
        )}
      </div>
    </div>
  );
};

// 代码内容视图，带语法高亮。
const CodeContentView: React.FC<{ filename: string; content: string }> = ({ filename, content }) => {
  const baseName = filename.split('/').pop() || filename;
  const language = getLanguage(baseName);

  return (
    <div className="h-full">
      <div className="px-3 py-1 bg-muted/80 border-b border-border/30 text-xs text-muted-foreground flex items-center justify-between sticky top-0 z-10">
        <span>{baseName}</span>
        <span className="text-[10px] opacity-60">{language}</span>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', background: 'transparent' }}
        showLineNumbers
        wrapLongLines={false}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};

// ──────────────── 文件树 ────────────────

/** 文件树节点递归渲染组件。 */
const FileTreeNode: React.FC<{
  nodes: ProjectFileNode[];
  onSelect: (path: string) => void;
  selectedPath: string | null;
  level?: number;
}> = ({ nodes, onSelect, selectedPath, level = 0 }) => {
  return (
    <div>
      {nodes.map(node => (
        <div key={node.path}>
          <button
            className={cn(
              'w-full text-left text-xs px-2 py-1 hover:bg-accent transition-colors truncate',
              selectedPath === node.path && 'bg-accent text-primary font-medium'
            )}
            style={{ paddingLeft: `${0.5 + level * 0.75}rem` }}
            onClick={() => {
              if (node.type === 'file') onSelect(node.path);
            }}
          >
            {node.type === 'folder' ? '📁 ' : '📄 '}{node.name}
          </button>
          {node.children && node.children.length > 0 && (
            <FileTreeNode nodes={node.children} onSelect={onSelect} selectedPath={selectedPath} level={level + 1} />
          )}
        </div>
      ))}
    </div>
  );
};
