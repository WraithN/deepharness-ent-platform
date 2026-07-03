import React, { useEffect, useState } from 'react';
import { FolderGit2, GitCompareArrows, Eye, RefreshCw, Loader2, CheckCircle2, FileCode2 } from 'lucide-react';
import { projectApi, type ProjectCheckResponse } from '@/lib/project-api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProjectCardProps {
  /** 工程根目录的绝对路径 */
  path: string;
  /** 点击预览按钮时的回调 */
  onPreview?: (path: string, isNew: boolean) => void;
}

/**
 * 工程卡片组件。
 *
 * 根据 projectApi.check 结果区分两种展示形态：
 * - 新建工程（绿色）：显示文件数、预览工程按钮、同步到仓库按钮
 * - 已有工程修改（琥珀色）：显示查看 diff 按钮
 */
export const ProjectCard: React.FC<ProjectCardProps> = ({ path, onPreview }) => {
  const [checkResult, setCheckResult] = useState<ProjectCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    projectApi
      .check(path)
      .then((result) => {
        if (!cancelled) setCheckResult(result);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ProjectCard] check failed:', err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await projectApi.sync({ path });
      toast.success(result.message || '项目已同步到仓库');
    } catch (err) {
      console.error('[ProjectCard] sync failed:', err);
      toast.error('同步失败，请重试');
    } finally {
      setSyncing(false);
    }
  };

  const handlePreview = () => {
    if (onPreview && checkResult) {
      onPreview(path, checkResult.isNew);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 w-full p-4 rounded-2xl border border-border/60 bg-card">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">正在检查工程状态...</span>
      </div>
    );
  }

  const projectName = checkResult?.projectName || path.split('/').pop() || path;
  const isNew = checkResult?.isNew ?? true;
  const hasDiff = checkResult?.hasDiff ?? false;
  const fileCount = checkResult?.fileCount ?? 0;

  // 新建工程：绿色主题
  if (isNew) {
    return (
      <div className="w-full p-4 rounded-2xl border border-green-500/30 bg-green-50/50 dark:bg-green-900/10 shadow-sm hover:shadow-md transition-all">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
            <FolderGit2 className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground truncate">{projectName}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-700 dark:text-green-300 font-medium">
                新建工程
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {fileCount > 0 ? `${fileCount} 个文件` : '空工程'}
              {checkResult && checkResult.dirSize > 0 && (
                <span className="ml-2">{formatSize(checkResult.dirSize)}</span>
              )}
            </p>
            <div className="flex items-center gap-3 mt-3">
              <button
                type="button"
                onClick={handlePreview}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-300 hover:underline"
              >
                <Eye className="h-3.5 w-3.5" />
                预览工程
              </button>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                同步到仓库
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 已有工程修改：琥珀色主题
  return (
    <div className="w-full p-4 rounded-2xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
          <GitCompareArrows className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{projectName}</p>
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
              hasDiff
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-muted text-muted-foreground'
            )}>
              {hasDiff ? '修改完成' : '无变更'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {fileCount > 0 ? `${fileCount} 个文件` : ''}
          </p>
          <div className="flex items-center gap-3 mt-3">
            {hasDiff ? (
              <button
                type="button"
                onClick={handlePreview}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline"
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
                查看 Diff
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePreview}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:underline"
              >
                <Eye className="h-3.5 w-3.5" />
                预览工程
              </button>
            )}
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              同步到仓库
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
