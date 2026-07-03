import React, { useEffect, useRef, useState, useId } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';

interface MermaidBlockProps {
  code: string;
}

// mermaid 库动态导入缓存，避免重复加载。
let mermaidLoader: Promise<typeof import('mermaid')> | null = null;

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then(mod => {
      mod.default.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
      });
      return mod;
    });
  }
  return mermaidLoader;
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
    setLoading(true);
    setError(null);

    loadMermaid()
      .then(mod => {
        if (cancelled) return;
        return mod.default.render(diagramId, code.trim());
      })
      .then(result => {
        if (cancelled) return;
        if (result) {
          setSvg(result.svg);
          setLoading(false);
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[MermaidBlock] render failed:', err);
        setError(err?.message || '渲染失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
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
        <pre className="text-xs text-muted-foreground overflow-auto font-mono">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex justify-center py-4 overflow-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};
