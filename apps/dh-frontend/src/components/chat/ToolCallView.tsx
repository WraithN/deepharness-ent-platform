import React from 'react';
import type { ToolCallMessagePart } from '@assistant-ui/react';
import { CheckCircle2, FileEdit, FileSearch, Loader2, Search, Terminal, Wrench, XCircle } from 'lucide-react';
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

const TOOL_NAME_MAP: Record<string, string> = {
  write: '写入文件',
  file_write: '写入文件',
  read: '读取文件',
  file_read: '读取文件',
  bash: '执行命令',
  terminal: '执行命令',
  execute: '执行命令',
  search: '搜索',
  web_search: '搜索',
};

/**
 * 从工具参数中提取一段可读的预览文本。
 * 优先返回 file_path、command、path 等关键参数，否则返回第一个非空字符串，最后回退到 JSON 摘要。
 */
function formatArgsPreview(args: Record<string, unknown> | unknown): string {
  if (!args || typeof args !== 'object') {
    return '';
  }
  const record = args as Record<string, unknown>;
  const priorityKeys = ['file_path', 'command', 'path', 'query', 'search_query', 'url'];
  for (const key of priorityKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  const values = Object.values(record);
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

function getToolDisplayName(toolName: string): string {
  return TOOL_NAME_MAP[toolName.toLowerCase()] || toolName || '工具调用';
}

function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower.includes('write')) return FileEdit;
  if (lower.includes('read')) return FileSearch;
  if (lower.includes('bash') || lower.includes('terminal') || lower === 'execute') return Terminal;
  if (lower.includes('search')) return Search;
  return Wrench;
}

/**
 * 工具调用卡片。
 * 展示工具名称、当前状态（执行中/已完成/失败）以及参数预览，
 * 与原生 Claude 的 Web Search 等工具调用条目风格保持一致。
 */
export const ToolCallView: React.FC<ToolCallViewProps> = ({ part, compact = false }) => {
  const isRunning = part.result === undefined && !part.isError;
  const argsPreview = truncate(formatArgsPreview(part.args), MAX_ARGS_PREVIEW_LENGTH);
  const displayName = getToolDisplayName(part.toolName || '');
  const ToolIcon = getToolIcon(part.toolName || '');

  const statusClass = part.isError
    ? 'bg-destructive/10 text-destructive'
    : isRunning
      ? 'bg-primary/10 text-primary'
      : 'bg-green-500/10 text-green-600 dark:text-green-400';

  const statusLabel = part.isError ? TOOL_STATUS_ERROR : isRunning ? TOOL_STATUS_RUNNING : TOOL_STATUS_COMPLETE;

  return (
    <div className={cn(
      'text-sm rounded-xl border bg-muted/30 border-border/50',
      compact ? 'px-3 py-2 my-1' : 'mx-4 my-2 px-4 py-2.5'
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
            <ToolIcon className="h-3.5 w-3.5 text-muted-foreground" />
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
