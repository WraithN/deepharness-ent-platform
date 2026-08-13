import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Cog,
  ExternalLink,
  FileCode2,
  FileInput,
  FileText,
  Github,
  GitBranch,
  Info,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Timer,
  User,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import {
  AGENT_ROLE_LABELS,
  OPERATOR_TYPE,
  PROCESS_TYPE_LABELS,
  PROCESS_POLL_INTERVAL_MS,
  STAGE_NAMES,
  STAGE_STATUS,
  type ChatMessage,
  type Process,
  type ProcessStage,
  processApi,
  sessionApi,
} from '@/lib/process-api';
import type { WorkItemDTO, WorkItemCommitDTO } from '@/lib/api-types';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { WorkItemCard } from '@/components/WorkItemCard';
import { parseReviewReportFromText, type ReviewReportData } from '@/components/chat/ReviewReportCard';
import { FlowGraph } from '@/components/FlowGraph';
import { requirementShareApi, productSpaceApi, findPrototypeProductName } from '@/lib/productspace-api';
import { productDocApi } from '@/lib/productdoc-api';
import { workItemDocApi } from '@/lib/workitem-doc-api';
import { workItemApi } from '@/lib/workitem-api';

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

const COLLAPSED_MESSAGE_MAX_LENGTH = 300;

const STAGE_STATUS_LABELS: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '待执行',
  [STAGE_STATUS.IN_PROGRESS]: '进行中',
  [STAGE_STATUS.COMPLETED]: '已完成',
  [STAGE_STATUS.FAILED]: '失败',
  [STAGE_STATUS.SKIPPED]: '已跳过',
};

const API_STATUS_TO_UI: Record<string, string> = {
  backlog: '待处理',
  todo: '待处理',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
  on_hold: '已挂起',
};

const API_PRIORITY_TO_UI: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  '待处理': 'bg-gray-400',
  '进行中': 'bg-blue-500',
  '已完成': 'bg-green-500',
  '已取消': 'bg-red-500',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  [STAGE_STATUS.COMPLETED]: 'default',
  [STAGE_STATUS.IN_PROGRESS]: 'secondary',
  [STAGE_STATUS.FAILED]: 'destructive',
  [STAGE_STATUS.PENDING]: 'outline',
  [STAGE_STATUS.SKIPPED]: 'outline',
};

type StatusIcon = React.FC<React.SVGProps<SVGSVGElement>>;

const STATUS_ICON: Record<string, StatusIcon> = {
  [STAGE_STATUS.PENDING]: Circle,
  [STAGE_STATUS.IN_PROGRESS]: Loader2,
  [STAGE_STATUS.COMPLETED]: CheckCircle2,
  [STAGE_STATUS.FAILED]: XCircle,
  [STAGE_STATUS.SKIPPED]: Circle,
};

const STATUS_COLOR: Record<string, string> = {
  [STAGE_STATUS.PENDING]: 'text-muted-foreground/40',
  [STAGE_STATUS.IN_PROGRESS]: 'text-blue-500',
  [STAGE_STATUS.COMPLETED]: 'text-emerald-500',
  [STAGE_STATUS.FAILED]: 'text-red-500',
  [STAGE_STATUS.SKIPPED]: 'text-slate-400',
};

const STATUS_BORDER: Record<string, string> = {
  [STAGE_STATUS.PENDING]: 'border-muted',
  [STAGE_STATUS.IN_PROGRESS]: 'border-blue-200 dark:border-blue-800',
  [STAGE_STATUS.COMPLETED]: 'border-emerald-200 dark:border-emerald-800',
  [STAGE_STATUS.FAILED]: 'border-red-200 dark:border-red-800',
  [STAGE_STATUS.SKIPPED]: 'border-slate-200 dark:border-slate-800',
};

const STATUS_BG: Record<string, string> = {
  [STAGE_STATUS.PENDING]: '',
  [STAGE_STATUS.IN_PROGRESS]: 'bg-blue-50 dark:bg-blue-950/40',
  [STAGE_STATUS.COMPLETED]: 'bg-emerald-50 dark:bg-emerald-950/40',
  [STAGE_STATUS.FAILED]: 'bg-red-50 dark:bg-red-950/40',
  [STAGE_STATUS.SKIPPED]: 'bg-slate-50 dark:bg-slate-950/40',
};

const SCROLL_OFFSET_Y = 100;

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60000;
const MS_PER_HOUR = 3600000;

function formatDuration(ms: number): string {
  if (ms < MS_PER_SEC) return `${ms}ms`;
  if (ms < MS_PER_MIN) return `${(ms / MS_PER_SEC).toFixed(1)}秒`;
  if (ms < MS_PER_HOUR) {
    const min = Math.floor(ms / MS_PER_MIN);
    const sec = Math.floor((ms % MS_PER_MIN) / MS_PER_SEC);
    return sec > 0 ? `${min}分${sec}秒` : `${min}分`;
  }
  return `${(ms / MS_PER_HOUR).toFixed(1)}小时`;
}

function calcDurationMs(startedAt: string, completedAt: string): number {
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function durationFromStage(stage: ProcessStage): number | null {
  if (!stage.startedAt || !stage.completedAt) return null;
  return calcDurationMs(stage.startedAt, stage.completedAt);
}

/** 脱敏：将提示词中的工作区绝对路径替换为 ~/，隐藏服务器目录结构 */
const maskWorkspacePath = (text: string): string =>
  text.replace(/\/[^\s"]+\/projects\//g, '~/projects/');

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm text-foreground font-medium">{value}</div>
    </div>
  );
}

function ResourceCard({ icon, label, onClick, loading }: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <div
      className={`border border-border/50 rounded-lg px-4 py-3 flex items-center justify-between transition-colors ${
        onClick ? 'cursor-pointer hover:bg-muted/40' : 'opacity-60'
      }`}
      onClick={!loading ? onClick : undefined}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-foreground">{label}</span>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : onClick ? (
        <span className="text-muted-foreground">›</span>
      ) : null}
    </div>
  );
}

