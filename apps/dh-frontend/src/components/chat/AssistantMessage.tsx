import React, { useState, useEffect } from 'react';
import { Bot, Box, FileCode2, ListTodo, CheckCircle2, Wrench, X, Copy, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { MessageState, TextMessagePart, ReasoningMessagePart, DataMessagePart, ToolCallMessagePart } from '@assistant-ui/react';
import { useThread } from '@assistant-ui/react';
import { MarkdownView } from './MarkdownView';
import { FileAttachmentCard } from './FileAttachmentCard';
import { ProjectCard } from './ProjectCard';
import { DiffView } from './DiffView';
import type { PreviewMode } from './LivePreview';
import { TaskListView, type TaskItemData } from './TaskListView';
import { ToolCallView } from './ToolCallView';
import { ThinkingCard } from './ThinkingCard';
import { UserStoryCard } from './UserStoryCard';
import { parseUserStoryFromText } from './UserStoryCard';
import type { UserStoryData } from './UserStoryCard';
import type { ChatPart } from './types';
import { toast } from 'sonner';
import { cn, formatTime } from '@/lib/utils';

  const CARD_MARKER_REGEX = /\[\[CARD:([^\]]+)\]\]/g;

const TEXT_COLLAPSE_LINE_THRESHOLD = 12;
const TEXT_COLLAPSE_CHAR_THRESHOLD = 800;

function extractCardTypes(text: string): string[] {
  const types: string[] = [];
  for (const match of text.matchAll(CARD_MARKER_REGEX)) {
    const type = match[1]?.trim();
    if (type && !types.includes(type)) {
      types.push(type);
    }
  }
  return types;
}

