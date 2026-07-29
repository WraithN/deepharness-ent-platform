import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Zap, FileCheck, AlertCircle, Rocket, Loader2, LogIn, FolderGit2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { workspaceApi } from '@/lib/workspace-api';
import { repositoryApi } from '@/lib/repository-api';
import { useAuth } from '@/contexts/AuthContext';
import { SPACE_ROLE, SUB_ROLE } from '@/lib/role-constants';
import { toast } from 'sonner';
import type { WorkspaceRepository } from '@/types';

/** 通知数据类型 */
interface NotificationItem {
  id: string;
  userId: string;
  tenantId: string;
  workspaceId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  actionType?: string;
  actionStatus?: string;
  actionUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** 通知轮询间隔（毫秒） */
const NOTIFICATION_POLL_INTERVAL = 30_000;

/** 通知类型图标映射 */
const NOTIFICATION_ICONS: Record<string, React.ElementType> = {
  workitem_assigned: Zap,
  ai_dev_started: Rocket,
  ai_dev_completed: FileCheck,
  ai_dev_failed: AlertCircle,
};

export const NotificationCenter: React.FC = () => {
  const navigate = useNavigate();
  const { user, membership, workspaces, refreshWorkspaces, switchWorkspace } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [acting, setActing] = useState<string>('');

  const unreadCount = notifications.filter(n => !n.read).length;

  // ── 批准对话框状态 ──
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [pendingApproveId, setPendingApproveId] = useState<string | null>(null);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string>('');
  const [pendingWorkspaceName, setPendingWorkspaceName] = useState<string>('');
  const [needJoin, setNeedJoin] = useState(false);
  const [joining, setJoining] = useState(false);

  // ── 工程选择状态 ──
  const [repos, setRepos] = useState<WorkspaceRepository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [reposLoading, setReposLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const list = await api.get<NotificationItem[]>('/v1/notifications?unread=true');
      setNotifications(list || []);
    } catch {
      // 静默失败，不打断用户
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, NOTIFICATION_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  /** 检查用户是否已是通知来源空间的成员 */
  const isMemberOfWorkspace = (wsId: string) => workspaces.some(w => w.workspaceId === wsId);

  /** 加载工作空间的 git 仓库列表 */
  const loadRepos = async (wsId: string) => {
    setReposLoading(true);
    try {
      const list = await repositoryApi.list(wsId);
      setRepos(list || []);
      // 默认选中第一个
      if (list && list.length > 0) {
        setSelectedRepoId(list[0].id);
      } else {
        setSelectedRepoId('');
      }
    } catch {
      setRepos([]);
      setSelectedRepoId('');
    } finally {
      setReposLoading(false);
    }
  };

  const handleApprove = async (id: string, notifWorkspaceId: string) => {
    const notif = notifications.find(n => n.id === id);
    const wsName = notif?.data?.['workspaceName'] as string || notifWorkspaceId;
    const member = isMemberOfWorkspace(notifWorkspaceId);

    setPendingApproveId(id);
    setPendingWorkspaceId(notifWorkspaceId);
    setPendingWorkspaceName(wsName);
    setNeedJoin(!member);
    setProjectName('');
    setAutoGenerate(false);
    setSelectedRepoId('');

    // 若已是成员，加载该空间的仓库列表
    if (member) {
      await loadRepos(notifWorkspaceId);
    }
    setShowApproveDialog(true);
  };

  const handleReject = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, { action: 'reject' });
      toast.info('已拒绝 AI 托管开发');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
  };

