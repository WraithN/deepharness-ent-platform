import React from 'react';
import { ThreadPrimitive, useThread } from '@assistant-ui/react';
import type { MessageState } from '@assistant-ui/react';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { formatDateLabel, isSameDay } from '@/lib/utils';
import type { PreviewMode } from './LivePreview';

interface ChatThreadProps {
  openDetail: (type: 'req' | 'defect' | 'case', id: string) => void;
  onArtifactClick: () => void;
  onEditMessage?: (text: string) => void;
  onRegenerate?: () => void;
  onFilePreview?: (path: string) => void;
  onProjectPreview?: (path: string, mode: PreviewMode) => void;
}

/**
 * 单条消息渲染：在跨天时插入日期分隔线，然后渲染用户或助手消息。
 * 通过 useThread() 获取消息列表，对比前一条消息的 createdAt 判断是否跨天。
 */
const ChatMessageItem: React.FC<{
  message: MessageState;
  props: ChatThreadProps;
}> = ({ message, props }) => {
  const thread = useThread();
  const messages = thread.messages;
  const prevMessage = message.index > 0 ? messages[message.index - 1] : undefined;

  const showSeparator = !prevMessage || !isSameDay(prevMessage.createdAt, message.createdAt);

  return (
    <>
      {showSeparator && (
        <div className="flex items-center gap-3 py-2 select-none">
          <div className="flex-1 h-px bg-border/40" />
          <span className="text-[11px] text-muted-foreground/70 font-medium whitespace-nowrap">
            {formatDateLabel(message.createdAt)}
          </span>
          <div className="flex-1 h-px bg-border/40" />
        </div>
      )}
      {message.role === 'user' ? (
        <UserMessage
          message={message}
          openDetail={props.openDetail}
          onRepoClick={props.onArtifactClick}
          onEdit={props.onEditMessage}
        />
      ) : (
        <AssistantMessage
          message={message}
          onArtifactClick={props.onArtifactClick}
          onRegenerate={props.onRegenerate}
          onFilePreview={props.onFilePreview}
          onProjectPreview={props.onProjectPreview}
        />
      )}
    </>
  );
};

export const ChatThread: React.FC<ChatThreadProps> = (props) => {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto space-y-4 px-1">
        <ThreadPrimitive.Messages>
          {({ message }) => (
            <ChatMessageItem message={message} props={props} />
          )}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};
