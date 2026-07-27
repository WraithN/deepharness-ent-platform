import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { projectApi, type ProjectFileNode, type ProjectCheckResponse } from '@/lib/project-api';
import { productSpaceApi } from '@/lib/productspace-api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  Loader2,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Smartphone,
  Tablet,
  X,
} from 'lucide-react';

/** 聊天内嵌的原型预览面板，复用产品空间原型预览的设计。 */
interface PrototypePreviewPanelProps {
  /** 原型工程根目录的绝对路径（如 .../products/prototypes/campaign-manager） */
  productPath: string;
  /** 关联的需求标题，用于卡片展示 */
  requirementTitle?: string;
  /** 关联的需求 ID；提供后点击采纳会自动关联需求并生成设计版本 */
  workitemId?: string;
  onClose?: () => void;
}

interface PageEntry {
  relPath: string;
  name: string;
}

type DeviceSize = 'desktop' | 'tablet' | 'mobile';

const DEVICE_WIDTHS: Record<DeviceSize, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'dist']);

function collectHtmlPages(nodes: ProjectFileNode[], prefix: string): PageEntry[] {
  const pages: PageEntry[] = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      if (SKIP_DIRS.has(node.name)) continue;
      pages.push(...collectHtmlPages(node.children || [], `${prefix}${node.name}/`));
    } else if (/\.html?$/i.test(node.name)) {
      pages.push({ relPath: `${prefix}${node.name}`, name: node.name });
    }
  }
  return pages;
}

function pickDefaultPage(pages: PageEntry[]): string | null {
  if (pages.length === 0) return null;
  const distIndex = pages.find((p) => p.relPath === 'dist/index.html');
  if (distIndex) return distIndex.relPath;
  const rootIndex = pages.find((p) => p.relPath === 'index.html');
  if (rootIndex) return rootIndex.relPath;
  return pages[0].relPath;
}

function encodePathSegments(relPath: string): string {
  return relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export const PrototypePreviewPanel: React.FC<PrototypePreviewPanelProps> = ({
  productPath,
  requirementTitle,
  workitemId,
  onClose,
}) => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  const productName = useMemo(() => productPath.split('/').filter(Boolean).pop() || productPath, [productPath]);
  const folderName = productName;

  const [loading, setLoading] = useState(true);
  const [checkResult, setCheckResult] = useState<ProjectCheckResponse | null>(null);
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceSize>('desktop');
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCheckResult(null);
    setPages([]);
    setSelectedPage(null);
    setAdopted(false);

    Promise.all([projectApi.check(productPath), projectApi.tree(productPath)])
      .then(([check, tree]) => {
        if (cancelled) return;
        setCheckResult(check);
        const htmlPages = collectHtmlPages(tree, '');
        setPages(htmlPages);
        setSelectedPage(pickDefaultPage(htmlPages));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[PrototypePreviewPanel] load failed:', err);
        toast.error('加载原型工程失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [productPath]);

  useEffect(() => {
    setIframeLoading(true);
  }, [selectedPage]);

  const serveUrl = useMemo(() => {
    if (!workspaceId || !selectedPage) return null;
    const encoded = encodePathSegments(selectedPage);
    return `/api/v1/workspaces/${workspaceId}/product-space/serve/prototypes/${encodeURIComponent(folderName)}/${encoded}`;
  }, [workspaceId, selectedPage, folderName]);

  const handleAdopt = async () => {
    if (!workspaceId) {
      toast.error('未选择工作空间');
      return;
    }
    setImporting(true);
    try {
      await productSpaceApi.importPrototype(workspaceId, folderName, workitemId);
      toast.success(workitemId ? '原型已采纳并生成设计版本' : '原型已采纳到产品空间');
      setAdopted(true);
    } catch (err) {
      console.error('[PrototypePreviewPanel] adopt failed:', err);
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || '采纳失败，请确认是否已加入该工作空间');
    } finally {
      setImporting(false);
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current && serveUrl) {
      iframeRef.current.src = serveUrl;
    }
  };

  const handleOpenNewTab = () => {
    if (serveUrl) window.open(serveUrl, '_blank');
  };

  const isPreviewMode = true;

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
        <span className="text-sm">正在加载原型预览...</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background animate-in fade-in duration-300">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-card shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold truncate">原型预览</span>
          <span className="text-xs text-muted-foreground truncate hidden sm:inline">{productName}</span>
          {requirementTitle && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={requirementTitle}>
              ({requirementTitle})
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
            {checkResult?.htmlCount ?? pages.length} 个页面
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {workspaceId && (
            <Button
              variant={adopted ? 'outline' : 'default'}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleAdopt}
              disabled={importing || adopted}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : adopted ? <Check className="h-3.5 w-3.5" /> : <FolderInput className="h-3.5 w-3.5" />}
              {adopted ? '已采纳' : '采纳到产品空间'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={rightCollapsed ? '展开页面树' : '收起页面树'}
            onClick={() => setRightCollapsed((v) => !v)}
          >
            {rightCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭预览">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/50 bg-muted/20 shrink-0">
        <Button
          variant={device === 'desktop' ? 'default' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setDevice('desktop')}
          title="桌面"
        >
          <Monitor className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={device === 'tablet' ? 'default' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setDevice('tablet')}
          title="平板"
        >
          <Tablet className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={device === 'mobile' ? 'default' : 'ghost'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setDevice('mobile')}
          title="手机"
        >
          <Smartphone className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} title="刷新">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenNewTab} title="新标签页打开">
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* 画布 */}
        <div className="flex-1 flex flex-col min-w-0 bg-muted/20 relative">
          {pages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <FileText className="h-10 w-10 opacity-30" />
              <span className="text-sm">未找到可预览的 HTML 页面</span>
            </div>
          ) : (
            <>
              {iframeLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/30 z-10 animate-in fade-in">
                  <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
                  <span className="text-sm text-muted-foreground">正在加载页面...</span>
                </div>
              )}
              <div className="flex-1 overflow-auto flex justify-center">
                <iframe
                  ref={iframeRef}
                  src={serveUrl ?? undefined}
                  className="bg-white border-0 shadow-sm transition-all duration-500"
                  style={{ width: DEVICE_WIDTHS[device], height: '100%', minWidth: '320px' }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  title={`${productName} 原型预览`}
                  onLoad={() => setIframeLoading(false)}
                />
              </div>
            </>
          )}
        </div>

        {/* 页面树 */}
        {!rightCollapsed && (
          <aside className="w-[220px] border-l border-border/50 flex flex-col min-h-0 shrink-0 bg-background/60">
            <div className="px-3 py-2 text-xs font-semibold text-foreground/80 border-b border-border/50 flex items-center gap-1.5">
              <Folder className="h-3.5 w-3.5" />
              页面 ({pages.length})
            </div>
            <ScrollArea className="flex-1 min-h-0">
              {pages.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3">暂无页面</p>
              ) : (
                <div className="p-1 space-y-0.5">
                  {pages.map((page) => (
                    <button
                      key={page.relPath}
                      type="button"
                      onClick={() => setSelectedPage(page.relPath)}
                      className={cn(
                        'w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1.5 transition-colors',
                        selectedPage === page.relPath
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-accent text-foreground'
                      )}
                      title={page.relPath}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{page.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </aside>
        )}
      </div>
    </div>
  );
};
