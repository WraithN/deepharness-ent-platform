import React from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';

interface ChatThreadProps {
  openDetail: (type: 'req' | 'defect' | 'case', id: string) => void;
  onArtifactClick: () => void;
}

export const ChatThread: React.FC<ChatThreadProps> = ({ openDetail, onArtifactClick }) => {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full space-y-6">
      <ThreadPrimitive.Messages>
        {({ message }) => {
          if (message.role === 'user') {
            return (
              <UserMessage
                message={message}
                openDetail={openDetail}
                onRepoClick={onArtifactClick}
              />
            );
          }
          return <AssistantMessage message={message} onArtifactClick={onArtifactClick} />;
        }}
      </ThreadPrimitive.Messages>
    </ThreadPrimitive.Root>
  );
};
