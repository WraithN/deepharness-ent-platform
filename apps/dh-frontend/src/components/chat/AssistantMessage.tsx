import React, { useState, useEffect } from 'react';
import { Bot, Box, FileCode2, ListTodo, CheckCircle2, Wrench, X, Copy, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { MessageState, TextMessagePart, ReasoningMessagePart, DataMessagePart, ToolCallMessagePart } from '@assistant-ui/react';
import { useThread } from '@assistant-ui/react';
import { MarkdownView } from './MarkdownView';
import { FileAttachmentCard } from './FileAttachmentCard';
import { ProjectCard } from './ProjectCard';
import { DiffView } from './DiffView';
import type { PreviewMode } from './LivePreview';
import { TaskListView, type TaskItemData } from './TaskListView';
import { ToolCallView } from './ToolCallView';
import { ThinkingCard } from './ThinkingCard';
import { PrototypeCard } from './PrototypeCard';
import { UserStoryCard, parseUserStoryFromText } from './UserStoryCard';
import type { UserStoryData } from './UserStoryCard';
import { RequirementBreakdownCard, useRequirementBreakdownData } from './RequirementBreakdownCard';
import type { RequirementBreakdownData, RequirementBreakdownSubmitResult, RequirementItem } from './RequirementBreakdownCard';
import { ReviewReportCard, parseReviewReportFromText } from './ReviewReportCard';
import type { ReviewReportData } from './ReviewReportCard';
import type { ChatPart } from './types';
import { toast } from 'sonner';
import { cn, formatTime, isProductSpaceFile } from '@/lib/utils';

const CARD_MARKER_REGEX = /\[\[CARD:([^\]]+)\]\]/g;
const REQ_NAME_MARKER_REGEX = /\[\[REQ_NAME:([^\]]+)\]\]/g;

const TEXT_COLLAPSE_LINE_THRESHOLD = 12;
const TEXT_COLLAPSE_CHAR_THRESHOLD = 800;
const PROTOTYPE_DIR_SEGMENT = '/products/prototypes/';
const REQ_BREAKDOWN_JSON_REGEX = /\[\[REQ_BREAKDOWN_START\]\][\s\S]*?\[\[REQ_BREAKDOWN_END\]\]/g;
// 匹配需求拆分相关文件：路径中包含 req-breakdown 且以 .md/.json 结尾。
// 支持 xxx/req-breakdown/foo-req-breakdown.md、xxx-req-breakdown.json 等命名。
const REQ_BREAKDOWN_FILE_REGEX = /req-breakdown.*\.(md|json)$/i;
const REQ_BREAKDOWN_JSON_FILE_REGEX = /req-breakdown.*\.json$/i;

// 工具调用名称到展示文案的映射，用于折叠卡片和状态栏统一显示。
const TOOL_DISPLAY_NAME_MAP: Record<string, string> = {
  write: '写入文件',
  file_write: '写入文件',
  read: '读取文件',
  file_read: '读取文件',
  bash: '执行命令',
  terminal: '执行命令',
  execute: '执行命令',
  search: '搜索',
  web_search: '搜索',
};

function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAME_MAP[toolName.toLowerCase()] ?? toolName;
}

function extractCardTypes(text: string): string[] {
  const types: string[] = [];
  for (const match of text.matchAll(CARD_MARKER_REGEX)) {
    const type = match[1]?.trim();
    if (type && !types.includes(type)) {
      types.push(type);
    }
  }
  return types;
}

