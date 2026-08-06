import React, { useEffect, useRef, useState, useId } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface MermaidBlockProps {
  code: string;
}

// mermaid 库动态导入缓存，避免重复加载。
let mermaidLoader: Promise<typeof import('mermaid')> | null = null;

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
 * 预处理 Mermaid 代码，修复 AI 生成时常见的语法问题。
 *
 * Mermaid 不支持反斜杠转义引号（\"），但 AI 经常在 ER 图属性注释、
 * 流程图节点标签等位置生成转义引号，导致解析失败。
 * 将转义双引号替换为单引号，既消除反斜杠又避免双引号嵌套冲突。
 */
function preprocessMermaidCode(code: string): string {
  return code
    .replace(/\\"/g, "'")     // 转义双引号 -> 单引号
    .replace(/\\'/g, "'")     // 转义单引号 -> 单引号
    .replace(/&quot;/g, "'")  // HTML 实体双引号 -> 单引号
    .replace(/&#34;/g, "'");  // 数字 HTML 实体双引号 -> 单引号
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
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex items-center gap-1.5 text-destructive text-xs mb-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>图表渲染失败：{error}</span>
        </div>
        <div className="text-xs text-muted-foreground overflow-auto font-mono whitespace-pre-wrap">{code}</div>
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