  /** 执行实际的批准 API 调用 */
  const doApprove = async (id: string, repoId: string, projName: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, {
        action: 'approve',
        repositoryId: repoId,
        projectName: autoGenerate ? '' : projName,
      });
      toast.success('已批准 AI 托管开发，开发流程已启动');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
  };

  /** 加入空间并加载仓库列表 */
  const handleJoinAndLoad = async () => {
    if (!user?.id || !pendingWorkspaceId) return;
    setJoining(true);
    try {
      await workspaceApi.addMember(pendingWorkspaceId, {
        userId: user.id,
        role: SPACE_ROLE.MEMBER,
        subRole: SUB_ROLE.DEVELOPER,
      });
      await refreshWorkspaces();
      switchWorkspace(pendingWorkspaceId);
      toast.success(`已加入空间「${pendingWorkspaceName}」`);
      setNeedJoin(false);
      await loadRepos(pendingWorkspaceId);
    } catch {
      toast.error('加入空间失败，请重试');
    } finally {
      setJoining(false);
    }
  };

  /** 确认批准 */
  const handleConfirmApprove = async () => {
    if (!pendingApproveId) return;

    // 若当前不在该空间，先切换
    if (membership?.workspaceId !== pendingWorkspaceId) {
      switchWorkspace(pendingWorkspaceId);
    }

    setShowApproveDialog(false);
    await doApprove(pendingApproveId, selectedRepoId, projectName);
  };

  const handleViewReview = async (id: string, url?: string) => {
    try {
      await api.patch(`/v1/notifications/${id}/read`);
    } catch {
      // 标记已读失败不阻塞跳转
    }
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (url) {
      navigate(url);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.post('/v1/notifications/all-read');
      setNotifications([]);
    } catch {
      toast.error('操作失败');
    }
  };

  // 有仓库且选了仓库 -> 可批准；无仓库 -> 需输入工程名或勾选自动生成
  const canApprove = needJoin
    ? false
    : repos.length > 0
      ? !!selectedRepoId
      : autoGenerate || !!projectName.trim();

  return (
    <>
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full w-8 h-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          <span className="sr-only">通知</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-h-[500px] overflow-y-auto p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 sticky top-0 bg-background z-10">
          <span className="text-sm font-semibold">通知</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleMarkAllRead}>
              全部已读
            </Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
            暂无新通知
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {notifications.map(n => {
              const Icon = NOTIFICATION_ICONS[n.type] || Bell;
              return (
                <div key={n.id} className="p-3 hover:bg-accent/30 transition-colors">
                  <div className="flex gap-2.5">
                    <div className="shrink-0 mt-0.5">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        n.type === 'ai_dev_failed' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                        : n.type === 'ai_dev_completed' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : n.type === 'ai_dev_started' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-medium text-foreground">{n.title}</p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground whitespace-pre-line">{n.body}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60">
                        {new Date(n.createdAt).toLocaleString('zh-CN')}
                      </p>
                      {/* 操作按钮 */}
                      {n.actionType === 'approve_ai_dev' && n.actionStatus === 'pending' && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => handleApprove(n.id, n.workspaceId)}
                          >
                            {acting === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                            批准AI开发
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={acting === n.id}
                            onClick={() => handleReject(n.id)}
                          >
                            拒绝
                          </Button>
                        </div>
                      )}
                      {n.actionType === 'view_review' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleViewReview(n.id, n.actionUrl)}
                        >
                          <FileCheck className="h-3 w-3" />
                          查看评审
                        </Button>
                      )}
                      {n.actionStatus === 'approved' && (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold">
                          已批准
                        </span>
                      )}
                      {n.actionStatus === 'rejected' && (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300 font-semibold">
                          已拒绝
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>

    {/* ── 批准 AI 开发对话框 ── */}
    <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
      <DialogContent className="sm:max-w-[440px] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              {needJoin ? <LogIn className="h-4 w-4 text-primary" /> : <FolderGit2 className="h-4 w-4 text-primary" />}
            </div>
            <div className="text-left">
              <DialogTitle className="text-base font-semibold">
                {needJoin ? '加入工作空间' : '确认开发配置'}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                {needJoin
                  ? '该需求属于其他工作空间，加入后即可进行 AI 开发'
                  : '选择目标工程，开始 AI 托管开发'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 需要加入空间 */}
        {needJoin ? (
          <div className="px-6 py-5">
            <p className="text-sm text-muted-foreground">
              需求所在空间：<span className="font-medium text-foreground">{pendingWorkspaceName}</span>
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              加入后将以「开发人员」身份加入该空间，并自动切换到该空间进行开发。
            </p>
          </div>
        ) : (
          /* 已是成员 -> 选择工程 */
          <div className="px-6 py-5 space-y-4">
            {/* 工作空间（只读） */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">工作空间</Label>
              <div className="text-sm font-medium text-foreground">{pendingWorkspaceName}</div>
            </div>

            {/* 仓库选择或工程名输入 */}
            {reposLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载工程列表...
              </div>
            ) : repos.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="repo-select">目标工程</Label>
                <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
                  <SelectTrigger id="repo-select">
                    <SelectValue placeholder="选择工程" />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="project-name">工程名</Label>
                  <Input
                    id="project-name"
                    placeholder="输入工程目录名"
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    disabled={autoGenerate}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="auto-gen"
                    checked={autoGenerate}
                    onCheckedChange={(v) => { setAutoGenerate(!!v); if (v) setProjectName(''); }}
                  />
                  <Label htmlFor="auto-gen" className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1">
                    <Wand2 className="h-3 w-3" /> AI 自动生成工程名
                  </Label>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setShowApproveDialog(false)}
            disabled={joining || acting === pendingApproveId}
          >
            取消
          </Button>
          {needJoin ? (
            <Button
              onClick={handleJoinAndLoad}
              disabled={joining}
              className="gap-1.5"
            >
              {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
              加入空间
            </Button>
          ) : (
            <Button
              onClick={handleConfirmApprove}
              disabled={!canApprove || acting === pendingApproveId}
              className="gap-1.5"
            >
              {acting === pendingApproveId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              批准并开始开发
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
