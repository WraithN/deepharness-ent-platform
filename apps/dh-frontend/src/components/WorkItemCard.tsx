import React from 'react';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { WorkItemDTO } from '@/lib/api-types';

// 后端状态（下划线）与中文展示状态的映射（与 Requirements.tsx 看板一致）
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

const DATE_FMT: Intl.DateTimeFormatOptions = {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

const renderStatusBadge = (rawStatus: string): React.ReactNode => {
  const label = API_STATUS_TO_UI[rawStatus] ?? '待处理';
  switch (label) {
    case '已完成':
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-200 border-green-200 shadow-none">{label}</Badge>;
    case '进行中':
      return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 shadow-none">{label}</Badge>;
    case '已取消':
      return <Badge className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border-zinc-200 shadow-none">{label}</Badge>;
    case '已挂起':
      return <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-200 shadow-none">{label}</Badge>;
    default:
      return <Badge className="bg-zinc-100 text-zinc-700 hover:bg-zinc-200 border-zinc-200 shadow-none">{label}</Badge>;
  }
};

const renderPriorityBadge = (rawPriority: string): React.ReactNode => {
  const label = API_PRIORITY_TO_UI[rawPriority] ?? rawPriority;
  switch (label) {
    case '高':
      return <Badge variant="destructive" className="bg-red-500/10 text-red-600 hover:bg-red-500/20 border-red-500/20 shadow-none">{label}</Badge>;
    case '中':
      return <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20 border-orange-500/20 shadow-none">{label}</Badge>;
    case '低':
      return <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 hover:bg-zinc-500/20 border-zinc-500/20 shadow-none">{label}</Badge>;
    default:
      return <Badge variant="outline" className="shadow-none">{label}</Badge>;
  }
};

interface WorkItemCardProps {
  workitem: WorkItemDTO;
  /** 操作按钮区域，渲染在卡片下方 */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * 需求卡片组件：以看板风格展示需求信息（标题、ID、状态、优先级、负责人、创建时间、描述）。
 * 在流程详情的输入、交付物等多处复用。
 */
export const WorkItemCard: React.FC<WorkItemCardProps> = ({ workitem, actions, className }) => {
  const ownerName = workitem.assigneeName || workitem.reporter || '未分配';

  return (
    <div className={`space-y-3 py-1 ${className ?? ''}`}>
      <div className="bg-muted/40 rounded-lg p-3 space-y-3">
        {/* 标题 */}
        <div className="flex items-start gap-2">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <span className="text-sm font-medium leading-snug line-clamp-2">{workitem.title}</span>
        </div>
        {/* ID + 状态 + 优先级（与看板卡片字段一致） */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{workitem.id}</span>
          <div className="flex items-center gap-1.5">
            {renderStatusBadge(workitem.status)}
            {workitem.priority && renderPriorityBadge(workitem.priority)}
          </div>
        </div>
        {/* 负责人 + 创建时间（与看板卡片字段一致） */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px]">
              {ownerName.charAt(0)}
            </div>
            <span className="text-xs text-muted-foreground">{ownerName}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {new Date(workitem.createdAt).toLocaleString('zh-CN', DATE_FMT)}
          </span>
        </div>
        {/* 需求描述 */}
        {workitem.description && (
          <p className="text-xs text-muted-foreground line-clamp-4 pt-1 border-t border-border/30">
            {workitem.description}
          </p>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
};
