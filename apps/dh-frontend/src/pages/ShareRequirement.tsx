import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  MousePointerClick,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  requirementShareApi,
  type AddCommentRequest,
  type AddRequirementShareDocCommentRequest,
  type PrototypeComment,
  type SharedDocInfo,
  type SharedPrototypePage,
  type SharedRequirementView,
} from '@/lib/productspace-api';
import type { ShareComment } from '@/lib/productdoc-api';
import { CommentPanel } from '@/components/share/CommentPanel';
import { CommentFloatingPill } from '@/components/share/CommentFloatingPill';
import { CommentHoverCard } from '@/components/share/CommentHoverCard';
import { applyDocHighlights, scrollToDocComment } from '@/components/share/doc-highlights';
import type { DisplayComment } from '@/components/share/types';

/** 与后端 injectPrototypeAnnotationScript 对齐的 iframe 消息类型。 */
const MSG_RENDER_MARKERS = 'dh-render-markers';
const MSG_SET_MARKER_CLICKABLE = 'dh-set-marker-clickable';
const MSG_SET_ANNOTATE_MODE = 'dh-set-annotate-mode';
const MSG_FOCUS_MARKER = 'dh-focus-marker';
const MSG_MARKER_CLICK = 'dh-marker-click';
const MSG_MARKER_HOVER = 'dh-marker-hover';
const MSG_MARKER_LEAVE = 'dh-marker-leave';
const MSG_ANNOTATE_CLICK = 'dh-annotate-click';

/** 左侧页面列表固定宽度（像素）。 */
const PAGE_LIST_WIDTH = 200;

/** 批注人昵称本地存储 key。 */
const NICKNAME_STORAGE_KEY = 'share-comment-nickname';
/** 文档批注引用/内容长度限制（与后端一致）。 */
const MAX_QUOTE_LENGTH = 500;
const MAX_COMMENT_LENGTH = 2000;
const MAX_AUTHOR_LENGTH = 64;

/** 浮动批注输入框半宽，用于贴边选区时的位置钳制。 */
const COMPOSER_HALF_WIDTH = 150;

/** 批注悬浮卡片消失的延迟时间（毫秒），避免鼠标短暂划过导致闪烁。 */
const HOVER_LEAVE_DELAY_MS = 150;

