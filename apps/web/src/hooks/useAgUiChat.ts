import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HttpAgent } from '@ag-ui/client';
import { useAgUiRuntime } from '@assistant-ui/react-ag-ui';
import type { AssistantRuntime, ThreadState } from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { toast } from 'sonner';

interface SendContext {
  quotedCard?: { type: 'req' | 'defect' | 'case'; id: string; title: string; reporter: string };
  selectedRepos?: { id: string; name: string }[];
}

interface UseAgUiChatReturn {
  runtime: AssistantRuntime;
  sessionId: string | null;
  wsConnected: boolean;
  isRunning: boolean;
  messages: ThreadMessageLike[];
  sendMessage: (text: string, context?: SendContext) => void;
  switchSession: (nextSessionId: string | null) => void;
}

const AGENT_URL = '/api/v1/agent';

function toThreadMessageLike(msg: ThreadState['messages'][number]): ThreadMessageLike {
  // runtime 内部消息已经是 ThreadMessageLike 兼容结构，只需处理 content 为字符串的简化场景。
  const content: ThreadMessageLike['content'] =
    typeof msg.content === 'string'
      ? [{ type: 'text' as const, text: msg.content }]
      : (msg.content.map((part) => {
          if (typeof part === 'string') {
            return { type: 'text' as const, text: part };
          }
          if (part.type === 'text') {
            return { type: 'text' as const, text: part.text };
          }
          if (part.type === 'reasoning') {
            // assistant-ui 的 ReasoningMessagePart 使用 text 字段
            return { type: 'reasoning' as const, text: (part as { text?: string }).text ?? '' };
          }
          if (part.type === 'tool-call') {
            return {
              type: 'tool-call' as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args,
              result: (part as { result?: unknown }).result,
            };
          }
          // AG-UI 可能返回独立的 tool-result，ThreadMessageLike 没有该类型，合并到 tool-call 中展示
          const tp = part as { type?: string; toolCallId?: string; toolName?: string; result?: unknown };
          if (tp.type === 'tool-result') {
            return {
              type: 'tool-call' as const,
              toolCallId: tp.toolCallId,
              toolName: tp.toolName ?? '',
              result: tp.result,
            };
          }
          return part as ThreadMessageLike['content'][number];
        }) as ThreadMessageLike['content']);
  return {
    id: msg.id,
    role: msg.role,
    content,
    metadata: msg.metadata,
  };
}

export function useAgUiChat(): UseAgUiChatReturn {
  // HttpAgent 负责通过 SSE 与后端 /api/v1/agent 通信。
  const agent = useMemo(() => new HttpAgent({ url: AGENT_URL }), []);
  const runtime = useAgUiRuntime({
    agent,
    onError: (err) => {
      console.error('[useAgUiChat] runtime error:', err);
      toast.error(`Agent 运行错误: ${err.message}`);
    },
  });
  const threadRuntimeRef = useRef(runtime.thread);

  useEffect(() => {
    threadRuntimeRef.current = runtime.thread;
  }, [runtime.thread]);

  // 订阅 assistant-ui thread 状态变化，用于兼容旧版 UI 的 messages / isRunning。
  const [threadState, setThreadState] = useState<ThreadState>(() => runtime.thread.getState());

  useEffect(() => {
    setThreadState(runtime.thread.getState());
    return runtime.thread.subscribe(() => {
      const state = runtime.thread.getState();
      console.log('[useAgUiChat] thread state updated:', {
        messageCount: state.messages.length,
        isRunning: state.isRunning,
        messages: state.messages.map((m) => ({ id: m.id, role: m.role, contentPreview: typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 200) })),
      });
      setThreadState(state);
    });
  }, [runtime.thread]);

  const [sessionId, setSessionId] = useState<string | null>(null);

  const messages = useMemo(() => threadState.messages.map(toThreadMessageLike), [threadState.messages]);

  const switchSession = useCallback((nextSessionId: string | null) => {
    // 切换会话时重置当前 thread。
    threadRuntimeRef.current.reset();
    setSessionId(nextSessionId);
  }, []);

  const sendMessage = useCallback((text: string, context: SendContext = {}) => {
    if (!text.trim() && !context.quotedCard) return;

    const metadata: Record<string, unknown> = {};
    if (context.quotedCard) {
      metadata.quotedCard = context.quotedCard;
    }
    if (context.selectedRepos && context.selectedRepos.length > 0) {
      metadata.selectedRepos = context.selectedRepos;
    }

    // 追加用户消息到 thread，并立即启动 run。
    console.log('[useAgUiChat] sendMessage:', text);
    try {
      threadRuntimeRef.current.append({
        role: 'user',
        content: [{ type: 'text', text }],
        metadata: { custom: metadata },
        startRun: true,
      });
      console.log('[useAgUiChat] append succeeded');
    } catch (err) {
      console.error('[useAgUiChat] append failed:', err);
      toast.error('发送消息失败');
      return;
    }
  }, []);

  return {
    runtime,
    sessionId,
    wsConnected: !threadState.isRunning,
    isRunning: threadState.isRunning,
    messages,
    sendMessage,
    switchSession,
  };
}
