import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Zap, FileCheck, AlertCircle, Rocket, Loader2, LogIn } from 'lucide-react';
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
import { api } from '@/lib/api';
import { workspaceApi } from '@/lib/workspace-api';
import { useAuth } from '@/contexts/AuthContext';
import { SPACE_ROLE, SUB_ROLE } from '@/lib/role-constants';
import { toast } from 'sonner';

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

  // ── 加入空间对话框状态 ──
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  const [pendingApproveId, setPendingApproveId] = useState<string | null>(null);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string>('');
  const [pendingWorkspaceName, setPendingWorkspaceName] = useState<string>('');
  const [joining, setJoining] = useState(false);

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

  const handleApprove = async (id: string, notifWorkspaceId: string) => {
    // 如果已是该空间成员，直接批准
    if (isMemberOfWorkspace(notifWorkspaceId)) {
      // 若当前不在该空间，先切换过去
      if (membership?.workspaceId !== notifWorkspaceId) {
        switchWorkspace(notifWorkspaceId);
      }
      doApprove(id);
      return;
    }

    // 不是该空间成员 -> 弹出加入空间对话框
    const notif = notifications.find(n => n.id === id);
    const wsName = notif?.data?.['workspaceName'] as string || notifWorkspaceId;
    setPendingApproveId(id);
    setPendingWorkspaceId(notifWorkspaceId);
    setPendingWorkspaceName(wsName);
    setShowJoinDialog(true);
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
  const doApprove = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, { action: 'approve' });
      toast.success('已批准 AI 托管开发，开发流程已启动');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
  };

  /** 加入空间并批准 */
  const handleJoinAndApprove = async () => {
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
      setShowJoinDialog(false);
      if (pendingApproveId) {
        doApprove(pendingApproveId);
      }
    } catch {
      toast.error('加入空间失败，请重试');
    } finally {
      setJoining(false);
    }
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

    {/* ── 加入空间对话框 ── */}
    <Dialog open={showJoinDialog} onOpenChange={setShowJoinDialog}>
      <DialogContent className="sm:max-w-[400px] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <LogIn className="h-4 w-4 text-primary" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-base font-semibold">加入工作空间</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                该需求属于其他工作空间，加入后即可进行 AI 开发
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground">
            需求所在空间：<span className="font-medium text-foreground">{pendingWorkspaceName}</span>
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2">
            加入后将以「开发人员」身份加入该空间，并自动切换到该空间进行开发。
          </p>
        </div>

        <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setShowJoinDialog(false)}
            disabled={joining}
          >
            取消
          </Button>
          <Button
            onClick={handleJoinAndApprove}
            disabled={joining}
            className="gap-1.5"
          >
            {joining ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="h-3.5 w-3.5" />
            )}
            加入并批准
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
