import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  MessageSquare,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── 类型定义 ──

interface ProcessStage {
  name: string;
  label: string;
  status: string;
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface Process {
  id: string;
  workspaceId: string;
  workitemId: string;
  title: string;
  type: string;
  stages: ProcessStage[];
  createdAt: string;
  updatedAt: string;
}

// ── 常量 ──

const REFRESH_INTERVAL_MS = 5000;
const STAGE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

// ── 阶段状态 UI 配置 ──

interface StageUIConfig {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  colorClass: string;
  bgClass: string;
}

const STATUS_UI: Record<string, StageUIConfig> = {
  [STAGE_STATUS.PENDING]: { icon: Circle, colorClass: 'text-muted-foreground/40', bgClass: 'bg-muted' },
  [STAGE_STATUS.IN_PROGRESS]: { icon: Loader2, colorClass: 'text-blue-500 animate-spin', bgClass: 'bg-blue-50 dark:bg-blue-950' },
  [STAGE_STATUS.COMPLETED]: { icon: CheckCircle2, colorClass: 'text-emerald-500', bgClass: 'bg-emerald-50 dark:bg-emerald-950' },
  [STAGE_STATUS.FAILED]: { icon: XCircle, colorClass: 'text-red-500', bgClass: 'bg-red-50 dark:bg-red-950' },
};

// ── 流程类型标签配置 ──

const PROCESS_TYPE_LABELS: Record<string, string> = {
  ai_dev: 'AI 开发',
};

/**
 * 流程追踪页面 — AI 开发流程阶段可视化。
 * 展示当前工作空间下所有流程的阶段进度，
 * 支持点击「查看详情」跳转到对应的 Agent 会话。
 */
export const FlowTracking: React.FC = () => {
  const navigate = useNavigate();
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaceId = getCurrentWorkspaceId();

  const fetchProcesses = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get<Process[]>(
        `/v1/processes?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      setProcesses(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取流程列表失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchProcesses();
    const timer = setInterval(fetchProcesses, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchProcesses]);

  const handleViewDetail = (process: Process) => {
    const sessionStage = process.stages.find(
      (s) => s.sessionId && s.status === STAGE_STATUS.IN_PROGRESS
    ) ?? process.stages.find((s) => s.sessionId && s.status === STAGE_STATUS.COMPLETED)
      ?? process.stages.find((s) => s.sessionId);

    if (!sessionStage?.sessionId) {
      toast.error('暂无关联的开发会话');
      return;
    }
    navigate(`/chat?session=${encodeURIComponent(sessionStage.sessionId)}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchProcesses}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold">流程追踪</h2>
        <Badge variant="secondary" className="text-xs">
          {processes.length}
        </Badge>
        <div className="ml-auto">
          <Button variant="ghost" size="icon" onClick={fetchProcesses} title="刷新">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {processes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">暂无流程</p>
            <p className="text-xs text-muted-foreground/60">
              AI 托管开发被批准后将自动创建流程记录
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {processes.map((process) => (
            <ProcessCard
              key={process.id}
              process={process}
              onViewDetail={() => handleViewDetail(process)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── 流程卡片 ──

interface ProcessCardProps {
  process: Process;
  onViewDetail: () => void;
}

const ProcessCard: React.FC<ProcessCardProps> = ({ process, onViewDetail }) => {
  const hasActiveStage = process.stages.some(
    (s) => s.status === STAGE_STATUS.IN_PROGRESS
  );

  return (
    <Card className={hasActiveStage ? 'ring-1 ring-blue-200 dark:ring-blue-800' : ''}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <CardTitle className="text-sm font-medium truncate">
              {process.title}
            </CardTitle>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {PROCESS_TYPE_LABELS[process.type] ?? process.type}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 ml-2 h-7 text-xs"
            onClick={onViewDetail}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            查看详情
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <StageTimeline stages={process.stages} />
      </CardContent>
    </Card>
  );
};

// ── 阶段时间线 ──

interface StageTimelineProps {
  stages: ProcessStage[];
}

const StageTimeline: React.FC<StageTimelineProps> = ({ stages }) => (
  <div className="flex items-center justify-between">
    {stages.map((stage, index) => {
      const ui = STATUS_UI[stage.status] ?? STATUS_UI[STAGE_STATUS.PENDING];
      const Icon = ui.icon;
      const isLast = index === stages.length - 1;

      return (
        <React.Fragment key={stage.name}>
          <div
            className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 ${ui.bgClass}`}
          >
            <Icon className={`h-5 w-5 ${ui.colorClass}`} />
            <span className="text-xs font-medium">{stage.label}</span>
            {stage.error && (
              <span className="text-[10px] text-red-500 max-w-[80px] truncate" title={stage.error}>
                {stage.error}
              </span>
            )}
          </div>
          {!isLast && (
            <div className="flex-1 mx-2 h-0.5 bg-muted-foreground/20" />
          )}
        </React.Fragment>
      );
    })}
  </div>
);
