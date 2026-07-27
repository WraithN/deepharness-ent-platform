import type { ShareComment } from '@/lib/productdoc-api';

/** 高亮 span 的 CSS 类名，用于清理旧高亮和样式定位。 */
const HIGHLIGHT_CLASS = 'dh-doc-highlight';

/** 鼠标悬停/离开的延迟时间（毫秒），避免快速划过导致卡片闪烁。 */
const HOVER_DELAY_MS = 150;

export interface HighlightOptions {
  onClick: (comment: ShareComment) => void;
  onHover: (comment: ShareComment, clientX: number, clientY: number) => void;
  onLeave: () => void;
}

/**
 * 清理容器内已存在的高亮包裹元素，将其子文本节点还原到父级。
 * 注意：仅处理由本模块创建的 .dh-doc-highlight 元素。
 */
function clearHighlights(container: HTMLElement): void {
  const existing = container.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  existing.forEach(el => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  });
}

interface HighlightMatch {
  node: Text;
  start: number;
  end: number;
  seq: number;
  comment: ShareComment;
}

interface MergedSegment {
  start: number;
  end: number;
  seqs: number[];
  comments: ShareComment[];
}

/**
 * 在文档正文容器内高亮所有带批注的文本。
 *
 * 实现说明：
 * - 按时间正序为批注分配序号（最早为 1）。
 * - 遍历正文中的所有文本节点，查找 quoteText 子串并包裹高亮 span。
 * - 对于在同一文本节点内重叠的批注区间，合并为一个高亮段并显示所有序号徽章。
 * - 跨元素边界的 quoteText 无法通过简单文本匹配高亮，属于已知限制。
 *
 * @param container 文档正文根元素（MarkdownView 渲染后的容器）
 * @param comments  文档批注列表（时间倒序，最新在前）
 * @param options   交互回调：点击、悬停、离开
 */
export function applyDocHighlights(
  container: HTMLElement,
  comments: ShareComment[],
  options: HighlightOptions
): void {
  clearHighlights(container);

  if (comments.length === 0) return;

  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleLeave = () => {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => options.onLeave(), HOVER_DELAY_MS);
  };
  const cancelLeave = () => {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  };

  const total = comments.length;
  const matches: HighlightMatch[] = [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  comments.forEach((comment, idx) => {
    const quote = comment.quoteText?.trim();
    if (!quote) return;
    const seq = total - idx;
    textNodes.forEach(node => {
      const text = node.textContent ?? '';
      let pos = 0;
      while (true) {
        const index = text.indexOf(quote, pos);
        if (index < 0) break;
        matches.push({ node, start: index, end: index + quote.length, seq, comment });
        pos = index + 1;
      }
    });
  });

  const byNode = new Map<Text, HighlightMatch[]>();
  matches.forEach(m => {
    const arr = byNode.get(m.node) ?? [];
    arr.push(m);
    byNode.set(m.node, arr);
  });

  byNode.forEach((nodeMatches, node) => {
    nodeMatches.sort((a, b) => a.start - b.start || a.end - b.end);

    const merged: MergedSegment[] = [];
    nodeMatches.forEach(m => {
      const last = merged[merged.length - 1];
      if (last && m.start <= last.end) {
        last.end = Math.max(last.end, m.end);
        if (!last.seqs.includes(m.seq)) {
          last.seqs.push(m.seq);
          last.comments.push(m.comment);
        }
      } else {
        merged.push({ start: m.start, end: m.end, seqs: [m.seq], comments: [m.comment] });
      }
    });

    const text = node.textContent ?? '';
    const parent = node.parentNode;
    if (!parent) return;

    let lastEnd = 0;
    const fragment = document.createDocumentFragment();

    merged.forEach(seg => {
      if (seg.start > lastEnd) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd, seg.start)));
      }

      const span = document.createElement('span');
      span.className =
        `${HIGHLIGHT_CLASS} border-b-2 border-yellow-400 bg-yellow-100/30 dark:bg-yellow-900/20 cursor-pointer`;

      const inner = document.createTextNode(text.slice(seg.start, seg.end));
      span.appendChild(inner);

      seg.seqs.forEach((seq, i) => {
        const badge = document.createElement('sup');
        badge.className =
          'dh-doc-badge inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-yellow-500 text-white text-[10px] font-bold ml-0.5 align-super cursor-pointer select-none';
        badge.textContent = String(seq);
        badge.dataset.commentId = seg.comments[i].id;
        badge.addEventListener('click', e => {
          e.stopPropagation();
          cancelLeave();
          options.onClick(seg.comments[i]);
        });
        badge.addEventListener('mouseenter', e => {
          cancelLeave();
          options.onHover(seg.comments[i], (e as MouseEvent).clientX, (e as MouseEvent).clientY);
        });
        badge.addEventListener('mouseleave', () => scheduleLeave());
        span.appendChild(badge);
      });

      span.addEventListener('click', () => {
        cancelLeave();
        options.onClick(seg.comments[0]);
      });
      span.addEventListener('mouseenter', e => {
        cancelLeave();
        options.onHover(seg.comments[0], (e as MouseEvent).clientX, (e as MouseEvent).clientY);
      });
      span.addEventListener('mouseleave', () => scheduleLeave());

      fragment.appendChild(span);
      lastEnd = seg.end;
    });

    if (lastEnd < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
    }

    parent.replaceChild(fragment, node);
  });
}

/**
 * 滚动到指定批注的第一个高亮位置。
 */
export function scrollToDocComment(container: HTMLElement, commentId: string): void {
  const badge = container.querySelector<HTMLElement>(`.${HIGHLIGHT_CLASS} .dh-doc-badge[data-comment-id="${commentId}"]`);
  if (badge) {
    badge.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
