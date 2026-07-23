import React, { useState } from 'react';
import type { ToolCallMessagePart } from '@assistant-ui/react';
import { CheckCircle2, ChevronDown, ChevronRight, FileEdit, FileSearch, Loader2, Search, Terminal, Wrench, XCircle } from 'lucide-react';
import { cn, sanitizeWorkspacePaths } from '@/lib/utils';

interface ToolCallViewProps {
  part: ToolCallMessagePart;
  /** 为 true 时减少外边距，用于嵌套在思考卡片内部。 */
  compact?: boolean;
}

const MAX_ARGS_PREVIEW_LENGTH = 120;
const MAX_RESULT_PREVIEW_LENGTH = 200;
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
 * 摘要行（始终可见）：图标 + 工具名称 + 状态标签 + 参数预览
 * 展开后：完整参数 JSON + 执行结果
 */
export const ToolCallView: React.FC<ToolCallViewProps> = ({ part, compact = false }) => {
  const [expanded, setExpanded] = useState(false);

  const resultStr: string | undefined = typeof part.result === 'string' ? part.result : undefined;
  // result 为 undefined 时表示执行中；空字符串表示已完成但无输出
  const isRunning = resultStr === undefined && !part.isError;
  const hasResult = resultStr !== undefined && resultStr !== '';
  const argsPreview = truncate(sanitizeWorkspacePaths(formatArgsPreview(part.args)), MAX_ARGS_PREVIEW_LENGTH);
  const resultPreview = hasResult
    ? truncate(sanitizeWorkspacePaths(resultStr!), MAX_RESULT_PREVIEW_LENGTH)
    : '';
  const displayName = getToolDisplayName(part.toolName || '');
  const ToolIcon = getToolIcon(part.toolName || '');

  const statusClass = part.isError
    ? 'bg-destructive/10 text-destructive'
    : isRunning
      ? 'bg-primary/10 text-primary'
      : 'bg-green-500/10 text-green-600 dark:text-green-400';

  const statusLabel = part.isError ? TOOL_STATUS_ERROR : isRunning ? TOOL_STATUS_RUNNING : TOOL_STATUS_COMPLETE;

  const argsJson = (() => {
    try {
      return JSON.stringify(part.args, null, 2);
    } catch {
      return String(part.args);
    }
  })();

  const canExpand = !isRunning && (argsJson.length > 20 || hasResult);

  return (
    <div className={cn(
      'text-sm rounded-xl border bg-muted/30 border-border/50',
      compact ? 'px-3 py-2 my-1' : 'mx-4 my-2 px-4 py-2.5'
    )}>
      {/* 摘要行：图标 + 名称 + 状态 + 参数预览 */}
      <div
        className={cn('flex items-start gap-2.5', canExpand && 'cursor-pointer hover:bg-muted/50 rounded-lg transition-colors')}
        onClick={canExpand ? () => setExpanded(!expanded) : undefined}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
      >
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
            <span className={cn('text-xs px-1.5 py-0.5 rounded', statusClass)}>{statusLabel}</span>
            {canExpand && (
              expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto" />
            )}
          </div>
          {argsPreview && !expanded && (
            <div className="mt-1 text-xs text-muted-foreground truncate font-mono">{argsPreview}</div>
          )}
          {resultPreview && !expanded && (
            <div className="mt-0.5 text-xs text-green-600/70 dark:text-green-400/70 truncate font-mono">→ {resultPreview}</div>
          )}
        </div>
      </div>

      {/* 展开内容：完整参数 + 执行结果 */}
      {expanded && (
        <div className="mt-2 space-y-2 pl-6">
          {argsJson && argsJson.length > 20 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">输入参数</div>
              <pre className="text-xs bg-background/60 rounded-md p-2 overflow-x-auto max-h-48 font-mono whitespace-pre-wrap break-all">
                {sanitizeWorkspacePaths(argsJson)}
              </pre>
            </div>
          )}
          {hasResult && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">执行结果</div>
              <pre className="text-xs bg-background/60 rounded-md p-2 overflow-x-auto max-h-64 font-mono whitespace-pre-wrap break-all">
                {sanitizeWorkspacePaths(resultStr || '')}
              </pre>
            </div>
          )}
          {!hasResult && !isRunning && (
            <div className="text-xs text-muted-foreground italic">（无输出）</div>
          )}
        </div>
      )}
    </div>
  );
};
