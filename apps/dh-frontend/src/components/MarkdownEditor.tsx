import React, { useEffect, useRef, useState } from 'react';
import '@wangeditor/editor/dist/css/style.css';
import { type IDomEditor, type IEditorConfig, type IToolbarConfig, SlateTransforms } from '@wangeditor/editor';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import {
  Bold,
  Code, CodeSquare, Heading1, Heading2, Image, Italic, Link2, List, ListOrdered, Loader2, MessageSquarePlus, Minus, Quote,ScrollText, Send, Table,
} from 'lucide-react';
import { MarkdownView } from '@/components/chat/MarkdownView';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTemplates } from '@/hooks/use-templates';
import type { DocTemplate, TemplateCategory } from '@/types';
import { htmlToMarkdown, markdownToHtml } from '@/lib/markdown-html';
import { cn } from '@/lib/utils';

/** 编辑模式：可视化富文本 / Markdown 源码 / 预览 */
export type EditorMode = 'rich' | 'markdown' | 'preview';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  /** 最近保存时间，用于底部状态栏展示 */
  lastSavedAt?: Date | null;
  /** 「常用模板」菜单的模板列表，默认从平台模板池读取 */
  templates?: DocTemplate[];
  /** 是否显示右上角「常用模板」快捷填充按钮，默认 true */
  showTemplatePicker?: boolean;
  /** 是否开启文档批注入口：选中文本后显示浮动批注按钮 */
  allowComments?: boolean;
  /** 提交批注：quote 为选中文本，content 为批注内容 */
  onAddComment?: (comment: { quote: string; content: string }) => Promise<void>;
}

/** MarkdownEditor 默认使用的模板分类。 */
const DEFAULT_TEMPLATE_CATEGORY: TemplateCategory = 'product';

const MODE_TABS: { key: EditorMode; label: string }[] = [
  { key: 'rich', label: '可视化编辑' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'preview', label: '预览' },
];

/** 可视化模式工具栏：与参考设计一致的固定配置 */
const TOOLBAR_CONFIG: Partial<IToolbarConfig> = {
  toolbarKeys: [
    'headerSelect', 'bold', 'italic', 'underline', 'through', 'color', 'bgColor',
    '|',
    'bulletedList', 'numberedList', 'blockquote',
    '|',
    'insertTable', 'insertLink', 'insertImage',
    '|',
    'undo', 'redo',
  ],
};

/** Markdown 源码模式下的快捷插入动作。 */
interface MdToolbarAction {
  icon: React.ElementType;
  label: string;
  /** 选区前后包装符（已包裹时再次点击为取消） */
  wrap?: [string, string];
  placeholder?: string;
  /** 直接插入的片段（自动保证独占一行） */
  insert?: string;
  /** 行级语法前缀（相同前缀再次点击为取消） */
  linePrefix?: string;
  /** 同类行前缀匹配正则，应用前先剥离旧前缀 */
  lineMatch?: RegExp;
  /** 块级 wrap（代码块）：保证前后换行 */
  block?: boolean;
}

