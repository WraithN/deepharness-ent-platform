import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, AlertCircle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { repositoryApi, type UserRepoStatus } from '@/lib/repository-api';
import { LivePreview } from '@/components/chat/LivePreview';
import type { RepositoryDTO, BranchInfoDTO } from '@/lib/api-types';

/**
 * 原型预览工作台。
 *
 * 对产品/设计角色隐藏 Git 术语，把「分支」展示为「版本」。
 * 选择产品项目与版本后，启动 dev server 并通过 LivePreview 展示。
 */
export const PrototypeWorkspace: React.FC = () => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  const [syncChecking, setSyncChecking] = useState(true);
  const [userRepoStatuses, setUserRepoStatuses] = useState<UserRepoStatus[]>([]);
  const [repositories, setRepositories] = useState<RepositoryDTO[]>([]);
  const [branches, setBranches] = useState<BranchInfoDTO[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);

  // 检查仓库同步状态
  useEffect(() => {
    if (!workspaceId) return;
    setSyncChecking(true);
    repositoryApi
      .listUserRepos(workspaceId)
      .then(setUserRepoStatuses)
      .catch(() => toast.error('检查项目同步状态失败'))
      .finally(() => setSyncChecking(false));
  }, [workspaceId]);

  // 同步完成后加载仓库列表
  useEffect(() => {
    if (!workspaceId || syncChecking || userRepoStatuses.length === 0) return;
    const hasSynced = userRepoStatuses.some(s => s.synced);
    if (!hasSynced) return;

    setLoadingRepos(true);
    api
      .get<RepositoryDTO[]>(`/v1/workspaces/${workspaceId}/repositories`)
      .then(repos => {
        setRepositories(repos);
        const firstDev = repos.find(r => r.type === 'dev') ?? repos[0];
        if (firstDev) {
          setSelectedRepoId(firstDev.id);
        }
      })
      .catch(() => toast.error('加载项目列表失败'))
      .finally(() => setLoadingRepos(false));
  }, [workspaceId, syncChecking, userRepoStatuses]);

  // 选择仓库后加载分支（产品语义：版本）
  useEffect(() => {
    if (!workspaceId || !selectedRepoId) return;
    setLoadingBranches(true);
    api
      .get<BranchInfoDTO[]>(`/v1/workspaces/${workspaceId}/repositories/${selectedRepoId}/branches`)
      .then(list => {
        setBranches(list);
        const current = list.find(b => b.isCurrent) || list[0];
        setSelectedBranch(current?.name ?? '');
      })
      .catch(() => toast.error('加载版本列表失败'))
      .finally(() => setLoadingBranches(false));
  }, [workspaceId, selectedRepoId]);

  const currentRepo = useMemo(
    () => repositories.find(r => r.id === selectedRepoId),
    [repositories, selectedRepoId]
  );

  const handleRefreshBranches = async () => {
    if (!workspaceId || !selectedRepoId) return;
    setLoadingBranches(true);
    try {
      const list = await repositoryApi.refreshBranches(workspaceId, selectedRepoId);
      setBranches(list);
      toast.success('版本列表已刷新');
    } catch {
      toast.error('刷新版本列表失败');
    } finally {
      setLoadingBranches(false);
    }
  };

  if (syncChecking) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p>正在检查项目同步状态…</p>
      </div>
    );
  }

  const hasSyncedRepo = userRepoStatuses.some(s => s.synced);
  if (!hasSyncedRepo) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <AlertCircle className="h-8 w-8 text-amber-500" />
        <p>尚未同步产品项目，请在设置中配置并同步代码仓库</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">原型预览</span>
        </div>
        <div className="flex items-center gap-3">
          {loadingRepos ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="选择产品项目" />
              </SelectTrigger>
              <SelectContent>
                {repositories.map(repo => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex items-center gap-2">
            {loadingBranches ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue placeholder="选择版本" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map(branch => (
                    <SelectItem key={branch.name} value={branch.name}>
                      {branch.isCurrent ? `${branch.name}（当前）` : branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRefreshBranches} disabled={loadingBranches}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {currentRepo?.localPath ? (
          <LivePreview projectPath={currentRepo.localPath} previewOnly />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <AlertCircle className="h-8 w-8" />
            <p>请选择已同步的产品项目以预览原型</p>
          </div>
        )}
      </div>
    </div>
  );
};
