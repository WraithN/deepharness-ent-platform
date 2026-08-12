import React, { useEffect, useRef, useState, useId } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MermaidBlockProps {
  code: string;
}

// mermaid 库动态导入缓存，避免重复加载。
let mermaidLoader: Promise<typeof import('mermaid')> | null = null;

// HTML 实体，用于在 Mermaid 节点标签内部安全地表示引号。
const HTML_QUOT_ENTITY = '&quot;';
const HTML_APOSTROPHE_ENTITY = '&#39;';

// 节点标签中若包含这些字符，未加引号时会导致 Mermaid 解析失败。
const NODE_LABEL_SPECIAL_CHARS = /[()\[\]{}\\/,"'&]/;

// 矩形节点定义：ID[label]，label 中不能包含换行或嵌套方括号。
const RECT_NODE_PATTERN = /([A-Za-z0-9_\u4e00-\u9fa5]+)\s*\[([^\[\]\n]*)\]/g;

function initializeMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then(mod => {
      mod.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        fontSize: 14,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      });
      return mod;
    });
    return mermaidLoader;
  }
  mermaidLoader.then(mod => {
    mod.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      fontSize: 14,
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
  });
  return mermaidLoader;
}

/**
 * 自动为 graph/flowchart 矩形节点标签添加双引号。
 *
 * Mermaid 的矩形节点语法 A[label] 中，若 label 包含括号、方括号、斜杠、
 * 逗号、& 等特殊字符，必须用引号包裹，否则解析器会将其误认为节点形状
 * 结束符。本函数仅对未加引号且包含特殊字符的矩形节点标签做处理。
 */
function quoteMermaidNodeLabels(code: string): string {
  const lines = code.split('\n');
  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) {
      return line;
    }

    // 跳过指令、样式、类定义等行，避免误替换。
    if (/^(classDef|style|linkStyle|class|click|subgraph|end|direction)\s/i.test(trimmed)) {
      return line;
    }

    return line.replace(RECT_NODE_PATTERN, (match, idPart, label) => {
      const trimmedLabel = label.trim();
      if (!trimmedLabel) {
        return match;
      }
      // 已加引号的 label 不再处理，防止重复转义。
      if (/^["'].*["']$/.test(trimmedLabel)) {
        return match;
      }
      // 只有包含特殊字符时才需要加引号。
      if (!NODE_LABEL_SPECIAL_CHARS.test(trimmedLabel)) {
        return match;
      }

      // label 内部的双引号用 HTML 实体表示，避免破坏外层引号。
      const escaped = trimmedLabel.replace(/"/g, HTML_QUOT_ENTITY);
      return `${idPart}["${escaped}"]`;
    });
  });
  return processedLines.join('\n');
}

/**
 * 预处理 Mermaid 代码，修复 AI 生成时常见的语法问题。
 *
 * 1. 将反斜杠转义的引号统一替换为 HTML 实体，Mermaid 在引号 label 内支持
 *    HTML 实体但不支持反斜杠转义。
 * 2. 为包含特殊字符但未加引号的矩形节点标签自动添加双引号，避免解析器
 *    把 label 中的括号、斜杠等误判为节点形状结束符。
 */
function preprocessMermaidCode(code: string): string {
  return quoteMermaidNodeLabels(
    code
      .replace(/\\"/g, HTML_QUOT_ENTITY)
      .replace(/\\'/g, HTML_APOSTROPHE_ENTITY)
      .replace(/&quot;/g, HTML_QUOT_ENTITY)
      .replace(/&#34;/g, HTML_QUOT_ENTITY)
  );
}

/**
 * Mermaid 图表渲染组件。
 *
 * 动态导入 mermaid 库，将 mermaid 语法代码渲染为 SVG 图表。
 * 渲染失败时回退显示原始代码和错误提示。
 */
export const MermaidBlock: React.FC<MermaidBlockProps> = ({ code }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rawId = useId();
  // mermaid 要求 id 以字母开头且不含特殊字符。
  const diagramId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let rendered = false;
    setLoading(true);
    setError(null);

    initializeMermaid()
      .then(async mod => {
        if (cancelled) return;
        const processed = preprocessMermaidCode(code.trim());
        // 先用 parse 校验语法，非法时抛错进入 catch 渲染错误回退，
        // 避免 mermaid render 返回带“Syntax error”炸弹图的 SVG 却仍被当成成功结果。
        await mod.default.parse(processed, { suppressErrors: false });
        return mod.default.render(diagramId, processed);
      })
      .then(result => {
        if (cancelled) return;
        if (result && result.svg) {
          rendered = true;
          if (timeoutId) clearTimeout(timeoutId);
          setSvg(result.svg);
          setLoading(false);
        }
      })
      .catch(err => {
        if (cancelled) return;
        rendered = true;
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[MermaidBlock] render failed:', err);
        setError(err?.message || '渲染失败');
        setLoading(false);
      });

    // 兜底：如果 Mermaid 库异常或网络卡死，15 秒后仍未完成则展示错误。
    timeoutId = setTimeout(() => {
      if (!cancelled && !rendered) {
        setLoading(false);
        setError('图表渲染超时，请检查 Mermaid 语法或网络');
      }
    }, 15000);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [code, diagramId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        <span className="text-sm">正在渲染图表...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 my-2">
        <div className="flex items-center gap-1.5 text-destructive text-xs mb-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>图表渲染失败，已回退为代码块：{error}</span>
        </div>
        <div className="rounded overflow-x-auto border border-border/50">
          <SyntaxHighlighter
            language="mermaid"
            style={vscDarkPlus}
            customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', maxHeight: '400px' }}
            showLineNumbers
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mermaid-diagram-wrapper rounded-xl border border-border/50 p-4 my-2 shadow-sm overflow-auto"
      style={{ background: '#0f172a', minHeight: '120px' }}
    >
      <div
        ref={containerRef}
        className="w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
};