const MD_TOOLBAR_ACTIONS: MdToolbarAction[] = [
  { icon: Bold, label: '加粗', wrap: ['**', '**'], placeholder: '加粗文本' },
  { icon: Italic, label: '斜体', wrap: ['*', '*'], placeholder: '斜体文本' },
  { icon: Heading1, label: '一级标题', linePrefix: '# ', lineMatch: /^#{1,6}\s+/, placeholder: '一级标题' },
  { icon: Heading2, label: '二级标题', linePrefix: '## ', lineMatch: /^#{1,6}\s+/, placeholder: '二级标题' },
  { icon: List, label: '无序列表', linePrefix: '- ', lineMatch: /^(?:[-*+]\s+|\d+\.\s+)/, placeholder: '列表项' },
  { icon: ListOrdered, label: '有序列表', linePrefix: '1. ', lineMatch: /^(?:[-*+]\s+|\d+\.\s+)/, placeholder: '列表项' },
  { icon: Quote, label: '引用', linePrefix: '> ', lineMatch: /^>\s+/, placeholder: '引用内容' },
  { icon: Code, label: '行内代码', wrap: ['`', '`'], placeholder: 'code' },
  { icon: CodeSquare, label: '代码块', wrap: ['```\n', '\n```'], placeholder: '// 代码', block: true },
  { icon: Link2, label: '链接', wrap: ['[', '](https://)'], placeholder: '链接文本' },
  { icon: Image, label: '图片', wrap: ['![', '](https://)'], placeholder: '图片描述' },
  { icon: Table, label: '表格', insert: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |' },
  { icon: Minus, label: '分割线', insert: '---' },
];

/** 粗略统计正文字数：去除常见 Markdown 符号与空白后的字符数。 */
const countWords = (markdown: string): number =>
  markdown.replace(/[>#*_`~|!\[\]()-]/g, '').replace(/\s/g, '').length;

/** HTML 转 Markdown 的防抖间隔（毫秒） */
const SYNC_DEBOUNCE_MS = 300;

/** 批注引用文本与内容长度限制（与后端一致）。 */
const MAX_COMMENT_QUOTE_LENGTH = 500;
const MAX_COMMENT_CONTENT_LENGTH = 2000;

/** 浮动批注输入框半宽，用于贴边选区时的位置钳制。 */
const COMPOSER_HALF_WIDTH = 150;

/**
 * 编辑器错误边界：WangEditor/Slate 内部崩溃（如节点路径错误）时，
 * 捕获渲染异常并展示恢复入口，避免整个页面白屏。
 */
class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err: Error) {
    console.error('[DH-DEBUG] editor crashed:', err.message);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">编辑器渲染异常，请重试</p>
        <button
          className="px-3 py-1.5 text-sm rounded-md border border-border/50 hover:bg-muted transition-colors"
          onClick={this.props.onReset}
        >
          重新加载编辑器
        </button>
      </div>
    );
  }
}

/**
 * 文档编辑器（统一以 Markdown 存储）。
 *
 * - 可视化编辑：WangEditor 富文本（标题/加粗/颜色/列表/引用/表格/链接/图片/撤销重做），
 *   内容经 turndown 实时（防抖）转回 Markdown；
 * - Markdown：源码编辑 + 快捷插入工具栏（格式开关、块级自动换行）；
 * - 预览：MarkdownView 渲染；
 * - 右上角「常用模板」一键填充业务模板；底部状态栏展示字数与最近保存时间。
 */
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  placeholder = '在此编辑文档，支持插入表格、图片、列表…',
  readOnly = false,
  lastSavedAt = null,
  templates: templatesProp,
  showTemplatePicker = true,
  allowComments = false,
  onAddComment,
}) => {
  const { templates: defaultTemplates } = useTemplates(DEFAULT_TEMPLATE_CATEGORY, true);
  const templates = templatesProp ?? defaultTemplates;
  const [mode, setMode] = useState<EditorMode>('rich');
  const [editor, setEditor] = useState<IDomEditor | null>(null);
  // 编辑器重建计数器：作为 Editor 的 key，错误恢复时强制重建实例
  const [editorKey, setEditorKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // WangEditor 实例 ref（state 用于触发 Toolbar 挂载，ref 用于安全的生命周期管理）
  const editorRef = useRef<IDomEditor | null>(null);
  // 最近一次向父级发出的 Markdown，用于识别外部 value 变化（切换文档等）
  const lastEmittedRef = useRef(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // WangEditor 初始化后不会更新 config.onChange，使用 ref 保证总能调用到父组件最新回调，
  // 避免切换文档/模板时触发旧的 onChange 闭包导致父级状态被旧数据覆盖。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 文档批注：选区信息、浮动按钮/输入框状态
  const [selection, setSelection] = useState<{ quote: string; x: number; y: number } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  /** 将 x 坐标钳制在视口内，避免贴边选区时弹出框溢出。 */
  const clampX = (x: number) => Math.min(Math.max(x, COMPOSER_HALF_WIDTH), window.innerWidth - COMPOSER_HALF_WIDTH);

  /**
   * 安全写入 HTML。setHtml 会在编辑器内部结算节点操作，若此时存在选区或
   * 上一轮操作尚未结算，Slate 会抛「Cannot find a descendant at path」崩溃。
   * 因此统一延迟到当前事件循环结束后执行，并先取消选区。
   */
  const setEditorHtml = (ed: IDomEditor, markdown: string) => {
    const html = markdownToHtml(markdown);
    // setHtml 前先取消选区，避免选区指向即将被替换的旧节点
    try {
      SlateTransforms.deselect(ed);
    } catch {
      // 无选区时 deselect 可能报错，忽略
    }
    setTimeout(() => {
      if (editorRef.current !== ed) return;
      try {
        ed.setHtml(html);
      } catch (err) {
        console.error('[DH-DEBUG] setHtml failed:', err);
        return;
      }
      // setHtml 后 WangEditor 会将选区恢复到文档末尾，但新 DOM 尚未渲染完成，
      // slate-react 解析选区 DOM 会抛「Cannot resolve a DOM node from Slate node」，
      // 下一帧再次取消选区规避
      requestAnimationFrame(() => {
        try {
          SlateTransforms.deselect(ed);
        } catch {
          // 忽略
        }
      });
    }, 0);
  };

  const handleEditorCreated = (ed: IDomEditor) => {
    console.log('[DH-DEBUG] editor onCreated');
    editorRef.current = ed;
    // 编辑器内容非受控：仅在创建时写入一次初始 HTML，之后一律经实例方法更新，
    // 避免「value 受控 + onChange 回写」因 HTML 规范化差异形成无限渲染循环
    setEditorHtml(ed, value);
    setEditor(ed);
  };

  // 安全销毁编辑器（切换模式/组件卸载时调用，避免重复销毁报错）
  const destroyEditor = () => {
    const ed = editorRef.current;
    if (!ed) return;
    console.log('[DH-DEBUG] editor destroy');
    editorRef.current = null;
    setEditor(null);
    ed.destroy();
  };

  // 组件卸载时销毁 WangEditor 实例
  useEffect(() => {
    console.log('[DH-DEBUG] MarkdownEditor mount');
    return () => {
      console.log('[DH-DEBUG] MarkdownEditor unmount');
      destroyEditor();
    };
  }, []);

  // 外部 value 变化（切换文档/模板等，非本次编辑产生）时，imperative 刷新编辑器内容
  useEffect(() => {
    if (mode !== 'rich' || !editorRef.current) return;
    if (value === lastEmittedRef.current) return;
    console.log('[DH-DEBUG] external value change → setHtml, len =', value.length);
    setEditorHtml(editorRef.current, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, value]);

  // 立即将可视化 HTML 同步为 Markdown（切换模式/套用模板时调用）
  const flushRichToMarkdown = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const ed = editorRef.current;
    if (!ed) return;
    const md = htmlToMarkdown(ed.getHtml());
    lastEmittedRef.current = md;
    onChangeRef.current(md);
  };

  const handleModeChange = (next: EditorMode) => {
    if (next === mode) return;
    console.log('[DH-DEBUG] mode change', mode, '→', next);
    // 离开可视化模式前先 flush，保证 Markdown 源码与预览拿到最新内容；
    // 同时销毁编辑器实例，避免切回时 Toolbar 拿到已销毁的旧实例
    if (mode === 'rich' && editor) {
      flushRichToMarkdown();
      destroyEditor();
    }
    setMode(next);
  };

  const editorConfig: Partial<IEditorConfig> = {
    placeholder,
    readOnly,
    onChange: (ed: IDomEditor) => {
      const html = ed.getHtml();
      // 防抖回写 Markdown（内容非受控，不再 setState 存 HTML，避免渲染循环）
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const md = htmlToMarkdown(html);
        lastEmittedRef.current = md;
        onChangeRef.current(md);
      }, SYNC_DEBOUNCE_MS);
    },
  };

  // 套用模板：统一走 Markdown，可视化模式下同步刷新编辑器内容
  const applyTemplate = (content: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    lastEmittedRef.current = content;
    onChangeRef.current(content);
    if (mode === 'rich' && editor) {
      setEditorHtml(editor, content);
    }
  };

  // Markdown 源码模式：应用工具栏动作（选区插入/格式开关）
  const applyMdAction = (action: MdToolbarAction) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);

    let nextValue: string;
    let caretStart: number;
    let caretEnd: number;

    if (action.insert !== undefined) {
      // 块级插入（表格/分割线）：自动补换行，保证独立成行
      const needsLeadingNl = selectionStart > 0 && value[selectionStart - 1] !== '\n';
      const needsTrailingNl = selectionEnd < value.length && value[selectionEnd] !== '\n';
      const fragment = (needsLeadingNl ? '\n' : '') + action.insert + (needsTrailingNl ? '\n' : '');
      nextValue = value.slice(0, selectionStart) + fragment + value.slice(selectionEnd);
      caretStart = caretEnd = selectionStart + fragment.length;
    } else if (action.linePrefix !== undefined) {
      // 行级语法：剥离同类旧前缀后写入新前缀，相同则为取消
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const lineBefore = value.slice(lineStart, selectionStart);
      const existing = action.lineMatch?.exec(lineBefore)?.[0] ?? '';
      const prefix = existing === action.linePrefix ? '' : action.linePrefix;
      const text = selected || action.placeholder || '';
      nextValue = value.slice(0, lineStart) + prefix + lineBefore.slice(existing.length) + text + value.slice(selectionEnd);
      caretStart = selectionStart - existing.length + prefix.length;
      caretEnd = caretStart + text.length;
    } else if (action.wrap) {
      const [before, after] = action.wrap;
      const wrapped =
        selectionStart >= before.length &&
        value.slice(selectionStart - before.length, selectionStart) === before &&
        value.slice(selectionEnd, selectionEnd + after.length) === after;
      if (wrapped) {
        nextValue = value.slice(0, selectionStart - before.length) + selected + value.slice(selectionEnd + after.length);
        caretStart = selectionStart - before.length;
        caretEnd = caretStart + selected.length;
      } else {
        const text = selected || action.placeholder || '';
        let lead = before;
        let tail = after;
        if (action.block) {
          if (selectionStart > 0 && value[selectionStart - 1] !== '\n') lead = '\n' + lead;
          const afterEnd = selectionEnd + after.length;
          if (afterEnd < value.length && value[afterEnd] !== '\n') tail += '\n';
        }
        nextValue = value.slice(0, selectionStart) + lead + text + tail + value.slice(selectionEnd);
        caretStart = selectionStart + lead.length;
        caretEnd = caretStart + text.length;
      }
    } else {
      return;
    }

    onChange(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caretStart, caretEnd);
    });
  };

  // 文档批注：监听鼠标松开，捕获选中文本与位置。
  const handleMouseUp = (e: React.MouseEvent) => {
    if (composerOpen || !allowComments || !onAddComment) return;
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    if (!sel || !quote || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    // 仅当事件目标或选区锚定节点位于编辑器容器内时才处理，避免工具栏/面板触发
    const container = e.currentTarget as HTMLElement;
    if (!container.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    if (quote.length > MAX_COMMENT_QUOTE_LENGTH) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelection({ quote, x: rect.left + rect.width / 2, y: rect.top });
  };

  const handleSubmitComment = async () => {
    if (!selection || !onAddComment) return;
    const content = commentDraft.trim();
    if (!content) return;
    setSendingComment(true);
    try {
      await onAddComment({ quote: selection.quote, content });
      setCommentDraft('');
      setComposerOpen(false);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch {
      // 父组件已通过 toast 提示错误
    } finally {
      setSendingComment(false);
    }
  };

  // 点击批注输入框外部时关闭
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

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" onMouseUp={handleMouseUp}>
      {/* 模式切换栏：左侧三模式标签，右侧模板菜单（Markdown 模式附加快捷工具栏） */}
      <div className="flex items-center justify-between h-11 px-4 border-b border-border/50 shrink-0 bg-background/90 gap-2">
        <div className="aurora-tab-bar level-3 shrink-0">
          {MODE_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => handleModeChange(tab.key)}
              className={cn('aurora-tab-item level-3', mode === tab.key && 'active')}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 min-w-0">
          {mode === 'markdown' && !readOnly && (
            <div className="flex items-center gap-0.5 flex-wrap justify-end mr-1">
              {MD_TOOLBAR_ACTIONS.map(action => (
                <button
                  key={action.label}
                  type="button"
                  title={action.label}
                  className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  onMouseDown={e => {
                    e.preventDefault();
                    applyMdAction(action);
                  }}
                >
                  <action.icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          )}
          {!readOnly && showTemplatePicker && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
                  <ScrollText className="h-4 w-4" />
                  <span className="hidden sm:inline">常用模板</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs text-muted-foreground">业务常用模板</DropdownMenuLabel>
                {templates.map(tpl => (
                  <DropdownMenuItem key={tpl.key} onClick={() => applyTemplate(tpl.content)}>
                    {tpl.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* 可视化模式：WangEditor 工具栏（必须等编辑器实例就绪后再挂载，
          否则 editor-for-react 内部会报 Can not get editor instance） */}
      {mode === 'rich' && editor && (
        <Toolbar
          editor={editor}
          defaultConfig={TOOLBAR_CONFIG}
          mode="default"
          className="shrink-0 border-b border-border/50"
        />
      )}

      {/* 编辑内容区 */}
      <div className="flex-1 overflow-hidden">
        {mode === 'rich' && (
          <EditorErrorBoundary
            key={editorKey}
            onReset={() => {
              destroyEditor();
              setEditorKey(k => k + 1);
            }}
          >
            <Editor
              defaultConfig={editorConfig}
              onCreated={handleEditorCreated}
              mode="default"
              style={{ height: '100%', overflowY: 'hidden' }}
            />
          </EditorErrorBoundary>
        )}
        {mode === 'markdown' && (
          <div className="h-full p-4 overflow-auto">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={placeholder}
              readOnly={readOnly}
              className="w-full h-full min-h-[400px] font-mono text-sm resize-none border-none focus-visible:ring-0 bg-transparent"
            />
          </div>
        )}
        {mode === 'preview' && (
          <div className="h-full p-4 overflow-auto">
            <MarkdownView content={value} collapsible={false} />
          </div>
        )}
      </div>

      {/* 选中文本后的浮动批注入口：提高 z-index 避免被 WangEditor 浮动工具栏遮挡 */}
      {selection && !composerOpen && (
        <div
          className="fixed z-[9999] -translate-x-1/2 -translate-y-full"
          style={{ left: clampX(selection.x), top: selection.y - 8 }}
        >
          <Button
            size="sm"
            className="h-7 text-xs gap-1 shadow-lg"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setComposerOpen(true)}
          >
            <MessageSquarePlus className="h-3 w-3" />
            批注
          </Button>
        </div>
      )}

      {/* 批注输入框：提高 z-index 避免被 WangEditor 浮动工具栏遮挡 */}
      {selection && composerOpen && (
        <div
          ref={composerRef}
          className="fixed z-[9999] -translate-x-1/2 w-72 rounded-lg border border-border bg-background shadow-xl p-3 space-y-2"
          style={{ left: clampX(selection.x), top: selection.y + 24 }}
        >
          <blockquote className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 line-clamp-2 break-words">
            {selection.quote}
          </blockquote>
          <Textarea
            value={commentDraft}
            onChange={e => setCommentDraft(e.target.value.slice(0, MAX_COMMENT_CONTENT_LENGTH))}
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
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={sendingComment || !commentDraft.trim()}
              onClick={handleSubmitComment}
            >
              {sendingComment ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              发表
            </Button>
          </div>
        </div>
      )}

      {/* 底部状态栏：字数统计 + 最近保存时间 */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border/50 shrink-0 text-xs text-muted-foreground bg-background/90">
        <span>字数统计：{countWords(value)} 字</span>
        <span>{lastSavedAt ? `最后保存：${lastSavedAt.toLocaleTimeString()}` : '尚未保存'}</span>
      </div>
    </div>
  );
};
