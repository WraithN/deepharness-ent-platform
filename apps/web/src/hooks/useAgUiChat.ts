import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExternalStoreRuntime, useExternalStoreSharedOptions } from '@assistant-ui/core/react';
import type { AssistantRuntime, ThreadMessageLike } from '@assistant-ui/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export interface SendContext {
  quotedCard?: { type: 'req' | 'defect' | 'case'; id: string; title: string; reporter: string };
  selectedRepos?: { id: string; name: string }[];
}

interface UseAgUiChatOptions {
  /** 当前 run 使用的 gatewayd agent 插件 key，如 claude-code、opencode、codex。 */
  agentPluginKey?: string;
}

interface UseAgUiChatReturn {
  runtime: AssistantRuntime;
  sessionId: string | null;
  instanceId: string | null;
  wsConnected: boolean;
  isRunning: boolean;
  messages: ThreadMessageLike[];
  sendMessage: (text: string, context?: SendContext) => Promise<void>;
  switchSession: (nextSessionId: string | null) => Promise<void>;
  createSession: (pluginKey?: string) => Promise<{ sessionId: string; instanceId: string } | null>;
  cancelRun: () => void;
}

const AGENT_URL = '/api/v1/agent';
// 工具调用后模型整理长报告可能较长时间无 token，60s 容易误触发，延长到 180s。
const NO_EVENT_TIMEOUT_MS = 180000;
const NO_EVENT_TIMER_INTERVAL_MS = 5000;

const USER_PROMPT_MARKER = '__USER_PROMPT__';

const PROMPT_TEMPLATE_RULES = `请严格遵循以下规则回答：
1. 回答必须使用中文。
2. 禁止使用 /workflows、/commit、/pr、/review 等 slash command；所有任务都通过直接回答或调用工具完成，不要引导用户去其他页面或后台工作流查看结果。
3. 工具调用结束后，请立即先用一两句话告诉用户"正在整理结果"或"结果如下"，不要让用户长时间看不到任何回复；整理完成后再给出完整内容。
4. 如果创建了文件，请在完整内容末尾提及，并使用以下格式标记文件路径：
   [[FILE:/path/to/file.md]]
   示例：
   调研报告已生成：[[FILE:/home/nan/deepharness-ent-platform/docs/product-research/report.md]]
   重要：[[FILE:...]] 中的路径必须与你调用 Write 工具时使用的 file_path 完全一致（建议使用绝对路径）。
   如果 Write 工具创建在 docs/product-research/xxx.md，那么 [[FILE:...]] 也必须是 docs/product-research/xxx.md，不能是其他路径，否则用户无法预览或下载。
   除了这种 [[FILE:...]] 格式外，不要把 "/workflows"、"/Computer/Super" 等普通 slash 字符串当作文件路径。
5. 文件路径标记会渲染为可点击卡片，用户可预览或下载文件；markdown 文件会直接格式化展示。`;

/**
 * 把用户原始提示词包装到提示词模板中，让模型统一遵循回答规则。
 */
function wrapUserPrompt(text: string): string {
  return `${PROMPT_TEMPLATE_RULES}\n\n${USER_PROMPT_MARKER}\n${text}`;
}

/**
 * 从包装后的提示词中提取用户原始输入。
 */
export function extractUserPrompt(text: string): string {
  const idx = text.indexOf(USER_PROMPT_MARKER);
  if (idx === -1) return text;
  return text.slice(idx + USER_PROMPT_MARKER.length).trimStart();
}

interface BackendMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

function backendMessageToThreadMessageLike(msg: BackendMessage): ThreadMessageLike {
  const custom = (msg.metadata ?? {}) as Record<string, unknown>;
  const base: ThreadMessageLike = {
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: [{ type: 'text' as const, text: msg.content }],
    metadata: { custom },
    createdAt: new Date(msg.timestamp),
  };
  // assistant-ui 的 status 只支持 assistant 消息。
  if (base.role === 'assistant') {
    return { ...base, status: { type: 'complete' as const, reason: 'unknown' as const } };
  }
  return base;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 将 ThreadMessageLike 的文本内容提取为字符串，用于后端 RunAgentInput。
 */
function messageToBackendText(msg: ThreadMessageLike): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text?: string }).text ?? '')
    .join('\n');
}

