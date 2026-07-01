import React from 'react';
import { Bot, Box, FileCode2, ListTodo, CheckCircle2, Wrench, X, Copy, RefreshCw, Loader2 } from 'lucide-react';
import type { MessageState, TextMessagePart, ReasoningMessagePart, DataMessagePart, ToolCallMessagePart } from '@assistant-ui/react';
import { useThread } from '@assistant-ui/react';
import { MarkdownView } from './MarkdownView';
import { FileAttachmentCard } from './FileAttachmentCard';
import { DiffView } from './DiffView';
import { TaskListView, type TaskItemData } from './TaskListView';
import { ToolCallView } from './ToolCallView';
import { ThinkingCard } from './ThinkingCard';
import type { ChatPart } from './types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AssistantMessageProps {
  message: MessageState;
  onArtifactClick?: () => void;
  onRegenerate?: () => void;
  onFilePreview?: (path: string) => void;
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({ message, onArtifactClick, onRegenerate, onFilePreview }) => {
  const thread = useThread();
  const content = Array.isArray(message.content) ? message.content : [];

  let artifact: { type: string; title: string } | undefined;
  const legacyDataParts: { name: string; data: ChatPart }[] = [];

  for (const part of content) {
    if (part.type === 'data') {
      const dataPart = part as DataMessagePart;
      if (dataPart.name === 'artifact') {
        artifact = dataPart.data as { type: string; title: string };
      } else {
        legacyDataParts.push({ name: dataPart.name, data: dataPart.data as ChatPart });
      }
    }
  }

  if (!artifact) {
    for (const part of content) {
      if (part.type === 'data') {
        const original = (part as DataMessagePart).data as ChatPart;
        if (original?.artifact) {
          artifact = original.artifact;
          break;
        }
      }
    }
  }

  // 把消息内容拆分为：给用户的最终输出、思考/工具过程、legacy data 三种。
  // 启发式规则：最后一段连续 text 之前的 text 都视为模型内部过程，
  // 只有位于最后一个非 text 部件之后的 text 才作为最终给用户的输出。
  let lastNonTextIndex = -1;
  content.forEach((part, idx) => {
    if (part.type !== 'text') {
      lastNonTextIndex = idx;
    }
  });

  const outputParts: TextMessagePart[] = [];
  const thinkingItems: (
    | { type: 'reasoning'; text: string }
    | { type: 'text'; text: string }
    | { type: 'tool-call'; part: ToolCallMessagePart }
  )[] = [];

  for (let i = 0; i < content.length; i++) {
    const part = content[i];
    if (part.type === 'text') {
      const textPart = part as TextMessagePart;
      if (textPart.text) {
        if (i > lastNonTextIndex) {
          outputParts.push(textPart);
        } else {
          thinkingItems.push({ type: 'text', text: textPart.text });
        }
      }
    } else if (part.type === 'reasoning') {
      const text = (part as ReasoningMessagePart).text;
      if (text) thinkingItems.push({ type: 'reasoning', text });
    } else if (part.type === 'tool-call') {
      thinkingItems.push({ type: 'tool-call', part: part as ToolCallMessagePart });
    }
  }

  const hasThinkingContent = thinkingItems.length > 0;
  const hasOutputText = outputParts.some((p) => Boolean(p.text));

  // 当前助手消息是否没有任何可见内容（空文本、空思考、空工具、空 data）且仍在生成中。
  // 这种情况下在气泡内展示“思考中...”占位动画，避免 TTFT 期间页面看起来没有响应。
  // 用全局 thread 的运行状态兜底，避免 run 已结束但某条消息状态没更新导致一直显示"思考中"。
  const isMessageRunning = message.status?.type === 'running';
  const isRunning = isMessageRunning && thread.isRunning;
  const hasVisibleContent = content.some((part) => {
    if (part.type === 'text') return Boolean((part as TextMessagePart).text);
    if (part.type === 'reasoning') return Boolean((part as ReasoningMessagePart).text);
    if (part.type === 'tool-call') return true;
    if (part.type === 'data') return true;
    return false;
  });
  const showThinkingPlaceholder = isRunning && !hasVisibleContent;

  const textContent = outputParts
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n');

  // 从最终输出中提取模型标记的文件路径，统一在消息底部展示为附件卡片。
  const FILE_MARKER_REGEX = /\[\[FILE:([^\]]+)\]\]/g;
  const fileAttachments: string[] = [];
  for (const part of outputParts) {
    if (!part.text) continue;
    for (const match of part.text.matchAll(FILE_MARKER_REGEX)) {
      const path = match[1]?.trim();
      if (path && !fileAttachments.includes(path)) {
        fileAttachments.push(path);
      }
    }
  }

  return (
    <div className="flex gap-3 justify-start">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 items-start">
        <div className="flex flex-col gap-2 w-fit max-w-full min-w-0 bg-muted/60 rounded-2xl rounded-tl-sm border border-border/50 shadow-sm overflow-hidden">
          {showThinkingPlaceholder && (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>思考中</span>
              <span className="inline-flex">
                <span className="animate-bounce mx-0.5">.</span>
                <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.4s' }}>.</span>
              </span>
            </div>
          )}

          {/* 思考/工具过程统一折叠在 ThinkingCard 中，按实际出现顺序用时间线连接 */}
          {hasThinkingContent && (
            <ThinkingCard isRunning={isRunning} defaultOpen={isRunning}>
              <div className="relative py-1">
                {/* 中心贯穿时间线，从圆点中心穿过 */}
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />
                {thinkingItems.map((item, idx) => (
                  <div key={idx} className="relative flex gap-3 py-1.5">
                    {/* 时间线圆点，与内容垂直居中对齐 */}
                    <div className="relative shrink-0 w-6 flex items-center justify-center">
                      <div className={cn(
                        'h-2.5 w-2.5 rounded-full border-2 bg-background z-10',
                        item.type === 'tool-call'
                          ? 'border-primary'
                          : 'border-muted-foreground/60'
                      )} />
                    </div>
                    {/* 步骤内容 */}
                    <div className="flex-1 min-w-0">
                      {item.type === 'reasoning' && (
                        <div className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                          {item.text}
                        </div>
                      )}
                      {item.type === 'text' && (
                        <div className="text-sm text-muted-foreground break-words leading-relaxed">
                          <MarkdownView content={item.text} />
                        </div>
                      )}
                      {item.type === 'tool-call' && <ToolCallView part={item.part} compact />}
                    </div>
                  </div>
                ))}
              </div>
            </ThinkingCard>
          )}

          {/* 最终给用户的实际输出（去掉 [[FILE:...]] 标记，避免重复展示） */}
          {outputParts.map((part, idx) => {
            if (!part.text) return null;
            const cleanText = part.text.replace(FILE_MARKER_REGEX, '').trim();
            if (!cleanText) return null;
            return (
              <div key={idx} className="px-4 py-3 text-sm break-words">
                <MarkdownView content={cleanText} />
              </div>
            );
          })}

          {/* 文件附件卡片统一放在消息底部 */}
          {fileAttachments.length > 0 && (
            <div className="px-4 pb-3 flex flex-wrap gap-2">
              {fileAttachments.map((path) => (
                <FileAttachmentCard key={path} path={path} onPreview={onFilePreview} />
              ))}
            </div>
          )}

          {/* legacy data 部件（diff / task_list / tool_use / tool_result 等） */}
          {legacyDataParts.map((item, idx) => {
            const { name, data } = item;
            if (name === 'diff') {
              return <div key={idx} className="px-4 py-2"><DiffView content={data.content} /></div>;
            }
            if (name === 'task_list') {
              const tasks = (data.metadata?.tasks || []) as TaskItemData[];
              return <div key={idx} className="px-4 py-2"><TaskListView tasks={tasks} /></div>;
            }
            if (name === 'tool_use') {
              const isFailed = data.metadata?.status === 'failed' || data.metadata?.status === 'timeout';
              return (
                <div key={idx} className={`my-2 px-4 py-2 text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-muted/30 border-border/30 text-muted-foreground'}`}>
                  <div className="flex items-center gap-2">
                    <Wrench className={`h-4 w-4 ${isFailed ? 'text-red-500' : 'text-blue-500'}`} />
                    <span className="font-medium">{data.metadata?.name || '工具调用'}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${isFailed ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{data.metadata?.status || 'pending'}</span>
                  </div>
                  {data.content && <pre className={`mt-1 text-xs overflow-x-auto ${isFailed ? 'text-red-700 dark:text-red-300' : ''}`}>{data.content}</pre>}
                </div>
              );
            }
            if (name === 'tool_result') {
              const isFailed = data.metadata?.status === 'failed' || data.metadata?.status === 'timeout';
              return (
                <div key={idx} className={`my-2 px-4 py-2 text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-green-50/50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50'}`}>
                  <div className={`flex items-center gap-2 ${isFailed ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
                    {isFailed ? <X className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    <span className="font-medium">{isFailed ? '工具执行失败' : '工具执行结果'}</span>
                  </div>
                  {data.content && (
                    <div className={`mt-1 ${isFailed ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
                      <MarkdownView content={data.content} />
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>

        {artifact && (
          <div className="mt-2 p-3 rounded-xl border border-border/50 bg-card cursor-pointer hover:border-primary transition-colors flex items-center gap-3 w-full max-w-sm soft-shadow" onClick={onArtifactClick}>
            <div className="h-10 w-10 rounded bg-secondary flex items-center justify-center shrink-0">
              {artifact.type === 'ui' && <Box className="h-5 w-5 text-blue-500" />}
              {artifact.type === 'code' && <FileCode2 className="h-5 w-5 text-green-500" />}
              {artifact.type === 'requirement' && <ListTodo className="h-5 w-5 text-amber-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{artifact.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center">点击查看详情 <span className="ml-1">›</span></p>
            </div>
          </div>
        )}

        {textContent && (
          <div className="flex items-center gap-1 mt-1.5">
            <button
              onClick={onRegenerate}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              title="重新生成"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(textContent); toast.success('已复制'); }}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              title="复制"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
