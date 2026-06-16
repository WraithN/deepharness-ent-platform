import { useCallback, useEffect, useRef, useState } from 'react';
import { useExternalStoreRuntime, type ThreadMessageLike, type AssistantRuntime } from '@assistant-ui/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ChatMsg, ChatPart } from '@/components/chat/types';

const RUNNING_IDLE_TIMEOUT_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

interface SendContext {
  quotedCard?: ChatMsg['quotedCard'];
  selectedRepos?: ChatMsg['selectedRepos'];
}

function convertPartToContent(part: ChatPart): ThreadMessageLike['content'][number] {
  if (part.type === 'text') {
    return { type: 'text', text: part.content };
  }
  if (part.type === 'thinking') {
    return { type: 'reasoning', text: part.content };
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

  const markRunning = useCallback(() => {
    setIsRunning(true);
    if (runningTimerRef.current) clearTimeout(runningTimerRef.current);
    runningTimerRef.current = setTimeout(() => {
      setIsRunning(false);
    }, RUNNING_IDLE_TIMEOUT_MS);
  }, []);

  const switchSession = useCallback((nextSessionId: string | null) => {
    setMessages([]);
    setSessionId(nextSessionId);
  }, []);

  const sendMessage = useCallback((text: string, context: SendContext = {}) => {
    if (!text.trim() && !context.quotedCard) return;

    const userMsg: ChatMsg = {
      id: Date.now().toString(),
      role: 'user',
      parts: [{ id: Date.now().toString(), type: 'text', content: text || '请帮我处理这个引用的内容' }],
      quotedCard: context.quotedCard,
      selectedRepos: context.selectedRepos,
    };

    setMessages(prev => [...prev, userMsg]);
    markRunning();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        event: 'message',
        payload: { type: 'text', content: userMsg.parts[0]?.content || '' },
      }));
    } else {
      toast.error('WebSocket 未连接，请刷新页面重试');
    }
  }, [markRunning]);

  // 创建会话并连接 WebSocket（带自动重连）
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const wsMessagesRef = messages;

    function connectWebSocket(sid: string) {
      if (cancelled) return;
      const wsUrl = `ws://${window.location.host}/ws/v1/sessions/${sid}`;
      console.log('[Chat] Connecting WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Chat] WebSocket connected');
        reconnectAttempts = 0;
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[Chat] WS message received:', data);
          const evType = data.Type || data.type;
          const payload = data.Payload || data.payload;

          if (evType === 'message' && payload) {
            const msg = payload;
            const partId = msg.Metadata?.agentPartID || msg.metadata?.agentPartID;
            const msgId = msg.ID || msg.id || Date.now().toString();
            const msgRole = msg.Role || msg.role || 'assistant';
            const msgContent = msg.Content || msg.content || '';
            const msgType = msg.Type || msg.type || 'text';
            const artifact = msg.Metadata?.artifact || msg.metadata?.artifact;
            const messageID = msg.Metadata?.messageID || msg.metadata?.messageID;
            const fullMetadata = msg.Metadata || msg.metadata || {};

            if (msgRole === 'user') {
              setMessages(prev => [...prev, {
                id: msgId,
                role: 'user',
                parts: [{ id: msgId, type: msgType, content: msgContent, artifact, metadata: fullMetadata }],
                messageID,
              }]);
              return;
            }

            markRunning();

            setMessages(prev => {
              if (messageID) {
                const existingIndex = prev.findIndex(m => m.messageID === messageID && m.role === 'assistant');
                if (existingIndex >= 0) {
                  const next = [...prev];
                  const existingParts = next[existingIndex].parts;
                  const partIndex = existingParts.findIndex(p => p.metadata?.agentPartID === partId);
                  if (partIndex >= 0) {
                    existingParts[partIndex] = { ...existingParts[partIndex], content: msgContent, artifact, metadata: fullMetadata };
                  } else {
                    existingParts.push({ id: msgId, type: msgType, content: msgContent, artifact, metadata: fullMetadata });
                  }
                  return next;
                }
              }
              const lastIndex = prev.length - 1;
              if (lastIndex >= 0 && prev[lastIndex].role === 'assistant' && !prev[lastIndex].messageID) {
                const next = [...prev];
                const existingParts = next[lastIndex].parts;
                const partIndex = existingParts.findIndex(p => p.metadata?.agentPartID === partId);
                if (partIndex >= 0) {
                  existingParts[partIndex] = { ...existingParts[partIndex], content: msgContent, artifact, metadata: fullMetadata };
                } else {
                  existingParts.push({ id: msgId, type: msgType, content: msgContent, artifact, metadata: fullMetadata });
                }
                return next;
              }
              return [...prev, {
                id: msgId,
                role: 'assistant',
                parts: [{ id: msgId, type: msgType, content: msgContent, artifact, metadata: fullMetadata }],
                messageID,
              }];
            });
          } else if (evType === 'error') {
            const errPayload = data.Error || data.error;
            toast.error(errPayload?.Message || errPayload?.message || payload?.content || '服务异常');
            setIsRunning(false);
          }
        } catch (e) {
          console.error('[Chat] Failed to parse WS message:', e);
        }
      };

      ws.onclose = (event) => {
        console.log('[Chat] WebSocket closed. Code:', event.code, 'Reason:', event.reason);
        setWsConnected(false);
        wsRef.current = null;
        if (!cancelled && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(1000 * reconnectAttempts, 5000);
          console.log(`[Chat] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
          reconnectTimer = setTimeout(() => connectWebSocket(sid), delay);
        }
      };

      ws.onerror = (err) => {
        console.error('[Chat] WebSocket error:', err);
        setWsConnected(false);
      };
    }

    if (!sessionId) {
      const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
      api.post<{ data: { sessionId: string; wsUrl: string } }>('/v1/sessions', {
        workspaceId,
        agentId: selectedAgentId || 'agent-default',
        agentType: 'opencode',
        model: 'gpt-4o',
        projectId: 'p1',
      })
        .then(res => {
          if (cancelled) return;
          const sid = res.data.sessionId;
          console.log('[Chat] Session created:', sid);
          setSessionId(sid);
        })
        .catch(err => {
          console.error('[Chat] Failed to create session:', err);
          toast.error('创建会话失败');
        });
    } else {
      connectWebSocket(sessionId);
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
  }, [sessionId, selectedAgentId]);

  const runtime = useExternalStoreRuntime<ChatMsg>({
    messages,
    convertMessage,
    isRunning,
    isSendDisabled: !wsConnected,
    onNew: async () => {
      // 发送逻辑由 Chat.tsx 直接调用 sendMessage 处理，这里不重复触发
    },
  });

  return { runtime, sessionId, wsConnected, isRunning, messages, sendMessage, switchSession };
}
