import React from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';

interface ChatThreadProps {
  openDetail: (type: 'req' | 'defect' | 'case', id: string) => void;
  onArtifactClick: () => void;
  onEditMessage?: (text: string) => void;
  onRegenerate?: () => void;
  onFilePreview?: (path: string) => void;
}

export const ChatThread: React.FC<ChatThreadProps> = ({ openDetail, onArtifactClick, onEditMessage, onRegenerate, onFilePreview }) => {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto space-y-6 px-2">
        <ThreadPrimitive.Messages>
          {({ message }) => {
            // message rendering debug log removed
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
            return <AssistantMessage message={message} onArtifactClick={onArtifactClick} onRegenerate={onRegenerate} onFilePreview={onFilePreview} />;
          }}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};
