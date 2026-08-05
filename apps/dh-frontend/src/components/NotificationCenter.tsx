import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Zap, FileCheck, AlertCircle, Rocket, Loader2, FolderGit2, Wand2, ClipboardCheck, ClipboardList, CheckCircle2, X, FlaskConical, TestTubeDiagonal, ShieldCheck } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { repositoryApi } from '@/lib/repository-api';
import { useAuth } from '@/contexts/AuthContext';
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
  human_review_required: ClipboardCheck,
  requirement_eval_required: ClipboardList,
  human_audit_required: ClipboardCheck,
  test_plan_review_required: ClipboardList,
  test_case_review_required: FlaskConical,
  test_admission_review_required: ShieldCheck,
  product_review_required: ClipboardCheck,
  product_proto_review_required: TestTubeDiagonal,
  product_final_review_required: ShieldCheck,
};

export const NotificationCenter: React.FC = () => {
  const navigate = useNavigate();
  const { membership, workspaces } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [acting, setActing] = useState<string>('');
  const [showAll, setShowAll] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  // ── 批准对话框状态 ──
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [pendingApproveId, setPendingApproveId] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');

  // ── 工程选择状态 ──
  const [repos, setRepos] = useState<WorkspaceRepository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [reposLoading, setReposLoading] = useState(false);

  // ── 人工复审审批对话框状态 ──
  const [showOptimizeDialog, setShowOptimizeDialog] = useState(false);
  const [optimizeNotificationId, setOptimizeNotificationId] = useState<string | null>(null);
  const [optimizeTitle, setOptimizeTitle] = useState<string>('');
  const [optimizePrompt, setOptimizePrompt] = useState<string>('');

  // ── 驳回原因对话框状态 ──
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectNotificationId, setRejectNotificationId] = useState<string | null>(null);
  const [rejectTitle, setRejectTitle] = useState<string>('');
  const [rejectReason, setRejectReason] = useState<string>('');

  // 审批通过：直接提交，无需优化
  const handleReviewPass = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, {
        action: 'approve',
        approved: true,
      });
      toast.success('审批通过，开发已完成');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
    fetchNotifications();
  };

  // 需求评估：需要架构设计（approved=false，无需优化指示）
  const handleReviewRejectDirect = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, {
        action: 'approve',
        approved: false,
      });
      toast.success('已选择架构设计，流程继续');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
    fetchNotifications();
  };

  // 人工审核通过：approved=true，流程进入需求开发
  const handleAuditPass = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, {
        action: 'approve',
        approved: true,
      });
      toast.success('审核通过，进入需求开发');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
    fetchNotifications();
  };

  // 测试审核通过
  const handleTestReviewPass = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, {
        action: 'approve',
        approved: true,
      });
      toast.success('审核通过，流程继续');
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
    fetchNotifications();
  };

  // 打开驳回原因对话框
  const openRejectDialog = (id: string, title: string) => {
    setRejectNotificationId(id);
    setRejectTitle(title);
    setRejectReason('');
    setShowRejectDialog(true);
  };

  // 提交驳回（附原因）
  const handleSubmitReject = async () => {
    if (!rejectNotificationId) return;
    setActing(rejectNotificationId);
    try {
      await api.post(`/v1/notifications/${rejectNotificationId}/action`, {
        action: 'approve',
        approved: false,
        reason: rejectReason,
      });
      toast.success('已驳回');
      setNotifications(prev => prev.filter(n => n.id !== rejectNotificationId));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
    setShowRejectDialog(false);
    setRejectNotificationId(null);
    setRejectReason('');
    fetchNotifications();
  };

  // 查看详情：标记已读后跳转到流程页
  const handleViewDetail = async (id: string, url: string) => {
    try {
      await api.patch(`/v1/notifications/${id}/read`);
    } catch {
      // 忽略
    }
    setNotifications(prev => prev.filter(n => n.id !== id));
    navigate(url);
  };

  // 审批不通过：提交优化指示，触发代码优化
  const handleReviewReject = async () => {
    if (!optimizeNotificationId) return;
    setActing(optimizeNotificationId);
    try {
      await api.post(`/v1/notifications/${optimizeNotificationId}/action`, {
        action: 'approve',
        approved: false,
        prompt: optimizePrompt,
      });
      toast.success('已提交优化指示，AI 将进行代码优化后重新评审');
      setNotifications(prev => prev.filter(n => n.id !== optimizeNotificationId));
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActing('');
    }
    setShowOptimizeDialog(false);
    setOptimizeNotificationId(null);
    setOptimizePrompt('');
    setOptimizeTitle('');
    fetchNotifications();
  };

  const fetchNotifications = useCallback(async () => {
    try {
      const query = showAll ? '' : '?unread=true';
      const list = await api.get<NotificationItem[]>(`/v1/notifications${query}`);
      setNotifications(list || []);
    } catch {
      // 静默失败，不打断用户
    }
  }, [showAll]);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, NOTIFICATION_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

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

  const handleApprove = async (id: string, _notifWorkspaceId: string) => {
    // 默认选择当前工作空间
    const currentWsId = membership?.workspaceId ?? workspaces[0]?.workspaceId ?? '';

    setPendingApproveId(id);
    setSelectedWorkspaceId(currentWsId);
    setProjectName('');
    setAutoGenerate(false);
    setSelectedRepoId('');

    // 加载当前工作空间的仓库列表
    if (currentWsId) {
      await loadRepos(currentWsId);
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
  const doApprove = async (id: string, wsId: string, repoId: string, projName: string) => {
    setActing(id);
    try {
      await api.post(`/v1/notifications/${id}/action`, {
        action: 'approve',
        workspaceId: wsId,
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

  /** 切换工作空间并加载仓库列表 */
  const handleWorkspaceChange = async (wsId: string) => {
    setSelectedWorkspaceId(wsId);
    setProjectName('');
    setAutoGenerate(false);
    setSelectedRepoId('');
    await loadRepos(wsId);
  };

  /** 确认批准 */
  const handleConfirmApprove = async () => {
    if (!pendingApproveId) return;
    setShowApproveDialog(false);
    await doApprove(pendingApproveId, selectedWorkspaceId, selectedRepoId, projectName);
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
  const canApprove = selectedWorkspaceId === ''
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
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">通知</span>
            <button
              type="button"
              onClick={() => setShowAll(prev => !prev)}
              className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors ${showAll ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
            >
              {showAll ? '全部' : '未读'}
            </button>
          </div>
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
                        : n.type === 'human_review_required' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                        : n.type === 'requirement_eval_required' ? 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400'
                        : n.type === 'human_audit_required' ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                        : n.type === 'test_plan_review_required' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                        : n.type === 'test_case_review_required' ? 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400'
                        : n.type === 'test_admission_review_required' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
                        : n.type === 'product_review_required' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                        : n.type === 'product_proto_review_required' ? 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400'
                        : n.type === 'product_final_review_required' ? 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-400'
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
                      {n.actionType === 'approve_code_optimize' && n.actionStatus === 'pending' && n.type !== 'requirement_eval_required' && n.type !== 'human_audit_required' && n.type !== 'test_plan_review_required' && n.type !== 'test_case_review_required' && n.type !== 'test_admission_review_required' && n.type !== 'product_review_required' && n.type !== 'product_proto_review_required' && n.type !== 'product_final_review_required' && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => handleReviewPass(n.id)}
                          >
                            {acting === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            审批通过
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => {
                              setOptimizeNotificationId(n.id);
                              setOptimizeTitle(n.title);
                              setOptimizePrompt('');
                              setShowOptimizeDialog(true);
                            }}
                          >
                            <Wand2 className="h-3 w-3" />
                            需优化
                          </Button>
                        </div>
                      )}
                      {/* 需求评估通知按钮 */}
                      {n.actionType === 'approve_code_optimize' && n.actionStatus === 'pending' && n.type === 'requirement_eval_required' && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => handleReviewPass(n.id)}
                          >
                            {acting === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            直接开发
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => handleReviewRejectDirect(n.id)}
                          >
                            <ClipboardList className="h-3 w-3" />
                            需要架构设计
                          </Button>
                        </div>
                      )}
                      {/* 人工审核通知按钮 */}
                      {n.actionType === 'approve_code_optimize' && n.actionStatus === 'pending' && n.type === 'human_audit_required' && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => handleAuditPass(n.id)}
                          >
                            {acting === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            通过
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => openRejectDialog(n.id, n.title)}
                          >
                            <X className="h-3 w-3" />
                         不通过
                           </Button>
                        </div>
                      )}
                      {/* 测试方案/用例/准入审核通知按钮 */}
                      {n.actionType === 'approve_code_optimize' && n.actionStatus === 'pending' && (n.type === 'test_plan_review_required' || n.type === 'test_case_review_required' || n.type === 'test_admission_review_required') && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => handleTestReviewPass(n.id)}
                          >
                            {acting === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                            通过
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={acting === n.id}
                            onClick={() => openRejectDialog(n.id, n.title)}
                          >
                            <X className="h-3 w-3" />
                             不通过
                            </Button>
                          </div>
                        )}
                        {/* 产品评审通知按钮 */}
                        {n.actionType === 'approve_code_optimize' && n.actionStatus === 'pending' && (n.type === 'product_review_required' || n.type === 'product_proto_review_required' || n.type === 'product_final_review_required') && (
                          <div className="flex gap-2 pt-1">
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={acting === n.id}
                              onClick={() => handleTestReviewPass(n.id)}
                            >
                              {acting === n.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              disabled={acting === n.id}
                              onClick={() => openRejectDialog(n.id, n.title)}
                            >
                              <X className="h-3 w-3" />
                               不通过
                            </Button>
                          </div>
                        )}
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
                       {n.actionType === 'approve_code_optimize' && n.actionStatus === 'pending' && n.actionUrl && (
                         <div className="pt-0.5">
                           <Button
                             size="sm"
                             variant="link"
                             className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                             onClick={() => handleViewDetail(n.id, n.actionUrl)}
                           >
                             查看详情
                             <ArrowRight className="ml-1 h-3 w-3" />
                           </Button>
                         </div>
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
              <FolderGit2 className="h-4 w-4 text-primary" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-base font-semibold">确认开发配置</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                选择目标工作空间与工程，开始 AI 托管开发
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* 工作空间选择 */}
          <div className="space-y-1.5">
            <Label htmlFor="ws-select">目标工作空间</Label>
            <Select value={selectedWorkspaceId} onValueChange={handleWorkspaceChange}>
              <SelectTrigger id="ws-select">
                <SelectValue placeholder="选择工作空间" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map(w => (
                  <SelectItem key={w.workspaceId} value={w.workspaceId}>
                    {w.workspaceName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

        <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setShowApproveDialog(false)}
            disabled={acting === pendingApproveId}
          >
            取消
          </Button>
          <Button
            onClick={handleConfirmApprove}
            disabled={!canApprove || acting === pendingApproveId}
            className="gap-1.5"
          >
            {acting === pendingApproveId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            批准并开始开发
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── 代码优化审批对话框 ── */}
    <Dialog open={showOptimizeDialog} onOpenChange={setShowOptimizeDialog}>
      <DialogContent className="sm:max-w-[500px] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Wand2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <DialogTitle className="text-base">审核评审报告并指示优化</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {optimizeTitle}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-4 space-y-4 overflow-y-auto max-h-[calc(70vh-80px)]">
          <div className="space-y-1.5">
            <Label htmlFor="optimize-prompt">优化指示（可选）</Label>
            <Textarea
              id="optimize-prompt"
              placeholder="输入对 AI 的具体优化指示，例如：请重点关注性能优化和错误处理..."
              value={optimizePrompt}
              onChange={e => setOptimizePrompt(e.target.value)}
              className="min-h-[120px]"
            />
            <p className="text-[11px] text-muted-foreground">
              留空则 AI 仅根据评审报告自动进行优化修复
            </p>
          </div>
        </div>
        <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowOptimizeDialog(false);
              setOptimizeNotificationId(null);
              setOptimizePrompt('');
            }}
          >
            取消
          </Button>
          <Button
            onClick={handleReviewReject}
            className="gap-1.5"
          >
            <Wand2 className="h-3.5 w-3.5" />
            提交优化指示
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── 驳回原因对话框 ── */}
    <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
      <DialogContent className="sm:max-w-[440px] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <X className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-base font-semibold">驳回原因</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                {rejectTitle}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">驳回原因（可选）</Label>
            <Textarea
              id="reject-reason"
              placeholder="请输入驳回原因，帮助团队理解需要改进的地方..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
        </div>
        <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowRejectDialog(false);
              setRejectNotificationId(null);
              setRejectReason('');
            }}
          >
            取消
          </Button>
          <Button
            onClick={handleSubmitReject}
            className="gap-1.5"
            variant="destructive"
          >
            <X className="h-3.5 w-3.5" />
            确认驳回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};
