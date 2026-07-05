import React, { useEffect, useState } from 'react';
import { FolderGit2, GitCompareArrows, Eye, GitCommit, Loader2, Code2 } from 'lucide-react';
import { projectApi, type ProjectCheckResponse } from '@/lib/project-api';
import { repositoryApi } from '@/lib/repository-api';
import { profileApi } from '@/lib/profile-api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { PreviewMode } from '@/components/chat/LivePreview';
import type { WorkspaceRepository } from '@/types';

interface ProjectCardProps {
  /** 工程根目录的绝对路径 */
  path: string;
  /** 点击按钮时的回调，传递预览模式 */
  onPreview?: (path: string, mode: PreviewMode) => void;
}

/**
 * 工程卡片组件。
 *
 * 所有工程都显示"查看 Diff"按钮（通过 git diff 对比 master/main）；
 * 前端工程额外显示"预览"按钮（启动 dev server）。
 * 根据工程状态区分两种展示形态：
 * - 新建工程（绿色）
 * - 已有工程修改（琥珀色）
 */
export const ProjectCard: React.FC<ProjectCardProps> = ({ path, onPreview }) => {
  const [checkResult, setCheckResult] = useState<ProjectCheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [workspaceRepos, setWorkspaceRepos] = useState<WorkspaceRepository[]>([]);
  const [profileSSHKey, setProfileSSHKey] = useState<string>('');

  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCheckFailed(false);
    projectApi
      .check(path)
      .then((result) => {
        if (!cancelled) setCheckResult(result);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[ProjectCard] check failed:', err);
          setCheckFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // 预加载当前工作空间的仓库配置与用户 SSH Key，用于同步时匹配远程仓库。
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    repositoryApi
      .list(workspaceId)
      .then((repos) => {
        if (!cancelled) setWorkspaceRepos(repos);
      })
      .catch((err) => {
        console.error('[ProjectCard] failed to load workspace repos:', err);
      });
    profileApi
      .get()
      .then((profile) => {
        if (!cancelled) setProfileSSHKey(profile.sshKey || '');
      })
      .catch((err) => {
        console.error('[ProjectCard] failed to load user profile:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleSync = async () => {
    if (!workspaceId) {
      toast.error('未选择工作空间，无法同步到远程仓库');
      return;
    }

    setSyncing(true);
    try {
      const projectName = checkResult?.projectName || path.split('/').pop() || path;
      const matchedRepo = workspaceRepos.find((repo) => repo.name === projectName);

      const syncReq: Parameters<typeof projectApi.sync>[0] = { path, workspaceId };
      if (matchedRepo) {
        syncReq.remoteUrl = matchedRepo.url;
        syncReq.remoteBranch = matchedRepo.defaultBranch || 'main';
        syncReq.sshKey = matchedRepo.sshKey || profileSSHKey;
      }

      const result = await projectApi.sync(syncReq);
      toast.success(result.message || '项目已同步到仓库');
    } catch (err) {
      console.error('[ProjectCard] sync failed:', err);
      toast.error('同步失败，请重试');
    } finally {
      setSyncing(false);
    }
  };

  const handleDiff = () => {
    onPreview?.(path, 'diff');
  };

  const handlePreview = () => {
    onPreview?.(path, 'preview');
  };

  const handleCode = () => {
    onPreview?.(path, 'code');
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 w-full p-4 rounded-2xl border border-border/60 bg-card animate-in fade-in zoom-in-95 duration-300">
        <div className="h-10 w-10 rounded-xl bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-1/3 bg-muted rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
        </div>
      </div>
    );
  }

  const projectName = checkResult?.projectName || path.split('/').pop() || path;
  const isNew = checkResult?.isNew ?? true;
  const hasDiff = checkResult?.hasDiff ?? false;
  const fileCount = checkResult?.fileCount ?? 0;

  // check 失败时作为新建工程展示，仍允许查看 Diff 和预览。
  if (isNew || checkFailed) {
    return (
      <div className="w-full p-4 rounded-2xl border border-green-500/30 bg-green-50/50 dark:bg-green-900/10 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-500">
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
                onClick={handleDiff}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-300 hover:underline transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
                查看 Diff
              </button>
              <button
                type="button"
                onClick={handlePreview}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-300 hover:underline transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                <Eye className="h-3.5 w-3.5" />
                预览页面
              </button>
              <button
                type="button"
                onClick={handleCode}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-300 hover:underline transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                <Code2 className="h-3.5 w-3.5" />
                查看工程
              </button>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommit className="h-3.5 w-3.5" />}
                提交修改
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 已有工程修改：琥珀色主题
  return (
    <div className="w-full p-4 rounded-2xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-500">
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
            <button
              type="button"
              onClick={handleDiff}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              查看 Diff
            </button>
            <button
              type="button"
              onClick={handlePreview}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              <Eye className="h-3.5 w-3.5" />
              预览页面
            </button>
            <button
              type="button"
              onClick={handleCode}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              <Code2 className="h-3.5 w-3.5" />
              查看工程
            </button>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 transition-transform duration-200 hover:scale-105 active:scale-95"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommit className="h-3.5 w-3.5" />}
              提交修改
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
