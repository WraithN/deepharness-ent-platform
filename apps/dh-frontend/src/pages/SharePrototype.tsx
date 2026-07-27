import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileCode, Loader2, Maximize2, Minimize2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  prototypeShareApi,
  type SharedPrototypePage,
  type PrototypeComment,
} from '@/lib/productspace-api';

/** iframe 标注脚本通信消息类型，与后端 injectPrototypeAnnotationScript 对齐。 */
const MSG_RENDER_MARKERS = 'dh-render-markers';
const MSG_SET_MARKER_CLICKABLE = 'dh-set-marker-clickable';
const MSG_FOCUS_MARKER = 'dh-focus-marker';
const MSG_MARKER_CLICK = 'dh-marker-click';

/** 左侧文件列表固定宽度（像素）。 */
const SIDEBAR_WIDTH = 240;
/** 批注详情面板宽度（像素）。 */
const COMMENT_PANEL_WIDTH = 320;

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

/** 格式化时间戳为 MM-DD HH:mm。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 原型产品分享落地页（免登录）。
 *
 * 通过 /share/prototype/:token 访问，左侧展示该产品下全部原型页面列表，
 * 右侧 iframe 渲染选中页面的 HTML 并叠加批注数字标记。
 * 点击数字标记可查看批注详情，支持最大化全屏预览。
 */
export const SharePrototype: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [pages, setPages] = useState<SharedPrototypePage[]>([]);
  const [productFolder, setProductFolder] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [comments, setComments] = useState<PrototypeComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [activeComment, setActiveComment] = useState<PrototypeComment | null>(null);
  const [maximized, setMaximized] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 加载分享视图（产品名 + 页面列表）
  useEffect(() => {
    if (!token) return;
    prototypeShareApi
      .getView(token)
      .then(view => {
        setProductFolder(view.productFolder);
        setPages(view.pages);
        if (view.pages.length > 0) {
          setSelectedItemId(view.pages[0].itemId);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  // 加载选中页面的批注
  useEffect(() => {
    if (!token || !selectedItemId) return;
    setCommentsLoading(true);
    setActiveComment(null);
    prototypeShareApi
      .listComments(token, selectedItemId)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [token, selectedItemId]);

  const selectedPage = useMemo(
    () => pages.find(p => p.itemId === selectedItemId) ?? null,
    [pages, selectedItemId],
  );

  // 向 iframe 发送消息
  const postToFrame = useCallback((message: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(message, '*');
  }, []);

  // iframe 加载完成后：启用可点击标记 + 渲染批注标记
  const handleFrameLoad = useCallback(() => {
    postToFrame({ type: MSG_SET_MARKER_CLICKABLE, active: true });
    postToFrame({ type: MSG_RENDER_MARKERS, markers: toFrameMarkers(comments) });
  }, [comments, postToFrame]);

  // 批注变化时重新渲染标记
  useEffect(() => {
    if (!selectedItemId) return;
    postToFrame({ type: MSG_RENDER_MARKERS, markers: toFrameMarkers(comments) });
  }, [comments, selectedItemId, postToFrame]);

  // 监听 iframe 标记点击，展示批注详情
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data || {};
      if (data.type !== MSG_MARKER_CLICK) return;
      const found = comments.find(c => c.id === data.id);
      if (found) {
        setActiveComment(found);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [comments]);

  // 点击批注列表项时，通知 iframe 滚动并高亮对应标记
  const handleLocateComment = useCallback(
    (c: PrototypeComment) => {
      setActiveComment(c);
      postToFrame({ type: MSG_FOCUS_MARKER, id: c.id });
    },
    [postToFrame],
  );

  // 最大化/还原：使用浏览器 Fullscreen API
  const containerRef = useRef<HTMLDivElement>(null);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-muted/20 text-muted-foreground">
        <FileCode className="h-12 w-12 opacity-20" />
        <p className="text-sm">分享链接不存在或已失效</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-screen bg-background flex flex-col overflow-hidden">
      {/* 顶栏：产品名 + 最大化按钮 */}
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3 px-6 py-3">
          <FileCode className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-lg font-semibold truncate flex-1">{productFolder || '原型分享'}</h1>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={handleToggleMaximize}>
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

      <div className="flex-1 flex min-h-0">
        {/* 左侧：文件列表 */}
        <aside
          className="border-r border-border/50 flex flex-col min-h-0 shrink-0 bg-muted/10"
          style={{ width: SIDEBAR_WIDTH }}
        >
          <div className="px-3 py-2.5 text-xs font-semibold border-b border-border/50 shrink-0">
            页面列表
            <span className="text-muted-foreground font-normal ml-1">({pages.length})</span>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            {pages.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 px-3">
                暂无原型页面
              </p>
            ) : (
              <div className="p-2 space-y-0.5">
                {pages.map(p => {
                  const isActive = p.itemId === selectedItemId;
                  return (
                    <button
                      key={p.itemId}
                      type="button"
                      onClick={() => setSelectedItemId(p.itemId)}
                      className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors flex items-center gap-2 ${
                        isActive
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-muted text-foreground/80'
                      }`}
                    >
                      <FileCode className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{p.title.replace(/\.html$/i, '')}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* 右侧：HTML 预览 iframe */}
        <main className="flex-1 min-h-0 relative bg-muted/20">
          {selectedPage ? (
            <iframe
              title={selectedPage.title}
              ref={iframeRef}
              src={prototypeShareApi.serveUrl(token!, selectedPage.relativePath)}
              onLoad={handleFrameLoad}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              请从左侧选择一个页面
            </div>
          )}
        </main>

        {/* 批注详情面板 */}
        <aside
          className="border-l border-border/50 flex flex-col min-h-0 shrink-0 bg-background"
          style={{ width: COMMENT_PANEL_WIDTH }}
        >
          <div className="px-3 py-2.5 text-xs font-semibold border-b border-border/50 shrink-0 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            批注
            <span className="text-muted-foreground font-normal">({comments.length})</span>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            {commentsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 px-3">
                当前页面暂无批注
              </p>
            ) : (
              <div className="p-3 space-y-2">
                {comments.map((c, idx) => {
                  const seq = comments.length - idx;
                  const isActive = activeComment?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleLocateComment(c)}
                      className={`w-full text-left rounded-lg border p-2.5 space-y-1.5 transition-colors ${
                        isActive
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border/50 bg-background hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold shrink-0">
                          {seq}
                        </span>
                        <span className="text-xs font-medium text-foreground/80 truncate">
                          {c.userName || '匿名'}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                          {formatTime(c.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/85 break-words whitespace-pre-wrap pl-7">
                        {c.content}
                      </p>
                      {c.targetText && (
                        <p className="text-[10px] text-muted-foreground border-l-2 border-primary/30 pl-2 line-clamp-2 break-words">
                          {c.targetText}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </aside>
      </div>

      <footer className="text-center text-xs text-muted-foreground py-2 border-t border-border/30 shrink-0">
        由 DeepHarness 产品空间分享
      </footer>
    </div>
  );
};
