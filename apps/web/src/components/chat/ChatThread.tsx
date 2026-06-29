import React from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';

interface ChatThreadProps {
  openDetail: (type: 'req' | 'defect' | 'case', id: string) => void;
  onArtifactClick: () => void;
  onEditMessage?: (text: string) => void;
  onRegenerate?: () => void;
}

export const ChatThread: React.FC<ChatThreadProps> = ({ openDetail, onArtifactClick, onEditMessage, onRegenerate }) => {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto space-y-6">
        <ThreadPrimitive.Messages>
          {({ message }) => {
            console.log('[ChatThread] rendering message:', message.id, message.role, message.content);
            if (message.role === 'user') {
              return (
                <UserMessage
                  message={message}
                  openDetail={openDetail}
                  onRepoClick={onArtifactClick}
                  onEdit={onEditMessage}
                />
              );
            }
            return <AssistantMessage message={message} onArtifactClick={onArtifactClick} onRegenerate={onRegenerate} />;
          }}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};