interface AgUiEvent {
  type: string;
  timestamp?: number;
  threadId?: string;
  runId?: string;
  messageId?: string;
  role?: string;
  delta?: string;
  toolCallId?: string;
  toolCallName?: string;
  content?: string;
  message?: string;
  code?: string;
}

function parseSSE(text: string): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  const buffer = text.split(/\n\n/);
  for (const block of buffer) {
    const lines = block.split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^\s/, ''));
      }
    }
    if (dataLines.length === 0) continue;
    try {
      events.push(JSON.parse(dataLines.join('\n')) as AgUiEvent);
    } catch {
      // ignore malformed sse data
    }
  }
  return events;
}

export function useAgUiChat(options: UseAgUiChatOptions = {}): UseAgUiChatReturn {
  const { agentPluginKey = 'claude-code' } = options;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunSessionIdRef = useRef<string | null>(null);

  const loadMessages = useCallback(async (targetSessionId: string | null) => {
    if (!targetSessionId) {
      setMessages([]);
      return;
    }
    try {
      const msgs = await api.get<BackendMessage[]>(`/v1/sessions/${targetSessionId}/messages`);
      setMessages(msgs.map(backendMessageToThreadMessageLike));
    } catch (err) {
      console.error('[useAgUiChat] load messages failed:', err);
      toast.error('加载会话历史失败');
      setMessages([]);
    }
  }, []);

  const createSession = useCallback(
    async (pluginKey?: string): Promise<{ sessionId: string; instanceId: string } | null> => {
      try {
        const key = pluginKey || agentPluginKey;
        console.log('[useAgUiChat] createSession pluginKey=', key);
        const res = await api.post<{
          code: number;
          data?: { sessionId: string; instanceId?: string };
          message?: string;
        }>('/v1/sessions', {
          workspaceId: 'ws-default',
          agentId: 'agent-default',
          agentType: 'chat',
          agent_key: key,
        });
        console.log('[useAgUiChat] createSession response', res);
        if (res.code !== 0 || !res.data?.sessionId) {
          toast.error(res.message || '创建会话失败');
          return null;
        }
        const id = res.data.sessionId;
        const instId = res.data.instanceId ?? '';
        console.log('[useAgUiChat] createSession success', id, instId);
        setSessionId(id);
        setInstanceId(instId);
        await loadMessages(id);
        return { sessionId: id, instanceId: instId };
      } catch (err) {
        console.error('[useAgUiChat] create session failed:', err);
        toast.error('创建会话失败');
        return null;
      }
    },
    [agentPluginKey, loadMessages]
  );

  const switchSession = useCallback(
    async (nextSessionId: string | null) => {
      console.log('[useAgUiChat] switchSession', nextSessionId);
      // 取消当前会话可能正在进行的 run，避免旧 SSE 事件污染新会话。
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      activeRunSessionIdRef.current = null;
      setIsRunning(false);
      setSessionId(nextSessionId);
      setInstanceId(null);
      await loadMessages(nextSessionId);
    },
    [loadMessages]
  );

  const cancelRun = useCallback(() => {
    console.log('[useAgUiChat] cancelRun');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsRunning(false);
      activeRunSessionIdRef.current = null;
    }
  }, []);

  const handleSend = useCallback(
    async (text: string, context: SendContext = {}) => {
      if (!text.trim() && !context.quotedCard) return;
      console.log('[useAgUiChat] handleSend start, text=', text.slice(0, 50));

      let currentSessionId = sessionIdRef.current;
      if (!currentSessionId) {
        console.log('[useAgUiChat] no session, creating...');
        const created = await createSession();
        console.log('[useAgUiChat] createSession result=', created);
        if (!created) return;
        currentSessionId = created.sessionId;
      }
      console.log('[useAgUiChat] currentSessionId=', currentSessionId);

      const metadata: Record<string, unknown> = {};
      if (context.quotedCard) metadata.quotedCard = context.quotedCard;
      if (context.selectedRepos && context.selectedRepos.length > 0) metadata.selectedRepos = context.selectedRepos;
      metadata.originalText = text;

      const userMessageId = generateId();
      const userMessage: ThreadMessageLike = {
        id: userMessageId,
        role: 'user',
        content: [{ type: 'text', text }],
        metadata: { custom: metadata },
        createdAt: new Date(),
      };

      // 立即把用户消息加入当前会话，避免发送后消息消失。
      setMessages((prev) => [...prev, userMessage]);

      const runId = generateId();
      const runInput = {
        threadId: currentSessionId,
        runId,
        state: null,
        messages: [
          {
            id: userMessageId,
            role: 'user',
            content: JSON.stringify(wrapUserPrompt(text)),
          },
        ],
        tools: [],
        context: [],
        forwardedProps: {},
        agent_key: agentPluginKey,
      };

      setIsRunning(true);
      activeRunSessionIdRef.current = currentSessionId;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // 长时间未收到任何 SSE 事件时自动重置，避免前端一直显示“思考中”。
      // 变量声明在 try 外，保证 catch/finally 也能访问。
      let lastEventAt = Date.now();
      let noEventTimeoutFired = false;
      let noEventTimer: ReturnType<typeof setInterval> | null = null;

      try {
        console.log('[useAgUiChat] fetching', AGENT_URL, 'runId=', runId);
        const response = await fetch(AGENT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(runInput),
          signal: abortController.signal,
        });

        console.log('[useAgUiChat] fetch response', response.status, 'hasBody=', !!response.body);
        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => '');
          throw new Error(`Agent run failed: ${response.status} ${body}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let sseBuffer = '';
        let assistantMessageId: string | null = null;

        noEventTimer = setInterval(() => {
          if (Date.now() - lastEventAt > NO_EVENT_TIMEOUT_MS) {
            noEventTimeoutFired = true;
            if (noEventTimer) clearInterval(noEventTimer);
            abortController.abort();
          }
        }, NO_EVENT_TIMER_INTERVAL_MS);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const parts = sseBuffer.split(/\n\n/);
          sseBuffer = parts.pop() ?? '';
          for (const part of parts) {
            const events = parseSSE(part);
            for (const ev of events) {
              // 安全兜底：如果会话已切换，忽略旧 run 的事件。
              if (activeRunSessionIdRef.current !== currentSessionId) continue;

              lastEventAt = Date.now();
              console.log('[useAgUiChat] SSE event', ev.type, 'runId=', runId, 'assistantMessageId=', assistantMessageId);

              switch (ev.type) {
                case 'RUN_STARTED':
                  setIsRunning(true);
                  break;

                case 'TEXT_MESSAGE_START': {
                  // 单次 run 内只创建一个 assistant 消息，保证一轮回复只有一个 AI 头像。
                  // 如果已有消息（来自前面的 thinking/text），复用并忽略新的 TEXT_MESSAGE_START。
                  if (assistantMessageId) break;
                  assistantMessageId = ev.messageId ?? generateId();
                  const assistant: ThreadMessageLike = {
                    id: assistantMessageId,
                    role: 'assistant',
                    content: [{ type: 'text', text: '' }],
                    createdAt: new Date(),
                    status: { type: 'running' },
                  };
                  setMessages((prev) => {
                    if (prev.some((m) => m.id === assistantMessageId)) return prev;
                    return [...prev, assistant];
                  });
                  break;
                }

                case 'TEXT_MESSAGE_CONTENT': {
                  if (!ev.delta) break;
                  // 兜底：如果还没有 assistant 消息，创建一个（某些协议实现可能先 content 后 start）。
                  if (!assistantMessageId) {
                    const msgId = ev.messageId ?? generateId();
                    assistantMessageId = msgId;
                    const deltaText = ev.delta || '';
                    setMessages((prev) => {
                      if (prev.some((m) => m.id === msgId)) return prev;
                      return [...prev, {
                        id: msgId,
                        role: 'assistant',
                        content: [{ type: 'text', text: deltaText }],
                        createdAt: new Date(),
                        status: { type: 'running' },
                      }];
                    });
                    break;
                  }
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantMessageId || m.role !== 'assistant') return m;
                      const content = Array.isArray(m.content) ? m.content : [{ type: 'text' as const, text: String(m.content ?? '') }];
                      const newContent = content.map((part) => {
                        if (part.type === 'text') return { ...part, text: (part.text ?? '') + ev.delta };
                        return part;
                      });
                      return { ...m, content: newContent };
                    })
                  );
                  break;
                }

                case 'THINKING_TEXT_MESSAGE_CONTENT': {
                  // thinking 文本与正式回复合并到同一个 assistant 消息，
                  // AssistantMessage 会把 tool-call 之前的 text 归为思考过程。
                  if (!ev.delta) break;
                  const thinkingText = ev.delta || '';
                  if (!assistantMessageId) {
                    const msgId = generateId();
                    assistantMessageId = msgId;
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: msgId,
                        role: 'assistant',
                        content: [{ type: 'text', text: thinkingText }],
                        createdAt: new Date(),
                        status: { type: 'running' },
                      },
                    ]);
                    break;
                  }
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantMessageId || m.role !== 'assistant') return m;
                      const content = Array.isArray(m.content) ? m.content : [{ type: 'text' as const, text: String(m.content ?? '') }];
                      const newContent = content.map((part) => {
                        if (part.type === 'text') return { ...part, text: (part.text ?? '') + ev.delta };
                        return part;
                      });
                      return { ...m, content: newContent };
                    })
                  );
                  break;
                }

                case 'TEXT_MESSAGE_END':
                  // 忽略中途的 TEXT_MESSAGE_END，避免把一次 run 拆成多个消息。
                  // 最终完成状态由 RUN_FINISHED 统一设置。
                  break;

                case 'TOOL_CALL_START': {
                  if (!ev.toolCallId || !ev.toolCallName) break;
                  setMessages((prev) => {
                    const lastAssistant = [...prev].reverse().find((m) => m.role === 'assistant');
                    if (!lastAssistant) return prev;
                    return prev.map((m) => {
                      if (m.id !== lastAssistant.id) return m;
                      const content = Array.isArray(m.content) ? m.content : [];
                      if (content.some((p) => p.type === 'tool-call' && (p as { toolCallId?: string }).toolCallId === ev.toolCallId)) {
                        return m;
                      }
                      return {
                        ...m,
                        content: [
                          ...content,
                          {
                            type: 'tool-call' as const,
                            toolCallId: ev.toolCallId,
                            toolName: ev.toolCallName,
                            args: undefined,
                            argsText: '',
                          },
                        ],
                      };
                    });
                  });
                  break;
                }

                case 'TOOL_CALL_ARGS': {
                  if (!ev.toolCallId || ev.delta === undefined) break;
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.role !== 'assistant') return m;
                      const content = Array.isArray(m.content) ? m.content : [];
                      const hasTarget = content.some(
                        (p) => p.type === 'tool-call' && (p as { toolCallId?: string }).toolCallId === ev.toolCallId
                      );
                      if (!hasTarget) return m;
                      return {
                        ...m,
                        content: content.map((p) => {
                          if (p.type !== 'tool-call' || (p as { toolCallId?: string }).toolCallId !== ev.toolCallId) return p;
                          const argsText = ((p as { argsText?: string }).argsText ?? '') + ev.delta;
                          let args = undefined;
                          try {
                            args = JSON.parse(argsText);
                          } catch {
                            // partial args
                          }
                          return { ...p, args, argsText };
                        }),
                      };
                    })
                  );
                  break;
                }

                case 'TOOL_CALL_RESULT': {
                  if (!ev.toolCallId || ev.content === undefined) break;
                  setMessages((prev) =>
                    prev.map((m) => {
                      if (m.role !== 'assistant') return m;
                      const content = Array.isArray(m.content) ? m.content : [];
                      const hasTarget = content.some(
                        (p) => p.type === 'tool-call' && (p as { toolCallId?: string }).toolCallId === ev.toolCallId
                      );
                      if (!hasTarget) return m;
                      return {
                        ...m,
                        content: content.map((p) => {
                          if (p.type !== 'tool-call' || (p as { toolCallId?: string }).toolCallId !== ev.toolCallId) return p;
                          const raw = ev.content ?? '';
                          let result: unknown = raw;
                          try {
                            result = JSON.parse(raw);
                          } catch {
                            // keep as string
                          }
                          return { ...p, result };
                        }),
                      };
                    })
                  );
                  break;
                }

                case 'RUN_FINISHED':
                  setIsRunning(false);
                  if (assistantMessageId) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMessageId && m.role === 'assistant' && m.status?.type === 'running'
                          ? { ...m, status: { type: 'complete', reason: 'unknown' } as const }
                          : m
                      )
                    );
                  } else {
                    // 整个 run 没有任何 assistant 消息返回，给出明确提示。
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: generateId(),
                        role: 'assistant',
                        content: [{ type: 'text', text: '模型未返回任何内容，请检查模型配置、网络或账户余额后重试。' }],
                        status: { type: 'incomplete', reason: 'error', error: 'empty response' },
                      },
                    ]);
                  }
                  activeRunSessionIdRef.current = null;
                  break;

                case 'RUN_ERROR': {
                  setIsRunning(false);
                  activeRunSessionIdRef.current = null;
                  const errorMsg = ev.message || 'Agent 运行出错';
                  const errorMessage: ThreadMessageLike = {
                    id: generateId(),
                    role: 'assistant',
                    content: [{ type: 'text', text: `运行出错：${errorMsg}` }],
                    status: { type: 'incomplete', reason: 'error', error: errorMsg },
                  };
                  setMessages((prev) => [...prev, errorMessage]);
                  break;
                }

                default:
                  break;
              }
            }
          }
        }

        console.log('[useAgUiChat] SSE stream ended, runId=', runId, 'assistantMessageId=', assistantMessageId, 'activeRunSessionIdRef=', activeRunSessionIdRef.current);
        // 兜底：SSE 流已结束但未收到 RUN_FINISHED/RUN_ERROR 时，
        // 强制重置运行状态，避免前端一直显示“思考中”。
        if (activeRunSessionIdRef.current === currentSessionId) {
          setIsRunning(false);
          activeRunSessionIdRef.current = null;
          if (assistantMessageId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId && m.role === 'assistant' && m.status?.type === 'running'
                  ? { ...m, status: { type: 'incomplete', reason: 'error', error: '连接已中断，未收到完整响应' } as const }
                  : m
              )
            );
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: [{ type: 'text', text: '连接已中断，未收到模型响应，请重试。' }],
                status: { type: 'incomplete', reason: 'error', error: 'connection closed' },
              },
            ]);
          }
        }
      } catch (err) {
        console.log('[useAgUiChat] send catch, runId=', runId, 'err=', err);
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.name === 'AbortError') {
          setIsRunning(false);
          activeRunSessionIdRef.current = null;
          if (noEventTimeoutFired) {
            // 超时自动取消：给出明确超时提示，避免用户困惑。
            const timeoutMsg = '模型响应超时，未收到任何输出。请检查网络、模型配置或账户余额后重试。';
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: [{ type: 'text', text: timeoutMsg }],
                status: { type: 'incomplete', reason: 'error', error: 'timeout' },
              },
            ]);
          } else {
            // 用户手动取消：保留用户消息，把未完成的 assistant 消息标记为 incomplete。
            setMessages((prev) =>
              prev.map((m) =>
                m.role === 'assistant' && m.status?.type === 'running'
                  ? { ...m, status: { type: 'incomplete', reason: 'cancelled' } as const }
                  : m
              )
            );
          }
          return;
        }
        console.error('[useAgUiChat] send failed:', error);
        toast.error(`发送失败：${error.message}`);
        setIsRunning(false);
        activeRunSessionIdRef.current = null;
      } finally {
        console.log('[useAgUiChat] send finally, runId=', runId, 'isRunning=', isRunning);
        if (noEventTimer) clearInterval(noEventTimer);
        abortControllerRef.current = null;
      }
    },
    [agentPluginKey, createSession]
  );

  // 使用自定义 ExternalStoreAdapter，直接由本地 state 驱动 assistant-ui runtime。
  const adapter = useMemo(
    () => ({
      messages,
      isRunning,
      convertMessage: (msg: ThreadMessageLike) => msg,
      onNew: async (message: { role: string; content: unknown; metadata?: { custom?: Record<string, unknown> } }) => {
        // assistant-ui composer 触发 onNew 时，我们已经在外部 handleSend 中处理发送。
        // 这里作为兜底：如果收到用户消息且当前未在运行，直接调用 handleSend。
        if (message.role === 'user') {
          const textParts = Array.isArray(message.content)
            ? message.content
                .filter((p) => (p as { type?: string }).type === 'text')
                .map((p) => (p as { text?: string }).text ?? '')
                .join('')
            : String(message.content ?? '');
          const meta = message.metadata?.custom ?? {};
          await handleSend(textParts, {
            quotedCard: meta.quotedCard as SendContext['quotedCard'],
            selectedRepos: meta.selectedRepos as SendContext['selectedRepos'],
          });
        }
      },
      onCancel: async () => cancelRun(),
    }),
    [messages, isRunning, handleSend, cancelRun]
  );

  const shared = useExternalStoreSharedOptions({});
  const runtime = useExternalStoreRuntime({ ...shared, ...adapter });

  return {
    runtime,
    sessionId,
    instanceId,
    wsConnected: !isRunning,
    isRunning,
    messages,
    sendMessage: handleSend,
    switchSession,
    createSession,
    cancelRun,
  };
}
