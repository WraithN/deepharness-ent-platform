import JSZip from 'jszip';
import {
  AlertCircle,
  Box,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileCode2,
  Folder,
  FolderPlus,
  Fullscreen,
  Grid3x3,
  History,
  Loader2,
  Lock,
  MessageSquare,
  Minus,
  MonitorPlay,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  Trash2,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { downloadBlob } from '@/lib/file-download';
import {
  decodeBase64Utf8,
  type ProductSpaceItem,
  type ProductSpaceTreeNode,
  type ProductSpaceVersion,
  type PrototypeComment,
  productSpaceApi,
} from '@/lib/productspace-api';
import { cn } from '@/lib/utils';
import { AUTH_TOKEN_KEY } from '@/lib/constants';

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

/** 原型目录树根节点名（与后端 PrototypesDir 一致） */
const PROTOTYPES_ROOT = 'prototypes';

/** 视口预设：value 为 fit 时表示适配屏幕（宽度占满画布）。
 *  其余预设对齐主流设备的真实 CSS 视口尺寸（width×height，竖屏为主），
 *  覆盖桌面/平板/手机三档，便于响应式原型逐设备验收。 */
const VIEWPORT_OPTIONS = [
  { value: 'fit', label: '适配屏幕', group: '常用', width: 0, height: 0 },
  // 桌面：主流显示器/笔记本分辨率
  { value: 'pc-1920', label: '桌面 · 1920×1080', group: '桌面', width: 1920, height: 1080 },
  { value: 'pc-1440', label: '桌面 · 1440×900', group: '桌面', width: 1440, height: 900 },
  { value: 'pc-1366', label: '桌面 · 1366×768', group: '桌面', width: 1366, height: 768 },
  { value: 'pc-1280', label: '桌面 · 1280×800', group: '桌面', width: 1280, height: 800 },
  // 平板：iPad 各代竖屏 CSS 视口 + 一档横屏
  { value: 'tablet-1024p', label: '平板 · 1024×1366', group: '平板', width: 1024, height: 1366 },
  { value: 'tablet-834', label: '平板 · 834×1194', group: '平板', width: 834, height: 1194 },
  { value: 'tablet-820', label: '平板 · 820×1180', group: '平板', width: 820, height: 1180 },
  { value: 'tablet-768', label: '平板 · 768×1024', group: '平板', width: 768, height: 1024 },
  { value: 'tablet-1024l', label: '平板横屏 · 1024×768', group: '平板', width: 1024, height: 768 },
  // 手机：iPhone 各档 + Android 主流 + 小屏旧机
  { value: 'mobile-430', label: '手机 · 430×932', group: '手机', width: 430, height: 932 },
  { value: 'mobile-414', label: '手机 · 414×896', group: '手机', width: 414, height: 896 },
  { value: 'mobile-390', label: '手机 · 390×844', group: '手机', width: 390, height: 844 },
  { value: 'mobile-375', label: '手机 · 375×812', group: '手机', width: 375, height: 812 },
  { value: 'mobile-360', label: '手机 · 360×800', group: '手机', width: 360, height: 800 },
  { value: 'mobile-320', label: '手机 · 320×568', group: '手机', width: 320, height: 568 },
] as const;

/** 下拉分组展示顺序 */
const VIEWPORT_GROUPS = ['常用', '桌面', '平板', '手机'] as const;

const ZOOM_DEFAULT = 100;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

const COMMENT_MAX_LENGTH = 2000;

/** 分享深链参数：?tab=prototype&prototype=<itemId> */
const SHARE_QUERY_KEY = 'prototype';

/** 新建页面对话框中“新建分组”的选项值 */
const NEW_GROUP_VALUE = '__new_group__';

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

/** 从目录树中定位 prototypes 根节点。 */
function findPrototypesRoot(tree: ProductSpaceTreeNode[]): ProductSpaceTreeNode | null {
  return tree.find(n => n.name === PROTOTYPES_ROOT) ?? null;
}

/** 产品 = prototypes 下的一级目录。 */
function listProducts(root: ProductSpaceTreeNode | null): ProductSpaceTreeNode[] {
  return (root?.children ?? []).filter(n => n.type === 'folder');
}

/** 格式化时间戳为 MM-DD HH:mm（无效输入返回 -）。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 在整棵树中按条目 ID 查找文件节点（用于分享深链定位页面）。 */
function findNodeByItemId(
  nodes: ProductSpaceTreeNode[],
  itemId: string
): { node: ProductSpaceTreeNode; productName: string } | null {
  for (const product of nodes) {
    for (const child of product.children ?? []) {
      if (child.id === itemId) return { node: child, productName: product.name };
      const found = (child.children ?? []).find(p => p.id === itemId);
      if (found) return { node: found, productName: product.name };
    }
  }
  return null;
}

/**
 * 生成新建原型页的骨架 HTML。
 * TODO: 后续接入 AI 生成，根据页面描述自动产出高保真原型 HTML。
 */
function buildSkeletonHtml(pageName: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #F8FAFC; color: #1E293B; }
    .page { max-width: 1200px; margin: 0 auto; padding: 48px 24px; }
    .placeholder { border: 2px dashed #CBD5E1; border-radius: 12px; padding: 64px 24px; text-align: center; color: #94A3B8; }
    h1 { font-size: 24px; margin-bottom: 12px; color: #3B82F6; }
  </style>
</head>
<body>
  <div class="page">
    <h1>${pageName}</h1>
    <div class="placeholder">原型页面骨架已创建，可在此编辑 HTML 内容</div>
  </div>
</body>
</html>`;
}

/** 画布网格背景（浅色方格，仅在开启网格时应用）。 */
const GRID_BACKGROUND: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(hsl(var(--border) / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.6) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────────

/** 当前选中的原型页面（树节点 + 条目详情） */
interface SelectedPage {
  itemId: string;
  item: ProductSpaceItem;
  html: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：左侧产品选择 + 页面树
// ─────────────────────────────────────────────────────────────────────────────

interface PageTreePanelProps {
  products: ProductSpaceTreeNode[];
  product: ProductSpaceTreeNode | null;
  selectedItemId: string;
  search: string;
  loading: boolean;
  onSearchChange: (v: string) => void;
  onSelectProduct: (name: string) => void;
  onSelectPage: (node: ProductSpaceTreeNode) => void;
  onDeletePage: (node: ProductSpaceTreeNode) => void;
  onCreateProduct: () => void;
  onCreatePage: () => void;
  onRefresh: () => void;
}

/** 页面行：文件名 + 悬停删除按钮。 */
const PageRow: React.FC<{
  node: ProductSpaceTreeNode;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}> = ({ node, active, onSelect, onDelete }) => (
  <div
    className={cn(
      'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors',
      active ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-muted'
    )}
    onClick={onSelect}
  >
    <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
    <span className="flex-1 truncate">{node.name.replace(/\.html$/i, '')}</span>
    <button
      type="button"
      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
      title="删除页面"
      onClick={e => {
        e.stopPropagation();
        onDelete();
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  </div>
);

/** 侧边栏：产品切换 + 页面树（含搜索过滤）。 */
const PageTreePanel: React.FC<PageTreePanelProps> = ({
  products,
  product,
  selectedItemId,
  search,
  loading,
  onSearchChange,
  onSelectProduct,
  onSelectPage,
  onDeletePage,
  onCreateProduct,
  onCreatePage,
  onRefresh,
}) => {
  // 搜索过滤：匹配页面名或分组名（大小写不敏感）
  const query = search.trim().toLowerCase();
  const groups = (product?.children ?? []).filter(n => n.type === 'folder');
  const directPages = (product?.children ?? []).filter(n => n.type === 'prototype');

  const matchPage = (n: ProductSpaceTreeNode) => !query || n.name.toLowerCase().includes(query);
  const visibleGroups = groups.filter(
    g => !query || g.name.toLowerCase().includes(query) || (g.children ?? []).some(matchPage)
  );

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="p-3 space-y-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Select value={product?.name ?? ''} onValueChange={onSelectProduct}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="选择产品" />
            </SelectTrigger>
            <SelectContent>
              {products.map(p => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="新建产品" onClick={onCreateProduct}>
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="刷新" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="搜索页面…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {product && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs justify-start gap-1.5 mb-1 border-dashed"
              onClick={onCreatePage}
            >
              <Plus className="h-3.5 w-3.5" />
              新建原型页
            </Button>
          )}

          {directPages.filter(matchPage).map(n => (
            <PageRow
              key={n.path}
              node={n}
              active={n.id === selectedItemId}
              onSelect={() => onSelectPage(n)}
              onDelete={() => onDeletePage(n)}
            />
          ))}

          {visibleGroups.map(group => (
            <GroupSection
              key={group.path}
              group={group}
              query={query}
              selectedItemId={selectedItemId}
              onSelectPage={onSelectPage}
              onDeletePage={onDeletePage}
            />
          ))}

          {product && directPages.length + groups.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">暂无页面，点击上方按钮新建</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

/** 分组折叠区：默认展开，组内页面按搜索词过滤。 */
const GroupSection: React.FC<{
  group: ProductSpaceTreeNode;
  query: string;
  selectedItemId: string;
  onSelectPage: (node: ProductSpaceTreeNode) => void;
  onDeletePage: (node: ProductSpaceTreeNode) => void;
}> = ({ group, query, selectedItemId, onSelectPage, onDeletePage }) => {
  const [open, setOpen] = useState(true);
  const pages = (group.children ?? []).filter(
    n => n.type === 'prototype' && (!query || n.name.toLowerCase().includes(query) || group.name.toLowerCase().includes(query))
  );
  if (pages.length === 0 && query) return null;

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Folder className="h-3.5 w-3.5" />
        <span className="truncate">{group.name}</span>
        <span className="ml-auto text-[10px] opacity-60">{pages.length}</span>
      </button>
      {open && (
        <div className="ml-3 space-y-0.5">
          {pages.map(n => (
            <PageRow
              key={n.path}
              node={n}
              active={n.id === selectedItemId}
              onSelect={() => onSelectPage(n)}
              onDelete={() => onDeletePage(n)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：批注评论面板
// ─────────────────────────────────────────────────────────────────────────────

interface CommentsPanelProps {
  comments: PrototypeComment[];
  loading: boolean;
  disabled: boolean;
  draft: string;
  sending: boolean;
  onDraftChange: (v: string) => void;
  onSubmit: () => void;
}

/** 批注评论：最新在上，底部输入发布。 */
const CommentsPanel: React.FC<CommentsPanelProps> = ({
  comments,
  loading,
  disabled,
  draft,
  sending,
  onDraftChange,
  onSubmit,
}) => (
  <div className="h-[30%] min-h-[200px] border-t border-border/50 flex flex-col shrink-0">
    <div className="px-3 py-2 text-xs font-semibold text-foreground/80 shrink-0 flex items-center gap-1.5">
      批注评论
      <span className="text-muted-foreground font-normal">({comments.length})</span>
    </div>
    <ScrollArea className="flex-1 min-h-0 px-3">
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          {disabled ? '选择页面后可查看批注' : '暂无批注，来发表第一条吧'}
        </p>
      ) : (
        <div className="space-y-3 pb-3">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2">
              <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0">
                {(c.userName || c.userId || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate">{c.userName || c.userId}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatTime(c.createdAt)}</span>
                </div>
                <p className="text-xs text-foreground/80 mt-0.5 break-words whitespace-pre-wrap">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ScrollArea>
    <div className="p-2 border-t border-border/50 shrink-0 space-y-1.5">
      <Textarea
        value={draft}
        onChange={e => onDraftChange(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
        placeholder={disabled ? '请先选择原型页面' : '输入批注…'}
        disabled={disabled || sending}
        className="min-h-[52px] max-h-[90px] text-xs resize-none"
      />
      <div className="flex justify-end">
        <Button size="sm" className="h-7 text-xs gap-1" disabled={disabled || sending || !draft.trim()} onClick={onSubmit}>
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          发布
        </Button>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：原型画布（工具栏 + iframe + 状态栏）
// ─────────────────────────────────────────────────────────────────────────────

interface PrototypeCanvasProps {
  page: SelectedPage | null;
  loading: boolean;
  hasProducts: boolean;
  viewport: string;
  zoom: number;
  grid: boolean;
  interactive: boolean;
  annotateMode: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onViewportChange: (v: string) => void;
  onZoomChange: (v: number) => void;
  onGridChange: (v: boolean) => void;
  onInteractiveChange: (v: boolean) => void;
  onAnnotateModeChange: (v: boolean) => void;
  onFrameLoad: () => void;
  onCreateProduct: () => void;
  onCreatePage: () => void;
}

/** 画布工具栏：视口、缩放、网格、交互模式、标注模式开关。 */
const CanvasToolbar: React.FC<
  Pick<
    PrototypeCanvasProps,
    | 'viewport'
    | 'zoom'
    | 'grid'
    | 'interactive'
    | 'annotateMode'
    | 'onViewportChange'
    | 'onZoomChange'
    | 'onGridChange'
    | 'onInteractiveChange'
    | 'onAnnotateModeChange'
  >
> = ({
  viewport,
  zoom,
  grid,
  interactive,
  annotateMode,
  onViewportChange,
  onZoomChange,
  onGridChange,
  onInteractiveChange,
  onAnnotateModeChange,
}) => {
  const isFit = viewport === 'fit';
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-background/80 shrink-0 flex-wrap">
      <Select value={viewport} onValueChange={onViewportChange}>
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <MonitorPlay className="h-3.5 w-3.5 mr-1.5 opacity-60" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VIEWPORT_GROUPS.map(group => {
            const items = VIEWPORT_OPTIONS.filter(v => v.group === group);
            if (items.length === 0) return null;
            return (
              <SelectGroup key={group}>
                <SelectLabel className="text-[11px] text-muted-foreground">{group}</SelectLabel>
                {items.map(v => (
                  <SelectItem key={v.value} value={v.value} className="text-xs">
                    {v.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={isFit || zoom <= ZOOM_MIN}
          onClick={() => onZoomChange(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs w-10 text-center tabular-nums text-muted-foreground">{isFit ? '自适应' : `${zoom}%`}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={isFit || zoom >= ZOOM_MAX}
          onClick={() => onZoomChange(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Button
        variant={grid ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8 text-xs gap-1.5"
        onClick={() => onGridChange(!grid)}
      >
        <Grid3x3 className="h-3.5 w-3.5" />
        网格
      </Button>

      <Button
        variant={interactive ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8 text-xs gap-1.5"
        title={interactive ? '交互演示模式已开启：页面脚本可执行' : '交互演示模式已关闭：页面脚本被禁用'}
        onClick={() => onInteractiveChange(!interactive)}
      >
        <Eye className="h-3.5 w-3.5" />
        交互演示
      </Button>

      <Button
        variant={annotateMode ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8 text-xs gap-1.5"
        title={annotateMode ? '标注模式已开启：点击页面元素添加批注' : '标注模式已关闭'}
        onClick={() => onAnnotateModeChange(!annotateMode)}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        标注
      </Button>
    </div>
  );
};

/** 空状态引导。 */
const CanvasEmptyGuide: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ icon, title, description, actionLabel, onAction }) => (
  <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
    {icon}
    <p className="text-sm font-medium text-foreground/70">{title}</p>
    <p className="text-xs">{description}</p>
    <Button size="sm" className="mt-1 gap-1.5" onClick={onAction}>
      <Plus className="h-3.5 w-3.5" />
      {actionLabel}
    </Button>
  </div>
);

/** iframe 渲染单元：通过 src 加载后端静态服务，交互模式追加 allow-scripts 允许脚本执行。 */
const PrototypeFrame: React.FC<{
  page: SelectedPage;
  interactive: boolean;
  src: string;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onLoad: () => void;
}> = ({ page, interactive, src, iframeRef, onLoad }) => (
  <iframe
    key={`${page.itemId}-${interactive}`}
    ref={iframeRef}
    title={page.item.title}
    src={src}
    sandbox={interactive ? 'allow-scripts' : ''}
    className="w-full h-full border-0 bg-white"
    onLoad={onLoad}
  />
);

/** 原型画布：iframe 静态服务渲染，支持视口/缩放/网格/交互/标注模式。 */
const PrototypeCanvas: React.FC<PrototypeCanvasProps> = ({
  page,
  loading,
  hasProducts,
  viewport,
  zoom,
  grid,
  interactive,
  annotateMode,
  canvasRef,
  iframeRef,
  onViewportChange,
  onZoomChange,
  onGridChange,
  onInteractiveChange,
  onAnnotateModeChange,
  onFrameLoad,
  onCreateProduct,
  onCreatePage,
}) => {
  const viewportDef = VIEWPORT_OPTIONS.find(v => v.value === viewport) ?? VIEWPORT_OPTIONS[0];
  const isFit = viewportDef.width === 0;
  // 适配屏幕模式下缩放不生效（始终 100%），固定视口按 zoom 缩放；高度取预设的真实设备视口高
  const scale = isFit ? 1 : zoom / 100;
  const frameHeight = viewportDef.height;
  const frameSrc = useMemo(() => {
    if (!page) return '';
    const token = localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
    return `/api/v1/workspaces/${page.item.workspace_id}/product-space/serve/${encodeURI(page.item.relative_path)}?auth=${encodeURIComponent(token)}`;
  }, [page]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <CanvasToolbar
        viewport={viewport}
        zoom={zoom}
        grid={grid}
        interactive={interactive}
        annotateMode={annotateMode}
        onViewportChange={onViewportChange}
        onZoomChange={onZoomChange}
        onGridChange={onGridChange}
        onInteractiveChange={onInteractiveChange}
        onAnnotateModeChange={onAnnotateModeChange}
      />

      <div
        ref={canvasRef}
        className="relative flex-1 min-h-0 overflow-auto bg-muted/30"
        style={grid ? GRID_BACKGROUND : undefined}
      >
        {loading && (
          <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">加载原型页面…</span>
          </div>
        )}

        {!loading && !page && !hasProducts && (
          <CanvasEmptyGuide
            icon={<Box className="h-10 w-10 text-primary/40" />}
            title="还没有产品"
            description="产品对应原型目录下的一级文件夹，用于组织一组原型页面"
            actionLabel="新建产品"
            onAction={onCreateProduct}
          />
        )}

        {!loading && !page && hasProducts && (
          <CanvasEmptyGuide
            icon={<FileCode2 className="h-10 w-10 text-primary/40" />}
            title="选择或新建原型页面"
            description="从右侧页面树选择页面进行预览，或新建一个原型页面"
            actionLabel="新建原型页"
            onAction={onCreatePage}
          />
        )}

        {/* 适配屏幕模式：绝对定位撑满画布，避免百分比高度链断裂导致 iframe 塌陷 */}
        {!loading && page && isFit && (
          <div className="absolute inset-0 p-6">
            <div className="bg-white shadow-lg rounded-lg overflow-hidden ring-1 ring-border/40 w-full h-full">
              <PrototypeFrame page={page} interactive={interactive} src={frameSrc} iframeRef={iframeRef} onLoad={onFrameLoad} />
            </div>
          </div>
        )}

        {/* 固定视口模式：外层占位容器按缩放后尺寸撑开滚动区域，保证 transform 缩放后可完整滚动查看 */}
        {!loading && page && !isFit && (
          <div className="min-h-full min-w-full flex justify-center p-6">
            <div style={{ width: viewportDef.width * scale, height: frameHeight * scale, flexShrink: 0 }}>
              <div
                className="bg-white shadow-lg rounded-lg overflow-hidden ring-1 ring-border/40"
                style={{
                  width: viewportDef.width,
                  height: frameHeight,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }}
              >
                <PrototypeFrame page={page} interactive={interactive} src={frameSrc} iframeRef={iframeRef} onLoad={onFrameLoad} />
              </div>
            </div>
          </div>
        )}
      </div>

      {page && (
        <div className="px-3 py-1.5 border-t border-border/50 bg-background/80 text-[11px] text-muted-foreground flex items-center gap-4 shrink-0">
          <span className="truncate">{page.item.relative_path}</span>
          <span className="whitespace-nowrap ml-auto">最后更新 {formatTime(page.item.updated_at)}</span>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：对话框
// ─────────────────────────────────────────────────────────────────────────────

/** 新建产品对话框（产品 = prototypes 下一级目录）。 */
const CreateProductDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}> = ({ open, onOpenChange, onSubmit }) => {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('请输入产品名称');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(trimmed);
      setName('');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建产品</DialogTitle>
          <DialogDescription>产品用于组织一组相关的原型页面</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="product-name">产品名称</Label>
          <Input
            id="product-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：订单管理系统"
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** 新建原型页对话框：选择产品、分组（可新建）、页面名称。 */
const CreatePageDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductSpaceTreeNode[];
  defaultProduct: string;
  onSubmit: (params: { product: string; group: string; name: string }) => Promise<void>;
}> = ({ open, onOpenChange, products, defaultProduct, onSubmit }) => {
  const [product, setProduct] = useState(defaultProduct);
  const [group, setGroup] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setProduct(defaultProduct || products[0]?.name || '');
      setGroup('');
      setNewGroup('');
      setName('');
    }
  }, [open, defaultProduct, products]);

  const groups = useMemo(
    () => (products.find(p => p.name === product)?.children ?? []).filter(n => n.type === 'folder'),
    [products, product]
  );
  const effectiveGroup = group === NEW_GROUP_VALUE ? newGroup.trim() : group;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!product || !trimmed) {
      toast.error('请选择产品并输入页面名称');
      return;
    }
    if (group === NEW_GROUP_VALUE && !newGroup.trim()) {
      toast.error('请输入新分组名称');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ product, group: effectiveGroup, name: trimmed });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建原型页</DialogTitle>
          <DialogDescription>创建空白 HTML 原型页面骨架，后续可由 AI 生成内容</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>所属产品</Label>
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="选择产品" />
              </SelectTrigger>
              <SelectContent>
                {products.map(p => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>分组（可选）</Label>
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="不分组" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">不分组</SelectItem>
                {groups.map(g => (
                  <SelectItem key={g.path} value={g.name}>
                    {g.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_GROUP_VALUE}>＋ 新建分组…</SelectItem>
              </SelectContent>
            </Select>
            {group === NEW_GROUP_VALUE && (
              <Input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="新分组名称" className="h-9 mt-1.5" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="page-name">页面名称</Label>
            <Input
              id="page-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：登录页"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !product}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            创建页面
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** 权限说明对话框：原型管理仅 PM 可用（后端 requirePM 校验）。 */
const PermissionDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          权限设置
        </DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2 text-sm pt-1">
            <p>原型空间当前采用固定权限策略：</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>仅产品经理（PM）角色可创建、删除原型页面与文件夹</li>
              <li>仅 PM 可发表与查看批注评论</li>
              <li>分享链接面向空间内成员，访问需登录且具备空间权限</li>
            </ul>
            <p className="text-xs text-muted-foreground">细粒度成员级权限配置将在后续版本支持。</p>
          </div>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>知道了</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// ─────────────────────────────────────────────────────────────────────────────
// 子组件：标注与版本历史面板
// ─────────────────────────────────────────────────────────────────────────────

/** 添加标注批注对话框：点击页面元素后弹出，允许输入产品描述。 */
interface AnnotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetText?: string;
  onSubmit: (content: string) => Promise<void>;
}

const AnnotationDialog: React.FC<AnnotationDialogProps> = ({ open, onOpenChange, targetText, onSubmit }) => {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setContent('');
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error('请输入批注内容');
      return;
    }
    setSending(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            添加批注
          </DialogTitle>
          <DialogDescription>为选中的页面元素添加产品描述</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {targetText && (
            <div className="text-xs text-muted-foreground bg-muted rounded px-2 py-1.5 truncate">
              选中：{targetText}
            </div>
          )}
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
            placeholder="输入产品描述或批注…"
            className="min-h-[80px] max-h-[160px] text-xs resize-none"
            disabled={sending}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={sending || !content.trim()}>
            {sending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            发布
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface VersionsPanelProps {
  versions: ProductSpaceVersion[];
  loading: boolean;
  disabled: boolean;
  currentVersion: number;
  onRestore: (version: number) => void;
}

/** 版本历史面板：列出历史版本并提供恢复入口。 */
const VersionsPanel: React.FC<VersionsPanelProps> = ({ versions, loading, disabled, currentVersion, onRestore }) => (
  <div className="h-[30%] min-h-[180px] border-t border-border/50 flex flex-col shrink-0">
    <div className="px-3 py-2 text-xs font-semibold text-foreground/80 flex items-center gap-1.5 shrink-0">
      <History className="h-3.5 w-3.5" />
      版本历史
      <span className="text-muted-foreground font-normal">({versions.length})</span>
    </div>
    <ScrollArea className="flex-1 min-h-0 px-3">
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : disabled ? (
        <p className="text-xs text-muted-foreground text-center py-4">选择页面后可查看版本历史</p>
      ) : versions.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">暂无历史版本</p>
      ) : (
        <div className="space-y-2 pb-2">
          {versions.map(v => (
            <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium">
                  v{v.version}
                  {v.version === currentVersion && <span className="ml-1 text-muted-foreground">(当前)</span>}
                </div>
                <div className="text-muted-foreground truncate">{v.change_summary || '无描述'}</div>
                <div className="text-[10px] text-muted-foreground">{formatTime(v.created_at)}</div>
              </div>
              {v.version !== currentVersion && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onRestore(v.version)}>
                  恢复
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </ScrollArea>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// 主组件
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 原型预览工作台（AI HTML 原型协作平台）。
 *
 * 数据模型：产品 = prototypes 下一级目录；分组 = 二级目录；页面 = .html 文件。
 * 画布通过 iframe srcDoc 渲染 HTML，右侧栏提供页面树与批注评论。
 */
export const PrototypeWorkspace: React.FC = () => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  const [tree, setTree] = useState<ProductSpaceTreeNode[]>([]);
  const [loadingTree, setLoadingTree] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [page, setPage] = useState<SelectedPage | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [search, setSearch] = useState('');

  const [viewport, setViewport] = useState('fit');
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [grid, setGrid] = useState(false);
  const [interactive, setInteractive] = useState(true);

  const [comments, setComments] = useState<PrototypeComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  const [versions, setVersions] = useState<ProductSpaceVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    selector?: string;
    targetText?: string;
    x: number;
    y: number;
  } | null>(null);

  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductSpaceTreeNode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 分享深链仅应用一次，避免刷新树后重复跳转
  const deepLinkAppliedRef = useRef(false);

  const root = useMemo(() => findPrototypesRoot(tree), [tree]);
  const products = useMemo(() => listProducts(root), [root]);
  const product = useMemo(
    () => products.find(p => p.name === selectedProduct) ?? null,
    [products, selectedProduct]
  );

  const loadComments = useCallback(
    async (itemId: string) => {
      if (!workspaceId) return;
      setLoadingComments(true);
      try {
        const list = await productSpaceApi.listComments(workspaceId, itemId);
        setComments(list ?? []);
      } catch {
        toast.error('加载批注失败');
      } finally {
        setLoadingComments(false);
      }
    },
    [workspaceId]
  );

  const loadVersions = useCallback(
    async (itemId: string) => {
      if (!workspaceId) return;
      setLoadingVersions(true);
      try {
        const list = await productSpaceApi.listVersions(workspaceId, itemId);
        setVersions(list ?? []);
      } catch {
        toast.error('加载版本历史失败');
      } finally {
        setLoadingVersions(false);
      }
    },
    [workspaceId]
  );

  const loadPage = useCallback(
    async (itemId: string) => {
      if (!workspaceId) return;
      setLoadingPage(true);
      try {
        const detail = await productSpaceApi.getItem(workspaceId, itemId);
        setPage({ itemId, item: detail, html: decodeBase64Utf8(detail.content) });
        setAnnotateMode(false);
        loadComments(itemId);
        loadVersions(itemId);
      } catch {
        toast.error('加载原型页面失败');
        setPage(null);
      } finally {
        setLoadingPage(false);
      }
    },
    [workspaceId, loadComments, loadVersions]
  );

  const loadTree = useCallback(async () => {
    if (!workspaceId) return;
    setLoadingTree(true);
    try {
      const data = await productSpaceApi.tree(workspaceId);
      setTree(data ?? []);
    } catch {
      toast.error('加载原型目录失败');
    } finally {
      setLoadingTree(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // 树加载完成后的初始选择：优先应用分享深链，否则默认选中第一个产品
  useEffect(() => {
    if (loadingTree || products.length === 0) return;
    if (!deepLinkAppliedRef.current) {
      deepLinkAppliedRef.current = true;
      const linkItemId = new URLSearchParams(window.location.search).get(SHARE_QUERY_KEY);
      if (linkItemId) {
        const found = findNodeByItemId(products, linkItemId);
        if (found) {
          setSelectedProduct(found.productName);
          loadPage(linkItemId);
          return;
        }
      }
    }
    if (!selectedProduct || !products.some(p => p.name === selectedProduct)) {
      setSelectedProduct(products[0].name);
    }
  }, [loadingTree, products, selectedProduct, loadPage]);

  const handleSelectProduct = (name: string) => {
    setSelectedProduct(name);
    setPage(null);
    setComments([]);
    setVersions([]);
    setAnnotateMode(false);
  };

  const handleSelectPage = (node: ProductSpaceTreeNode) => {
    if (!node.id) return;
    setAnnotateMode(false);
    setPendingAnnotation(null);
    loadPage(node.id);
  };

  // 与 iframe 的标注脚本通信：切换标注模式、渲染标记。
  const postToFrame = useCallback((message: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(message, '*');
  }, []);

  const toFrameMarkers = useCallback((list: PrototypeComment[]) => {
    return list
      .filter(c => typeof c.x === 'number' && typeof c.y === 'number')
      .map(c => ({
        selector: c.selector,
        targetText: c.targetText,
        x: c.x,
        y: c.y,
        content: c.content,
        userName: c.userName,
        createdAt: c.createdAt,
      }));
  }, []);

  const handleFrameLoad = useCallback(() => {
    if (!page) return;
    postToFrame({ type: 'dh-set-annotate-mode', active: annotateMode });
    postToFrame({ type: 'dh-render-markers', markers: toFrameMarkers(comments) });
  }, [annotateMode, comments, page, postToFrame, toFrameMarkers]);

  useEffect(() => {
    if (!page) return;
    postToFrame({ type: 'dh-set-annotate-mode', active: annotateMode });
  }, [annotateMode, page, postToFrame]);

  useEffect(() => {
    if (!page) return;
    postToFrame({ type: 'dh-render-markers', markers: toFrameMarkers(comments) });
  }, [comments, page, postToFrame, toFrameMarkers]);

  // 监听 iframe 发送的标注点击事件，弹出批注对话框。
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data || {};
      if (data.type === 'dh-annotate-click') {
        setPendingAnnotation({
          selector: data.selector,
          targetText: data.targetText,
          x: data.x,
          y: data.y,
        });
        setAnnotationDialogOpen(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleInteractiveChange = useCallback((v: boolean) => {
    setInteractive(v);
    if (!v) setAnnotateMode(false);
  }, []);

  const handleAnnotateModeChange = useCallback((v: boolean) => {
    setAnnotateMode(v);
    if (v) setInteractive(true);
  }, []);

  const handleAnnotationSubmit = useCallback(
    async (content: string) => {
      if (!page || !pendingAnnotation) return;
      setSendingComment(true);
      try {
        await productSpaceApi.addComment(workspaceId, page.itemId, {
          content,
          selector: pendingAnnotation.selector,
          targetText: pendingAnnotation.targetText,
          x: pendingAnnotation.x,
          y: pendingAnnotation.y,
        });
        toast.success('批注已添加');
        setAnnotateMode(false);
        setPendingAnnotation(null);
        await loadComments(page.itemId);
      } catch {
        toast.error('添加批注失败');
      } finally {
        setSendingComment(false);
      }
    },
    [workspaceId, page, pendingAnnotation, loadComments]
  );

  const handleRestoreVersion = useCallback(
    async (version: number) => {
      if (!page) return;
      if (!window.confirm(`确认恢复至 v${version}？当前未保存的修改将丢失。`)) return;
      setRestoringVersion(version);
      try {
        await productSpaceApi.restoreVersion(workspaceId, page.itemId, version);
        toast.success(`已恢复至 v${version}`);
        await loadPage(page.itemId);
      } catch {
        toast.error('恢复版本失败');
      } finally {
        setRestoringVersion(null);
      }
    },
    [workspaceId, page, loadPage]
  );

  const handleCreateProduct = async (name: string) => {
    try {
      await productSpaceApi.createFolder(workspaceId, 'prototypes', name);
      toast.success('产品已创建');
      await loadTree();
      setSelectedProduct(name);
    } catch {
      toast.error('创建产品失败');
      throw new Error('create product failed');
    }
  };

  const handleCreatePage = async (params: { product: string; group: string; name: string }) => {
    try {
      const folder = params.group ? `${params.product}/${params.group}` : params.product;
      const item = await productSpaceApi.createPrototype(workspaceId, {
        title: params.name,
        folder,
        html: buildSkeletonHtml(params.name),
      });
      toast.success('原型页面已创建');
      setSelectedProduct(params.product);
      await loadTree();
      loadPage(item.id);
    } catch {
      toast.error('创建原型页面失败');
      throw new Error('create page failed');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      await productSpaceApi.deleteItem(workspaceId, deleteTarget.id);
      toast.success('页面已删除');
      if (page?.itemId === deleteTarget.id) {
        setPage(null);
        setComments([]);
        setVersions([]);
        setAnnotateMode(false);
      }
      await loadTree();
    } catch {
      toast.error('删除页面失败');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleShare = async () => {
    if (!page) {
      toast.error('请先选择要分享的原型页面');
      return;
    }
    const url = `${window.location.origin}/personal-space?tab=prototype&${SHARE_QUERY_KEY}=${page.itemId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('分享链接已复制', { description: url });
    } catch {
      toast.error('复制链接失败');
    }
  };

  const handleExportCurrent = () => {
    if (!page) return;
    downloadBlob(new Blob([page.html], { type: 'text/html;charset=utf-8' }), page.item.title);
    toast.success('已导出当前页面');
  };

  /** 批量导出：拉取当前产品下所有页面 HTML 并打包为 zip。 */
  const handleExportAll = async () => {
    if (!product) return;
    const nodes: ProductSpaceTreeNode[] = [];
    for (const child of product.children ?? []) {
      if (child.type === 'prototype') nodes.push(child);
      nodes.push(...(child.children ?? []).filter(n => n.type === 'prototype'));
    }
    if (nodes.length === 0) {
      toast.error('当前产品暂无可导出的页面');
      return;
    }
    setExporting(true);
    try {
      const zip = new JSZip();
      await Promise.all(
        nodes.map(async n => {
          if (!n.id) return;
          const detail = await productSpaceApi.getItem(workspaceId, n.id);
          // zip 内路径去掉 prototypes/ 前缀，保留 产品/分组/页面 层级
          const zipPath = n.path.replace(new RegExp(`^${PROTOTYPES_ROOT}/`), '');
          zip.file(zipPath, decodeBase64Utf8(detail.content));
        })
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${product.name}-原型.zip`);
      toast.success(`已导出 ${nodes.length} 个页面`);
    } catch {
      toast.error('批量导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleFullscreen = () => {
    canvasRef.current?.requestFullscreen?.();
  };

  const handleSubmitComment = async () => {
    const content = commentDraft.trim();
    if (!page || !content) return;
    setSendingComment(true);
    try {
      const created = await productSpaceApi.addComment(workspaceId, page.itemId, { content });
      setComments(prev => [created, ...prev]);
      setCommentDraft('');
    } catch {
      toast.error('发布批注失败');
    } finally {
      setSendingComment(false);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 顶栏：标题 + 全局操作 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90 gap-3">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">原型预览</span>
          {product && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {product.name}
              {page ? ` / ${page.item.title.replace(/\.html$/i, '')}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={handleShare} disabled={!page}>
            <Share2 className="h-3.5 w-3.5" />
            分享
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" disabled={!page || exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                导出
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCurrent}>导出当前页面（HTML）</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportAll}>导出全部页面（ZIP）</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setPermissionOpen(true)}>
            <Lock className="h-3.5 w-3.5" />
            权限设置
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={handleFullscreen} disabled={!page}>
            <Fullscreen className="h-3.5 w-3.5" />
            全屏
          </Button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <PrototypeCanvas
          page={page}
          loading={loadingPage || loadingTree}
          hasProducts={products.length > 0}
          viewport={viewport}
          zoom={zoom}
          grid={grid}
          interactive={interactive}
          annotateMode={annotateMode}
          canvasRef={canvasRef}
          iframeRef={iframeRef}
          onViewportChange={setViewport}
          onZoomChange={setZoom}
          onGridChange={setGrid}
          onInteractiveChange={handleInteractiveChange}
          onAnnotateModeChange={handleAnnotateModeChange}
          onFrameLoad={handleFrameLoad}
          onCreateProduct={() => setCreateProductOpen(true)}
          onCreatePage={() => setCreatePageOpen(true)}
        />

        {/* 右侧栏：页面树 + 版本历史 + 批注评论 */}
        <aside className="w-[340px] border-l border-border/50 flex flex-col min-h-0 shrink-0 bg-background/60">
          <PageTreePanel
            products={products}
            product={product}
            selectedItemId={page?.itemId ?? ''}
            search={search}
            loading={loadingTree}
            onSearchChange={setSearch}
            onSelectProduct={handleSelectProduct}
            onSelectPage={handleSelectPage}
            onDeletePage={setDeleteTarget}
            onCreateProduct={() => setCreateProductOpen(true)}
            onCreatePage={() => setCreatePageOpen(true)}
            onRefresh={loadTree}
          />
          <VersionsPanel
            versions={versions}
            loading={loadingVersions}
            disabled={!page}
            currentVersion={page?.item.current_version ?? 0}
            onRestore={handleRestoreVersion}
          />
          <CommentsPanel
            comments={comments}
            loading={loadingComments}
            disabled={!page}
            draft={commentDraft}
            sending={sendingComment}
            onDraftChange={setCommentDraft}
            onSubmit={handleSubmitComment}
          />
        </aside>
      </div>

      <CreateProductDialog open={createProductOpen} onOpenChange={setCreateProductOpen} onSubmit={handleCreateProduct} />
      <CreatePageDialog
        open={createPageOpen}
        onOpenChange={setCreatePageOpen}
        products={products}
        defaultProduct={selectedProduct}
        onSubmit={handleCreatePage}
      />
      <PermissionDialog open={permissionOpen} onOpenChange={setPermissionOpen} />
      <AnnotationDialog
        open={annotationDialogOpen}
        onOpenChange={open => {
          if (!open) setAnnotateMode(false);
          setAnnotationDialogOpen(open);
        }}
        targetText={pendingAnnotation?.targetText}
        onSubmit={handleAnnotationSubmit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              删除原型页面
            </AlertDialogTitle>
            <AlertDialogDescription>
              确认删除页面「{deleteTarget?.name.replace(/\.html$/i, '')}」？其全部版本与批注将一并删除，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
