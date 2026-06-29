import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useExternalStoreRuntime, type ThreadMessageLike, type AssistantRuntime } from '@assistant-ui/react';
import { toast } from 'sonner';
import { api, type ApiResponse } from '@/lib/api';
import type { ChatMsg, ChatPart } from '@/components/chat/types';

const RUNNING_IDLE_TIMEOUT_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface SendContext {
  quotedCard?: ChatMsg['quotedCard'];
  selectedRepos?: ChatMsg['selectedRepos'];
}

interface CreateSessionResponse {
  sessionId: string;
  gatewaydUrl: string;
  gatewaydWsUrl: string;
  agentId: string;
}

interface GatewaydEvent {
  event_type: string;
  instance_id?: string;
  payload: {
    conversation_id?: string;
    sessionID?: string;
    text?: string;
    content?: string;
    type?: string;
    toolName?: string;
    message?: string;
  };
}

function convertPartToContent(part: ChatPart): ThreadMessageLike['content'][number] {
  if (part.type === 'text') {
    return { type: 'text', text: part.content };
  }
  if (part.type === 'thinking') {
    return { type: 'reasoning', text: part.content || '思考中...' };
  }
  return { type: 'data', name: part.type, data: part };
}

function convertMessage(msg: ChatMsg): ThreadMessageLike {
  const content: ThreadMessageLike['content'] = msg.parts.map(convertPartToContent) as unknown as ThreadMessageLike['content'];
  return {
    id: msg.id,
    role: msg.role,
    content,
    metadata: {
      custom: {
        quotedCard: msg.quotedCard,
        selectedRepos: msg.selectedRepos,
      },
    },
  };
}

function updateAssistantMessageAccumulated(
  messages: ChatMsg[],
  messageID: string | undefined,
  partId: string,
  newPart: ChatPart,
): ChatMsg[] {
  if (messageID) {
    const existingIndex = messages.findIndex(m => m.messageID === messageID && m.role === 'assistant');
    if (existingIndex >= 0) {
      const next = [...messages];
      const msg = next[existingIndex];
      const partIndex = msg.parts.findIndex(p => p.id === partId);
      if (partIndex >= 0) {
        // Replace existing part (text accumulation)
        const newParts = [...msg.parts];
        newParts[partIndex] = newPart;
        next[existingIndex] = { ...msg, parts: newParts };
      } else {
        // Append new part (thinking/tool events)
        next[existingIndex] = { ...msg, parts: [...msg.parts, newPart] };
      }
      return next;
    }
  }

  // No existing message for this messageID; check last assistant message
  const lastIndex = messages.length - 1;
  if (lastIndex >= 0 && messages[lastIndex].role === 'assistant' && !messages[lastIndex].messageID) {
    const next = [...messages];
    const last = next[lastIndex];
    // Replace empty thinking placeholder with first real part
    const emptyThinkingIdx = last.parts.findIndex(p => p.type === 'thinking' && p.content === '' && !p.metadata?.agentPartID);
    if (emptyThinkingIdx >= 0) {
      const newParts = [...last.parts];
      newParts[emptyThinkingIdx] = newPart;
      next[lastIndex] = { ...last, parts: newParts, messageID };
    } else {
      next[lastIndex] = { ...last, parts: [...last.parts, newPart], messageID };
    }
    return next;
  }

  // Create new assistant message
  return [...messages, {
    id: newPart.id,
    role: 'assistant' as const,
    parts: [newPart],
    messageID,
  }];
}

function genId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
}

interface UseChatRuntimeOptions {
  selectedAgentId?: string;
}

interface UseChatRuntimeReturn {
  runtime: AssistantRuntime;
  sessionId: string | null;
  wsConnected: boolean;
  isRunning: boolean;
  messages: ChatMsg[];
  sendMessage: (text: string, context?: SendContext) => void;
  switchSession: (nextSessionId: string | null) => void;
}

