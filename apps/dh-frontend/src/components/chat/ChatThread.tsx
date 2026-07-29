import React from 'react';
import { ThreadPrimitive, useThread } from '@assistant-ui/react';
import type { MessageState } from '@assistant-ui/react';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { formatDateLabel, isSameDay } from '@/lib/utils';
import type { PreviewMode } from './LivePreview';
import type { SendContext } from '@/hooks/use-ag-ui-chat';
import type { UserStoryData } from './UserStoryCard';
import type { RequirementBreakdownData, RequirementBreakdownSubmitResult, RequirementItem } from './RequirementBreakdownCard';

interface ChatThreadProps {
  openDetail: (type: 'req' | 'defect' | 'case', id: string) => void;
  onArtifactClick: () => void;
  onEditMessage?: (text: string, context?: SendContext) => void;
  onRegenerate?: () => void;
  onFilePreview?: (path: string) => void;
  onProjectPreview?: (path: string, mode: PreviewMode) => void;
  onUserStoryPreview?: (data: UserStoryData) => void;
  activeUserStoryData?: UserStoryData | null;
  onReqBreakdownPreview?: (data: RequirementBreakdownData) => void;
  activeReqBreakdownData?: RequirementBreakdownData | null;
  onReqBreakdownSubmit?: (items: RequirementItem[]) => Promise<RequirementBreakdownSubmitResult>;
  onPrototypePreview?: (path: string) => void;
  requirementTitle?: string;
  workitemId?: string;
  /** 需求列表，用于原型卡片按标题自动匹配需求 ID。 */
  requirements?: Array<{ id: string; title: string }>;
  runPhase?: 'connecting' | 'thinking' | null;
  agentPluginKey?: string;
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
          runPhase={props.runPhase}
          agentPluginKey={props.agentPluginKey}
          onArtifactClick={props.onArtifactClick}
          onRegenerate={props.onRegenerate}
          onFilePreview={props.onFilePreview}
          onProjectPreview={props.onProjectPreview}
          onUserStoryPreview={props.onUserStoryPreview}
          activeUserStoryData={props.activeUserStoryData}
          onReqBreakdownPreview={props.onReqBreakdownPreview}
          activeReqBreakdownData={props.activeReqBreakdownData}
          onReqBreakdownSubmit={props.onReqBreakdownSubmit}
          onPrototypePreview={props.onPrototypePreview}
          requirementTitle={props.requirementTitle}
          workitemId={props.workitemId}
          requirements={props.requirements}
        />
      )}
    </>
  );
};

export const ChatThread: React.FC<ChatThreadProps> = (props) => {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full min-w-0">
      {/* min-w-0 / max-w-full 防止消息内容（如长 reasoning 文本）把滚动容器横向撑开 */}
      <ThreadPrimitive.Viewport className="flex-1 space-y-4 px-1 min-w-0 max-w-full">
        <ThreadPrimitive.Messages>
          {({ message }) => (
            <ChatMessageItem message={message} props={props} />
          )}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};