interface AssistantMessageProps {
  message: MessageState;
  runPhase?: 'connecting' | 'thinking' | null;
  onArtifactClick?: () => void;
  onRegenerate?: () => void;
  onFilePreview?: (path: string) => void;
  onProjectPreview?: (path: string, mode: PreviewMode) => void;
  onUserStoryPreview?: (data: UserStoryData) => void;
  activeUserStoryData?: UserStoryData | null;
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({ message, runPhase, onArtifactClick, onRegenerate, onFilePreview, onProjectPreview, onUserStoryPreview, activeUserStoryData }) => {
  const thread = useThread();
  const content = Array.isArray(message.content) ? message.content : [];
  const [textExpanded, setTextExpanded] = useState(false);

  const isUserStoryActive = (data: UserStoryData) =>
    activeUserStoryData != null &&
    activeUserStoryData.title === data.title &&
    activeUserStoryData.total === data.total &&
    (activeUserStoryData.stories[0]?.story === data.stories[0]?.story);

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
  // 只有位于最后一个 reasoning 部件之后的 text 才作为最终给用户的输出。
  // tool-call 不视为边界，因为模型可能在生成文本后调用工具。
  let lastNonTextIndex = -1;
  content.forEach((part, idx) => {
    if (part.type === 'reasoning') {
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

  // 计算思考次数和工具调用统计，用于折叠卡片标题展示。
  const thinkingCount = thinkingItems.filter((item) => item.type === 'reasoning').length;
  const toolStats = thinkingItems.reduce<Record<string, number>>((acc, item) => {
    if (item.type !== 'tool-call') return acc;
    const name = item.part.toolName || '工具调用';
    const displayName =
      { write: '写入文件', file_write: '写入文件', read: '读取文件', file_read: '读取文件', bash: '执行命令', terminal: '执行命令', execute: '执行命令', search: '搜索', web_search: '搜索' }[name.toLowerCase()] || name;
    acc[displayName] = (acc[displayName] || 0) + 1;
    return acc;
  }, {});

  // 检测 reasoning 部件是否全部标记为 done（已收到 THINKING_END 事件）。
  const reasoningParts = content.filter((p): p is ReasoningMessagePart & { done?: boolean } => p.type === 'reasoning');
  const reasoningAllDone = reasoningParts.length > 0 && reasoningParts.every((p) => p.done);

  // 当前助手消息是否没有任何可见内容（空文本、空思考、空工具、空 data）且仍在生成中。
  // 这种情况下在气泡内展示"思考中..."占位动画，避免 TTFT 期间页面看起来没有响应。
  // 用全局 thread 的运行状态兜底，避免 run 已结束但某条消息状态没更新导致一直显示"思考中"。
  const isMessageRunning = message.status?.type === 'running';
  const isRunning = isMessageRunning && thread.isRunning;

  // 思考是否仍在进行：只有当最终给用户的 TEXT 输出出现（或 run 已结束）时才认为思考完毕。
  // reasoningAllDone 只表示模型思考阶段结束，但后续可能还有工具调用、再次思考，
  // 只有真正输出 TEXT 给用户才算"思考完毕"。
  const isThinkingRunning = isRunning && !hasOutputText;
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

  const textLineCount = textContent.split('\n').length;
  const shouldCollapseText = textLineCount > TEXT_COLLAPSE_LINE_THRESHOLD || textContent.length > TEXT_COLLAPSE_CHAR_THRESHOLD;
  const isStreaming = isRunning || isThinkingRunning;

  const UNRESOLVED_PLACEHOLDER_PATTERNS = [
    '绝对路径',
    '需求名称',
    '调研主题',
    '工程名',
    '功能名称',
    '功能名',
    '分析主题',
    '用户故事',
  ] as const;

  function hasUnresolvedPlaceholders(filePath: string): boolean {
    return UNRESOLVED_PLACEHOLDER_PATTERNS.some((pattern) => filePath.includes(pattern));
  }

  // 从最终输出中提取模型标记的文件路径，统一在消息底部展示为附件卡片。
  // 过滤掉包含未解析中文占位符的路径（如「绝对路径」「需求名称」等）。
  const FILE_MARKER_REGEX = /\[\[FILE:([^\]]+)\]\]/g;
  const PROJECT_MARKER_REGEX = /\[\[PROJECT:([^\]]+)\]\]/g;
  const fileAttachments: string[] = [];
  const projectPaths: string[] = [];
  for (const part of outputParts) {
    if (!part.text) continue;
    for (const match of part.text.matchAll(FILE_MARKER_REGEX)) {
      const path = match[1]?.trim();
      if (path && !fileAttachments.includes(path) && !hasUnresolvedPlaceholders(path)) {
        fileAttachments.push(path);
      }
    }
    for (const match of part.text.matchAll(PROJECT_MARKER_REGEX)) {
      const path = match[1]?.trim();
      if (path && !projectPaths.includes(path) && !hasUnresolvedPlaceholders(path)) {
        projectPaths.push(path);
      }
    }
  }

  const cardTypes = extractCardTypes(textContent);
  const hasUserStoryFromMarker = cardTypes.includes('user_story');
  const userStoryData = hasUserStoryFromMarker
    ? parseUserStoryFromText(textContent, fileAttachments[0] ?? '')
    : null;

  const hasUserStoryFromLegacy = legacyDataParts.some((item) => item.name === 'user_story');
  const hasUserStory = hasUserStoryFromLegacy || hasUserStoryFromMarker;

  // 用户故事卡片出现时，默认展开完整文本，避免"内容没有输出完整"的观感。
  useEffect(() => {
    if (hasUserStoryFromMarker || hasUserStoryFromLegacy) {
      setTextExpanded(true);
    }
  }, [hasUserStoryFromMarker, hasUserStoryFromLegacy]);

  const showCollapsed = shouldCollapseText && !textExpanded && !isStreaming;

  const toolCallCount = thinkingItems.filter((i) => i.type === 'tool-call').length;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(message.createdAt).getTime();
    if (!isRunning) {
      setElapsed(Math.floor((Date.now() - start) / 1000));
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [isRunning, message.createdAt]);

  return (
    <div className="flex gap-3 justify-start">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 items-start">
        <div className="chat-bubble-card flex flex-col gap-2 w-full max-w-full min-w-0 rounded-2xl rounded-tl-sm overflow-hidden">
          {showThinkingPlaceholder && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{runPhase === 'connecting' ? '正在连接个人助手' : '思考中'}</span>
              <span className="inline-flex">
                <span className="animate-bounce mx-0.5">.</span>
                <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.4s' }}>.</span>
              </span>
            </div>
          )}

          {/* 思考/工具过程统一折叠在 ThinkingCard 中，按实际出现顺序用时间线连接 */}
          {hasThinkingContent && (
            <ThinkingCard isRunning={isThinkingRunning} defaultOpen={false} thinkingCount={thinkingCount} toolStats={toolStats}>
              <div className="relative py-1">
                {/* 中心贯穿时间线，从圆点中心穿过 */}
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />
                {thinkingItems.map((item, idx) => {
                  // 时间线圆点颜色：绿色=已完成（该步骤之后还有内容或整体已结束），灰色=仍在进行中
                  const isLastItem = idx === thinkingItems.length - 1;
                  const itemComplete = !isThinkingRunning || !isLastItem;
                  return (
                    <div key={idx} className="relative flex gap-3 py-1.5">
                      <div className="relative shrink-0 w-6 flex items-center justify-center">
                        <div className={cn(
                          'h-2.5 w-2.5 rounded-full border-2 bg-background z-10',
                          itemComplete ? 'border-green-500' : 'border-muted-foreground/60'
                        )} />
                      </div>
                      {/* 步骤内容 */}
                      <div className="flex-1 min-w-0">
                        {item.type === 'reasoning' && (
                          <div className="text-xs sm:text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                            {item.text}
                          </div>
                        )}
                        {item.type === 'text' && (
                          <div className="text-xs sm:text-sm text-muted-foreground break-words leading-relaxed">
                            <MarkdownView content={item.text} />
                          </div>
                        )}
                        {item.type === 'tool-call' && <ToolCallView part={item.part} compact />}
                      </div>
                    </div>
                  );
                })}
                {/* 思考进行中时在时间线底部显示转圈圈，直到 TEXT 输出出现 */}
                {isThinkingRunning && (
                  <div className="relative flex gap-3 py-1.5">
                    <div className="relative shrink-0 w-6 flex items-center justify-center">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>
            </ThinkingCard>
          )}

          {/* 最终给用户的实际输出（去掉 [[FILE:...]] 和 [[PROJECT:...]] 标记，避免重复展示） */}
          {textContent && (
            <div>
              <div className="relative">
                <div className={showCollapsed ? 'chat-bubble-text chat-bubble-text-closed' : 'chat-bubble-text chat-bubble-text-open'}>
                  {outputParts.map((part, idx) => {
                    if (!part.text) return null;
                    const cleanText = part.text.replace(FILE_MARKER_REGEX, '').replace(PROJECT_MARKER_REGEX, '').trim();
                    if (!cleanText) return null;
                    return (
                      <div key={idx} className="px-5 py-1.5 text-sm break-words">
                        <MarkdownView content={cleanText} collapsible={false} />
                      </div>
                    );
                  })}
                </div>
                {showCollapsed && (
                  <div className="chat-bubble-fade absolute bottom-0 left-0 right-0 h-16 pointer-events-none z-10" />
                )}
              </div>
              {shouldCollapseText && (
                <div className="flex justify-center py-1.5">
                  <button
                    className="chat-bubble-toggle"
                    onClick={() => setTextExpanded(v => !v)}
                    type="button"
                  >
                    {textExpanded ? (
                      <>收起 <ChevronUp className="h-3.5 w-3.5" /></>
                    ) : (
                      <>展开全部 <ChevronDown className="h-3.5 w-3.5" /></>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 工程卡片：新建工程显示预览+同步，已有工程显示 diff（有 user_story 数据时不展示） */}
          {!hasUserStory && projectPaths.length > 0 && (
            <div className="px-3 pb-2 flex flex-col gap-2">
              {projectPaths.map((path) => (
                <ProjectCard key={path} path={path} onPreview={onProjectPreview} />
              ))}
            </div>
          )}

          {/* 文件附件卡片统一放在消息底部（有 user_story 数据时不展示） */}
          {!hasUserStory && fileAttachments.length > 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-2">
              {fileAttachments.map((path) => (
                <FileAttachmentCard key={path} path={path} onPreview={onFilePreview} />
              ))}
            </div>
          )}

          {/* 从 [[CARD:user_story]] 标记自动检测到的用户故事卡片 */}
          {!hasUserStoryFromLegacy && hasUserStoryFromMarker && userStoryData && (
            <div className="px-3 py-2"><UserStoryCard data={userStoryData} isPreviewActive={isUserStoryActive(userStoryData)} onPreview={onUserStoryPreview} /></div>
          )}

          {/* legacy data 部件（diff / task_list / tool_use / tool_result 等） */}
          {legacyDataParts.map((item, idx) => {
            const { name, data } = item;
            if (name === 'diff') {
              return <div key={idx} className="px-3 py-2"><DiffView content={data.content} /></div>;
            }
            if (name === 'task_list') {
              const tasks = (data.metadata?.tasks || []) as TaskItemData[];
              return <div key={idx} className="px-3 py-2"><TaskListView tasks={tasks} /></div>;
            }
            if (name === 'tool_use') {
              const isFailed = data.metadata?.status === 'failed' || data.metadata?.status === 'timeout';
              return (
                <div key={idx} className={`my-2 px-3 py-2 text-xs sm:text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-muted/30 border-border/30 text-muted-foreground'}`}>
                  <div className="flex items-center gap-2">
                    <Wrench className={`h-4 w-4 ${isFailed ? 'text-red-500' : 'text-blue-500'}`} />
                    <span className="font-medium">{data.metadata?.name || '工具调用'}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${isFailed ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{data.metadata?.status || 'pending'}</span>
                  </div>
                  {data.content && <pre className={`mt-1 text-xs overflow-x-auto ${isFailed ? 'text-red-700 dark:text-red-300' : ''}`}>{data.content}</pre>}
                </div>
              );
            }
            if (name === 'user_story') {
              const storyData = (data.content ? JSON.parse(data.content) : data.metadata) as UserStoryData;
              if (storyData && storyData.stories) {
                return <div key={idx} className="px-3 py-2"><UserStoryCard data={storyData} isPreviewActive={isUserStoryActive(storyData)} onPreview={onUserStoryPreview} /></div>;
              }
              return null;
            }
            if (name === 'tool_result') {
              const isFailed = data.metadata?.status === 'failed' || data.metadata?.status === 'timeout';
              return (
                <div key={idx} className={`my-2 px-3 py-2 text-xs sm:text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-green-50/50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50'}`}>
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

        {textContent && !isRunning && (
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-muted-foreground/50 px-1">{formatTime(message.createdAt)}</span>
            <span className="text-[10px] text-muted-foreground/50">总耗时 {elapsed} 秒 · 工具调用 {toolCallCount} 次</span>
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
        {isRunning && (
          <div className="flex items-center gap-2 mt-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
            <span className="text-[10px] text-muted-foreground/50">生成中 {elapsed} 秒 · 工具调用 {toolCallCount} 次</span>
          </div>
        )}
      </div>
    </div>
  );
};
