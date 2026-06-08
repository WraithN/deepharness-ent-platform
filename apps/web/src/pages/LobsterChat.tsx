import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Send, Bot, User, Loader2, PanelLeftClose, PanelLeftOpen, Plus, MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const MOCK_LOBSTERS: Record<string, {name: string, role: string}> = {
  'lob-1': { name: '大钳子', role: '虾测试' },
  'lob-2': { name: '小红须', role: '虾开发' },
  'lob-3': { name: '虾产品', role: '虾产品' },
  'lob-4': { name: '虾运营', role: '虾运营' }
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
}

function getStorageKey(lobsterId: string) {
  return `lobster_chat_sessions_${lobsterId}`;
}

function generateTitle(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    return firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '...' : '');
  }
  return '新会话';
}

export const LobsterChat: React.FC = () => {
  const { id } = useParams<{id: string}>();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const lobsterInfo = id ? MOCK_LOBSTERS[id] || { name: '虾班智守', role: '专属助手' } : null;

  // Load sessions from localStorage
  useEffect(() => {
    if (!id) return;
    const raw = localStorage.getItem(getStorageKey(id));
    if (raw) {
      try {
        const parsed: ChatSession[] = JSON.parse(raw);
        setSessions(parsed);
        setActiveSessionId(parsed[0]?.id || null);
      } catch {
        createDefaultSession();
      }
    } else {
      createDefaultSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Save sessions whenever they change
  useEffect(() => {
    if (!id || sessions.length === 0) return;
    localStorage.setItem(getStorageKey(id), JSON.stringify(sessions));
  }, [sessions, id]);

  const activeMessages = useMemo(() => {
    const session = sessions.find(s => s.id === activeSessionId);
    return session?.messages || [];
  }, [sessions, activeSessionId]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      const scrollElement = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [activeMessages, isTyping]);

  function createDefaultSession() {
    const defaultSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: '新会话',
      createdAt: Date.now(),
      messages: [
        { id: '1', role: 'assistant', content: '您好！我是虾班智守，很高兴为您服务。请问有什么我可以帮您的？' }
      ]
    };
    setSessions([defaultSession]);
    setActiveSessionId(defaultSession.id);
  }

  const handleNewSession = () => {
    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: '新会话',
      createdAt: Date.now(),
      messages: [
        { id: '1', role: 'assistant', content: '您好！我是虾班智守，很高兴为您服务。请问有什么我可以帮您的？' }
      ]
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setInput('');
    toast.success('新会话已创建');
  };

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== sessionId);
      if (filtered.length === 0) {
        // If all deleted, create default
        const defaultSession: ChatSession = {
          id: `session-${Date.now()}`,
          title: '新会话',
          createdAt: Date.now(),
          messages: [
            { id: '1', role: 'assistant', content: '您好！我是虾班智守，很高兴为您服务。请问有什么我可以帮您的？' }
          ]
        };
        setActiveSessionId(defaultSession.id);
        return [defaultSession];
      }
      if (activeSessionId === sessionId) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleSend = () => {
    if (!input.trim() || !lobsterInfo || !activeSessionId) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };

    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const updatedMessages = [...s.messages, userMsg];
      // Update title on first user message
      const title = s.title === '新会话' && s.messages.length === 1
        ? generateTitle(updatedMessages)
        : s.title;
      return { ...s, messages: updatedMessages, title };
    }));

    setInput('');
    setIsTyping(true);

    // Mock response
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `我是${lobsterInfo.name}(${lobsterInfo.role})，已经收到您的指令：“${userMsg.content}”。我马上开始处理！`
      };
      setSessions(prev => prev.map(s => {
        if (s.id !== activeSessionId) return s;
        return { ...s, messages: [...s.messages, aiMsg] };
      }));
      setIsTyping(false);
    }, 1500);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  if (!lobsterInfo) return <div>找不到该智手</div>;

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
                    {formatTime(session.createdAt)} · {session.messages.length} 条消息
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/lobster')} title="返回">
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
            <h2 className="font-bold truncate">{lobsterInfo.name}</h2>
            <p className="text-xs text-muted-foreground">{lobsterInfo.role}</p>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-6 max-w-3xl mx-auto">
            {activeMessages.map(msg => (
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
        <div className="p-4 border-t bg-background shrink-0">
          <div className="relative flex items-center max-w-3xl mx-auto">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder={`跟 ${lobsterInfo.name} 聊点什么...`}
              className="pr-12 h-12 rounded-xl bg-muted/50 border-border/50 focus-visible:ring-primary/20"
            />
            <Button
              size="icon"
              className="absolute right-1.5 h-9 w-9 rounded-lg"
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
