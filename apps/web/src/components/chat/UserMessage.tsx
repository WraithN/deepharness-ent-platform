import React from 'react';
import { User, ListTodo, Bug, FlaskConical, GitBranch, Pencil, Copy } from 'lucide-react';
import type { MessageState, TextMessagePart } from '@assistant-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

interface UserMessageProps {
  message: MessageState;
  openDetail?: (type: 'req' | 'defect' | 'case', id: string) => void;
  onRepoClick?: () => void;
  onEdit?: (text: string) => void;
}

export const UserMessage: React.FC<UserMessageProps> = ({ message, openDetail, onRepoClick, onEdit }) => {
  const custom = (message.metadata?.custom || {}) as {
    quotedCard?: { type: 'req' | 'defect' | 'case'; id: string; title: string };
    selectedRepos?: { id: string; name: string }[];
  };
  const { quotedCard, selectedRepos } = custom;

  const textPart = Array.isArray(message.content)
    ? (message.content.find(p => p.type === 'text') as TextMessagePart | undefined)
    : undefined;

  return (
    <div className="flex gap-3 justify-end">
      <div className="flex flex-col max-w-[85%] items-end">
        {(quotedCard || (selectedRepos && selectedRepos.length > 0)) && (
          <div className="mb-2 flex flex-wrap gap-2 w-full justify-end">
            {quotedCard && (
              <div
                className="flex items-center gap-2 w-56 px-3 py-2 rounded-xl border border-primary/20 bg-primary/10 cursor-pointer hover:bg-primary/20 transition-colors"
                onClick={() => openDetail?.(quotedCard.type, quotedCard.id)}
              >
                {quotedCard.type === 'req' && <ListTodo className="h-4 w-4 text-primary shrink-0" />}
                {quotedCard.type === 'defect' && <Bug className="h-4 w-4 text-destructive shrink-0" />}
                {quotedCard.type === 'case' && <FlaskConical className="h-4 w-4 text-violet-500 shrink-0" />}
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium text-foreground truncate">{quotedCard.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    引用{quotedCard.type === 'req' ? '需求' : quotedCard.type === 'defect' ? '缺陷' : '用例'} · {quotedCard.id}
                  </p>
                </div>
              </div>
            )}
            {selectedRepos?.map(repo => (
              <div
                key={repo.id}
                className="flex items-center gap-2 w-56 px-3 py-2 rounded-xl border border-primary/20 bg-primary/10 cursor-pointer hover:bg-primary/20 transition-colors"
                onClick={onRepoClick}
              >
                <GitBranch className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium text-foreground truncate">{repo.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">工程代码</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 w-full bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm">
          {textPart?.text && (
            <div className="px-4 py-3 text-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    const codeString = String(children).replace(/\n$/, '');
                    if (!inline && match) {
                      return <pre className="bg-primary-foreground/10 rounded p-2 text-xs overflow-x-auto"><code>{codeString}</code></pre>;
                    }
                    return <code className="bg-primary-foreground/20 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>;
                  },
                }}
              >
                {textPart.text}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {textPart?.text && (
          <div className="flex items-center gap-1 mt-1.5">
            <button
              onClick={() => onEdit?.(textPart.text)}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              title="编辑"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { navigator.clipboard.writeText(textPart.text); toast.success('已复制'); }}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              title="复制"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
        <User className="h-4 w-4 text-primary-foreground" />
      </div>
    </div>
  );
};
