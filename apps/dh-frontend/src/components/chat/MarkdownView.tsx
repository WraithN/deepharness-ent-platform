import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ChatCodeBlock } from './ChatCodeBlock';
import { MermaidBlock } from './MermaidBlock';
import { TreeDirBlock, isTreeDirContent } from './TreeDirBlock';
import { sanitizeWorkspacePaths } from '@/lib/utils';
import { isMermaidDiagramCode } from '@/lib/mermaid-utils';

const COLLAPSE_LINE_THRESHOLD = 12;
const COLLAPSE_CHAR_THRESHOLD = 600;
const MERMAID_LANGUAGE = 'mermaid';

/** HTML 实体解码，用于将 WangEditor 等保存的 HTML 还原为可读代码。 */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * 预处理 Markdown 内容，将 HTML 形式的 <pre><code> 代码块转换为 Markdown 代码围栏，
 * 确保 Mermaid 图表能被正确识别并渲染。
 */
const HTML_PRE_CODE_PATTERN = /<pre[^>]*><code(?:\s+class="[^"]*language-(?<lang>[^"\s]+)[^"]*")?\s*>(?<code>[\s\S]*?)<\/code><\/pre>/gi;

function normalizeCodeBlocks(content: string): string {
  if (!content.includes('<pre') && !content.includes('<code')) return content;
  return content.replace(HTML_PRE_CODE_PATTERN, (match, ...args) => {
    const groups = args[args.length - 1] as { lang?: string; code?: string } | undefined;
    const lang = groups?.lang ?? '';
    const rawCode = groups?.code ?? '';
    const code = decodeHtmlEntities(rawCode);
    if (lang === MERMAID_LANGUAGE || isMermaidDiagramCode(code)) {
      return `\n\`\`\`mermaid\n${code}\n\`\`\`\n`;
    }
    return `\n\`\`\`${lang || 'text'}\n${code}\n\`\`\`\n`;
  });
}

/** 判断代码块是否为纯文本流程（用箭头连接的一串节点，但没有 Mermaid 语法关键字）。 */
const TEXT_FLOW_ARROW_PATTERN = /(?:→|⟶|⇒|➜|->|-->|=>|==>|➡|⇨|→|〜|~>)/;
const TEXT_FLOW_ARROW_SPLIT_PATTERN = /(?:\s*(?:→|⟶|⇒|➜|->|-->|-\.->|=>|==>|➡|⇨|〜|~>)\s*)/;

// 文本流程不应包含的代码特征行：注释行或常见编程语言关键字行。
// 这些行中的箭头（如 "→"）只是说明文字，若当作文本流程会误把 TS/JS 注释渲染成图表。
const TEXT_FLOW_CODE_LINE_PATTERN = /^(?:\/\/|#|\/\*|\*|import\s|export\s|const\s|let\s|var\s|function\s|return\s|if\s*\(|for\s*\(|while\s*\(|switch\s*\()/;

function isTextFlow(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  const lines = trimmed.split('\n');

  // 排除包含代码注释或编程语言特征的代码块，避免把 TS/JS/Python 等注释说明当流程图。
  const codeLikeLines = lines.filter(line => TEXT_FLOW_CODE_LINE_PATTERN.test(line.trim()));
  if (codeLikeLines.length > 0) {
    return false;
  }

  // 单行或多行，只要包含至少两个箭头分隔的步骤。
  const arrows = trimmed.match(TEXT_FLOW_ARROW_PATTERN) || [];
  if (arrows.length < 1) return false;
  const segments = trimmed.split(TEXT_FLOW_ARROW_SPLIT_PATTERN).filter(Boolean);
  return segments.length >= 2;
}

/**
 * 将文本流程转换为 Mermaid flowchart 语法。
 * 例如：A → B → C 转成 flowchart TD; A["A"] --> B["B"] --> C["C"];
 * 使用垂直布局和双引号标签，避免中文/特殊字符解析异常，适合长文本节点。
 */
function convertTextFlowToMermaid(code: string): string {
  const segments = code
    .split(TEXT_FLOW_ARROW_SPLIT_PATTERN)
    .map(s => s.trim())
    .filter(Boolean);
  if (segments.length < 2) return code;

  const chain = segments
    .map((segment, idx) => {
      const id = String.fromCharCode(65 + idx); // A, B, C, ...
      // 用双引号包裹标签，避免中文字符、空格、/ 等特殊字符导致 Mermaid 解析异常。
      const label = `"${segment.replace(/"/g, '\\"')}"`;
      return `${id}[${label}]`;
    })
    .join(' --> ');
  return `flowchart TD\n    ${chain}`;
}
function containsMermaid(content: string): boolean {
  const normalized = normalizeCodeBlocks(content);
  const mermaidFencePattern = /```\s*mermaid\s*[\s\S]*?```/;
  if (mermaidFencePattern.test(normalized)) return true;
  const codeBlocks = normalized.match(/```([\s\S]*?)```/g) ?? [];
  return codeBlocks.some(block => {
    const code = block.replace(/```/g, '');
    return isMermaidDiagramCode(code) || isTextFlow(code);
  });
}

interface MarkdownViewProps {
  content: string;
  collapsible?: boolean;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, collapsible = true }) => {
  const [expanded, setExpanded] = useState(false);

  const sanitizedContent = sanitizeWorkspacePaths(content);
  // 预处理 HTML 代码块，确保 WangEditor 保存的 HTML 内容中的 Mermaid 也能被识别。
  const normalizedContent = normalizeCodeBlocks(sanitizedContent);

  const lineCount = normalizedContent.split('\n').length;
  const hasMermaid = containsMermaid(normalizedContent);
  // 包含 Mermaid 图表的 Markdown 需要完整展示，避免 300px 高度截断图表。
  const shouldCollapse = collapsible && !hasMermaid && (lineCount > COLLAPSE_LINE_THRESHOLD || normalizedContent.length > COLLAPSE_CHAR_THRESHOLD);

  return (
    <div className="relative">
      <div className={`markdown-preview ${shouldCollapse && !expanded ? 'max-h-[300px] overflow-hidden' : ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '');
              const codeString = String(children).replace(/\n$/, '');

              // react-markdown v10 移除了 inline prop，通过 className 判断原 Markdown 是否为代码块：
              // 块级代码块的 className 为 'language-' 或 'language-xxx'；行内代码无 className。
              const classNameValue = className || '';
              const isBlock = classNameValue.startsWith('language-') || codeString.includes('\n');

              // Mermaid 图表：优先检测，避免含 / <br/> 等字符的 Mermaid 代码被
              // isTreeDirContent 误判为目录树结构。
              const isMermaid = isBlock && (match?.[1] === MERMAID_LANGUAGE || isMermaidDiagramCode(codeString));
              if (isMermaid) {
                return <MermaidBlock code={codeString} />;
              }

              // 纯文本流程（如 "A → B → C"）：自动转换为 Mermaid flowchart 渲染。
              if (isBlock && isTextFlow(codeString)) {
                return <MermaidBlock code={convertTextFlowToMermaid(codeString)} />;
              }

              // 树形目录结构：仅块级代码检测。
              if (isBlock && isTreeDirContent(codeString)) {
                return <TreeDirBlock code={codeString} />;
              }

              if (isBlock && match) {
                return <ChatCodeBlock code={codeString} language={match[1]} />;
              }

              // 无语言声明的块级代码：统一按 text 代码块展示，避免行内样式被包在 <pre> 里。
              if (isBlock) {
                return <ChatCodeBlock code={codeString} language="text" />;
              }
              // 行内代码：不传播 props.node，避免生成 node="[object Object]" 属性。
              return <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>;
            },
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      </div>
      {shouldCollapse && !expanded && (
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />
      )}
      {shouldCollapse && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {expanded ? (
            <>
              收起 <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开全部 <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  );
};