export function useChatRuntime(options: UseChatRuntimeOptions = {}): UseChatRuntimeReturn {
  const { selectedAgentId } = options;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const runningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didCreateSessionRef = useRef(false);
  const pendingSendRef = useRef<{ text: string; context: SendContext } | null>(null);

  // Gatewayd connection info (set from session creation response)
  const gatewaydUrlRef = useRef<string>('');
  const gatewaydWsUrlRef = useRef<string>('');
  const agentIdRef = useRef<string>('');

  // Tracks the current assistant response messageID (for grouping events)
  const currentMessageIDRef = useRef<string | null>(null);
  // Accumulates text across agent.token events into a single ChatPart
  const accumulatedTextRef = useRef<string>('');
  // Ref copy of sessionId for use in closures
  const sessionIdRef = useRef<string | null>(null);

  // Keep sessionIdRef in sync
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const removeEmptyPlaceholder = useCallback(() => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && last.parts.length === 1 && last.parts[0].type === 'thinking' && last.parts[0].content === '') {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  console.log('[ChatRuntime] render: sessionId=%s, selectedAgentId=%s, messages=%d', sessionId, selectedAgentId, messages.length);

  const markRunning = useCallback(() => {
    setIsRunning(true);
    if (runningTimerRef.current) clearTimeout(runningTimerRef.current);
    runningTimerRef.current = setTimeout(() => {
      setIsRunning(false);
    }, RUNNING_IDLE_TIMEOUT_MS);
  }, []);

  const switchSession = useCallback((nextSessionId: string | null) => {
    setMessages([]);
    if (nextSessionId === null) {
      didCreateSessionRef.current = false;
    }
    setSessionId(nextSessionId);
  }, []);

  // ---- Gatewayd event handlers ----

  function handleTokenEvent(text: string) {
    if (!currentMessageIDRef.current) {
      currentMessageIDRef.current = 'msg-' + genId();
      accumulatedTextRef.current = '';
    }

    accumulatedTextRef.current += text;

    const partId = 'text-' + currentMessageIDRef.current;
    const newPart: ChatPart = {
      id: partId,
      type: 'text',
      content: accumulatedTextRef.current,
    };

    markRunning();

    flushSync(() => {
      setMessages(prev => updateAssistantMessageAccumulated(
        prev,
        currentMessageIDRef.current!,
        partId,
        newPart,
      ));
    });
  }

  function handleThinkingEvent(payload: { content?: string; type?: string; toolName?: string }) {
    if (!currentMessageIDRef.current) {
      currentMessageIDRef.current = 'msg-' + genId();
    }

    let partType = 'thinking';
    if (payload.type === 'tool_use') partType = 'tool_use';
    else if (payload.type === 'tool_result') partType = 'tool_result';

    const partId = partType + '-' + genId();
    const newPart: ChatPart = {
      id: partId,
      type: partType,
      content: payload.content || '',
      metadata: payload.toolName ? { name: payload.toolName } : undefined,
    };

    markRunning();

    flushSync(() => {
      setMessages(prev => updateAssistantMessageAccumulated(
        prev,
        currentMessageIDRef.current!,
        partId,
        newPart,
      ));
    });
  }

  function handleDoneEvent() {
    currentMessageIDRef.current = null;
    accumulatedTextRef.current = '';
    setIsRunning(false);
    if (runningTimerRef.current) clearTimeout(runningTimerRef.current);
  }

  function handleErrorEvent(message: string) {
    currentMessageIDRef.current = null;
    accumulatedTextRef.current = '';
    setIsRunning(false);
    toast.error(message || 'Agent error');
    if (runningTimerRef.current) clearTimeout(runningTimerRef.current);
  }

  function handleGatewaydEvent(gatewaydEvent: GatewaydEvent) {
    const { event_type, payload } = gatewaydEvent;
    if (!payload) return;

    // Filter by conversation_id to scope events to this session
    const convID = payload.conversation_id || payload.sessionID || '';
    if (convID !== sessionIdRef.current) return;

    switch (event_type) {
      case 'agent.token':
        handleTokenEvent(payload.text || '');
        break;
      case 'agent.thinking':
        handleThinkingEvent(payload);
        break;
      case 'agent.done':
        handleDoneEvent();
        break;
      case 'agent.error':
        handleErrorEvent(payload.message || 'Unknown agent error');
        break;
      default:
        break;
    }
  }

  // ---- Send message via HTTP POST to gatewayd ----

  async function sendMessageViaHttp(text: string) {
    const url = gatewaydUrlRef.current + '/agents/' + agentIdRef.current + '/message';
    const curSessionId = sessionIdRef.current;
    if (!url || !curSessionId) {
      console.error('[ChatRuntime] Cannot send: missing gatewayd URL or session ID');
      toast.error('Failed to send message: connection not ready');
      setIsRunning(false);
      removeEmptyPlaceholder();
      return;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: curSessionId,
          message: text,
        }),
      });
      if (!res.ok) {
        throw new Error('gatewayd returned ' + res.status);
      }
    } catch (err) {
      console.error('[ChatRuntime] Failed to send message via HTTP:', err);
      toast.error('Failed to send message');
      setIsRunning(false);
      removeEmptyPlaceholder();
    }
  }

  // ---- Public API ----

  const sendMessage = useCallback((text: string, context: SendContext = {}) => {
    if (!text.trim() && !context.quotedCard) return;

    const now = Date.now();
    const userMsg: ChatMsg = {
      id: now.toString(),
      role: 'user',
      parts: [{ id: now.toString(), type: 'text', content: text || '请帮我处理这个引用的内容' }],
      quotedCard: context.quotedCard,
      selectedRepos: context.selectedRepos,
    };

    const thinkingPlaceholder: ChatMsg = {
      id: 'thinking-' + now.toString(),
      role: 'assistant',
      parts: [{ id: 'thinking-part-' + now.toString(), type: 'thinking', content: '' }],
    };

    setMessages(prev => [...prev, userMsg, thinkingPlaceholder]);
    markRunning();

    // Reset messageID tracking for new user message
    currentMessageIDRef.current = null;
    accumulatedTextRef.current = '';

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && gatewaydUrlRef.current && agentIdRef.current) {
      sendMessageViaHttp(text);
    } else {
      pendingSendRef.current = { text, context };
      toast.info('正在连接会话，连接成功后自动发送');
    }
  }, [markRunning]);

  // ---- Session creation and WebSocket connection ----

  useEffect(() => {
    console.log('[ChatRuntime:effect] ENTER sessionId=%s didCreate=%s selectedAgentId=%s', sessionId, didCreateSessionRef.current, selectedAgentId);
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;

    function connectWebSocket(wsUrl: string) {
      console.log('[ChatRuntime] Connecting to gatewayd WS:', wsUrl);
      if (cancelled) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        console.log('[ChatRuntime] Gatewayd WS connected');
        reconnectAttempts = 0;
        setWsConnected(true);

        // Send any pending message
        const pending = pendingSendRef.current;
        if (pending && gatewaydUrlRef.current && agentIdRef.current) {
          sendMessageViaHttp(pending.text);
          pendingSendRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const gatewaydEvent = JSON.parse(event.data) as GatewaydEvent;
          handleGatewaydEvent(gatewaydEvent);
        } catch (e) {
          console.error('[ChatRuntime] Failed to parse gatewayd event:', e);
        }
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) return;
        console.log('[ChatRuntime] Gatewayd WS closed. Code:', event.code, 'Reason:', event.reason);
        setWsConnected(false);
        wsRef.current = null;
        const isNormalClose = event.code === 1000;
        if (!cancelled && !isNormalClose && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(1000 * reconnectAttempts, 5000);
          console.log('[ChatRuntime] Reconnecting in ' + delay + 'ms (attempt ' + reconnectAttempts + ')');
          reconnectTimer = setTimeout(() => connectWebSocket(wsUrl), delay);
        } else {
          removeEmptyPlaceholder();
        }
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        console.error('[ChatRuntime] Gatewayd WS error');
        setWsConnected(false);
        removeEmptyPlaceholder();
      };
    }

    if (!sessionId) {
      if (didCreateSessionRef.current) {
        console.log('[ChatRuntime:effect] SKIP create (already did)');
        return;
      }
      didCreateSessionRef.current = true;

      const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
      console.log('[ChatRuntime:effect] POST /v1/sessions workspaceId=%s agentId=%s', workspaceId, selectedAgentId || 'agent-default');
      api.post<ApiResponse<CreateSessionResponse>>('/v1/sessions', {
        workspaceId,
        agentId: selectedAgentId || 'agent-default',
        agentType: 'opencode',
        model: 'gpt-4o',
        projectId: 'p1',
      })
        .then(res => {
          if (cancelled) return;
          const { sessionId: sid, gatewaydUrl, gatewaydWsUrl, agentId } = res.data;
          console.log('[ChatRuntime] Session created:', sid, 'gatewayd:', gatewaydUrl, 'agent:', agentId);
          gatewaydUrlRef.current = gatewaydUrl || '';
          gatewaydWsUrlRef.current = gatewaydWsUrl || '';
          agentIdRef.current = agentId || '';
          setSessionId(sid);
        })
        .catch(err => {
          console.error('[ChatRuntime] Failed to create session:', err);
          toast.error('创建会话失败');
          removeEmptyPlaceholder();
        });
    } else {
      if (gatewaydWsUrlRef.current) {
        connectWebSocket(gatewaydWsUrlRef.current);
      } else {
        console.warn('[ChatRuntime] No gatewayd WS URL available, cannot connect');
      }
    }

    return () => {
      cancelled = true;
      if (runningTimerRef.current) clearTimeout(runningTimerRef.current);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const runtime = useExternalStoreRuntime<ChatMsg>({
    messages,
    convertMessage,
    isRunning,
    isSendDisabled: !wsConnected,
    onNew: async () => {
      // Send logic handled by Chat.tsx directly calling sendMessage
    },
  });

  return { runtime, sessionId, wsConnected, isRunning, messages, sendMessage, switchSession };
}
