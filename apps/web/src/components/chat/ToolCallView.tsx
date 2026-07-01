import React from 'react';
import type { ToolCallMessagePart } from '@assistant-ui/react';
import { CheckCircle2, Loader2, Wrench, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolCallViewProps {
  part: ToolCallMessagePart;
  /** 为 true 时减少外边距，用于嵌套在思考卡片内部。 */
  compact?: boolean;
}

const MAX_ARGS_PREVIEW_LENGTH = 120;
const TOOL_STATUS_RUNNING = '执行中';
const TOOL_STATUS_COMPLETE = '已完成';
const TOOL_STATUS_ERROR = '执行失败';

/**
 * 从工具参数中提取一段可读的预览文本。
 * 优先返回第一个非空字符串参数（通常是搜索/query），否则返回 JSON 摘要。
 */
function formatArgsPreview(args: Record<string, unknown> | unknown): string {
  if (!args || typeof args !== 'object') {
    return '';
  }
  const values = Object.values(args as Record<string, unknown>);
  const firstString = values.find((value) => typeof value === 'string' && value.length > 0);
  if (firstString) {
    return firstString as string;
  }
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

/**
 * 工具调用卡片。
 * 展示工具名称、当前状态（执行中/已完成/失败）以及参数预览，
 * 与原生 Claude 的 Web Search 等工具调用条目风格保持一致。
 */
export const ToolCallView: React.FC<ToolCallViewProps> = ({ part, compact = false }) => {
  const isRunning = part.result === undefined && !part.isError;
  const argsPreview = truncate(formatArgsPreview(part.args), MAX_ARGS_PREVIEW_LENGTH);
  const displayName = part.toolName || '工具调用';

  const statusClass = part.isError
    ? 'bg-destructive/10 text-destructive'
    : isRunning
      ? 'bg-primary/10 text-primary'
      : 'bg-green-500/10 text-green-600 dark:text-green-400';

  const statusLabel = part.isError ? TOOL_STATUS_ERROR : isRunning ? TOOL_STATUS_RUNNING : TOOL_STATUS_COMPLETE;

  return (
    <div className={cn(
      'text-sm rounded-xl border bg-muted/30 border-border/50',
      compact ? 'px-3 py-2 my-1.5' : 'mx-4 my-2 px-4 py-2.5'
    )}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">
          {part.isError ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : isRunning ? (
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium text-foreground">{displayName}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${statusClass}`}>{statusLabel}</span>
          </div>
          {argsPreview && (
            <div className="mt-1 text-xs text-muted-foreground truncate font-mono">{argsPreview}</div>
          )}
        </div>
      </div>
    </div>
  );
};
