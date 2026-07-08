import React, { useEffect, useState } from 'react';
import { FolderGit2, GitCompareArrows, Eye, Code2, GitCommit, Loader2 } from 'lucide-react';
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
  /** 点击操作按钮时的回调，传递预览模式 */
  onPreview?: (path: string, mode: PreviewMode) => void;
}

/** 卡片主题色类型。 */
type CardTheme = 'green' | 'amber';

const THEME_TEXT_CLASS: Record<CardTheme, string> = {
  green: 'text-green-700 dark:text-green-300',
  amber: 'text-amber-700 dark:text-amber-300',
};

const SYNC_TEXT_CLASS = 'text-blue-600 dark:text-blue-400';

/**
 * 工程卡片组件。
 *
 * 提供四种操作：
 * - 查看 Diff（对比 master/main）
 * - 预览页面（启动 dev server）
 * - 查看工程（文件树 + 代码高亮）
 * - 提交修改（同步到远程仓库）
 *
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

  const handleDiff = () => onPreview?.(path, 'diff');
  const handlePreview = () => onPreview?.(path, 'preview');
  const handleCode = () => onPreview?.(path, 'code');

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
  const theme: CardTheme = isNew || checkFailed ? 'green' : 'amber';

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
            <ActionBar
              theme={theme}
              syncing={syncing}
              onDiff={handleDiff}
              onPreview={handlePreview}
              onCode={handleCode}
              onSync={handleSync}
            />
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
          <ActionBar
            theme={theme}
            syncing={syncing}
            onDiff={handleDiff}
            onPreview={handlePreview}
            onCode={handleCode}
            onSync={handleSync}
          />
        </div>
      </div>
    </div>
  );
};

interface ActionBarProps {
  theme: CardTheme;
  syncing: boolean;
  onDiff: () => void;
  onPreview: () => void;
  onCode: () => void;
  onSync: () => void;
}

/** 工程卡片操作按钮组：Diff、预览、代码、提交。 */
const ActionBar: React.FC<ActionBarProps> = ({ theme, syncing, onDiff, onPreview, onCode, onSync }) => {
  const themeClass = THEME_TEXT_CLASS[theme];

  return (
    <div className="flex items-center gap-3 mt-3 flex-wrap">
      <ActionLink icon={GitCompareArrows} label="查看 Diff" themeClass={themeClass} onClick={onDiff} />
      <ActionLink icon={Eye} label="预览页面" themeClass={themeClass} onClick={onPreview} />
      <ActionLink icon={Code2} label="查看工程" themeClass={themeClass} onClick={onCode} />
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline disabled:opacity-50 transition-transform duration-200 hover:scale-105 active:scale-95"
      >
        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommit className="h-3.5 w-3.5" />}
        提交修改
      </button>
    </div>
  );
};

interface ActionLinkProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  themeClass: string;
  onClick: () => void;
}

/** 单个文本操作按钮（Diff/预览/代码）。 */
const ActionLink: React.FC<ActionLinkProps> = ({ icon: Icon, label, themeClass, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1.5 text-xs font-medium hover:underline transition-transform duration-200 hover:scale-105 active:scale-95',
      themeClass
    )}
  >
    <Icon className="h-3.5 w-3.5" />
    {label}
  </button>
);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