interface AssistantMessageProps {
  message: MessageState;
  runPhase?: 'connecting' | 'thinking' | null;
  agentPluginKey?: string;
  onArtifactClick?: () => void;
  onRegenerate?: () => void;
  onFilePreview?: (path: string) => void;
  onProjectPreview?: (path: string, mode: PreviewMode) => void;
  onUserStoryPreview?: (data: UserStoryData) => void;
  activeUserStoryData?: UserStoryData | null;
  onReqBreakdownPreview?: (data: RequirementBreakdownData) => void;
  activeReqBreakdownData?: RequirementBreakdownData | null;
  onReqBreakdownSubmit?: (items: RequirementItem[], options?: { jsonFilePath?: string }) => Promise<RequirementBreakdownSubmitResult>;
  onPrototypePreview?: (path: string) => void;
  /** 评审报告修复按钮回调：父组件用于设置 /code 指令并发送。 */
  onReviewFix?: (reportPath: string, projectName: string) => void;
  requirementTitle?: string;
  workitemId?: string;
  /** 需求列表，用于原型卡片按消息内的需求标题匹配真实需求 ID。 */
  requirements?: Array<{ id: string; title: string }>;
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({ message, runPhase, agentPluginKey, onArtifactClick, onRegenerate, onFilePreview, onProjectPreview, onUserStoryPreview, activeUserStoryData, onReqBreakdownPreview, activeReqBreakdownData, onReqBreakdownSubmit, onPrototypePreview, onReviewFix, requirementTitle, workitemId, requirements }) => {
  const thread = useThread();
  const content = Array.isArray(message.content) ? message.content : [];
  const [textExpanded, setTextExpanded] = useState(false);

  const isUserStoryActive = (data: UserStoryData) =>
    activeUserStoryData != null &&
    activeUserStoryData.title === data.title &&
    activeUserStoryData.total === data.total &&
    (activeUserStoryData.stories[0]?.story === data.stories[0]?.story);

  const isReqBreakdownActive = (data: RequirementBreakdownData | null) =>
    activeReqBreakdownData != null &&
    data != null &&
    activeReqBreakdownData.title === data.title &&
    activeReqBreakdownData.total === data.total &&
    (activeReqBreakdownData.items[0]?.title === data.items[0]?.title);

  let artifact: { type: string; title: string } | undefined;
  const legacyDataParts: { name: string; data: ChatPart }[] = [];

  for (const part of content) {
    if (part.type === 'data') {
      const dataPart = part as DataMessagePart;
      if (dataPart.name === 'artifact') {
        artifact = dataPart.data as { type: string; title: string };
      } else {
        legacyDataParts.push({ name: dataPart.name, data: dataPart.data as ChatPart });
      }
    }
  }

  if (!artifact) {
    for (const part of content) {
      if (part.type === 'data') {
        const original = (part as DataMessagePart).data as ChatPart;
        if (original?.artifact) {
          artifact = original.artifact;
          break;
        }
      }
    }
  }

  // 把消息内容拆分为：给用户的最终输出、思考/工具过程。
  // reasoning 和 tool-call 归入思考过程，可折叠查看。
  // 对于部分模型把内部英文推理流作为 text 部件下发的情况，使用启发式规则将其识别为 reasoning，
  // 避免思考过程与用户输出混排。
  const outputParts: TextMessagePart[] = [];
  const thinkingItems: (
    | { type: 'reasoning'; text: string }
    | { type: 'text'; text: string }
    | { type: 'tool-call'; part: ToolCallMessagePart }
  )[] = [];

  // 判断文本片段是否更像模型内部推理而非给用户的最终输出：
  // 1. 不能是明显的中文回复（中文字符占比 > 30% 视为用户输出）；
  // 2. 需要当前消息存在工具调用，说明是 agent 运行中的中间过程；
  // 3. 包含常见的英文推理短语（进度、自说自话、验证等）。
  //
  // 该启发式只作为兜底：当 agent 已经正确输出独立的 reasoning 部件时（如 Claude 和修复后的
  // OpenCode/Codex），直接信任事件类型，不再靠内容猜；仅在 Codex 模式或整条消息都没有
  // reasoning 部件时才启用，避免把正常英文输出误判为思考过程。
  const hasRealReasoningParts = content.some((p) => p.type === 'reasoning');
  const hasToolCallParts = content.some((p) => p.type === 'tool-call');
  const enableReasoningHeuristic = agentPluginKey === 'codex' || !hasRealReasoningParts;
  const REASONING_PHRASES = [
    /\b(part \d+ done|good progress|now r-\d|now let me|let me|i need to|i will|i should|i think|ok|okay|first|then|next|finally|wait|actually|hmm|i see|i got it)\b/i,
    /\b(verify|check|written successfully|output the final|required markers|the file has been|i need to output)\b/i,
  ];
  const isLikelyReasoningText = (text: string): boolean => {
    if (!enableReasoningHeuristic) return false;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (chineseChars > 0 && chineseChars / text.length > 0.3) return false;
    if (!hasToolCallParts) return false;
    return REASONING_PHRASES.some((regex) => regex.test(text));
  };

  // 从所有 text 部件中提取 [[FILE:...]] / [[PROJECT:...]] 标记，避免内部推理文本被折叠后丢失附件路径。
  const FILE_MARKER_REGEX = /\[\[FILE:([^\]]+)\]\]/g;
  const PROJECT_MARKER_REGEX = /\[\[PROJECT:([^\]]+)\]\]/g;

  const UNRESOLVED_PLACEHOLDER_PATTERNS = [
    '绝对路径',
    '需求名称',
    '调研主题',
    '工程名',
    '功能名称',
    '功能名',
    '分析主题',
    '用户故事',
  ] as const;

  function hasUnresolvedPlaceholders(filePath: string): boolean {
    return UNRESOLVED_PLACEHOLDER_PATTERNS.some((pattern) => filePath.includes(pattern));
  }

  const fileAttachments: string[] = [];
  const projectPaths: string[] = [];
  for (const part of content) {
    if (part.type !== 'text') continue;
    const textPart = part as TextMessagePart;
    if (!textPart.text) continue;
    for (const match of textPart.text.matchAll(FILE_MARKER_REGEX)) {
      const path = match[1]?.trim();
      if (path && !fileAttachments.includes(path) && !hasUnresolvedPlaceholders(path)) {
        fileAttachments.push(path);
      }
    }
    for (const match of textPart.text.matchAll(PROJECT_MARKER_REGEX)) {
      const path = match[1]?.trim();
      if (path && !projectPaths.includes(path) && !hasUnresolvedPlaceholders(path)) {
        projectPaths.push(path);
      }
    }
  }

  for (let i = 0; i < content.length; i++) {
    const part = content[i];
    if (part.type === 'text') {
      const textPart = part as TextMessagePart;
      if (!textPart.text) continue;
      if (isLikelyReasoningText(textPart.text)) {
        thinkingItems.push({ type: 'text', text: textPart.text });
      } else {
        outputParts.push(textPart);
      }
    } else if (part.type === 'reasoning') {
      const text = (part as ReasoningMessagePart).text;
      if (text) thinkingItems.push({ type: 'reasoning', text });
    } else if (part.type === 'tool-call') {
      thinkingItems.push({ type: 'tool-call', part: part as ToolCallMessagePart });
    }
  }

  const hasThinkingContent = thinkingItems.length > 0;
  const hasOutputText = outputParts.some((p) => Boolean(p.text));

  // 计算思考次数和工具调用统计，用于折叠卡片标题展示。
  // 将 reasoning 部件和识别为推理的 text 部件都计入思考次数。
  const thinkingCount = thinkingItems.filter((item) => item.type === 'reasoning' || item.type === 'text').length;
  const toolStats = thinkingItems.reduce<Record<string, number>>((acc, item) => {
    if (item.type !== 'tool-call') return acc;
    const name = item.part.toolName || '工具调用';
    const displayName = getToolDisplayName(name);
    acc[displayName] = (acc[displayName] || 0) + 1;
    return acc;
  }, {});

  // 当前仍在执行中（未返回 result）的工具调用，用于底部状态栏实时展示。
  const pendingToolCalls = thinkingItems.filter(
    (item): item is { type: 'tool-call'; part: ToolCallMessagePart } =>
      item.type === 'tool-call' && item.part.result === undefined
  );
  const pendingToolCount = pendingToolCalls.length;
  const displayPendingToolName = pendingToolCalls[0]?.part.toolName
    ? getToolDisplayName(pendingToolCalls[0].part.toolName)
    : '工具';

  // 检测 reasoning 部件是否全部标记为 done（已收到 THINKING_END 事件）。
  const reasoningParts = content.filter((p): p is ReasoningMessagePart & { done?: boolean } => p.type === 'reasoning');
  const reasoningAllDone = reasoningParts.length > 0 && reasoningParts.every((p) => p.done);

  // 当前助手消息是否没有任何可见内容（空文本、空思考、空工具、空 data）且仍在生成中。
  // 这种情况下在气泡内展示"思考中..."占位动画，避免 TTFT 期间页面看起来没有响应。
  // 用全局 thread 的运行状态兜底，避免 run 已结束但某条消息状态没更新导致一直显示"思考中"。
  const isMessageRunning = message.status?.type === 'running';
  const isRunning = isMessageRunning && thread.isRunning;

  // 思考是否仍在进行：只有当最终给用户的 TEXT 输出出现（或 run 已结束）时才认为思考完毕。
  // reasoningAllDone 只表示模型思考阶段结束，但后续可能还有工具调用、再次思考，
  // 只有真正输出 TEXT 给用户才算"思考完毕"。
  const isThinkingRunning = isRunning && !hasOutputText;
  const hasVisibleContent = content.some((part) => {
    if (part.type === 'text') return Boolean((part as TextMessagePart).text);
    if (part.type === 'reasoning') return Boolean((part as ReasoningMessagePart).text);
    if (part.type === 'tool-call') return true;
    if (part.type === 'data') return true;
    return false;
  });
  const showThinkingPlaceholder = isRunning && !hasVisibleContent;

  const textContent = outputParts
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n');

  // 用于检测 [[CARD:...]] 标记的完整文本，包含识别为推理的 text 部件，
  // 避免模型把标记放在内部推理流中时卡片无法被触发。
  const allTextContent = content
    .filter((p) => p.type === 'text')
    .map((p) => (p as TextMessagePart).text)
    .filter(Boolean)
    .join('\n');

  // 解析 [[REQ_NAME:需求名]] 标记，优先作为原型卡片的需求名展示；
  // 若消息内无该标记则回退到父组件传入的 requirementTitle（如引用需求卡片的标题）。
  const reqNameMatch = allTextContent.match(REQ_NAME_MARKER_REGEX);
  const parsedRequirementTitle = reqNameMatch?.[1]?.trim();
  const prototypeRequirementTitle = requirementTitle || parsedRequirementTitle;

  // 按消息内的需求标题匹配真实需求 ID；父组件已传入的 workitemId 仍作为最高优先级。
  // 这样即使聊天中没有显式引用需求卡片，只要 AI 回复或原型卡片标题命中已有需求，
  // 点击采纳时也能关联到该需求并生成设计版本。
  const resolvedWorkitemId = React.useMemo(() => {
    if (workitemId) return workitemId;
    if (!requirements || !prototypeRequirementTitle) return undefined;
    const normalized = prototypeRequirementTitle.trim().toLowerCase();
    return requirements.find(r => r.title.trim().toLowerCase() === normalized)?.id;
  }, [workitemId, requirements, prototypeRequirementTitle]);

  const textLineCount = textContent.split('\n').length;
  const shouldCollapseText = textLineCount > TEXT_COLLAPSE_LINE_THRESHOLD || textContent.length > TEXT_COLLAPSE_CHAR_THRESHOLD;
  const isStreaming = isRunning || isThinkingRunning;

  // 将 /proto-make 等指令生成的原型工程路径按一级产品目录去重，
  // 并过滤掉属于该原型工程下的普通 PROJECT/FILE 标记，避免一次生成出现多个卡片。
  function getPrototypeRootPath(path: string): string | null {
    const parts = path.split('/');
    const productsIdx = parts.indexOf('products');
    if (productsIdx < 0 || parts[productsIdx + 1] !== 'prototypes' || !parts[productsIdx + 2]) {
      return null;
    }
    return parts.slice(0, productsIdx + 3).join('/');
  }

  const prototypePaths = projectPaths.filter(p => p.includes(PROTOTYPE_DIR_SEGMENT));
  const prototypeRootMap = new Map<string, string>();
  for (const p of prototypePaths) {
    const root = getPrototypeRootPath(p);
    if (root && !prototypeRootMap.has(root)) {
      prototypeRootMap.set(root, p);
    }
  }
  const prototypeRootPaths = Array.from(prototypeRootMap.keys());
  // /proto-make 等指令的结果应只展示原型卡片；若当前消息已识别出原型工程，
  // 强制屏蔽同消息内的普通工程卡片和文件附件，避免一个指令产出多个卡片。
  const hasPrototypeCards = prototypeRootPaths.length > 0;
  const normalProjectPaths = hasPrototypeCards
    ? []
    : projectPaths.filter(p => {
        const root = getPrototypeRootPath(p);
        return !root || !prototypeRootMap.has(root);
      });
  const nonPrototypeFileAttachments = hasPrototypeCards
    ? []
    : fileAttachments.filter(path =>
        !prototypeRootPaths.some(root => path === root || path.startsWith(`${root}/`))
      );

  // 有普通工程卡片时，抑制该工程目录下的文件附件（它们属于工程内部文件，
  // 已由 ProjectCard 代表），仅保留产品空间文件（products-jobs/）作为独立卡片。
  // 这样每个指令只展示一个结果卡片，避免工程卡片+文件卡片重复出现。
  const hasNormalProjectCards = normalProjectPaths.length > 0;
  const nonProjectFileAttachments = hasNormalProjectCards
    ? nonPrototypeFileAttachments.filter(path =>
        isProductSpaceFile(path) ||
        !normalProjectPaths.some(projPath => path === projPath || path.startsWith(`${projPath}/`))
      )
    : nonPrototypeFileAttachments;

  const cardTypes = extractCardTypes(allTextContent);
  const hasUserStoryFromMarker = cardTypes.includes('user_story');
  const userStoryData = hasUserStoryFromMarker
    ? parseUserStoryFromText(textContent, fileAttachments[0] ?? '')
    : null;

  const hasUserStoryFromLegacy = legacyDataParts.some((item) => item.name === 'user_story');
  const hasUserStory = hasUserStoryFromLegacy || hasUserStoryFromMarker;

  const hasReqBreakdownFromMarker = cardTypes.includes('req_breakdown');
  const { data: reqBreakdownData, loading: reqBreakdownLoading, error: reqBreakdownError } = useRequirementBreakdownData(allTextContent, fileAttachments);

  const hasReqBreakdownFromLegacy = legacyDataParts.some((item) => item.name === 'req_breakdown');
  const hasReqBreakdown = hasReqBreakdownFromLegacy || hasReqBreakdownFromMarker;

  const nonReqBreakdownFileAttachments = hasReqBreakdownFromMarker
    ? nonProjectFileAttachments.filter(path => !REQ_BREAKDOWN_FILE_REGEX.test(path))
    : nonProjectFileAttachments;

  // 解析 [[REVIEW_REPORT:json]] 标记，提取评审报告元数据。
  const reviewReportData = parseReviewReportFromText(allTextContent);

  // 用户故事/需求拆分/评审报告卡片出现时，默认展开完整文本，避免"内容没有输出完整"的观感。
  useEffect(() => {
    if (hasUserStoryFromMarker || hasUserStoryFromLegacy || hasReqBreakdownFromMarker || hasReqBreakdownFromLegacy || reviewReportData) {
      setTextExpanded(true);
    }
  }, [hasUserStoryFromMarker, hasUserStoryFromLegacy, hasReqBreakdownFromMarker, hasReqBreakdownFromLegacy, reviewReportData]);

  const showCollapsed = shouldCollapseText && !textExpanded && !isStreaming;

  const toolCallCount = thinkingItems.filter((i) => i.type === 'tool-call').length;

  // 底部运行状态栏文案：优先展示正在执行的工具调用，其次是思考中，最后是生成用户内容。
  const runningStatusText = (() => {
    const totalText = `总共调用 ${toolCallCount} 次`;
    if (pendingToolCount > 0) {
      if (pendingToolCount === 1) {
        return `正在调用 ${displayPendingToolName} 工具 · ${totalText}`;
      }
      return `正在调用 ${displayPendingToolName} 工具等 ${pendingToolCount} 个工具 · ${totalText}`;
    }
    if (isThinkingRunning) {
      return `正在思考中 · ${totalText}`;
    }
    return `正在生成内容 · ${totalText}`;
  })();

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(message.createdAt).getTime();
    if (!isRunning) {
      // 历史消息：不显示错误的"耗时"（Date.now - createdAt 是消息年龄而非运行时长）
      // 仅当消息 createdAt 在 5 分钟内时才计算（可能是刚完成的实时消息）
      const duration = Math.floor((Date.now() - start) / 1000);
      if (duration >= 0 && duration < 300) {
        setElapsed(duration);
      } else {
        setElapsed(0);
      }
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [isRunning, message.createdAt]);

  return (
    <div className="flex gap-3 justify-start min-w-0 max-w-full">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 items-start">
        <div className="chat-bubble-card flex flex-col gap-2 w-full max-w-full min-w-0 rounded-2xl rounded-tl-sm overflow-hidden">
          {showThinkingPlaceholder && (
            <div className="px-3 py-2 flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{runPhase === 'connecting' ? '正在连接个人助手' : '思考中'}</span>
              <span className="inline-flex">
                <span className="animate-bounce mx-0.5">.</span>
                <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-bounce mx-0.5" style={{ animationDelay: '0.4s' }}>.</span>
              </span>
            </div>
          )}

          {/* 思考/工具过程统一折叠在 ThinkingCard 中，按实际出现顺序用时间线连接 */}
          {hasThinkingContent && (
            <ThinkingCard isRunning={isThinkingRunning} defaultOpen={false} thinkingCount={thinkingCount} toolStats={toolStats}>
              <div className="relative py-1">
                {/* 中心贯穿时间线，从圆点中心穿过 */}
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />
                {thinkingItems.map((item, idx) => {
                  // 时间线圆点颜色：绿色=已完成（该步骤之后还有内容或整体已结束），灰色=仍在进行中
                  const isLastItem = idx === thinkingItems.length - 1;
                  const itemComplete = !isThinkingRunning || !isLastItem;
                  return (
                    <div key={idx} className="relative flex gap-3 py-1.5">
                      <div className="relative shrink-0 w-6 flex items-center justify-center">
                        <div className={cn(
                          'h-2.5 w-2.5 rounded-full border-2 bg-background z-10',
                          itemComplete ? 'border-green-500' : 'border-muted-foreground/60'
                        )} />
                      </div>
                      {/* 步骤内容 */}
                      <div className="flex-1 min-w-0">
                        {item.type === 'reasoning' && (
                          <div className="text-xs sm:text-sm whitespace-pre-wrap break-all min-w-0 text-muted-foreground leading-relaxed">
                            {item.text}
                          </div>
                        )}
                        {item.type === 'text' && (
                          <div className="text-xs sm:text-sm text-muted-foreground break-words min-w-0 leading-relaxed">
                            <MarkdownView content={item.text} />
                          </div>
                        )}
                        {item.type === 'tool-call' && <ToolCallView part={item.part} compact />}
                      </div>
                    </div>
                  );
                })}
                {/* 思考进行中时在时间线底部显示转圈圈，直到 TEXT 输出出现 */}
                {isThinkingRunning && (
                  <div className="relative flex gap-3 py-1.5">
                    <div className="relative shrink-0 w-6 flex items-center justify-center">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>
            </ThinkingCard>
          )}

          {/* 最终给用户的实际输出（去掉 [[FILE:...]] 和 [[PROJECT:...]] 标记，避免重复展示） */}
          {textContent && (
            <div>
              <div className="relative">
                <div className={showCollapsed ? 'chat-bubble-text chat-bubble-text-closed' : 'chat-bubble-text chat-bubble-text-open'}>
                  {outputParts.map((part, idx) => {
                    if (!part.text) return null;
                    const cleanText = part.text
                      .replace(FILE_MARKER_REGEX, '')
                      .replace(PROJECT_MARKER_REGEX, '')
                      .replace(REQ_NAME_MARKER_REGEX, '')
                      .replace(CARD_MARKER_REGEX, '')
                      .replace(REQ_BREAKDOWN_JSON_REGEX, '')
                      .trim();
                    if (!cleanText) return null;
                    return (
                      <div key={idx} className="px-5 py-1.5 text-sm break-words">
                        <MarkdownView content={cleanText} collapsible={false} />
                      </div>
                    );
                  })}
                </div>
                {showCollapsed && (
                  <div className="chat-bubble-fade absolute bottom-0 left-0 right-0 h-16 pointer-events-none z-10" />
                )}
              </div>
              {shouldCollapseText && (
                <div className="flex justify-center py-1.5">
                  <button
                    className="chat-bubble-toggle"
                    onClick={() => setTextExpanded(v => !v)}
                    type="button"
                  >
                    {textExpanded ? (
                      <>收起 <ChevronUp className="h-3.5 w-3.5" /></>
                    ) : (
                      <>展开全部 <ChevronDown className="h-3.5 w-3.5" /></>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 原型工程卡片：按产品目录合并为单个卡片，点击在聊天预览面板打开。
              生成未完成时不展示，避免在输出过程中提前出现卡片。 */}
          {prototypeRootPaths.length > 0 && !isRunning && (
            <div className="px-3 pb-2 flex flex-col gap-2">
              {prototypeRootPaths.map((rootPath) => (
                <PrototypeCard
                  key={rootPath}
                  path={rootPath}
                  requirementTitle={prototypeRequirementTitle}
                  workitemId={resolvedWorkitemId}
                  onPreview={onPrototypePreview}
                />
              ))}
            </div>
          )}

          {/* 普通工程卡片：新建工程显示预览+同步，已有工程显示 diff（有 user_story 数据时不展示）。
              同样等生成完成后再展示。 */}
          {!hasUserStory && normalProjectPaths.length > 0 && !isRunning && (
            <div className="px-3 pb-2 flex flex-col gap-2">
              {normalProjectPaths.map((path) => (
                <ProjectCard key={path} path={path} onPreview={onProjectPreview} />
              ))}
            </div>
          )}

          {/* 非原型文件附件卡片统一放在消息底部（有 user_story 或 req_breakdown 数据时隐藏，避免重复展示）。
              生成完成后再展示。 */}
          {!hasUserStory && nonReqBreakdownFileAttachments.length > 0 && !isRunning && (
            <div className="px-3 pb-2 flex flex-wrap gap-2">
              {nonReqBreakdownFileAttachments.map((path) => (
                <FileAttachmentCard key={path} path={path} onPreview={onFilePreview} workitemId={resolvedWorkitemId} />
              ))}
            </div>
          )}

          {/* 从 [[CARD:req_breakdown]] 标记自动检测到的需求拆分卡片，生成完成后再展示。 */}
          {!hasReqBreakdownFromLegacy && hasReqBreakdownFromMarker && !isRunning && (
            <div className="px-3 py-2"><RequirementBreakdownCard data={reqBreakdownData} loading={reqBreakdownLoading} error={reqBreakdownError} isPreviewActive={isReqBreakdownActive(reqBreakdownData)} onPreview={onReqBreakdownPreview} onSubmit={onReqBreakdownSubmit} fileAttachments={fileAttachments} /></div>
          )}

          {/* 从 [[CARD:user_story]] 标记自动检测到的用户故事卡片，生成完成后再展示。 */}
          {!hasUserStoryFromLegacy && hasUserStoryFromMarker && userStoryData && !isRunning && (
            <div className="px-3 py-2"><UserStoryCard data={userStoryData} isPreviewActive={isUserStoryActive(userStoryData)} onPreview={onUserStoryPreview} /></div>
          )}

          {/* 从 [[REVIEW_REPORT:json]] 标记自动检测到的评审报告卡片，生成完成后再展示。 */}
          {reviewReportData && !isRunning && (
            <div className="px-3 py-2"><ReviewReportCard data={reviewReportData} onFix={onReviewFix} /></div>
          )}

          {/* legacy data 部件（diff / task_list / tool_use / tool_result 等） */}
          {legacyDataParts.map((item, idx) => {
            const { name, data } = item;
            if (name === 'diff') {
              return <div key={idx} className="px-3 py-2"><DiffView content={data.content} /></div>;
            }
            if (name === 'task_list') {
              const tasks = (data.metadata?.tasks || []) as TaskItemData[];
              return <div key={idx} className="px-3 py-2"><TaskListView tasks={tasks} /></div>;
            }
            if (name === 'tool_use') {
              const isFailed = data.metadata?.status === 'failed' || data.metadata?.status === 'timeout';
              return (
                <div key={idx} className={`my-2 px-3 py-2 text-xs sm:text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-muted/30 border-border/30 text-muted-foreground'}`}>
                  <div className="flex items-center gap-2">
                    <Wrench className={`h-4 w-4 ${isFailed ? 'text-red-500' : 'text-blue-500'}`} />
                    <span className="font-medium">{data.metadata?.name || '工具调用'}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${isFailed ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{data.metadata?.status || 'pending'}</span>
                  </div>
                  {data.content && <pre className={`mt-1 text-xs overflow-x-auto ${isFailed ? 'text-red-700 dark:text-red-300' : ''}`}>{data.content}</pre>}
                </div>
              );
            }
            if (name === 'user_story') {
              const storyData = (data.content ? JSON.parse(data.content) : data.metadata) as UserStoryData;
              if (storyData && storyData.stories && !isRunning) {
                return <div key={idx} className="px-3 py-2"><UserStoryCard data={storyData} isPreviewActive={isUserStoryActive(storyData)} onPreview={onUserStoryPreview} /></div>;
              }
              return null;
            }
            if (name === 'req_breakdown') {
              const rbData = (data.content ? JSON.parse(data.content) : data.metadata) as RequirementBreakdownData;
              if (rbData && rbData.items && !isRunning) {
                return <div key={idx} className="px-3 py-2"><RequirementBreakdownCard data={rbData} isPreviewActive={isReqBreakdownActive(rbData)} onPreview={onReqBreakdownPreview} onSubmit={onReqBreakdownSubmit} fileAttachments={fileAttachments} /></div>;
              }
              return null;
            }
            if (name === 'tool_result') {
              const isFailed = data.metadata?.status === 'failed' || data.metadata?.status === 'timeout';
              return (
                <div key={idx} className={`my-2 px-3 py-2 text-xs sm:text-sm rounded-xl border ${isFailed ? 'bg-red-50/50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50' : 'bg-green-50/50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50'}`}>
                  <div className={`flex items-center gap-2 ${isFailed ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>
                    {isFailed ? <X className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    <span className="font-medium">{isFailed ? '工具执行失败' : '工具执行结果'}</span>
                  </div>
                  {data.content && (
                    <div className={`mt-1 ${isFailed ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
                      <MarkdownView content={data.content} />
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>

        {artifact && !isRunning && (
          <div className="mt-2 p-3 rounded-xl border border-border/50 bg-card cursor-pointer hover:border-primary transition-colors flex items-center gap-3 w-full max-w-sm soft-shadow" onClick={onArtifactClick}>
            <div className="h-10 w-10 rounded bg-secondary flex items-center justify-center shrink-0">
              {artifact.type === 'ui' && <Box className="h-5 w-5 text-blue-500" />}
              {artifact.type === 'code' && <FileCode2 className="h-5 w-5 text-green-500" />}
              {artifact.type === 'requirement' && <ListTodo className="h-5 w-5 text-amber-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{artifact.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center">点击查看详情 <span className="ml-1">›</span></p>
            </div>
          </div>
        )}

        {/* 页脚操作栏：所有内容（文本、思考、工具调用）完成后都展示 */}
        {hasVisibleContent && !isRunning && (
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-muted-foreground/50 px-1">{formatTime(message.createdAt)}</span>
            {elapsed > 0 && (
              <span className="text-[10px] text-muted-foreground/50">总耗时 {elapsed} 秒 · 工具调用 {toolCallCount} 次</span>
            )}
            {toolCallCount > 0 && elapsed === 0 && (
              <span className="text-[10px] text-muted-foreground/50">工具调用 {toolCallCount} 次</span>
            )}
            <button
              onClick={onRegenerate}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              title="重新生成"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {textContent && (
              <button
                onClick={() => { navigator.clipboard.writeText(textContent); toast.success('已复制'); }}
                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
                title="复制"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {isRunning && hasVisibleContent && (
          <div className="flex items-center gap-2 mt-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
            <span className="text-[10px] text-muted-foreground/50">{elapsed} 秒 · {runningStatusText}</span>
          </div>
        )}
      </div>
    </div>
  );
};