export const ProcessDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const workspaceId = getCurrentWorkspaceId();
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [process, setProcess] = useState<Process | null>(null);
  const [workitem, setWorkitem] = useState<WorkItemDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [designLoading, setDesignLoading] = useState(false);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const [commits, setCommits] = useState<WorkItemCommitDTO[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const proc = await processApi.getById(id);
      setProcess(proc);
      const wi = await api.get<WorkItemDTO>(`/v1/workitems/${proc.workitemId}`).catch(() => null);
      if (wi) setWorkitem(wi);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '获取流程详情失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, PROCESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchData]);

  const scrollToStage = (stageName: string) => {
    sectionRefs.current[stageName]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollBy(0, -SCROLL_OFFSET_Y);
  };

  const handleOpenDesignContent = async () => {
    if (!workitem) return;
    setDesignLoading(true);
    try {
      const links = await workItemDocApi.list(workitem.id);
      const docLink = links.find(l => l.itemType === 'doc');
      const protoLink = links.find(l => l.itemType === 'prototype');
      const docId = docLink?.productSpaceItemId ?? '';

      let productFolder = '';
      if (protoLink?.productSpaceItemId) {
        try {
          const tree = await productSpaceApi.tree(workspaceId);
          productFolder = findPrototypeProductName(tree, protoLink.productSpaceItemId) ?? '';
        } catch {
          // 非 PM 用户无法获取目录树，跳过原型分享
        }
      }

      if (!docId && !productFolder) {
        toast.error('该需求暂无产品设计（文档或原型）');
        return;
      }

      const share = await requirementShareApi.getOrCreateView(workspaceId, {
        title: workitem.title,
        docId: docId || undefined,
        productFolder: productFolder || undefined,
        protoItemId: protoLink?.productSpaceItemId || undefined,
        allowComments: true,
      });
      window.open(`/share/requirement/${share.token}`, '_blank');
    } catch (err) {
      toast.error('获取设计内容分享链接失败');
    } finally {
      setDesignLoading(false);
    }
  };

  const handleOpenCodeRepo = async () => {
    if (!workitem) return;
    setCommitsOpen(true);
    setCommitsLoading(true);
    try {
      const data = await workItemApi.listCommits(workitem.id);
      setCommits(data);
    } catch {
      toast.error('获取提交记录失败');
    } finally {
      setCommitsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !process) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">{error ?? '流程不存在'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/personal/flow')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          返回列表
        </Button>
      </div>
    );
  }

  const currentStage = process.stages.find((s) => s.status === STAGE_STATUS.IN_PROGRESS)
    ?? process.stages.find((s) => s.status === STAGE_STATUS.PENDING);

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-6 py-3">
        <div className="flex items-center gap-3 max-w-7xl mx-auto">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/personal/flow')}>
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-base font-semibold truncate">{process.title}</h1>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {PROCESS_TYPE_LABELS[process.type] ?? process.type}
          </Badge>
          {currentStage && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              当前：{currentStage.label}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {new Date(process.createdAt).toLocaleString('zh-CN', DATE_FMT)}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchData} title="刷新">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <FlowGraph stages={process.stages} onStageClick={scrollToStage} processType={process.type} />

        <div className="space-y-5">
          {process.stages
            .filter((stage) => stage.status !== STAGE_STATUS.PENDING)
            .map((stage) => {
              const devStage = process.stages.find(s => s.name === STAGE_NAMES.DEVELOPMENT);
              const humanReviewStage = process.stages.find(s => s.name === STAGE_NAMES.HUMAN_REVIEW);
              return (
            <div
              key={stage.name}
              ref={(el) => { sectionRefs.current[stage.name] = el; }}
            >
              <StageCard
                stage={stage}
                workitem={workitem}
                workspaceId={workspaceId}
                onViewDetail={() => setDetailOpen(true)}
                onViewDesign={handleOpenDesignContent}
                devStageOutput={devStage?.outputDesc}
                reviewReportText={humanReviewStage?.prompt}
                processId={process.id}
              />
            </div>
              );
            })}
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-full max-w-[760px] p-0 flex flex-col max-h-[85vh] overflow-hidden">
          {workitem && (
            <>
              <DialogHeader className="px-6 py-5 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Info className="h-4 w-4 text-primary" />
                  </div>
                  <div className="text-left">
                    <DialogTitle className="text-lg font-semibold">需求详情</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground mt-0.5 font-mono">
                      {workitem.id}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 modal-content-scroll">
                <section>
                  <h4 className="text-sm font-medium text-foreground mb-3">基本信息</h4>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <DetailField label="标题" value={workitem.title} />
                    <DetailField label="提出人" value={workitem.reporter || '-'} />
                    <DetailField label="优先级" value={API_PRIORITY_TO_UI[workitem.priority] ?? workitem.priority} />
                    <DetailField label="状态" value={
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${STATUS_DOT_COLORS[API_STATUS_TO_UI[workitem.status] ?? '待处理']}`} />
                        {API_STATUS_TO_UI[workitem.status] ?? workitem.status}
                      </span>
                    } />
                    <DetailField label="来源" value={workitem.source ?? '-'} />
                    <DetailField label="负责人" value={workitem.assigneeName || workitem.assigneeId || '-'} />
                    <DetailField label="创建时间" value={workitem.createdAt.slice(0, 10)} />
                  </div>
                </section>

                <div className="w-full h-px bg-border/50" />

                <section>
                  <h4 className="text-sm font-medium text-foreground mb-3">任务描述</h4>
                  <div className="h-[240px] overflow-y-auto rounded-xl p-4 bg-muted/40">
                    <MarkdownView content={workitem.description || '暂无描述'} collapsible={false} />
                  </div>
                </section>

                <div className="w-full h-px bg-border/50" />

                <section>
                  <h4 className="text-sm font-medium text-foreground mb-3">相关资源</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <ResourceCard
                      icon={<FileText className="h-4 w-4 text-primary" />}
                      label="产品设计"
                      loading={designLoading}
                      onClick={handleOpenDesignContent}
                    />
                    <ResourceCard icon={<Github className="h-4 w-4 text-orange-500" />} label="代码仓库" onClick={handleOpenCodeRepo} />
                    <ResourceCard icon={<FileText className="h-4 w-4 text-primary" />} label="测试用例" />
                  </div>
                </section>
              </div>

              <DialogFooter className="px-6 py-4 border-t border-border/50 flex justify-between items-center">
                <button className="text-sm text-muted-foreground hover:text-foreground transition-colors" onClick={() => setDetailOpen(false)}>
                  返回
                </button>
                <div className="flex gap-3">
                  <Button variant="outline" size="sm" onClick={() => setDetailOpen(false)}>关闭</Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 开发提交记录弹窗 */}
      <Dialog open={commitsOpen} onOpenChange={setCommitsOpen}>
        <DialogContent className="sm:max-w-lg p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-orange-500" />
              <div className="text-left">
                <DialogTitle className="text-base font-semibold">开发提交记录</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                  {workitem?.title ?? '-'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="px-6 py-4 max-h-[360px] overflow-y-auto">
            {commitsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : commits.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无提交记录</p>
            ) : (
              <div className="space-y-2">
                {commits.map((c) => (
                  <div key={c.id} className="flex flex-col gap-1 border border-border/50 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20 px-1.5 py-0.5 rounded">
                        {c.commitHash.slice(0, 7)}
                      </code>
                      <span className="text-sm text-foreground truncate">{c.commitMessage || '-'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {c.author && <span>{c.author}</span>}
                      <span>{new Date(c.committedAt).toLocaleString('zh-CN', DATE_FMT)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border/50">
            <Button variant="outline" size="sm" onClick={() => setCommitsOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// --- 代码变更摘要卡片（开发阶段交付物 / 评审阶段前置输入复用） ---
interface CodeChangeSummary {
  projectName?: string;
  branch?: string;
  committed?: boolean;
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  techStack?: string[];
}

/** 解析 outputDesc JSON 为代码变更摘要，失败返回 null */
function parseCodeChangeSummary(outputDesc: string): CodeChangeSummary | null {
  try {
    const parsed = JSON.parse(outputDesc);
    if (parsed && typeof parsed === 'object' && parsed.projectName) {
      return parsed as CodeChangeSummary;
    }
  } catch {
    // outputDesc 不是 JSON
  }
  return null;
}

const CodeChangeSummaryCard: React.FC<{ summary: CodeChangeSummary }> = ({ summary }) => (
  <>
    {/* 工程信息 */}
    <div className="flex items-center gap-2 text-xs">
      <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium text-foreground">{summary.projectName}</span>
      {summary.branch && (
        <Badge variant="outline" className="text-[10px] gap-1">
          <GitBranch className="h-2.5 w-2.5" />
          {summary.branch}
        </Badge>
      )}
    </div>
    {/* 变更统计 + 提交状态 */}
    <div className="flex items-center gap-4 text-xs">
      <span className="flex items-center gap-1 text-muted-foreground">
        <FileCode2 className="h-3.5 w-3.5" />
        {summary.filesChanged ?? 0} 文件修改
      </span>
      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
        <Plus className="h-3.5 w-3.5" />
        {summary.linesAdded ?? 0}
      </span>
      <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
        <Minus className="h-3.5 w-3.5" />
        {summary.linesDeleted ?? 0}
      </span>
      {summary.committed !== undefined && (
        <span className={`flex items-center gap-1 ${summary.committed ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          {summary.committed ? '已提交' : '未提交'}
        </span>
      )}
    </div>
    {/* 技术栈 */}
    {summary.techStack && summary.techStack.length > 0 && (
      <div className="flex flex-wrap gap-1.5">
        {summary.techStack.map(tech => (
          <Badge key={tech} variant="secondary" className="text-[10px] shadow-none">
            {tech}
          </Badge>
        ))}
      </div>
    )}
  </>
);

// --- 评审报告摘要卡片（评审阶段交付物） ---
const SEVERITY_CONFIG: Array<{ key: keyof ReviewReportData; label: string; color: string; bg: string }> = [
  { key: 'critical', label: '致命', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' },
  { key: 'high', label: '严重', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/30' },
  { key: 'medium', label: '一般', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  { key: 'low', label: '轻微', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30' },
];

interface StageCardProps {
  stage: ProcessStage;
  workitem: WorkItemDTO | null;
  workspaceId: string;
  onViewDetail: () => void;
  onViewDesign: () => void;
  devStageOutput?: string;
  reviewReportText?: string;
  processId?: string;
}

const StageCard: React.FC<StageCardProps> = ({ stage, workitem, workspaceId, onViewDetail, onViewDesign, devStageOutput, reviewReportText, processId }) => {
  const status = stage.status;
  const Icon = STATUS_ICON[status] ?? Circle;
  const isSpinning = status === STAGE_STATUS.IN_PROGRESS;
  const color = STATUS_COLOR[status] ?? 'text-muted-foreground/40';
  const isAI = stage.operatorType === OPERATOR_TYPE.AI;
  const dur = durationFromStage(stage);
  const [expanded, setExpanded] = useState(false);

  const ALL_ITEMS = ['input', 'process', 'deliverables'];

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className={`border-l-4 ${STATUS_BORDER[status]}`}>
        <CardContent className="p-0">
          <CollapsibleTrigger asChild>
            <div className="cursor-pointer select-none">
              <StageHeader
                stage={stage}
                status={status}
                Icon={Icon}
                color={color}
                isSpinning={isSpinning}
                isAI={isAI}
                dur={dur}
                expanded={expanded}
              />
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <Accordion type="multiple" defaultValue={ALL_ITEMS} className="px-5">
              <AccordionItem value="input" className="border-border/50 last:border-b-0">
                <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <FileInput className="h-3.5 w-3.5" />
                    前置输入
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <StageInputContent stage={stage} workitem={workitem} workspaceId={workspaceId} onViewDetail={onViewDetail} onViewDesign={onViewDesign} devStageOutput={devStageOutput} />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="process" className="border-border/50 last:border-b-0">
                <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <Cog className="h-3.5 w-3.5" />
                    处理过程
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <StageProcessContent stage={stage} workitem={workitem} workspaceId={workspaceId} />
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="deliverables" className="border-border/50 last:border-b-0">
                <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 hover:no-underline">
                  <span className="flex items-center gap-2">
                    <PackageCheck className="h-3.5 w-3.5" />
                    交付成果
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <StageOutputContent stage={stage} workitem={workitem} workspaceId={workspaceId} reviewReportText={reviewReportText} processId={processId} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
};

interface StageHeaderProps {
  stage: ProcessStage;
  status: string;
  Icon: StatusIcon;
  color: string;
  isSpinning: boolean;
  isAI: boolean;
  dur: number | null;
  expanded: boolean;
}

const StageHeader: React.FC<StageHeaderProps> = ({ stage, status, Icon, color, isSpinning, isAI, dur, expanded }) => {
  const formatOperator = (): string => {
    if (!stage.operatorName) return '';
    if (isAI && stage.agentRole) {
      const roleLabel = AGENT_ROLE_LABELS[stage.agentRole] ?? stage.agentRole;
      return `${roleLabel}@${stage.operatorName}`;
    }
    if (isAI) {
      return `AI开发数字分身@${stage.operatorName}`;
    }
    return stage.operatorName;
  };

  return (
    <div className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40">
      <Icon className={`h-4 w-4 shrink-0 ${color} ${isSpinning ? 'animate-spin' : ''}`} />
      <span className={`text-xs font-medium ${color}`}>
        {STAGE_STATUS_LABELS[status] ?? status}
      </span>
      <span className="text-muted-foreground/40">|</span>
      <h3 className="text-sm font-semibold">{stage.label}</h3>

      {stage.startedAt && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {new Date(stage.startedAt).toLocaleString('zh-CN', DATE_FMT)}
        </span>
      )}

      {dur !== null && (
        <span className="text-xs text-muted-foreground ml-0.5 flex items-center gap-0.5">
          <Timer className="h-3 w-3" />
          {formatDuration(dur)}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {stage.operatorName && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            {isAI ? <Bot className="h-3.5 w-3.5 text-blue-400" /> : <User className="h-3.5 w-3.5" />}
            {formatOperator()}
          </span>
        )}
        {stage.error && (
          <span className="text-xs text-red-500">{stage.error}</span>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground/50 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </div>
    </div>
  );
};

// --- StageInputContent ---
// 前置输入分为两个部分：上一步交付物 + 额外输入
interface StageInputContentProps {
  stage: ProcessStage;
  workitem: WorkItemDTO | null;
  workspaceId: string;
  onViewDetail: () => void;
  onViewDesign: () => void;
  devStageOutput?: string;
}

/** 渲染"上一步交付物"区块内容 */
const PrevOutputSection: React.FC<{ stage: ProcessStage; workitem: WorkItemDTO | null; devStageOutput?: string }> = ({ stage, workitem, devStageOutput }) => {
  switch (stage.name) {
    case STAGE_NAMES.REQUIREMENT:
      return null;
    case STAGE_NAMES.DEVELOPMENT:
      return workitem ? <WorkItemCard workitem={workitem} /> : null;
    case STAGE_NAMES.REVIEW: {
      if (!devStageOutput) return null;
      const codeSummary = parseCodeChangeSummary(devStageOutput);
      return (
        <div className="bg-muted/40 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">代码变更</span>
          </div>
          {codeSummary ? <CodeChangeSummaryCard summary={codeSummary} /> : <p className="text-xs text-muted-foreground">{devStageOutput}</p>}
        </div>
      );
    }
    case STAGE_NAMES.HUMAN_REVIEW:
    case STAGE_NAMES.CODE_OPTIMIZE:
    case STAGE_NAMES.HUMAN_AUDIT:
      if (!stage.prompt) return null;
      return (
        <div className="bg-muted/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{stage.inputDesc || '评审报告'}</span>
          </div>
          <div className="p-2 bg-background/50 rounded border border-border/30 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {maskWorkspacePath(stage.prompt)}
          </div>
        </div>
      );
    case STAGE_NAMES.PRODUCT_BREAKDOWN:
    case STAGE_NAMES.PRODUCT_RESEARCH:
    case STAGE_NAMES.PRODUCT_DRAFT:
    case STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW:
    case STAGE_NAMES.PRODUCT_AI_GATEWAY:
    case STAGE_NAMES.PRODUCT_PROTO_MAKE:
    case STAGE_NAMES.PRODUCT_PRD_WRITE:
    case STAGE_NAMES.PRODUCT_FINAL_REVIEW:
      if (!stage.prompt) return null;
      return (
        <div className="bg-muted/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{stage.inputDesc || '前置产物'}</span>
          </div>
          <div className="p-2 bg-background/50 rounded border border-border/30 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {maskWorkspacePath(stage.prompt)}
          </div>
        </div>
      );
    default:
      return null;
  }
};

/** 渲染"额外输入"区块内容 */
const ExtraInputSection: React.FC<{ stage: ProcessStage; workitem: WorkItemDTO | null; onViewDetail: () => void; onViewDesign: () => void }> = ({ stage, workitem, onViewDetail, onViewDesign }) => {
  const [designBtnLoading, setDesignBtnLoading] = useState(false);

  switch (stage.name) {
    case STAGE_NAMES.REQUIREMENT:
      if (!workitem) return null;
      return (
        <WorkItemCard
          workitem={workitem}
          actions={
            <>
              <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={onViewDetail}>
                <Search className="h-3 w-3" />
                查看需求详情
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] gap-1"
                disabled={designBtnLoading}
                onClick={async () => {
                  setDesignBtnLoading(true);
                  try { await onViewDesign(); } finally { setDesignBtnLoading(false); }
                }}
              >
                <Loader2 className={`h-3 w-3 ${designBtnLoading ? 'animate-spin' : 'hidden'}`} />
                <ExternalLink className={`h-3 w-3 ${designBtnLoading ? 'hidden' : ''}`} />
                查看设计内容
              </Button>
            </>
          }
        />
      );
    case STAGE_NAMES.DEVELOPMENT:
      if (!stage.prompt) return null;
      return (
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">开发提示词</span>
          </div>
          <div className="p-2 bg-background/50 rounded border border-border/30 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {maskWorkspacePath(stage.prompt)}
          </div>
        </div>
      );
    case STAGE_NAMES.CODE_OPTIMIZE:
      if (!stage.extraInput) return null;
      return (
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{stage.extraInputDesc || '开发人员优化指示'}</span>
          </div>
          <div className="p-2 bg-background/50 rounded border border-border/30 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {stage.extraInput}
          </div>
        </div>
      );
    case STAGE_NAMES.PRODUCT_BRAINSTORM:
      return workitem ? <WorkItemCard workitem={workitem} /> : null;
    default:
      return null;
  }
};

const StageInputContent: React.FC<StageInputContentProps> = ({ stage, workitem, workspaceId, onViewDetail, onViewDesign, devStageOutput }) => {
  const hasPrevOutput = stage.name !== STAGE_NAMES.REQUIREMENT && stage.name !== STAGE_NAMES.PRODUCT_BRAINSTORM;
  const hasExtraInput =
    !!stage.extraInputDesc ||
    stage.name === STAGE_NAMES.REQUIREMENT ||
    stage.name === STAGE_NAMES.DEVELOPMENT ||
    stage.name === STAGE_NAMES.PRODUCT_BRAINSTORM;

  if (!hasPrevOutput && !hasExtraInput) {
    return <p className="text-xs text-muted-foreground py-1">暂无输入信息</p>;
  }

  return (
    <div className="space-y-3 py-1">
      {hasPrevOutput && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <PackageCheck className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">上一步交付物</span>
          </div>
          <PrevOutputSection stage={stage} workitem={workitem} devStageOutput={devStageOutput} />
        </div>
      )}
      {hasExtraInput && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <FileInput className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">额外输入</span>
          </div>
          <ExtraInputSection stage={stage} workitem={workitem} onViewDetail={onViewDetail} onViewDesign={onViewDesign} />
        </div>
      )}
    </div>
  );
};

// 产品流程阶段名称集合，用于区分 AI 会话展示与交付物卡片
const PRODUCT_STAGE_NAMES: string[] = [
  STAGE_NAMES.PRODUCT_BRAINSTORM,
  STAGE_NAMES.PRODUCT_BREAKDOWN,
  STAGE_NAMES.PRODUCT_RESEARCH,
  STAGE_NAMES.PRODUCT_DRAFT,
  STAGE_NAMES.PRODUCT_AI_DRAFT_REVIEW,
  STAGE_NAMES.PRODUCT_REVIEW,
  STAGE_NAMES.PRODUCT_AI_GATEWAY,
  STAGE_NAMES.PRODUCT_PRD_WRITE,
  STAGE_NAMES.PRODUCT_PROTO_MAKE,
  STAGE_NAMES.PRODUCT_PROTO_REVIEW,
  STAGE_NAMES.PRODUCT_FINAL_REVIEW,
];

function isProductStageName(name: string): boolean {
  return PRODUCT_STAGE_NAMES.includes(name);
}

/** 从产品阶段产物内容中提取简短摘要（取第一行非空文本，限制长度） */
function productStageSummary(prompt: string | undefined, maxLength = 200): string {
  if (!prompt) return '';
  const firstLine = prompt.trim().split('\n').find(line => line.trim()) ?? '';
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}…` : firstLine;
}

// --- 产品流程 AI 阶段处理过程展示（不拉取会话消息，避免跨用户会话权限问题） ---
interface ProductStageProcessProps {
  stage: ProcessStage;
}

const ProductStageProcess: React.FC<ProductStageProcessProps> = ({ stage }) => {
  const roleLabel = stage.agentRole
    ? (AGENT_ROLE_LABELS[stage.agentRole] ?? stage.agentRole)
    : 'AI 产品助理';

  return (
    <div className="py-1">
      <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">{roleLabel}@{stage.operatorName || 'AI'}</span>
          <span className="text-xs text-muted-foreground">
            {stage.status === STAGE_STATUS.COMPLETED ? '工作完毕' : '正在工作...'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          AI 已完成 {stage.label}，生成产物可在下方「交付成果」中查看。
        </p>
      </div>
    </div>
  );
};

// --- 产品流程交付物：从 prompt 标记解析真实产物并跳转分享页 ---

/** 产物标记类型：FILE = 单个文件（PRD / 调研报告等），PROJECT = 原型工程目录。 */
interface ProductDeliverableMarker {
  type: 'file' | 'project';
  path: string;
  name: string;
  kindLabel: string;
}

const MARKER_PATTERN = /\[\[(FILE|PROJECT):([^\]]+)\]\]/g;

/** 从产品阶段 prompt 中提取 [[FILE:...]] / [[PROJECT:...]] 真实产物标记。 */
function parseProductDeliverableMarkers(prompt: string | undefined): ProductDeliverableMarker[] {
  if (!prompt) return [];
  const markers: ProductDeliverableMarker[] = [];
  for (const match of prompt.matchAll(MARKER_PATTERN)) {
    const type = match[1] as 'FILE' | 'PROJECT';
    const rawPath = match[2].trim();
    if (!rawPath) continue;
    const segments = rawPath.split('/').filter(Boolean);
    const name = segments.length > 0 ? segments[segments.length - 1] : rawPath;
    if (type === 'FILE') {
      const lowerPath = rawPath.toLowerCase();
      let kindLabel = '文档';
      if (lowerPath.includes('/prd/')) kindLabel = 'PRD 文档';
      else if (lowerPath.includes('/research/')) kindLabel = '调研报告';
      else if (lowerPath.includes('/brainstorm/')) kindLabel = '头脑风暴';
      else if (lowerPath.includes('/req-breakdown/')) kindLabel = '需求拆分';
      else if (name.toLowerCase().endsWith('.md')) kindLabel = 'Markdown 文档';
      markers.push({ type: 'file', path: rawPath, name, kindLabel });
    } else {
      markers.push({ type: 'project', path: rawPath, name, kindLabel: '可运行原型' });
    }
  }
  return markers;
}

interface ProductDeliverableCardProps {
  marker: ProductDeliverableMarker;
  workspaceId: string;
  processId: string;
}

/** 单个交付物卡片：一键导入/采纳产物并打开需求级分享落地页（新窗口）。 */
const ProductDeliverableCard: React.FC<ProductDeliverableCardProps> = ({ marker, workspaceId, processId }) => {
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setLoading(true);
    try {
      const share = await productSpaceApi.shareProcessDeliverable(processId, {
        type: marker.type,
        path: marker.path,
      });
      window.open(`/share/requirement/${share.token}`, '_blank');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '打开交付物失败';
      console.error('[shareProcessDeliverable] marker:', marker, 'error:', msg, err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-border/50 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 bg-background/50">
      <div className="flex items-center gap-2 min-w-0">
        {marker.type === 'file' ? (
          <FileText className="h-4 w-4 text-primary shrink-0" />
        ) : (
          <FileCode2 className="h-4 w-4 text-orange-500 shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{marker.name}</div>
          <div className="text-xs text-muted-foreground">{marker.kindLabel}</div>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-[10px] gap-1 shrink-0"
        onClick={handleOpen}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ExternalLink className="h-3 w-3" />
        )}
        查看详情
      </Button>
    </div>
  );
};

interface ProductStageOutputProps {
  stage: ProcessStage;
  workspaceId: string;
  processId: string;
}

const ProductStageOutput: React.FC<ProductStageOutputProps> = ({ stage, workspaceId, processId }) => {
  const [open, setOpen] = useState(false);
  const markers = parseProductDeliverableMarkers(stage.prompt);
  const hasDetail = !!stage.prompt;
  const summary = productStageSummary(stage.prompt) || stage.outputDesc;

  // 存在真实产物标记时，渲染产物卡片列表，点击后跳转到产品空间分享页。
  if (markers.length > 0) {
    return (
      <div className="space-y-2 py-1">
        <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-medium">{stage.outputDesc}</span>
          </div>
          <div className="space-y-2">
            {markers.map((marker, idx) => (
              <ProductDeliverableCard
                key={`${marker.type}-${marker.path}-${idx}`}
                marker={marker}
                workspaceId={workspaceId}
                processId={processId}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-1">
      <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">{stage.outputDesc}</span>
        </div>
        {summary && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {maskWorkspacePath(summary)}
          </p>
        )}
        {hasDetail && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1"
            onClick={() => setOpen(true)}
          >
            <ExternalLink className="h-3 w-3" />
            查看详情
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{stage.outputDesc}</DialogTitle>
            <DialogDescription>{stage.label} 交付物详情</DialogDescription>
          </DialogHeader>
          <div className="text-sm">
            <MarkdownView content={maskWorkspacePath(stage.prompt || '')} collapsible={false} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// --- StageProcessContent ---
interface StageProcessContentProps {
  stage: ProcessStage;
  workitem: WorkItemDTO | null;
  workspaceId: string;
}

const StageProcessContent: React.FC<StageProcessContentProps> = ({ stage, workitem, workspaceId }) => {
  const isAI = stage.operatorType === OPERATOR_TYPE.AI;

  if (stage.status === STAGE_STATUS.PENDING) {
    return (
      <p className="text-sm text-muted-foreground py-1">
        {stage.name === STAGE_NAMES.REQUIREMENT ? '等待受理人审批' : '等待上一阶段完成'}
      </p>
    );
  }

  if (!isAI) {
    const operatorName = stage.operatorName || '用户';
    return (
      <div className="space-y-2 py-1">
        <div className="bg-muted/40 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{operatorName}</span>
            <span className="text-xs text-muted-foreground">
              {stage.startedAt ? new Date(stage.startedAt).toLocaleString('zh-CN', DATE_FMT) : ''}
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {stage.name === STAGE_NAMES.REQUIREMENT ? (
              <>
                受理并确认
                <span className="inline-block bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded mx-0.5 shadow-sm font-medium text-sm">
                  {workitem?.title ?? ''}
                </span>
                需求，安排
                <span className="inline-block bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded mx-0.5 shadow-sm font-medium text-sm">
                  AI开发数字分身@{workitem?.assigneeName || operatorName}
                </span>
                进行开发
              </>
            ) : (
              `${operatorName}完成了操作审批`
            )}
          </p>
        </div>
      </div>
    );
  }

  if (isProductStageName(stage.name)) {
    return <ProductStageProcess stage={stage} />;
  }

  return <AIConversationContent stage={stage} workspaceId={workspaceId} />;
};

// --- AIConversationContent (embedded in accordion, no extra expand/collapse) ---
interface AIConversationContentProps {
  stage: ProcessStage;
  workspaceId: string;
}

const AIConversationContent: React.FC<AIConversationContentProps> = ({ stage, workspaceId }) => {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!stage.sessionId) {
      setMessagesLoading(false);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    sessionApi
      .getMessages(stage.sessionId, workspaceId)
      .then((msgs) => {
        if (!cancelled) {
          setMessages(msgs);
          setMessagesError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMessagesError(err instanceof Error ? err.message : '加载会话消息失败');
        }
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => { cancelled = true; };
  }, [stage.sessionId, workspaceId]);

  const toggleMessageExpand = (msgId: string) => {
    setExpandedMessages((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const roleLabel = stage.agentRole
    ? AGENT_ROLE_LABELS[stage.agentRole] ?? stage.agentRole
    : 'AI 任务';

  /**
   * 过滤消息：当阶段有 prompt 时，只展示从该 prompt 对应的用户消息开始的消息。
   * 开发和评审阶段共用同一 sessionId，需要靠 prompt 区分各自的消息区间。
   */
  const filteredMessages = React.useMemo<ChatMessage[] | null>(() => {
    if (!messages) return null;
    if (!stage.prompt) return messages;
    const promptPrefix = stage.prompt.slice(0, 200);
    const startIndex = messages.findIndex(
      (msg) => msg.role === 'user' && msg.content.slice(0, 200) === promptPrefix
    );
    if (startIndex === -1) return messages;
    return messages.slice(startIndex);
  }, [messages, stage.prompt]);

  return (
    <div className="py-1 space-y-3">
      <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium">{roleLabel}@{stage.operatorName || 'AI'}</span>
          <span className="text-xs text-muted-foreground">
            {stage.status === STAGE_STATUS.COMPLETED ? '工作完毕' : '正在工作...'}
          </span>
        </div>
      </div>

      {messagesLoading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {messagesError && (
        <p className="text-xs text-red-500 px-2 py-2">{messagesError}</p>
      )}
      {filteredMessages && filteredMessages.length === 0 && !stage.sessionId && (
        <p className="text-xs text-muted-foreground px-2 py-2">暂未生成会话消息（该过程可能尚未开始）</p>
      )}
      {filteredMessages && filteredMessages.length === 0 && stage.sessionId && (
        <p className="text-xs text-muted-foreground px-2 py-2">会话消息为空</p>
      )}
      {filteredMessages && filteredMessages.length > 0 && (
        <div className="border rounded-lg bg-muted/30">
          <div className="max-h-[32rem] overflow-y-auto divide-y">
            {filteredMessages.map((msg) => {
              const isUser = msg.role === 'user';
              const content = msg.content || '';
              const isLong = content.length > COLLAPSED_MESSAGE_MAX_LENGTH;
              const isExpanded = expandedMessages[msg.id];
              const displayContent = isLong && !isExpanded
                ? maskWorkspacePath(content).slice(0, COLLAPSED_MESSAGE_MAX_LENGTH) + '…'
                : maskWorkspacePath(content);

              return (
                <div key={msg.id} className={`px-4 py-3 ${isUser ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={isUser ? 'secondary' : 'outline'} className="text-[10px] gap-1">
                      {isUser ? (
                        <><User className="h-3 w-3" />用户</>
                      ) : (
                        <><Bot className="h-3 w-3" />AI助手</>
                      )}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', DATE_FMT) : ''}
                    </span>
                  </div>
                  <div className="text-xs leading-relaxed">
                    {isUser ? (
                      <pre className="whitespace-pre-wrap font-sans text-foreground/80">{displayContent}</pre>
                    ) : (
                      <MarkdownView content={displayContent} collapsible={false} />
                    )}
                  </div>
                  {isLong && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-5 text-[10px] p-0"
                      onClick={() => toggleMessageExpand(msg.id)}
                    >
                      {isExpanded ? '收起' : '展开全部'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// --- 评审阶段交付物：评审报告摘要 + 新页面查看完整报告 ---
interface ReviewStageOutputProps {
  stage: ProcessStage;
  reportData: ReviewReportData | null;
  totalIssues: number;
  reviewReportText?: string;
  processId?: string;
}

const ReviewStageOutput: React.FC<ReviewStageOutputProps> = ({ stage, reportData, totalIssues, processId }) => {
  const handleViewReport = () => {
    if (processId) {
      window.open(`/personal/flow/${processId}/review-report`, '_blank');
    }
  };

  return (
    <div className="space-y-2 py-1">
      <div className="bg-muted/40 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">评审报告</span>
        </div>
        {reportData ? (
          <>
            {/* 工程信息 */}
            <div className="flex items-center gap-2 text-xs">
              <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
              {reportData.projectName && (
                <span className="font-medium text-foreground">{reportData.projectName}</span>
              )}
              {reportData.branch && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <GitBranch className="h-2.5 w-2.5" />
                  {reportData.branch}
                </Badge>
              )}
            </div>
            {/* 问题统计 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">问题总数</span>
              <Badge className="text-[10px] bg-foreground/10 text-foreground">{totalIssues}</Badge>
              {SEVERITY_CONFIG.map(({ key, label, color, bg }) => {
                const count = reportData[key] as number ?? 0;
                if (count === 0) return null;
                return (
                  <span key={key} className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${bg} ${color}`}>
                    {label} {count}
                  </span>
                );
              })}
              {totalIssues === 0 && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  无问题
                </span>
              )}
            </div>
            {/* 摘要 */}
            {reportData.summary && (
              <p className="text-xs text-muted-foreground leading-relaxed">{reportData.summary}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{stage.outputDesc}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] gap-1"
          onClick={handleViewReport}
        >
          <ExternalLink className="h-3 w-3" />
          查看评审报告
        </Button>
      </div>
    </div>
  );
};

// --- StageOutputContent ---
interface StageOutputContentProps {
  stage: ProcessStage;
  workitem: WorkItemDTO | null;
  workspaceId: string;
  reviewReportText?: string;
  processId?: string;
}

const StageOutputContent: React.FC<StageOutputContentProps> = ({ stage, workitem, workspaceId, reviewReportText, processId }) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  if (stage.status === STAGE_STATUS.PENDING) {
    return <p className="text-xs text-muted-foreground py-1">等待处理完成后生成交付物</p>;
  }

  if (stage.status === STAGE_STATUS.IN_PROGRESS) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
        <p className="text-sm text-muted-foreground">
          当前节点进行中，暂无交付物
        </p>
      </div>
    );
  }

  if (!stage.outputDesc) {
    return <p className="text-xs text-muted-foreground py-1">暂无交付物</p>;
  }

  // 需求阶段：展示需求卡片（与输入区域保持一致）
  if (stage.name === STAGE_NAMES.REQUIREMENT && workitem) {
    return <WorkItemCard workitem={workitem} />;
  }

  // 开发阶段：展示代码变更摘要 + 跳转入口
  if (stage.name === STAGE_NAMES.DEVELOPMENT) {
    const codeSummary = parseCodeChangeSummary(stage.outputDesc);

    const handleViewCode = () => {
      if (stage.operatorId && user && user.id !== stage.operatorId) {
        toast.error('你没有访问权限');
        return;
      }
      navigate('/personal-space');
    };

    return (
      <div className="space-y-2 py-1">
        <div className="bg-muted/40 rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">代码变更</span>
          </div>
          {codeSummary ? (
            <CodeChangeSummaryCard summary={codeSummary} />
          ) : (
            <p className="text-xs text-muted-foreground">{stage.outputDesc}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1"
            onClick={handleViewCode}
          >
            <Github className="h-3 w-3" />
            查看代码变更
          </Button>
        </div>
      </div>
    );
  }

  // 评审阶段：展示评审报告摘要 + 查看完整报告弹窗
  if (stage.name === STAGE_NAMES.REVIEW) {
    const reportData = reviewReportText ? parseReviewReportFromText(reviewReportText) : null;
    const totalIssues = reportData
      ? (reportData.critical ?? 0) + (reportData.high ?? 0) + (reportData.medium ?? 0) + (reportData.low ?? 0)
      : 0;

    return (
      <ReviewStageOutput
        stage={stage}
        reportData={reportData}
        totalIssues={totalIssues}
        processId={processId}
      />
    );
  }

  // 人工复审阶段：展示评审报告
  if (stage.name === STAGE_NAMES.HUMAN_REVIEW) {
    return (
      <div className="space-y-2 py-1">
        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{stage.outputDesc}</span>
          </div>
          {stage.prompt && (
            <div className="p-2 bg-background/50 rounded border border-border/30 text-xs text-muted-foreground max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {maskWorkspacePath(stage.prompt)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 智能评估阶段：展示 AI 评估报告
  if (stage.name === STAGE_NAMES.AI_EVAL) {
    return (
      <div className="space-y-2 py-1">
        <div className="bg-purple-50/50 dark:bg-purple-950/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-medium">{stage.outputDesc}</span>
          </div>
          {stage.prompt && (
            <div className="p-2 bg-background/50 rounded border border-border/30 text-xs text-muted-foreground max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {maskWorkspacePath(stage.prompt)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 人工审核阶段：展示审核结果
  if (stage.name === STAGE_NAMES.HUMAN_AUDIT) {
    return (
      <div className="space-y-2 py-1">
        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{stage.outputDesc}</span>
          </div>
          {stage.prompt && (
            <div className="p-2 bg-background/50 rounded border border-border/30 text-xs text-muted-foreground max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {maskWorkspacePath(stage.prompt)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 代码优化阶段：展示优化结果
  if (stage.name === STAGE_NAMES.CODE_OPTIMIZE) {
    return (
      <div className="space-y-2 py-1">
        <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-medium">{stage.outputDesc}</span>
          </div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{maskWorkspacePath(stage.prompt || 'AI根据评审报告完成了代码优化')}</p>
        </div>
      </div>
    );
  }

  // 产品流程：各阶段交付物统一展示为产物卡片，真实文件/原型可跳转分享页
  if (isProductStageName(stage.name)) {
    return <ProductStageOutput stage={stage} workspaceId={workspaceId} processId={processId ?? ''} />;
  }

  return (
    <div className="flex items-start gap-2 py-1">
      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
      <p className="text-sm text-muted-foreground">{stage.outputDesc}</p>
    </div>
  );
};
