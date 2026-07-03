import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send, Bot, User, Loader2, PanelLeftClose, PanelLeftOpen, Plus, MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { PersonalAssistantDTO, PersonalAssistantSessionDTO, PersonalAssistantMessageDTO } from '@/lib/api-types';

const WELCOME_MESSAGE: PersonalAssistantMessageDTO = {
  id: 'welcome',
  sessionId: '',
  role: 'assistant',
  type: 'text',
  content: '您好！我是虾班智守，很高兴为您服务。请问有什么我可以帮您的？',
  createdAt: new Date().toISOString(),
};

export const PersonalAssistantChat: React.FC = () => {
  const { id } = useParams<{id: string}>();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [assistant, setAssistant] = useState<PersonalAssistantDTO | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [sessions, setSessions] = useState<PersonalAssistantSessionDTO[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PersonalAssistantMessageDTO[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load assistant and sessions
  useEffect(() => {
    if (!id) return;

    setLoading(true);
    Promise.all([
      api.get<PersonalAssistantDTO>(`/v1/personal-assistants/${id}`),
      api.get<PersonalAssistantSessionDTO[]>(`/v1/personal-assistants/${id}/sessions`),
    ])
      .then(([assistantData, sessionList]) => {
        setAssistant(assistantData);
        setSessions(sessionList);
        if (sessionList.length > 0) {
          setActiveSessionId(sessionList[0].id);
        } else {
          return createSession(id, '新会话');
        }
      })
      .catch(() => toast.error('加载智守信息失败'))
      .finally(() => setLoading(false));
  }, [id]);

  // Load messages when active session changes
  useEffect(() => {
    if (!id || !activeSessionId) return;

    api.get<PersonalAssistantMessageDTO[]>(`/v1/personal-assistants/${id}/sessions/${activeSessionId}/messages`)
      .then(data => {
        setMessages(data.length > 0 ? data : [WELCOME_MESSAGE]);
      })
      .catch(() => toast.error('加载会话消息失败'));

    connectWebSocket(id, activeSessionId);

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [id, activeSessionId]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [messages, isTyping]);

  const createSession = async (assistantId: string, title: string) => {
    try {
      const session = await api.post<PersonalAssistantSessionDTO>(`/v1/personal-assistants/${assistantId}/sessions`, { title });
      setSessions(prev => [session, ...prev]);
      setActiveSessionId(session.id);
      return session;
    } catch {
      toast.error('创建会话失败');
      return null;
    }
  };

  const connectWebSocket = (assistantId: string, sessionId: string) => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/v1/personal-assistant/${assistantId}/sessions/${sessionId}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      // WebSocket 已连接，后端会自动重放历史消息。
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'message' && data.payload) {
          const msg: PersonalAssistantMessageDTO = data.payload;
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setIsTyping(false);
        }
      } catch {
        // ignore malformed message
      }
    };

    socket.onerror = () => {
      toast.error('智守连接出错');
    };

    socket.onclose = () => {
      socketRef.current = null;
    };
  };

  const handleNewSession = async () => {
    if (!id) return;
    const session = await createSession(id, '新会话');
    if (session) {
      setInput('');
      toast.success('新会话已创建');
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!id) return;

    try {
      await api.delete(`/v1/personal-assistants/${id}/sessions/${sessionId}`);
      const updated = sessions.filter(s => s.id !== sessionId);
      setSessions(updated);
      if (activeSessionId === sessionId) {
        if (updated.length > 0) {
          setActiveSessionId(updated[0].id);
        } else {
          await createSession(id, '新会话');
        }
      }
      toast.success('会话已删除');
    } catch {
      toast.error('删除会话失败');
    }
  };

  const handleSend = () => {
    if (!input.trim() || !assistant || !activeSessionId || !socketRef.current) return;

    const content = input.trim();
    const userMsg: PersonalAssistantMessageDTO = {
      id: `pending-${Date.now()}`,
      sessionId: activeSessionId,
      role: 'user',
      type: 'text',
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    socketRef.current.send(JSON.stringify({
      event: 'message',
      payload: { type: 'text', content }
    }));
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] w-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!assistant) return <div>找不到该智守</div>;

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] w-full bg-background rounded-none md:rounded-2xl soft-shadow overflow-hidden border-y md:border border-border/50">
      {/* History Sidebar */}
      <div
        className={`flex flex-col border-r border-border/50 bg-muted/10 transition-all duration-300 shrink-0 ${
          isHistoryOpen ? 'w-60 opacity-100' : 'w-0 opacity-0 overflow-hidden'
        }`}
      >
        {/* Sidebar Header */}
        <div className="h-14 border-b border-border/50 flex items-center justify-between px-3 shrink-0">
          <span className="text-sm font-semibold truncate">会话历史</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleNewSession} title="新建会话">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Sessions List */}
        <ScrollArea className="flex-1 p-2">
          <div className="flex flex-col gap-1">
            {sessions.map(session => (
              <button
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors group ${
                  activeSessionId === session.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted/50 text-foreground'
                }`}
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{session.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {formatTime(session.updatedAt)} · {session.messageCount} 条消息
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={(e) => handleDeleteSession(e, session.id)}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </Button>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-16 border-b border-border/50 flex items-center px-4 shrink-0 bg-muted/10 gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/personal-assistant')} title="返回">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden md:flex" onClick={() => setIsHistoryOpen(!isHistoryOpen)} title={isHistoryOpen ? '收起会话' : '展开会话'}>
            {isHistoryOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </Button>
          <div className="h-10 w-10 bg-gradient-to-r from-red-500/20 to-orange-400/20 rounded-full flex items-center justify-center p-1 overflow-hidden shadow-sm relative group">
             <img src="https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_8eeafa02-093e-49b1-b111-0ce2c924d417.jpg" className="w-full h-full object-cover rounded-full animate-[pulse_4s_ease-in-out_infinite]" alt="avatar"/>
             <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary/50 animate-[spin_3s_linear_infinite]" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold truncate">{assistant.name}</h2>
            <p className="text-xs text-muted-foreground">{assistant.role}</p>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-6 max-w-3xl mx-auto">
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary/20 text-primary' : 'bg-red-100 text-red-600 relative overflow-hidden'}`}>
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : (
                    <>
                      <Bot className="w-4 h-4 relative z-10" />
                      <div className="absolute inset-0 bg-red-200/50 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                    </>
                  )}
                </div>
                <div className={`p-3 rounded-2xl ${msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted rounded-tl-sm'}`}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {isTyping && (
               <div className="flex gap-3 max-w-[85%]">
                 <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-red-100 text-red-600 relative overflow-hidden">
                    <Bot className="w-4 h-4 relative z-10" />
                    <div className="absolute inset-0 bg-red-200/50 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
                 </div>
                 <div className="p-4 rounded-2xl bg-muted rounded-tl-sm flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">虾班智守正在思考...</span>
                 </div>
               </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-3 md:p-5 shrink-0 flex justify-center z-10 bg-gradient-to-t from-background via-background/95 to-background/50">
          <div className="w-full relative flex flex-col rounded-3xl border bg-background/80 backdrop-blur-xl soft-shadow overflow-visible">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={`跟 ${assistant.name} 聊点什么...`}
              className="min-h-[80px] w-full resize-none border-0 focus-visible:ring-0 px-5 py-4 text-base shadow-none bg-transparent"
            />
            <div className="flex items-center justify-end px-3 pb-3 mt-auto">
              <Button
                size="sm"
                className="h-9 px-4 rounded-full"
                onClick={handleSend}
                disabled={!input.trim() || isTyping || !activeSessionId}
              >
                <span className="mr-1.5 text-sm">发送</span>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
