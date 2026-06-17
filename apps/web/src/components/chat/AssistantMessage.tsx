import React from 'react';
import { Bot, Box, FileCode2, ListTodo, CheckCircle2, Wrench, X } from 'lucide-react';
import type { MessageState, TextMessagePart, ReasoningMessagePart, DataMessagePart } from '@assistant-ui/react';
import { MarkdownView } from './MarkdownView';
import { ThinkingPart } from './ThinkingPart';
import { DiffView } from './DiffView';
import { TaskListView, type TaskItemData } from './TaskListView';
import type { ChatPart } from './types';

interface AssistantMessageProps {
  message: MessageState;
  onArtifactClick?: () => void;
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({ message, onArtifactClick }) => {
  const content = Array.isArray(message.content) ? message.content : [];

  let artifact: { type: string; title: string } | undefined;
  const dataParts: { name: string; data: ChatPart }[] = [];

  for (const part of content) {
    if (part.type === 'data') {
      const dataPart = part as DataMessagePart;
      if (dataPart.name === 'artifact') {
        artifact = dataPart.data as { type: string; title: string };
      } else {
        dataParts.push({ name: dataPart.name, data: dataPart.data as ChatPart });
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

  return (
    <div className="flex gap-3 justify-start">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex flex-col max-w-[85%] items-start">
        <div className="flex flex-col gap-2 w-full bg-muted/60 rounded-2xl rounded-tl-sm border border-border/50 shadow-sm">
          {content.map((part, idx) => {
            if (part.type === 'text') {
              const textPart = part as TextMessagePart;
              if (!textPart.text) return null;
              return (
                <div key={idx} className="px-4 py-3 text-sm">
                  <MarkdownView content={textPart.text} />
                </div>
              );
            }

            if (part.type === 'reasoning') {
              const reasoningPart = part as ReasoningMessagePart;
              return <div key={idx} className="px-4 py-2"><ThinkingPart content={reasoningPart.text} /></div>;
            }

            if (part.type === 'data') {
              const dataPart = part as DataMessagePart;
              const original = dataPart.data as ChatPart;
              if (dataPart.name === 'diff') {
                return <div key={idx} className="px-4 py-2"><DiffView content={original.content} /></div>;
              }
              if (dataPart.name === 'task_list') {
                const tasks = (original.metadata?.tasks || []) as TaskItemData[];
                return <div key={idx} className="px-4 py-2"><TaskListView tasks={tasks} /></div>;
              }
              if (dataPart.name === 'artifact') {
                return null;
              }
              if (dataPart.name === 'tool_use') {
                const isFailed = original.metadata?.status === 'failed' || original.metadata?.status === 'timeout';
                return (
                  <div key={idx} className={`mx-4 my-2 px-4 py-2 text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-muted/30 border-border/30 text-muted-foreground'}`}>
                    <div className="flex items-center gap-2">
                      <Wrench className={`h-4 w-4 ${isFailed ? 'text-red-500' : 'text-blue-500'}`} />
                      <span className="font-medium">{original.metadata?.name || '工具调用'}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${isFailed ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{original.metadata?.status || 'pending'}</span>
                    </div>
                    {original.content && <pre className={`mt-1 text-xs overflow-x-auto ${isFailed ? 'text-red-700 dark:text-red-300' : ''}`}>{original.content}</pre>}
                  </div>
                );
              }
              if (dataPart.name === 'tool_result') {
                const isFailed = original.metadata?.status === 'failed' || original.metadata?.status === 'timeout';
                return (
                  <div key={idx} className={`mx-4 my-2 px-4 py-2 text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-green-50/50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50'}`}>
                    <div className={`flex items-center gap-2 ${isFailed ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
                      {isFailed ? <X className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      <span className="font-medium">{isFailed ? '工具执行失败' : '工具执行结果'}</span>
                    </div>
                    {original.content && (
                      <div className={`mt-1 ${isFailed ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
                        <MarkdownView content={original.content} />
                      </div>
                    )}
                  </div>
                );
              }
              return null;
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
      </div>
    </div>
  );
};
