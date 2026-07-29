import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Zap, FileCheck, AlertCircle, Rocket, Loader2, Link2, Wand2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { workspaceApi } from '@/lib/workspace-api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { WorkitemPlatform } from '@/types';

/** 通知数据类型 */
interface NotificationItem {
  id: string;
  userId: string;
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

/** 需求管理平台接口失败时的回退列表，保证下拉框始终可用 */
const DEFAULT_WORKITEM_PLATFORMS: WorkitemPlatform[] = [
  { key: 'meego', name: 'Meego', needsProjectId: true, projectIdPlaceholder: '输入 Meego 项目 ID...' },
  { key: 'jira', name: 'Jira', needsProjectId: true, projectIdPlaceholder: '输入 Jira 项目 Key（如 PROJ）...' },
  { key: 'pingcode', name: 'PingCode', needsProjectId: true, projectIdPlaceholder: '输入 PingCode 项目 ID...' },
];

export const NotificationCenter: React.FC = () => {
  const navigate = useNavigate();
  const { membership } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string>('');

  const unreadCount = notifications.filter(n => !n.read).length;
  const workspaceId = membership?.workspaceId ?? '';

  // ── 项目绑定对话框状态 ──
  const [showBindDialog, setShowBindDialog] = useState(false);
  const [pendingApproveId, setPendingApproveId] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<WorkitemPlatform[]>(DEFAULT_WORKITEM_PLATFORMS);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [projectIdInput, setProjectIdInput] = useState('');
  const [bindingLoading, setBindingLoading] = useState(false);

  const effectivePlatforms = platforms.length > 0 ? platforms : DEFAULT_WORKITEM_PLATFORMS;
  const selectedPlatformMeta = effectivePlatforms.find(p => p.key === selectedPlatform);

  const fetchNotifications = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const list = await api.get<NotificationItem[]>(`/v1/notifications?unread=true&workspaceId=${encodeURIComponent(workspaceId)}`);
      setNotifications(list || []);
    } catch {
      // 静默失败，不打断用户
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, NOTIFICATION_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  const handleApprove = async (id: string) => {
    // 先检查是否已绑定需求管理工程
    try {
      const wp = await workspaceApi.getWorkitemProject(workspaceId);
      if (!wp.platform || !wp.externalKey) {
        // 未绑定项目工程 → 弹出绑定对话框
        setPendingApproveId(id);
        openBindDialog();
        return;
      }
    } catch {
      // getWorkitemProject 失败（未绑定或网络问题）→ 同样弹出对话框
      setPendingApproveId(id);
      openBindDialog();
      return;
    }

    doApprove(id);
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

  /** 打开项目绑定对话框，同时预加载平台列表 */
  const openBindDialog = async () => {
    setShowBindDialog(true);
    // 尝试从后端获取平台列表
    try {
      const list = await workspaceApi.listWorkitemPlatforms();
      if (list && list.length > 0) {
        setPlatforms(list);
        setSelectedPlatform(list[0].key);
      }
    } catch {
      // 保持 DEFAULT_WORKITEM_PLATFORMS 回退
    }
  };

  /** 绑定项目工程后继续批准 */
  const handleBindAndApprove = async () => {
    if (!selectedPlatform) {
      toast.error('请选择需求管理平台');
      return;
    }
    if (selectedPlatformMeta?.needsProjectId && !projectIdInput.trim()) {
      toast.error('请输入项目 ID');
      return;
    }

    setBindingLoading(true);
    try {
      await workspaceApi.setWorkitemProject(workspaceId, {
        platform: selectedPlatform,
        externalKey: projectIdInput.trim(),
        name: selectedPlatformMeta?.name ?? selectedPlatform,
      });
      toast.success('项目工程已绑定');
      setShowBindDialog(false);

      // 继续批准
      if (pendingApproveId) {
        doApprove(pendingApproveId);
      }
    } catch {
      toast.error('绑定失败，请重试');
    } finally {
      setBindingLoading(false);
    }
  };

  /** 自动创建项目工程绑定并批准 */
  const handleAutoCreateAndApprove = async () => {
    const platform = effectivePlatforms[0];
    if (!platform) {
      toast.error('没有可用的需求管理平台');
      return;
    }
    const autoProjectId = `auto-${workspaceId}`;

    setBindingLoading(true);
    try {
      await workspaceApi.setWorkitemProject(workspaceId, {
        platform: platform.key,
        externalKey: autoProjectId,
        name: platform.name,
      });
      toast.success('已自动创建并绑定工程');
      setShowBindDialog(false);

      if (pendingApproveId) {
        doApprove(pendingApproveId);
      }
    } catch {
      toast.error('自动创建失败，请重试');
    } finally {
      setBindingLoading(false);
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
    if (!workspaceId) return;
    try {
      await api.post(`/v1/notifications/all-read?workspaceId=${encodeURIComponent(workspaceId)}`);
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
                            onClick={() => handleApprove(n.id)}
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

    {/* ── 项目绑定对话框 ── */}
    <Dialog open={showBindDialog} onOpenChange={setShowBindDialog}>
      <DialogContent className="sm:max-w-[440px] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Link2 className="h-4 w-4 text-primary" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-base font-semibold">绑定 AI 开发工程</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                批准 AI 托管开发前，需绑定需求管理平台的项目工程
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="bind-platform">需求管理平台</Label>
            <Select value={selectedPlatform} onValueChange={(v) => { setSelectedPlatform(v); setProjectIdInput(''); }}>
              <SelectTrigger id="bind-platform">
                <SelectValue placeholder="选择平台" />
              </SelectTrigger>
              <SelectContent>
                {effectivePlatforms.map(p => (
                  <SelectItem key={p.key} value={p.key}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPlatformMeta?.needsProjectId && (
            <div className="space-y-2">
              <Label htmlFor="bind-project-id">项目 ID</Label>
              <Input
                id="bind-project-id"
                placeholder={selectedPlatformMeta.projectIdPlaceholder || '输入项目 ID...'}
                value={projectIdInput}
                onChange={e => setProjectIdInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleBindAndApprove(); }}
              />
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-between">
          <Button
            variant="outline"
            onClick={() => setShowBindDialog(false)}
            disabled={bindingLoading}
          >
            取消
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleAutoCreateAndApprove}
              disabled={bindingLoading}
              className="gap-1.5"
            >
              {bindingLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              自动创建
            </Button>
            <Button
              onClick={handleBindAndApprove}
              disabled={bindingLoading}
              className="gap-1.5"
            >
              {bindingLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              绑定并批准
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
