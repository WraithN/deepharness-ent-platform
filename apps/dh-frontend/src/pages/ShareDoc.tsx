import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Loader2, MessageSquarePlus, Send, User } from 'lucide-react';
import { toast } from 'sonner';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { productDocApi, type ShareComment, type SharedDocView } from '@/lib/productdoc-api';

/** 批注人昵称本地存储 key（免登录场景下记住昵称） */
const NICKNAME_STORAGE_KEY = 'share-comment-nickname';
/** 与后端一致的长度限制 */
const MAX_QUOTE_LENGTH = 500;
const MAX_COMMENT_LENGTH = 2000;
const MAX_AUTHOR_LENGTH = 64;

/** 浮动批注输入框半宽（w-72 = 288px），用于贴边选区时的位置钳制 */
const COMPOSER_HALF_WIDTH = 150;

/** 将浮动元素的 x 坐标钳制在视口内，避免贴边选区时溢出屏幕。 */
function clampX(x: number, halfWidth: number): number {
  return Math.min(Math.max(x, halfWidth), window.innerWidth - halfWidth);
}

/** 格式化时间戳为 MM-DD HH:mm。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 选区信息：锚定文本 + 浮动按钮位置（视口坐标）。 */
interface SelectionInfo {
  quote: string;
  x: number;
  y: number;
}

/**
 * 分享文档落地页（免登录）。
 *
 * 通过 /s/:token 访问，展示该文档最新已发布版本的只读内容；
 * 支持选中任意文本发表批注，批注同步展示在原文档页面。
 */
export const ShareDoc: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<SharedDocView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [comments, setComments] = useState<ShareComment[]>([]);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [authorName, setAuthorName] = useState(
    () => localStorage.getItem(NICKNAME_STORAGE_KEY) ?? ''
  );
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const contentRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const loadComments = useCallback(async () => {
    if (!token) return;
    try {
      const list = await productDocApi.listShareComments(token);
      setComments(list ?? []);
    } catch {
      // 批注加载失败不影响文档阅读，静默处理
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    productDocApi
      .getSharedDoc(token)
      .then(setDoc)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    loadComments();
  }, [token, loadComments]);

  // 点击批注输入框外部时关闭输入框。
  // 注意：监听器必须延迟注册——打开输入框的 mousedown 事件仍在冒泡时，
  // 若同步注册 document 监听，同一事件会被判定为“点击外部”而立即关闭输入框。
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

  /** 鼠标释放时检测选区：非空且在内容区内则弹出批注入口。 */
  const handleContentMouseUp = () => {
    if (composerOpen) return;
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
  };

  const handleSubmitComment = async () => {
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
    setSending(true);
    try {
      await productDocApi.addShareComment(token, {
        authorName: name.slice(0, MAX_AUTHOR_LENGTH),
        quoteText: selection.quote,
        content,
      });
      localStorage.setItem(NICKNAME_STORAGE_KEY, name);
      setDraft('');
      setComposerOpen(false);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      loadComments();
    } catch {
      toast.error('发表批注失败');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !doc) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-muted/20 text-muted-foreground">
        <FileText className="h-12 w-12 opacity-20" />
        <p className="text-sm">分享链接不存在或已失效</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* 顶栏：文档标题、创建人与版本信息，滚动时保持可见 */}
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3 px-6 py-3">
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-lg font-semibold truncate flex-1">{doc.title}</h1>
          {doc.createdByName && (
            <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              创建人：{doc.createdByName}
            </span>
          )}
          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
            版本 {doc.version} · {new Date(doc.publishedAt).toLocaleDateString()}
          </span>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 内容区：占满屏幕剩余空间，支持选中文本批注 */}
        <main
          ref={contentRef}
          className="flex-1 overflow-auto px-6 py-6"
          onMouseUp={handleContentMouseUp}
        >
          <MarkdownView content={doc.content} collapsible={false} />
        </main>

        {/* 批注侧栏 */}
        <aside className="w-80 border-l border-border/50 flex flex-col min-h-0 shrink-0 bg-muted/10">
          <div className="px-3 py-2.5 text-xs font-semibold border-b border-border/50 shrink-0 flex items-center gap-1.5">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            批注
            <span className="text-muted-foreground font-normal">({comments.length})</span>
          </div>
          <ScrollArea className="flex-1 min-h-0">
            {comments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 px-3">
                暂无批注。选中正文任意文本即可发表批注
              </p>
            ) : (
              <div className="p-3 space-y-3">
                {comments.map(c => (
                  <div key={c.id} className="rounded-lg border border-border/50 bg-background p-2.5 space-y-1.5">
                    <blockquote className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 line-clamp-3 break-words">
                      {c.quoteText}
                    </blockquote>
                    <p className="text-xs text-foreground/85 break-words whitespace-pre-wrap">{c.content}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-medium text-foreground/70 truncate">{c.authorName}</span>
                      <span className="whitespace-nowrap">{formatTime(c.createdAt)}</span>
                      {c.status === 'resolved' && (
                        <span className="ml-auto shrink-0 text-emerald-600">已解决</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </aside>
      </div>

      <footer className="text-center text-xs text-muted-foreground py-3 border-t border-border/30 shrink-0">
        由 DeepHarness 产品空间分享
      </footer>

      {/* 选中文本后的浮动批注入口 / 输入框 */}
      {selection && !composerOpen && (
        <div
          className="fixed z-20 -translate-x-1/2 -translate-y-full"
          style={{ left: clampX(selection.x, 40), top: selection.y - 8 }}
        >
          <Button
            size="sm"
            className="h-7 text-xs gap-1 shadow-lg"
            onMouseDown={e => {
              // 阻止 mousedown 默认行为清除文本选区，保证提交时 quote 仍有效
              e.preventDefault();
              setComposerOpen(true);
            }}
          >
            <MessageSquarePlus className="h-3 w-3" />
            批注
          </Button>
        </div>
      )}

      {selection && composerOpen && (
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
            <Button size="sm" className="h-7 text-xs gap-1" disabled={sending} onClick={handleSubmitComment}>
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              发表
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
