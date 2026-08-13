import React, { useEffect, useState } from 'react';
import { MonitorPlay, Eye, Code2, FileText, Loader2 } from 'lucide-react';
import { projectApi, type ProjectCheckResponse } from '@/lib/project-api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { PreviewMode } from './LivePreview';

interface ResearchPrototypeCardProps {
  /** 高仿原型工程根目录的绝对路径（例如 .../pm-jobs/prd-research/pingcode-com/prototype） */
  path: string;
  /** 预览回调：mode 为 preview（打开原型预览）或 code（查看工程文件） */
  onPreview?: (path: string, mode: PreviewMode) => void;
}

/**
 * 竞品调研高仿原型卡片。
 *
 * 与 PrototypeCard（产品空间原型，可"采纳到产品空间"）不同：
 * 本卡片面向 /prd-research 产出的高仿原型，只提供「预览原型」和「查看工程」两个操作，
 * 不含任何 Git 相关操作（查看 Diff / 提交修改），因为原型工程不是受控代码库。
 */
export const ResearchPrototypeCard: React.FC<ResearchPrototypeCardProps> = ({ path, onPreview }) => {
  const productName = path.split('/').filter(Boolean).pop() || path;
  const [checkResult, setCheckResult] = useState<ProjectCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    projectApi
      .check(path)
      .then((res) => {
        if (!cancelled) setCheckResult(res);
      })
      .catch((err) => {
        if (!cancelled) console.error('[ResearchPrototypeCard] check failed:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const fileCount = checkResult?.fileCount ?? 0;

  return (
    <div className="w-full p-4 rounded-2xl border border-blue-500/30 bg-blue-50/50 dark:bg-blue-900/10 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
          <MonitorPlay className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground truncate">{productName}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-300 font-medium">
              高仿原型
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载中…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                {fileCount > 0 ? `${fileCount} 个文件` : '查看文件'}
              </span>
            )}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 text-xs gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-500/10')}
              onClick={() => onPreview?.(path, 'preview')}
            >
              <Eye className="h-3.5 w-3.5" />
              预览原型
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 text-xs gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-500/10')}
              onClick={() => onPreview?.(path, 'code')}
            >
              <Code2 className="h-3.5 w-3.5" />
              查看工程
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
