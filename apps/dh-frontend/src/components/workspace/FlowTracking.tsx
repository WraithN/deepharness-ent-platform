import React, { useCallback, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  MessageSquare,
  RefreshCw,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { useClientPagination } from '@/hooks/use-client-pagination';
import {
  PROCESS_PAGE_SIZE,
  PROCESS_POLL_INTERVAL_MS,
  PROCESS_TYPE_LABELS,
  STAGE_STATUS,
  type Process,
  processApi,
} from '@/lib/process-api';
import { FlowTemplateMarketContent } from '@/pages/FlowTemplateMarket';
import { workItemApi } from '@/lib/workitem-api';
import type { WorkItemDTO } from '@/lib/api-types';

// ── 日期格式化 ──

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

// ── 阶段状态图标 ──

const STAGE_ICON: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  [STAGE_STATUS.PENDING]: Circle,
  [STAGE_STATUS.IN_PROGRESS]: Loader2,
  [STAGE_STATUS.COMPLETED]: CheckCircle2,
  [STAGE_STATUS.FAILED]: XCircle,
};

const STAGE_ICON_COLOR: Record<string, string> = {
  [STAGE_STATUS.PENDING]: 'text-muted-foreground/40',
  [STAGE_STATUS.IN_PROGRESS]: 'text-blue-500 animate-spin',
  [STAGE_STATUS.COMPLETED]: 'text-emerald-500',
  [STAGE_STATUS.FAILED]: 'text-red-500',
};

// ── 流程追踪列表页 ──

export const FlowTracking: React.FC = () => {
  const navigate = useNavigate();
  const workspaceId = getCurrentWorkspaceId();

  const [processes, setProcesses] = React.useState<Process[]>([]);
  const [workitemMap, setWorkitemMap] = React.useState<Map<string, WorkItemDTO>>(new Map());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchProcesses = useCallback(async () => {
    try {
      setError(null);
      const [list, workitems] = await Promise.all([
        processApi.list(workspaceId),
        workItemApi.listByWorkspace(workspaceId).catch(() => [] as WorkItemDTO[]),
      ]);

      // 按创建时间倒序排列
      const sorted = [...list].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setProcesses(sorted);

      const map = new Map<string, WorkItemDTO>();
      for (const wi of workitems) {
        map.set(wi.id, wi);
      }
      setWorkitemMap(map);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取流程列表失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  React.useEffect(() => {
    fetchProcesses();
    const timer = setInterval(fetchProcesses, PROCESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchProcesses]);

  // 客户端分页（与项目其他列表页保持一致）
  const pagination = useClientPagination({ pageSize: PROCESS_PAGE_SIZE, total: processes.length });
  const pagedProcesses = processes.slice(pagination.startIndex, pagination.endIndex);

  const handleClickProcess = (processId: string) => {
    navigate(`/personal/flow/${encodeURIComponent(processId)}`);
  };

  return (
    <div className="h-full overflow-auto p-4">
      <Tabs defaultValue="instances" className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="instances">
              运行实例
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {processes.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="templates">流程模板</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="icon" onClick={fetchProcesses} title="刷新">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <TabsContent value="instances" className="space-y-4">
          <ProcessInstanceList
            processes={pagedProcesses}
            workitemMap={workitemMap}
            total={processes.length}
            loading={loading}
            error={error}
            pagination={pagination}
            onClickProcess={handleClickProcess}
            onRetry={fetchProcesses}
          />
        </TabsContent>

        <TabsContent value="templates">
          <FlowTemplateMarketContent />
        </TabsContent>
      </Tabs>
    </div>
  );
};

// ── 运行实例列表（Tabs 内使用） ──

interface ProcessInstanceListProps {
  processes: Process[];
  workitemMap: Map<string, WorkItemDTO>;
  total: number;
  loading: boolean;
  error: string | null;
  pagination: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
  onClickProcess: (processId: string) => void;
  onRetry: () => void;
}

const ProcessInstanceList: React.FC<ProcessInstanceListProps> = ({
  processes,
  workitemMap,
  total,
  loading,
  error,
  pagination,
  onClickProcess,
  onRetry,
}) => {
  if (loading && total === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          重试
        </Button>
      </div>
    );
  }

  if (total === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
          <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">暂无流程</p>
          <p className="text-xs text-muted-foreground/60">
            AI 托管开发被批准后将自动创建流程记录
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {processes.map((process) => (
          <ProcessListCard
            key={process.id}
            process={process}
            workitem={workitemMap.get(process.workitemId) ?? null}
            onClick={() => onClickProcess(process.id)}
          />
        ))}
      </div>
      <RecordPaginationBar
        total={total}
        currentPage={pagination.currentPage}
        totalPages={pagination.totalPages}
        onPageChange={pagination.onPageChange}
      />
    </>
  );
};

// ── 流程列表卡片 ──

interface ProcessListCardProps {
  process: Process;
  workitem: WorkItemDTO | null;
  onClick: () => void;
}

const ProcessListCard: React.FC<ProcessListCardProps> = ({ process, workitem, onClick }) => {
  const hasActiveStage = process.stages.some(
    (s) => s.status === STAGE_STATUS.IN_PROGRESS,
  );

  // 参与人：受理人 + 报告人
  const participants: string[] = [];
  if (workitem?.assigneeName) participants.push(workitem.assigneeName);
  if (workitem?.reporter && workitem.reporter !== workitem?.assigneeName) {
    participants.push(workitem.reporter);
  }

  return (
    <Card
      className={`cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all ${
        hasActiveStage ? 'ring-1 ring-blue-200 dark:ring-blue-800' : ''
      }`}
      onClick={onClick}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CardTitle className="text-sm font-medium truncate">
              {process.title}
            </CardTitle>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {PROCESS_TYPE_LABELS[process.type] ?? process.type}
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasActiveStage && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                进行中
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        {/* 阶段进度条 */}
        <div className="flex items-center gap-1.5 mb-3">
          {process.stages.map((stage) => {
            const Icon = STAGE_ICON[stage.status] ?? Circle;
            const colorClass = STAGE_ICON_COLOR[stage.status] ?? '';
            return (
              <div key={stage.name} className="flex items-center gap-1.5">
                <div className="flex items-center gap-1">
                  <Icon className={`h-3.5 w-3.5 ${colorClass}`} />
                  <span className="text-[10px] text-muted-foreground">{stage.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 元信息 */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(process.createdAt).toLocaleString('zh-CN', DATE_FMT)}
          </span>
          {participants.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {participants.join('、')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
