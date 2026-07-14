import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Markdown 与 HTML 的双向转换工具。
 *
 * 文档统一以 Markdown 存储；可视化（WYSIWYG）编辑模式基于 HTML，
 * 进入可视化模式时 Markdown → HTML，编辑过程中 HTML → Markdown 回写。
 */

// HTML 输出不做 sanitize：文档内容来自可信的编辑器内部，且需要保留表格等 GFM 结构
export const markdownToHtml = (markdown: string): string =>
  remark().use(remarkGfm).use(remarkHtml, { sanitize: false }).processSync(markdown).toString();

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// gfm 插件提供表格、删除线、任务列表等语法的 HTML → Markdown 转换
turndown.use(gfm);

export const htmlToMarkdown = (html: string): string => turndown.turndown(html);