/** 轻量 cn 合并，避免落地页引入外部 utils 依赖。 */
function cn(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** 将批注列表转换为 iframe 标记数据：序号按添加顺序（最早为 1），与列表一致。 */
function toFrameMarkers(list: PrototypeComment[]): Array<Record<string, unknown>> {
  const total = list.length;
  const markers: Array<Record<string, unknown>> = [];
  list.forEach((c, idx) => {
    if (typeof c.x !== 'number' || typeof c.y !== 'number') return;
    markers.push({
      id: c.id,
      seq: total - idx,
      x: c.x,
      y: c.y,
      content: c.content,
      userName: c.userName,
    });
  });
  return markers;
}

/** 将浮动元素的 x 坐标钳制在视口内，避免贴边选区时溢出屏幕。 */
function clampX(x: number, halfWidth: number): number {
  return Math.min(Math.max(x, halfWidth), window.innerWidth - halfWidth);
}

/** 选区信息：锚定文本 + 浮动按钮位置（视口坐标）。 */
interface SelectionInfo {
  quote: string;
  x: number;
  y: number;
}

/**
 * 将文档批注列表映射为统一展示类型。
 * 列表按时间倒序返回（最新在前），因此序号 = 总数 - 索引。
 */
function toDocDisplayComments(comments: ShareComment[]): DisplayComment[] {
  const total = comments.length;
  return comments.map((c, idx) => ({
    id: c.id,
    seq: total - idx,
    author: c.authorName,
    content: c.content,
    targetText: c.quoteText,
    createdAt: c.createdAt,
    raw: c,
  }));
}

/**
 * 将原型批注列表映射为统一展示类型。
 */
function toPrototypeDisplayComments(comments: PrototypeComment[]): DisplayComment[] {
  const total = comments.length;
  return comments.map((c, idx) => ({
    id: c.id,
    seq: total - idx,
    author: c.userName,
    content: c.content,
    targetText: c.targetText,
    createdAt: c.createdAt,
    raw: c,
  }));
}

/**
 * 需求级统一分享落地页（免登录）。
 *
 * 通过 /share/requirement/:token 访问，顶部展示需求名称，
 * 使用 Tab 切换「需求文档」与「原型预览」；
 * 文档页支持选中文本添加批注，原型页支持批注模式点击元素添加批注。
 */
export const ShareRequirement: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<SharedRequirementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // 当前激活的 Tab：文档或原型
  const [activeTab, setActiveTab] = useState<'doc' | 'prototype'>('doc');
  const hasDoc = !!view?.doc;
  const hasProto = !!view?.prototype && view.prototype.pages.length > 0;

  // 原型相关状态
  const [selectedPage, setSelectedPage] = useState<SharedPrototypePage | null>(null);
  const [comments, setComments] = useState<PrototypeComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [activeComment, setActiveComment] = useState<PrototypeComment | null>(null);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotationDialogOpen, setAnnotationDialogOpen] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    selector?: string;
    targetText?: string;
    x: number;
    y: number;
  } | null>(null);
  const [sendingPrototypeComment, setSendingPrototypeComment] = useState(false);

  // 文档批注状态
  const [docComments, setDocComments] = useState<ShareComment[]>([]);
  const [docCommentsLoading, setDocCommentsLoading] = useState(false);
  const [activeDocComment, setActiveDocComment] = useState<ShareComment | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [authorName, setAuthorName] = useState(() => localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '');
  const [draft, setDraft] = useState('');
  const [sendingDocComment, setSendingDocComment] = useState(false);

  // 最大化：使用浏览器 Fullscreen API
  const containerRef = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);

  // 鼠标悬停批注卡片
  const [hoveredComment, setHoveredComment] = useState<DisplayComment | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const doc = view?.doc;
  const prototype = view?.prototype;
  const allowComments = view?.allowComments ?? false;

  // 统一展示列表
  const displayComments = useMemo<DisplayComment[]>(
    () => (activeTab === 'doc' ? toDocDisplayComments(docComments) : toPrototypeDisplayComments(comments)),
    [activeTab, docComments, comments]
  );

  const showHoverCard = useCallback((comment: DisplayComment, x: number, y: number) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredComment(comment);
    setHoverPos({ x, y });
  }, []);

  const hideHoverCard = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredComment(null);
    }, HOVER_LEAVE_DELAY_MS);
  }, []);

  // 加载统一分享视图
  useEffect(() => {
    if (!token) return;
    requirementShareApi
      .getView(token)
      .then(data => {
        setView(data);
        if (data.prototype?.pages && data.prototype.pages.length > 0) {
          setSelectedPage(data.prototype.pages[0]);
        }
        // 默认优先展示文档；无文档则展示原型
        setActiveTab(data.doc ? 'doc' : 'prototype');
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  const iframeSrc = useMemo(() => {
    if (!token || !selectedPage) return '';
    return requirementShareApi.serveUrl(token, selectedPage.relativePath);
  }, [token, selectedPage]);

  // 加载选中页面的原型批注
  useEffect(() => {
    if (!token || !selectedPage) {
      setComments([]);
      setActiveComment(null);
      return;
    }
    setCommentsLoading(true);
    setActiveComment(null);
    requirementShareApi
      .listComments(token, selectedPage.itemId)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [token, selectedPage]);

  // 加载文档批注
  const loadDocComments = useCallback(async () => {
    if (!token || !doc) {
      setDocComments([]);
      return;
    }
    setDocCommentsLoading(true);
    try {
      const list = await requirementShareApi.listDocComments(token);
      setDocComments(list ?? []);
    } catch {
      setDocComments([]);
    } finally {
      setDocCommentsLoading(false);
    }
  }, [token, doc]);

  useEffect(() => {
    loadDocComments();
  }, [loadDocComments]);

  // 向 iframe 发送消息
  const postToFrame = useCallback((message: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(message, '*');
  }, []);

  // iframe 加载完成后：启用可点击标记 + 渲染批注标记 + 同步批注模式
  const handleFrameLoad = useCallback(() => {
    postToFrame({ type: MSG_SET_MARKER_CLICKABLE, active: true });
    postToFrame({ type: MSG_RENDER_MARKERS, markers: toFrameMarkers(comments) });
    postToFrame({ type: MSG_SET_ANNOTATE_MODE, active: annotateMode });
  }, [comments, annotateMode, postToFrame]);

  // 批注变化时重新渲染标记
  useEffect(() => {
    if (!selectedPage) return;
    postToFrame({ type: MSG_RENDER_MARKERS, markers: toFrameMarkers(comments) });
  }, [comments, selectedPage, postToFrame]);

  // 批注模式变化时同步 iframe
  useEffect(() => {
    if (!selectedPage) return;
    postToFrame({ type: MSG_SET_ANNOTATE_MODE, active: annotateMode });
  }, [annotateMode, selectedPage, postToFrame]);

  // 监听 iframe 标记点击/悬停/离开事件
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data || {};
      if (data.type === MSG_MARKER_CLICK) {
        const found = comments.find(c => c.id === data.id);
        if (found) {
          setActiveComment(found);
          postToFrame({ type: MSG_FOCUS_MARKER, id: found.id });
        }
        return;
      }
      if (data.type === MSG_MARKER_HOVER) {
        const found = displayComments.find(c => c.id === data.id);
        if (found) {
          const iframeRect = iframeRef.current?.getBoundingClientRect();
          const x = (iframeRect?.left ?? 0) + (Number(data.clientX) || 0);
          const y = (iframeRect?.top ?? 0) + (Number(data.clientY) || 0);
          showHoverCard(found, x, y);
        }
        return;
      }
      if (data.type === MSG_MARKER_LEAVE) {
        hideHoverCard();
        return;
      }
      if (data.type === MSG_ANNOTATE_CLICK) {
        if (!allowComments) {
          toast.error('该分享未开放批注权限');
          return;
        }
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
  }, [comments, allowComments, displayComments, postToFrame, showHoverCard, hideHoverCard]);

  // 文档正文高亮：在 MarkdownView 渲染完成后对 quoteText 进行下划线 + 序号徽章包裹
  useEffect(() => {
    if (activeTab !== 'doc' || !contentRef.current || docCommentsLoading) return;
    const timer = requestAnimationFrame(() => {
      if (!contentRef.current) return;
      applyDocHighlights(contentRef.current, docComments, {
        onClick: comment => {
          setActiveDocComment(comment);
          scrollToDocComment(contentRef.current!, comment.id);
        },
        onHover: (comment, clientX, clientY) => {
          const found = displayComments.find(c => c.id === comment.id);
          if (found) showHoverCard(found, clientX, clientY);
        },
        onLeave: hideHoverCard,
      });
    });
    return () => cancelAnimationFrame(timer);
  }, [activeTab, docComments, docCommentsLoading, doc?.content, displayComments, showHoverCard, hideHoverCard]);

  // 最大化/还原
  const handleToggleMaximize = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handleChange = () => setMaximized(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  // 点击原型批注列表项或浮动胶囊序号时：通知 iframe 滚动并高亮标记，
  // 同时在 iframe 中心位置展示批注详情弹层（标记经 scrollIntoView 居中）。
  const handleLocatePrototypeComment = useCallback(
    (display: DisplayComment) => {
      const raw = display.raw as PrototypeComment;
      setActiveComment(raw);
      postToFrame({ type: MSG_FOCUS_MARKER, id: raw.id });
      // focusMarker 使用 scrollIntoView({ block: 'center' })，标记会滚动到 iframe 中心，
      // 因此在 iframe 中心位置展示弹层，位置与标记基本重合。
      const iframeRect = iframeRef.current?.getBoundingClientRect();
      if (iframeRect) {
        showHoverCard(display, iframeRect.left + iframeRect.width / 2, iframeRect.top + iframeRect.height / 2);
      }
    },
    [postToFrame, showHoverCard]
  );

  // 点击文档批注列表项或浮动胶囊序号时：滚动到高亮位置并展示批注详情弹层。
  const handleLocateDocComment = useCallback((display: DisplayComment) => {
    const raw = display.raw as ShareComment;
    setActiveDocComment(raw);
    if (contentRef.current) {
      scrollToDocComment(contentRef.current, raw.id);
      // 查找高亮徽章元素，在其位置展示弹层
      const badge = contentRef.current.querySelector<HTMLElement>(
        `.dh-doc-highlight .dh-doc-badge[data-comment-id="${raw.id}"]`
      );
      if (badge) {
        const rect = badge.getBoundingClientRect();
        showHoverCard(display, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    }
  }, [showHoverCard]);

  const handleLocateComment = useCallback(
    (display: DisplayComment) => {
      if (activeTab === 'prototype') {
        handleLocatePrototypeComment(display);
      } else {
        handleLocateDocComment(display);
      }
    },
    [activeTab, handleLocatePrototypeComment, handleLocateDocComment]
  );

  // 原型批注提交
  const handleAnnotationSubmit = useCallback(
    async (content: string) => {
      if (!token || !selectedPage || !pendingAnnotation) return;
      setSendingPrototypeComment(true);
      try {
        const req: AddCommentRequest = {
          content,
          selector: pendingAnnotation.selector,
          targetText: pendingAnnotation.targetText,
          x: pendingAnnotation.x,
          y: pendingAnnotation.y,
        };
        await requirementShareApi.addPrototypeComment(token, selectedPage.itemId, req);
        setAnnotateMode(false);
        setPendingAnnotation(null);
        setAnnotationDialogOpen(false);
        const list = await requirementShareApi.listComments(token, selectedPage.itemId);
        setComments(list ?? []);
      } catch {
        toast.error('添加批注失败');
      } finally {
        setSendingPrototypeComment(false);
      }
    },
    [token, selectedPage, pendingAnnotation]
  );

  // 文档选区检测
  const handleContentMouseUp = useCallback(() => {
    if (composerOpen || !allowComments) return;
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    if (!sel || !quote || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!contentRef.current?.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    if (quote.length > MAX_QUOTE_LENGTH) {
      toast.error(`选中文本超过 ${MAX_QUOTE_LENGTH} 字，请缩短选区`);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelection({ quote, x: rect.left + rect.width / 2, y: rect.top });
  }, [composerOpen, allowComments]);

  // 文档批注提交
  const handleSubmitDocComment = useCallback(async () => {
    if (!token || !selection) return;
    const name = authorName.trim();
    const content = draft.trim();
    if (!name) {
      toast.error('请填写昵称');
      return;
    }
    if (!content) {
      toast.error('请填写批注内容');
      return;
    }
    setSendingDocComment(true);
    try {
      const req: AddRequirementShareDocCommentRequest = {
        authorName: name.slice(0, MAX_AUTHOR_LENGTH),
        quoteText: selection.quote,
        content,
      };
      await requirementShareApi.addDocComment(token, req);
      localStorage.setItem(NICKNAME_STORAGE_KEY, name);
      setDraft('');
      setComposerOpen(false);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      await loadDocComments();
    } catch {
      toast.error('发表批注失败');
    } finally {
      setSendingDocComment(false);
    }
  }, [token, selection, authorName, draft, loadDocComments]);

  // 点击文档批注输入框外部时关闭输入框
  useEffect(() => {
    if (!composerOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setComposerOpen(false);
        setSelection(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleMouseDown), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [composerOpen]);

  // 添加/切换批注入口：右侧面板 + 按钮使用
  const handleAddDocComment = useCallback(() => {
  }, []);

  const handleAddPrototypeComment = useCallback(() => {
    if (!allowComments) {
      toast.error('该分享未开放批注权限');
      return;
    }
    setAnnotateMode(true);
  }, [allowComments]);

  const handleAddComment = useCallback(() => {
    if (activeTab === 'prototype') {
      handleAddPrototypeComment();
    } else {
      handleAddDocComment();
    }
  }, [activeTab, handleAddDocComment, handleAddPrototypeComment]);

  // 页面切换
  const goPrevPage = useCallback(() => {
    if (!prototype?.pages.length) return;
    const idx = selectedPage ? prototype.pages.findIndex(p => p.itemId === selectedPage.itemId) : 0;
    const nextIdx = idx <= 0 ? prototype.pages.length - 1 : idx - 1;
    setSelectedPage(prototype.pages[nextIdx]);
  }, [prototype, selectedPage]);

  const goNextPage = useCallback(() => {
    if (!prototype?.pages.length) return;
    const idx = selectedPage ? prototype.pages.findIndex(p => p.itemId === selectedPage.itemId) : 0;
    const nextIdx = idx < 0 || idx >= prototype.pages.length - 1 ? 0 : idx + 1;
    setSelectedPage(prototype.pages[nextIdx]);
  }, [prototype, selectedPage]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        加载中…
      </div>
    );
  }

  if (notFound || !view || (!doc && !prototype)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-muted-foreground gap-3">
        <p className="text-sm">分享链接不存在或已失效</p>
      </div>
    );
  }

  const title = view.title || doc?.title || prototype?.productFolder || '需求分享';

  return (
    <div ref={containerRef} className="h-screen bg-background flex flex-col overflow-hidden">
      {/* 顶栏：需求名 + Tab 切换 + 最大化 */}
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 grid place-items-center shrink-0">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <h1 className="text-base font-semibold truncate flex-1">{title}</h1>

          {/* Tab 切换 */}
          {hasDoc && hasProto && (
            <div className="flex items-center bg-muted rounded-md p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('doc')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors',
                  activeTab === 'doc' && 'bg-background text-foreground shadow-sm'
                )}
              >
                <FileText className="h-3.5 w-3.5" />
                需求文档
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('prototype')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm transition-colors',
                  activeTab === 'prototype' && 'bg-background text-foreground shadow-sm'
                )}
              >
                <Eye className="h-3.5 w-3.5" />
                原型预览
              </button>
            </div>
          )}

          {/* 原型页的批注模式入口（与右侧面板 + 按钮、浮动批注 pill 互为独立入口） */}
          {activeTab === 'prototype' && allowComments && (
            <Button
              variant={annotateMode ? 'default' : 'ghost'}
              size="sm"
              className="h-8 gap-1.5 shrink-0"
              onClick={() => setAnnotateMode(prev => !prev)}
              title={annotateMode ? '退出批注模式' : '进入批注模式'}
            >
              <MousePointerClick className="h-4 w-4" />
              {annotateMode ? '退出批注' : '批注'}
            </Button>
          )}

          <Button variant="ghost" size="sm" className="h-8 gap-1.5 shrink-0" onClick={handleToggleMaximize}>
            {maximized ? (
              <>
                <Minimize2 className="h-4 w-4" />
                还原
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4" />
                最大化
              </>
            )}
          </Button>
        </div>
      </header>

      {/* 内容区 */}
      <main className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* 文档 Tab */}
        {activeTab === 'doc' && doc && (
          <>
            <section className={cn('flex-1 flex flex-col min-h-0', maximized && 'w-full')}>
              <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">{doc.title}</span>
                  {doc.createdByName && <span>· 发布人：{doc.createdByName}</span>}
                  <span>· 版本 {doc.version}</span>
                  <span>· {new Date(doc.publishedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <article
                  ref={contentRef as React.RefObject<HTMLElement>}
                  className="prose prose-sm dark:prose-invert max-w-none p-6"
                  onMouseUp={handleContentMouseUp}
                >
                  <MarkdownView content={doc.content} collapsible={false} />
                </article>
              </ScrollArea>
            </section>

            {/* 文档批注面板（最大化时隐藏） */}
            {!maximized && (
              <CommentPanel
                title="批注"
                comments={displayComments}
                loading={docCommentsLoading}
                activeId={activeDocComment?.id}
                allowComments={allowComments}
                emptyHint={allowComments ? '暂无批注。选中正文任意文本或点击 + 发表批注' : '暂无批注'}
                onAdd={handleAddComment}
                onSelect={handleLocateDocComment}
              />
            )}
          </>
        )}

        {/* 原型 Tab */}
        {activeTab === 'prototype' && prototype && (
          <>
            {/* 页面列表（最大化时隐藏） */}
            {!maximized && (
              <aside
                className="border-r border-border/50 flex flex-col shrink-0 bg-background/60"
                style={{ width: PAGE_LIST_WIDTH }}
              >
                <div className="px-3 py-2 border-b border-border/50 text-xs font-medium flex items-center gap-1.5 shrink-0">
                  <Eye className="h-3.5 w-3.5 text-primary" />
                  页面
                </div>
                <ScrollArea className="flex-1 p-2">
                  <div className="space-y-0.5">
                    {prototype.pages.map(page => (
                      <button
                        key={page.itemId}
                        onClick={() => {
                          setSelectedPage(page);
                          setAnnotateMode(false);
                        }}
                        className={cn(
                          'w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors truncate',
                          selectedPage?.itemId === page.itemId
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-foreground/80 hover:bg-muted'
                        )}
                        title={page.title.replace(/\.html$/i, '')}
                      >
                        {page.title.replace(/\.html$/i, '')}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </aside>
            )}

            {/* iframe 预览 */}
            <div className="flex-1 bg-muted/30 relative min-h-0">
              {iframeSrc ? (
                <iframe
                  ref={iframeRef}
                  src={iframeSrc}
                  onLoad={handleFrameLoad}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin"
                  title="原型预览"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">暂无原型页面</div>
              )}
            </div>

            {/* 原型批注面板（最大化时隐藏） */}
            {!maximized && (
              <CommentPanel
                title="批注"
                comments={displayComments}
                loading={commentsLoading}
                activeId={activeComment?.id}
                allowComments={allowComments}
                emptyHint={allowComments ? '点击右上角 + 进入批注模式，然后在页面上点击元素添加批注' : '暂无批注'}
                onAdd={handleAddComment}
                onSelect={handleLocatePrototypeComment}
              />
            )}
          </>
        )}

        {/* 最大化模式：页面切换箭头（仅原型） */}
        {maximized && activeTab === 'prototype' && prototype && prototype.pages.length > 0 && (
          <>
            <button
              type="button"
              onClick={goPrevPage}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-background/90 border border-border/50 shadow flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goNextPage}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-background/90 border border-border/50 shadow flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

      </main>

      {/* 右下角浮动批注入口（最大化等场景）：点击打开批注 Sheet，悬停显示序号快速跳转 */}
      {maximized && (allowComments || displayComments.length > 0) && (
        <div className="fixed bottom-4 right-4 z-20">
          <CommentFloatingPill
            count={displayComments.length}
            comments={displayComments}
            onSelect={handleLocateComment}
          />
        </div>
      )}

      {/* 原型批注输入对话框（最大化时渲染到 containerRef 内，避免 portal 被 Fullscreen API 遮挡） */}
      <Dialog open={annotationDialogOpen} onOpenChange={setAnnotationDialogOpen}>
        <DialogContent className="sm:max-w-md" container={maximized ? containerRef.current : undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" />
              添加批注
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {pendingAnnotation?.targetText && (
              <div className="text-xs text-muted-foreground bg-muted rounded px-2 py-1.5 break-words">
                选中：{pendingAnnotation.targetText}
              </div>
            )}
            <AnnotationForm
              onSubmit={handleAnnotationSubmit}
              onCancel={() => {
                setAnnotationDialogOpen(false);
                setAnnotateMode(false);
                setPendingAnnotation(null);
              }}
              loading={sendingPrototypeComment}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 鼠标悬停批注详情卡片 */}
      <CommentHoverCard
        comment={hoveredComment}
        x={hoverPos.x}
        y={hoverPos.y}
        onMouseEnter={() => {
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
        }}
        onMouseLeave={hideHoverCard}
      />

      {/* 文档选中文本后的浮动批注入口 / 输入框 */}
      {activeTab === 'doc' && selection && !composerOpen && (
        <div
          className="fixed z-20 -translate-x-1/2 -translate-y-full"
          style={{ left: clampX(selection.x, 40), top: selection.y - 8 }}
        >
          <Button
            size="sm"
            className="h-7 text-xs gap-1 shadow-lg"
            onMouseDown={e => {
              e.preventDefault();
              setComposerOpen(true);
            }}
          >
            <MessageSquarePlus className="h-3 w-3" />
            批注
          </Button>
        </div>
      )}

      {activeTab === 'doc' && selection && composerOpen && (
        <div
          ref={composerRef}
          className="fixed z-20 -translate-x-1/2 w-72 rounded-lg border border-border bg-background shadow-xl p-3 space-y-2"
          style={{ left: clampX(selection.x, COMPOSER_HALF_WIDTH), top: selection.y + 24 }}
        >
          <blockquote className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 line-clamp-2 break-words">
            {selection.quote}
          </blockquote>
          <Input
            value={authorName}
            onChange={e => setAuthorName(e.target.value)}
            placeholder="你的昵称"
            className="h-8 text-xs"
            maxLength={MAX_AUTHOR_LENGTH}
          />
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
            placeholder="输入批注内容…"
            className="min-h-[60px] max-h-[120px] text-xs resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setComposerOpen(false);
                setSelection(null);
              }}
            >
              取消
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" disabled={sendingDocComment} onClick={handleSubmitDocComment}>
              {sendingDocComment ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              发表
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

/** 批注内容输入表单（复用于原型批注对话框）。 */
const AnnotationForm: React.FC<{
  onSubmit: (content: string) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}> = ({ onSubmit, onCancel, loading }) => {
  const [content, setContent] = useState('');

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error('请输入批注内容');
      return;
    }
    await onSubmit(trimmed);
    setContent('');
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={content}
        onChange={e => setContent(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
        placeholder="输入批注内容…"
        className="min-h-[120px] text-sm resize-none"
        disabled={loading}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button size="sm" disabled={loading || !content.trim()} onClick={handleSubmit}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
          发布
        </Button>
      </div>
    </div>
  );
};
