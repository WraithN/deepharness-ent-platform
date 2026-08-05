import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExternalStoreRuntime, useExternalStoreSharedOptions } from '@assistant-ui/core/react';
import type { AssistantRuntime, ThreadMessageLike } from '@assistant-ui/react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import { parseUserStoryFromText } from '@/components/chat/UserStoryCard';
import { parseRequirementBreakdownFromText } from '@/components/chat/RequirementBreakdownCard';

export interface SendContext {
  quotedCard?: { type: 'req' | 'defect' | 'case'; id: string; title: string; reporter: string };
  selectedRepos?: { id: string; name: string; localPath?: string; branch?: string }[];
}

interface UseAgUiChatOptions {
  /** 当前 run 使用的 gatewayd agent 插件 key，如 claude-code、opencode、codex。 */
  agentPluginKey?: string;
}

const PHASE_CONNECTING = 'connecting' as const;
const PHASE_THINKING = 'thinking' as const;

type RunPhase = typeof PHASE_CONNECTING | typeof PHASE_THINKING | null;

interface RespondResponse {
  status: string;
  runId?: string;
  threadId?: string;
  instanceId?: string;
  fallback?: boolean;
}

interface UseAgUiChatReturn {
  runtime: AssistantRuntime;
  sessionId: string | null;
  instanceId: string | null;
  wsConnected: boolean;
  isRunning: boolean;
  runPhase: RunPhase;
  messages: ThreadMessageLike[];
  sendMessage: (text: string, context?: SendContext) => Promise<void>;
  switchSession: (nextSessionId: string | null) => Promise<void>;
  createSession: (pluginKey?: string) => Promise<{ sessionId: string; instanceId: string } | null>;
  cancelRun: () => void;
  tryRestoreSession: () => Promise<string | null>;
  /** 当前等待用户回复的 agent.question 事件；null 表示没有待处理问题。 */
  pendingQuestion: AgentQuestionEvent | null;
  /** 回复当前 agent.question 事件。 */
  respondToQuestion: (message: string, displayText?: string) => Promise<void>;
  /** 关闭待处理问题卡片并取消当前运行。 */
  dismissQuestion: () => void;
}

/** agent.question 工具中的单个选项。 */
export interface AgentQuestionOption {
  label: string;
  description?: string;
  value?: string;
}

/** agent.question 工具中的单条问题。 */
export interface AgentQuestionItem {
  id?: string;
  header?: string;
  /** 问题正文；兼容 question 和 text 两种字段名。 */
  question?: string;
  text?: string;
  options?: AgentQuestionOption[];
}

/** agent.question 自定义事件携带的完整负载。 */
export interface AgentQuestionEvent {
  threadId: string;
  instanceId: string;
  questions: AgentQuestionItem[];
  /** 如果为 true，表示问题来自文本 [[QUESTION:...]] 标记，应通过普通消息回答而非 gatewayd respond。 */
  isMarkerQuestion?: boolean;
}

const AGENT_URL = '/api/v1/agent';
const SESSIONS_API_URL = '/api/v1/sessions';

const QUESTION_MARKER_REGEX = /\[\[QUESTION:([\s\S]*?)\]\]/g;

/**
 * 从 assistant 文本末尾解析 [[QUESTION:问题|A. 选项一|B. 选项二|...]] 标记。
 * 返回去掉标记后的 cleanText、问题正文以及选项列表。
 * 解析失败时返回 null。
 */
function parseQuestionMarker(rawText: string): {
  cleanText: string;
  questionText: string;
  options: AgentQuestionOption[];
} | null {
  const matches = Array.from(rawText.matchAll(QUESTION_MARKER_REGEX));
  if (matches.length === 0) return null;
  const lastMatch = matches[matches.length - 1];
  const inner = lastMatch[1].trim();
  if (!inner) return null;
  const parts = inner.split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [questionText, ...optionParts] = parts;
  const options: AgentQuestionOption[] = optionParts.map((opt, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const m = opt.match(/^([A-Z])\.\s*(.*)$/);
    if (m) {
      const text = m[2].trim();
      return { label: text, value: `${m[1]}. ${text}` };
    }
    return { label: opt, value: `${letter}. ${opt}` };
  });
  const before = rawText.slice(0, lastMatch.index);
  const after = rawText.slice(lastMatch.index + lastMatch[0].length);
  const cleanText = (before + after).trim();
  return { cleanText, questionText: questionText.trim(), options };
}
// 工具调用后模型整理长报告可能较长时间无 token，延长到 10 分钟。
const NO_EVENT_TIMEOUT_MS = 600000;
const NO_EVENT_TIMER_INTERVAL_MS = 5000;
// 活跃 run 记录的有效期：超过 30 分钟视为已失效，恢复时直接丢弃。
const ACTIVE_RUN_TTL_MS = 30 * 60 * 1000;
// 断连重放的轮询间隔：每 3 秒拉取一次后端缓冲的 AG-UI 事件。
const SSE_REPLAY_POLL_INTERVAL_MS = 3000;
// SSE 重放接口在无缓冲事件时返回的标记事件类型。
const SSE_NO_PENDING_EVENTS_TYPE = 'NO_PENDING_EVENTS';
// localStorage 中登录 token 的键名，与 @/lib/api 的鉴权方式保持一致。
const AUTH_TOKEN_STORAGE_KEY = 'token';

const USER_PROMPT_MARKER = '__USER_PROMPT__';
const SESSION_ID_KEY_PREFIX = 'dh_chat_session_id';
const IN_PROGRESS_MSG_KEY_PREFIX = 'dh_chat_in_progress_msg';
const ACTIVE_RUN_KEY_PREFIX = 'dh_chat_active_run';

// 获取当前登录用户 ID（token 即 userId），用于按用户隔离 localStorage
const getCurrentUserId = (): string => localStorage.getItem('token') ?? '';

// 会话 ID 按工作区 + 用户隔离存储，避免切换用户后恢复其他用户的会话
const getSessionIdKey = (workspaceId: string) => `${SESSION_ID_KEY_PREFIX}:${workspaceId}:${getCurrentUserId()}`;

// 进行中的 AI 回复按会话 ID 隔离存储，用于页面刷新/关闭后恢复未完成的输出
const getInProgressMsgKey = (sessionId: string) => `${IN_PROGRESS_MSG_KEY_PREFIX}:${sessionId}`;

// 活跃 run 按会话 ID 隔离存储，用于页面导航/刷新后恢复"思考中"状态并断点续传
const getActiveRunKey = (sessionId: string) => `${ACTIVE_RUN_KEY_PREFIX}:${sessionId}`;

const ERROR_CLASSIFICATIONS: { keywords: RegExp; specificMsg: string }[] = [
  { keywords: /(api.?key|密钥|apikey|unauthorized|401.*invalid)/i, specificMsg: 'API 密钥无效或已过期，请检查模型配置中的 API Key 与 Base URL。' },
  { keywords: /(quota|余额|insufficient|billing|超出.*额度|exceeded.*limit)/i, specificMsg: '模型账户余额不足或配额已用完，请充值后重试。' },
  { keywords: /(rate.?limit|429|限流|too many requests|请求过于频繁)/i, specificMsg: '请求频率过高，被模型服务限流，请稍后重试。' },
  { keywords: /(timeout|超时|timed.?out|deadline|ETIMEDOUT)/i, specificMsg: '模型响应超时，请检查网络连接或模型服务状态后重试。' },
  { keywords: /(connect|connection|网络|network|refused|unreachable|ECONNREFUSED|ENOTFOUND)/i, specificMsg: '无法连接模型服务，请检查网络或模型配置的 Base URL 地址。' },
  { keywords: /(overloaded|busy|capacity|503|502|service.?unavailable|服务不可用)/i, specificMsg: '模型服务当前繁忙或过载，请稍后重试。' },
  { keywords: /(model.*not.?found|model.*unavailable|模型.*不可用|模型.*不存在|404.*model)/i, specificMsg: '模型不可用或名称错误，请检查模型配置中的模型名称。' },
];

function classifyAgentError(errorMsg: string): string {
  const matched = ERROR_CLASSIFICATIONS.find((entry) => entry.keywords.test(errorMsg));
  if (matched) {
    return `运行出错：${matched.specificMsg}\n\n原始错误：${errorMsg}`;
  }
  return `运行出错：${errorMsg}`;
}

/**
 * 构建提示词模板规则，传入当前 session_id 用于文件目录定位。
 * agent 的工作目录为 WORKSPACE_ROOT/{workspace_id}/{user_id}/，
 * 工程代码应写入 projects/{project-name}/ 子目录下。
 */
function buildPromptRules(sessionId: string): string {
  return `请严格遵循以下规则回答：
1. 回答必须使用中文，包括思考过程、工具调用说明、错误分析等所有内部推理文本也必须使用中文。
2. 禁止使用 /workflows、/commit、/pr、/review 等 slash command；所有任务都通过直接回答或调用工具完成，不要引导用户去其他页面或后台工作流查看结果。
3. 工具调用结束后，请立即先用一两句话告诉用户"正在整理结果"或"结果如下"，不要让用户长时间看不到任何回复；整理完成后再给出完整内容。
4. 创建工程代码时，必须将文件写入当前工作目录下的 projects/{项目名}/ 子目录中。
   例如：使用 Write 工具时 file_path 应为 ./projects/my-app/src/index.ts（相对路径）或对应的绝对路径。
   首次创建的工程，projects/{项目名}/ 目录不存在，需要先创建目录结构。
5. 如果是修改已有工程，直接在 projects/{项目名}/ 目录下修改对应文件，不要创建新的工程目录。
6. 工程创建或修改完成后，请在完整内容末尾用以下格式标记工程路径：
   [[PROJECT:/abs/path/to/projects/项目名]]
   重要：[[PROJECT:...]] 中的路径必须是你创建/修改的工程根目录的绝对路径。
   一个回复中可以标记多个工程，每个工程单独一行 [[PROJECT:...]]。
7. 如果只是创建单个文件（非工程），仍然使用 [[FILE:/abs/path/to/file.md]] 格式标记。
8. 除了 [[PROJECT:...]] 和 [[FILE:...]] 格式外，不要把 "/workflows"、"/Computer/Super" 等普通 slash 字符串当作文件路径。
9. [[PROJECT:...]] 路径标记会渲染为可点击的工程卡片，用户可预览工程文件（目录树+代码详情）或查看修改 diff，并可同步到仓库配置中。
10. 不要在最终回答正文中展示文件或工程的绝对路径；只使用 [[FILE:...]] 和 [[PROJECT:...]] 标记，前端会自动渲染为卡片。
11. 不要输出思考过程、Next Move、Relevant Files、计划步骤等中间信息；只输出用户要求的最终结果和必要的简短说明。`;
}

/**
 * 把用户原始提示词包装到提示词模板中，让模型统一遵循回答规则。
 * 如果用户选择了关联代码库，会将仓库名注入提示词，让 agent 在对应仓库上下文中工作。
 */
function wrapUserPrompt(text: string, sessionId: string, repoNames?: string[]): string {
  const rules = buildPromptRules(sessionId);
  const repoContext = repoNames && repoNames.length > 0
    ? `\n\n当前关联代码库: ${repoNames.join(', ')}。请在上述代码库的上下文中回答用户问题，如需修改代码请在对应仓库目录下操作。`
    : '';
  return `${rules}${repoContext}\n\n${USER_PROMPT_MARKER}\n${text}`;
}

/**
 * 从包装后的提示词中提取用户原始输入。
 */
export function extractUserPrompt(text: string): string {
  // 兼容历史数据：前端曾经用 JSON.stringify 双重编码 content，导致此处收到的
  // 文本以 " 开头且换行为字面量 \n。尝试再解码一层以还原真实内容。
  if (text.startsWith('"')) {
    try {
      const decoded = JSON.parse(text);
      if (typeof decoded === 'string') {
        text = decoded;
      }
    } catch {
      // 不是合法 JSON，按原始文本处理
    }
  }
  const idx = text.indexOf(USER_PROMPT_MARKER);
  if (idx === -1) return text;
  return text.slice(idx + USER_PROMPT_MARKER.length).trimStart();
}

interface BackendMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// 从 metadata.contentParts 恢复的结构化部件类型
interface StoredContentPart {
  type: 'reasoning' | 'text' | 'tool-call';
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsText?: string;
  result?: string;
  done?: boolean;
}

function backendMessageToThreadMessageLike(msg: BackendMessage): ThreadMessageLike {
  const custom = (msg.metadata ?? {}) as Record<string, unknown>;
  const defaultContent: ThreadMessageLike['content'] = [{ type: 'text' as const, text: msg.content }];
  const createdAt = new Date(msg.timestamp);

  if (msg.role === 'assistant' && Array.isArray(custom.contentParts)) {
    const parts = custom.contentParts as StoredContentPart[];
    const rebuilt: any[] = [];
    for (const p of parts) {
      if (p.type === 'reasoning' && p.text) {
        rebuilt.push({ type: 'reasoning', text: p.text, done: p.done ?? true });
      } else if (p.type === 'text' && p.text) {
        rebuilt.push({ type: 'text', text: p.text });
      } else if (p.type === 'tool-call') {
        let args: unknown = undefined;
        if (p.argsText) {
          try { args = JSON.parse(p.argsText); } catch { /* keep as string */ }
        }
        rebuilt.push({
          type: 'tool-call',
          toolCallId: p.toolCallId ?? '',
          toolName: p.toolName ?? '',
          args,
          argsText: p.argsText ?? '',
          result: p.result,
        });
      }
    }
    const content: ThreadMessageLike['content'] = rebuilt.length > 0
      ? (rebuilt as any[])
      : defaultContent;

    if (custom.cardType === 'user_story' && msg.content) {
      const fileMatch = msg.content.match(/\[\[FILE:([^\]]+)\]\]/);
      const filePath = fileMatch?.[1] ?? '';
      const storyData = parseUserStoryFromText(msg.content, filePath);
      if (storyData && storyData.stories.length > 0) {
        (content as any[]).push({
          type: 'data',
          name: 'user_story',
          data: { content: JSON.stringify(storyData) },
        });
      }
    }
    if (custom.cardType === 'req_breakdown' && msg.content) {
      const fileMatch = msg.content.match(/\[\[FILE:([^\]]+)\]\]/);
      const filePath = fileMatch?.[1] ?? '';
      const rbData = parseRequirementBreakdownFromText(msg.content, filePath);
      if (rbData && rbData.items.length > 0) {
        (content as any[]).push({
          type: 'data',
          name: 'req_breakdown',
          data: { content: JSON.stringify(rbData) },
        });
      }
    }
    return {
      id: msg.id,
      role: 'assistant',
      content,
      metadata: { custom },
      createdAt,
      status: { type: 'complete' as const, reason: 'unknown' as const },
    };
  }

  if (custom.cardType === 'req_breakdown' && msg.content) {
    const rbData = parseRequirementBreakdownFromText(msg.content, '');
    if (rbData && rbData.items.length > 0) {
      const contentWithCard: ThreadMessageLike['content'] = [
        { type: 'text' as const, text: msg.content },
        { type: 'data' as const, name: 'req_breakdown' as const, data: { content: JSON.stringify(rbData) } },
      ];
      return {
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: contentWithCard,
        metadata: { custom },
        createdAt,
      };
    }
  }

  if (custom.cardType === 'user_story' && msg.content) {
    const storyData = parseUserStoryFromText(msg.content, '');
    if (storyData && storyData.stories.length > 0) {
      const contentWithCard: ThreadMessageLike['content'] = [
        { type: 'text' as const, text: msg.content },
        { type: 'data' as const, name: 'user_story' as const, data: { content: JSON.stringify(storyData) } },
      ];
      return {
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: contentWithCard,
        metadata: { custom },
        createdAt,
      };
    }
  }

  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: defaultContent,
    metadata: { custom },
    createdAt,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 将 ThreadMessageLike 的文本内容提取为字符串，用于后端 RunAgentInput。
 */
function messageToBackendText(msg: ThreadMessageLike): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text?: string }).text ?? '')
    .join('\n');
}

/**
 * 将进行中的 AI 回复缓存到 localStorage，用于页面刷新/关闭后恢复未完成的输出。
 */
function saveInProgressMessage(sessionId: string, msg: ThreadMessageLike): void {
  try {
    localStorage.setItem(getInProgressMsgKey(sessionId), JSON.stringify(msg));
  } catch (err) {
    console.error('[useAgUiChat] save in-progress message failed:', err);
  }
}

/**
 * 从 localStorage 恢复进行中的 AI 回复。
 */
function loadInProgressMessage(sessionId: string): ThreadMessageLike | null {
  try {
    const raw = localStorage.getItem(getInProgressMsgKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as ThreadMessageLike;
  } catch {
    return null;
  }
}

/**
 * 清除进行中的 AI 回复缓存。
 */
function clearInProgressMessage(sessionId: string): void {
  localStorage.removeItem(getInProgressMsgKey(sessionId));
}

/**
 * 持久化的活跃 run 状态：run 进行中离开页面后，回来时据此恢复运行态并断点续传。
 */
interface ActiveRunState {
  runId: string;
  sessionId: string;
  startedAt: number;
  phase: NonNullable<RunPhase>;
}

/**
 * 将活跃 run 状态缓存到 localStorage，用于页面导航/刷新后恢复"思考中"。
 */
function saveActiveRun(state: ActiveRunState): void {
  try {
    localStorage.setItem(getActiveRunKey(state.sessionId), JSON.stringify(state));
  } catch (err) {
    console.error('[useAgUiChat] save active run failed:', err);
  }
}

/**
 * 从 localStorage 读取活跃 run 状态。
 */
function loadActiveRun(sessionId: string): ActiveRunState | null {
  try {
    const raw = localStorage.getItem(getActiveRunKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as ActiveRunState;
  } catch {
    return null;
  }
}

/**
 * 清除活跃 run 状态缓存。
 */
function clearActiveRun(sessionId: string): void {
  localStorage.removeItem(getActiveRunKey(sessionId));
}

/**
 * run 阶段变化时同步更新缓存中的 phase，保证恢复后展示正确的阶段文案。
 */
function updateActiveRunPhase(sessionId: string, phase: NonNullable<RunPhase>): void {
  const saved = loadActiveRun(sessionId);
  if (!saved) return;
  saveActiveRun({ ...saved, phase });
}

interface AgUiEvent {
  type: string;
  timestamp?: number;
  threadId?: string;
  runId?: string;
  messageId?: string;
  role?: string;
  delta?: string;
  toolCallId?: string;
  toolCallName?: string;
  content?: string;
  message?: string;
  code?: string;
  // Custom 事件字段
  name?: string;
  value?: unknown;
}

function parseSSE(text: string): AgUiEvent[] {
  const events: AgUiEvent[] = [];
  const buffer = text.split(/\n\n/);
  for (const block of buffer) {
    const lines = block.split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^\s/, ''));
      }
    }
    if (dataLines.length === 0) continue;
    try {
      events.push(JSON.parse(dataLines.join('\n')) as AgUiEvent);
    } catch {
      // ignore malformed sse data
    }
  }
  return events;
}

/**
 * processAgUiEvent 的上下文：live SSE 流与断连重放共用同一套事件分发逻辑，
 * 通过该上下文携带 run 级可变状态。
 */
interface AgUiEventProcessContext {
  /** 事件归属的会话 ID；gatewayd 改换 threadId 时会更新为最新会话。 */
  sessionId: string;
  /** 当前 run ID，用于日志与运行态持久化。 */
  runId: string;
  /** 当前 run 的 assistant 消息 ID，处理 TEXT_MESSAGE_START 等事件时回写。 */
  assistantMessageId: string | null;
  /** 当前正在流式输出的文本块 messageId，用于把 delta 路由到正确的 text 部件，避免多文本块内容错乱。 */
  currentTextMessageId: string | null;
}

/**
 * 将消息中所有仍处于「执行中」（result 未定义）的 tool-call 部件标记为已完成。
 * run 结束（正常完成/中断/取消/出错）时调用，避免工具调用条目永久停留在「执行中」状态。
 */
function withToolCallsFinalized(m: ThreadMessageLike): ThreadMessageLike {
  const content = Array.isArray(m.content) ? m.content : [];
  const hasPending = content.some(
    (p) => p.type === 'tool-call' && (p as { result?: unknown }).result === undefined
  );
  if (!hasPending) return m;
  return {
    ...m,
    content: content.map((p) =>
      p.type === 'tool-call' && (p as { result?: unknown }).result === undefined
        ? ({ ...p, result: '' } as typeof p)
        : p
    ),
  };
}

/**
 * 拉取后端缓冲的 AG-UI 事件（GET /api/v1/sessions/{id}/sse）。
 * 网络或 HTTP 错误时返回 null，由调用方在下个轮询周期重试。
 */
async function fetchSseReplayEvents(sessionId: string): Promise<AgUiEvent[] | null> {
  try {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${SESSIONS_API_URL}/${encodeURIComponent(sessionId)}/sse`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[useAgUiChat] sse replay fetch failed:', res.status);
      return null;
    }
    return parseSSE(await res.text());
  } catch (err) {
    console.warn('[useAgUiChat] sse replay fetch error:', err);
    return null;
  }
}

export function useAgUiChat(options: UseAgUiChatOptions = {}): UseAgUiChatReturn {
  const { agentPluginKey = 'claude-code' } = options;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runPhase, setRunPhase] = useState<RunPhase>(null);
  const [pendingQuestion, setPendingQuestion] = useState<AgentQuestionEvent | null>(null);
  const pendingQuestionRef = useRef(pendingQuestion);
  useEffect(() => {
    pendingQuestionRef.current = pendingQuestion;
  }, [pendingQuestion]);

  // 持久化 pendingQuestion 到 localStorage，刷新或切换页面后恢复。
  const PENDING_QUESTION_STORAGE_KEY = 'dh_pending_question';
  useEffect(() => {
    if (pendingQuestion) {
      localStorage.setItem(PENDING_QUESTION_STORAGE_KEY, JSON.stringify(pendingQuestion));
    } else {
      localStorage.removeItem(PENDING_QUESTION_STORAGE_KEY);
    }
  }, [pendingQuestion]);
  // 挂载时从 localStorage 恢复。
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PENDING_QUESTION_STORAGE_KEY);
      if (saved) {
        const restored = JSON.parse(saved) as AgentQuestionEvent;
        if (restored.threadId && restored.instanceId) {
          setPendingQuestion(restored);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const instanceIdRef = useRef(instanceId);
  useEffect(() => {
    instanceIdRef.current = instanceId;
  }, [instanceId]);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunSessionIdRef = useRef<string | null>(null);
  const lastWorkspaceIdRef = useRef<string>(getCurrentWorkspaceId());
  // 断连重放轮询的定时器与会话标记：同一时间只允许一个会话的重放循环。
  const reattachTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reattachSessionIdRef = useRef<string | null>(null);
  // 当前 run 已输出的 assistant 文本原始内容，用于在 RUN_FINISHED 时检测 [[QUESTION:...]] 标记。
  const currentAssistantTextRef = useRef<string>('');
  // 指向最新 handleSend 的 ref，供 marker 问题回答路径直接发送普通消息。
  const handleSendRef = useRef<((text: string, context?: SendContext) => Promise<void>) | null>(null);
  // 防止用户快速重复点击选项导致重复发送回答。
  const isRespondingToQuestionRef = useRef(false);

  // 停止断连重放轮询（如果存在）。
  const stopRunReattach = useCallback(() => {
    if (reattachTimerRef.current) {
      clearInterval(reattachTimerRef.current);
      reattachTimerRef.current = null;
    }
    reattachSessionIdRef.current = null;
  }, []);

  // 缓存当前运行中的 assistant 消息快照，供页面刷新/导航后恢复未完成的输出。
  const saveRunningSnapshot = useCallback(() => {
    if (!sessionIdRef.current) return;
    const runningAssistant = messagesRef.current.find((m) => m.role === 'assistant' && m.status?.type === 'running');
    if (runningAssistant) {
      saveInProgressMessage(sessionIdRef.current, runningAssistant);
    }
  }, []);

  // 组件卸载时中止所有进行中的 SSE 连接，避免卸载后仍持续 setState 阻塞导航。
  // 同时监听 beforeunload，在页面关闭/刷新前立即缓存未完成的 AI 回复到 localStorage。
  useEffect(() => {
    window.addEventListener('beforeunload', saveRunningSnapshot);
    return () => {
      window.removeEventListener('beforeunload', saveRunningSnapshot);
      // 路由卸载（SPA 导航）不是失败：保留 localStorage 中的快照与活跃 run 记录，
      // 重进页面后据此恢复"思考中"并通过 SSE 重放断点续传。
      saveRunningSnapshot();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      activeRunSessionIdRef.current = null;
      stopRunReattach();
    };
  }, [saveRunningSnapshot, stopRunReattach]);

  // 检测工作区切换：localStorage 中的 currentWorkspaceId 变化时重置当前会话状态，
  // 防止用新工作区 ID 去加载旧工作区的 session，导致后端报 "session not in this workspace"。
  useEffect(() => {
    const interval = setInterval(() => {
      const current = getCurrentWorkspaceId();
      if (current !== lastWorkspaceIdRef.current) {
        lastWorkspaceIdRef.current = current;
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        if (sessionIdRef.current) {
          clearInProgressMessage(sessionIdRef.current);
          clearActiveRun(sessionIdRef.current);
        }
        activeRunSessionIdRef.current = null;
        stopRunReattach();
        setIsRunning(false);
        setRunPhase(null);
        setSessionId(null);
        setInstanceId(null);
        setMessages([]);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [stopRunReattach]);

  // 处理单条 AG-UI 事件：live SSE 流与断连重放共用同一套分发逻辑。
  // ctx 携带 run 级可变状态，assistantMessageId 会在处理过程中回写。
  const processAgUiEvent = useCallback((ev: AgUiEvent, ctx: AgUiEventProcessContext) => {
    const evLog = { type: ev.type, delta: ev.delta?.slice(0, 80), messageId: ev.messageId, toolCallId: ev.toolCallId, toolCallName: ev.toolCallName, runId: ctx.runId };
    if (ev.type === 'RUN_STARTED' || ev.type === 'RUN_FINISHED' || ev.type === 'RUN_ERROR' || ev.type === 'TOOL_CALL_START' || ev.type === 'TOOL_CALL_RESULT') {
      console.log('[useAgUiChat] SSE', evLog);
    }

    switch (ev.type) {
      case 'RUN_STARTED': {
        setIsRunning(true);
        setRunPhase(PHASE_THINKING);
        // gatewayd 在 session 丢失后会创建新 thread，RUN_STARTED
        // 携带新的 threadId。将此 threadId 同步为当前会话 ID，
        // 确保前端 localStorage 与后端持久化的一致。
        if (ev.threadId && ev.threadId !== ctx.sessionId) {
          console.log('[useAgUiChat] threadId changed by gatewayd: %s -> %s', ctx.sessionId, ev.threadId);
          // 运行态记录与进行中快照随会话迁移，避免旧会话残留的缓存被误恢复。
          clearActiveRun(ctx.sessionId);
          clearInProgressMessage(ctx.sessionId);
          setSessionId(ev.threadId);
          ctx.sessionId = ev.threadId;
          saveActiveRun({ runId: ctx.runId, sessionId: ctx.sessionId, startedAt: Date.now(), phase: PHASE_THINKING });
        } else {
          // 阶段由 connecting 推进为 thinking，同步更新缓存中的运行态。
          updateActiveRunPhase(ctx.sessionId, PHASE_THINKING);
        }
        break;
      }

      case 'TEXT_MESSAGE_START': {
        // 新 assistant 文本块开始时清空原始文本累积器，用于检测 [[QUESTION:...]] 标记。
        currentAssistantTextRef.current = '';
        // 单次 run 内只创建一个 assistant 消息，保证一轮回复只有一个 AI 头像。
        const blockId = ev.messageId ?? null;
        if (!ctx.assistantMessageId) {
          ctx.assistantMessageId = blockId ?? generateId();
          if (blockId) ctx.currentTextMessageId = blockId;
          const assistant: ThreadMessageLike = {
            id: ctx.assistantMessageId,
            role: 'assistant',
            content: [{ type: 'text', text: '' }],
            createdAt: new Date(),
            status: { type: 'running' },
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === ctx.assistantMessageId)) return prev;
            return [...prev, assistant];
          });
        } else {
          // 消息已存在。为不同的文本块（不同 messageId）创建独立的 text 部件，
          // 避免多个文本块的 delta 被追加到同一部件导致内容错乱；
          // 同一块重复 START 时复用已有部件。
          if (blockId) ctx.currentTextMessageId = blockId;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== ctx.assistantMessageId || m.role !== 'assistant') return m;
              const content = Array.isArray(m.content)
                ? (m.content as Array<{ type: string; text?: string; messageId?: string }>)
                : [{ type: 'text' as const, text: String(m.content ?? '') }];
              // 有 messageId 且已存在同块部件 -> 复用
              if (blockId && content.some((p) => p.type === 'text' && p.messageId === blockId)) return m;
              // 有 messageId -> 新建带标记的 text 部件
              if (blockId) {
                return { ...m, content: [...content, { type: 'text' as const, text: '', messageId: blockId }] as ThreadMessageLike['content'] };
              }
              // 无 messageId：仅当最后一个部件不是 text 时才新建（保留旧行为）
              const lastPart = content.length > 0 ? content[content.length - 1] : null;
              if (lastPart && lastPart.type === 'text') return m;
              return { ...m, content: [...content, { type: 'text' as const, text: '' }] as ThreadMessageLike['content'] };
            })
          );
        }
        break;
      }

      case 'TEXT_MESSAGE_CONTENT': {
        if (!ev.delta) break;
        const delta = ev.delta;
        // 累积原始文本，用于 RUN_FINISHED 时检测 [[QUESTION:...]] 标记。
        currentAssistantTextRef.current += delta;
        // 兜底：如果还没有 assistant 消息，创建一个（某些协议实现可能先 content 后 start）。
        if (!ctx.assistantMessageId) {
          const msgId = ev.messageId ?? generateId();
          ctx.assistantMessageId = msgId;
          if (ev.messageId) ctx.currentTextMessageId = ev.messageId;
          const deltaText = delta;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msgId)) return prev;
            return [...prev, {
              id: msgId,
              role: 'assistant',
              content: [{ type: 'text', text: deltaText }],
              createdAt: new Date(),
              status: { type: 'running' },
            }];
          });
          break;
        }
        // 优先按 messageId 路由到对应文本块，避免多文本块 delta 互相错乱；
        // messageId 缺失时回退到最后一个 text 部件。
        const blockId = ev.messageId ?? ctx.currentTextMessageId ?? null;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== ctx.assistantMessageId || m.role !== 'assistant') return m;
            const content: Array<{ type: string; text?: string; messageId?: string }> = Array.isArray(m.content)
              ? (m.content as Array<{ type: string; text?: string; messageId?: string }>)
              : [{ type: 'text' as const, text: String(m.content ?? '') }];
            // 优先匹配 messageId 的 text 部件
            let targetIdx = -1;
            if (blockId) {
              for (let i = content.length - 1; i >= 0; i--) {
                if (content[i].type === 'text' && content[i].messageId === blockId) { targetIdx = i; break; }
              }
            }
            // 回退到最后一个 text 部件
            if (targetIdx < 0) {
              for (let i = content.length - 1; i >= 0; i--) {
                if (content[i].type === 'text') { targetIdx = i; break; }
              }
            }
            if (targetIdx >= 0) {
              const newContent = content.map((part, i) =>
                i === targetIdx ? { ...part, text: ((part as { text?: string }).text ?? '') + delta } : part
              );
              return { ...m, content: newContent as ThreadMessageLike['content'] };
            }
            // 尚无 text 部件，新建（尽量带 blockId 标记）
            const newPart: { type: 'text'; text: string; messageId?: string } = { type: 'text', text: delta };
            if (blockId) newPart.messageId = blockId;
            return { ...m, content: [...content, newPart] as ThreadMessageLike['content'] };
          })
        );
        break;
      }

      case 'THINKING_TEXT_MESSAGE_CONTENT': {
        // 将 thinking 内容存储为独立的 'reasoning' 类型部件，
        // 与最终输出 ('text' 类型) 分开存储。
        // AssistantMessage 会把 'reasoning' 部件直接渲染在 ThinkingCard 中，
        // 而 'text' 部件渲染为最终输出。
        const delta = ev.delta;
        if (!delta) break;
        if (!ctx.assistantMessageId) {
          const msgId = generateId();
          ctx.assistantMessageId = msgId;
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              role: 'assistant',
              content: [{ type: 'reasoning', text: delta }],
              createdAt: new Date(),
              status: { type: 'running' },
            },
          ]);
          break;
        }
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== ctx.assistantMessageId || m.role !== 'assistant') return m;
            const content: readonly { type: string; text?: string }[] = Array.isArray(m.content)
              ? (m.content as readonly { type: string; text?: string }[])
              : [{ type: 'text' as const, text: String(m.content ?? '') }];
            const lastPart = content.length > 0 ? content[content.length - 1] : null;
            if (lastPart && lastPart.type === 'reasoning' && !(lastPart as { done?: boolean }).done) {
              // 最后一个部件是未结束的 reasoning，追加 delta 到它
              const newContent = content.map((p, i) =>
                i === content.length - 1 ? { ...p, text: ((p as { text?: string }).text ?? '') + delta } : p
              );
              return { ...m, content: newContent as ThreadMessageLike['content'] };
            }
            // 最后一个部件不是 reasoning、或上一段思考已结束（done），
            // 在末尾创建新的 reasoning 部件，保持实际事件顺序并避免多段思考合并
            return { ...m, content: [...content, { type: 'reasoning', text: delta }] as ThreadMessageLike['content'] };
          })
        );
        break;
      }

      case 'THINKING_END':
      case 'THINKING_TEXT_MESSAGE_END':
        // 思考结束，标记所有 reasoning 部件为 done，
        // AssistantMessage 据此让 ThinkingCard 显示"思考过程"而非"思考中"。
        if (!ctx.assistantMessageId) break;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== ctx.assistantMessageId || m.role !== 'assistant') return m;
            const content = Array.isArray(m.content) ? m.content : [];
            const hasReasoning = content.some((p) => p.type === 'reasoning');
            if (!hasReasoning) return m;
            return {
              ...m,
              content: content.map((p) =>
                p.type === 'reasoning' ? { ...p, done: true } : p
              ) as ThreadMessageLike['content'],
            };
          })
        );
        break;

      case 'TEXT_MESSAGE_END':
        // 忽略中途的 TEXT_MESSAGE_END，避免把一次 run 拆成多个消息。
        // 最终完成状态由 RUN_FINISHED 统一设置。
        break;

      case 'TOOL_CALL_START': {
        if (!ev.toolCallId || !ev.toolCallName) break;
        setMessages((prev) => {
          // 优先使用当前 run 已追踪的 assistant 消息
          let target = ctx.assistantMessageId
            ? prev.find((m) => m.id === ctx.assistantMessageId && m.role === 'assistant')
            : undefined;
          // 回退到最后一条 assistant 消息
          if (!target) {
            target = [...prev].reverse().find((m) => m.role === 'assistant');
          }
          // 还没有 assistant 消息则新建一条（模型可能在输出 text 前就先调用工具）
          if (!target) {
            const msgId = generateId();
            ctx.assistantMessageId = msgId;
            return [
              ...prev,
              {
                id: msgId,
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call' as const,
                    toolCallId: ev.toolCallId,
                    toolName: ev.toolCallName,
                    args: undefined,
                    argsText: '',
                  },
                ],
                createdAt: new Date(),
                status: { type: 'running' },
              },
            ];
          }
          if (!ctx.assistantMessageId && target?.id) {
            ctx.assistantMessageId = target.id;
          }
          return prev.map((m) => {
            if (m.id !== target.id) return m;
            const content = Array.isArray(m.content) ? m.content : [];
            if (content.some((p) => p.type === 'tool-call' && (p as { toolCallId?: string }).toolCallId === ev.toolCallId)) {
              return m;
            }
            return {
              ...m,
              content: [
                ...content,
                {
                  type: 'tool-call' as const,
                  toolCallId: ev.toolCallId,
                  toolName: ev.toolCallName,
                  args: undefined,
                  argsText: '',
                },
              ],
            };
          });
        });
        break;
      }

      case 'TOOL_CALL_ARGS': {
        if (!ev.toolCallId || ev.delta === undefined) break;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.role !== 'assistant') return m;
            const content = Array.isArray(m.content) ? m.content : [];
            const hasTarget = content.some(
              (p) => p.type === 'tool-call' && (p as { toolCallId?: string }).toolCallId === ev.toolCallId
            );
            if (!hasTarget) return m;
            return {
              ...m,
              content: content.map((p) => {
                if (p.type !== 'tool-call' || (p as { toolCallId?: string }).toolCallId !== ev.toolCallId) return p;
                const argsText = ((p as { argsText?: string }).argsText ?? '') + ev.delta;
                let args = undefined;
                try {
                  args = JSON.parse(argsText);
                } catch {
                  // partial args
                }
                return { ...p, args, argsText };
              }),
            };
          })
        );
        break;
      }

      case 'TOOL_CALL_RESULT': {
        if (!ev.toolCallId || ev.content === undefined) break;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.role !== 'assistant') return m;
            const content = Array.isArray(m.content) ? m.content : [];
            const hasTarget = content.some(
              (p) => p.type === 'tool-call' && (p as { toolCallId?: string }).toolCallId === ev.toolCallId
            );
            if (!hasTarget) return m;
            return {
              ...m,
              content: content.map((p) => {
                if (p.type !== 'tool-call' || (p as { toolCallId?: string }).toolCallId !== ev.toolCallId) return p;
                const raw = ev.content ?? '';
                let result: unknown = raw;
                try {
                  result = JSON.parse(raw);
                } catch {
                  // keep as string
                }
                return { ...p, result };
              }),
            };
          })
        );
        break;
      }

      case 'RUN_FINISHED':
        setIsRunning(false);
        setRunPhase(null);
        clearInProgressMessage(ctx.sessionId);
        clearActiveRun(ctx.sessionId);
        if (ctx.assistantMessageId) {
          // 检测本轮末尾是否包含 [[QUESTION:...]] 标记。
          // 命中后设置 pendingQuestion 供前端渲染内联问题卡片，并通过普通消息回答；
          // 同时把 assistant 消息文本里的 marker 同步移除，避免聊天气泡里重复显示问题。
          const rawText = currentAssistantTextRef.current;
          const parsedMarker = rawText && !pendingQuestionRef.current ? parseQuestionMarker(rawText) : null;
          if (parsedMarker) {
            setPendingQuestion({
              threadId: ctx.sessionId,
              instanceId: instanceIdRef.current ?? '',
              questions: [{ question: parsedMarker.questionText, options: parsedMarker.options }],
              isMarkerQuestion: true,
            });
          }
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== ctx.assistantMessageId || m.role !== 'assistant') return m;
              const finalized = withToolCallsFinalized(m);
              let content = m.content;
              if (parsedMarker && Array.isArray(content)) {
                content = content.map((p) =>
                  p.type === 'text' && typeof (p as { text?: string }).text === 'string'
                    ? { ...p, text: (p as { text: string }).text.replace(QUESTION_MARKER_REGEX, '') }
                    : p
                ) as ThreadMessageLike['content'];
              }
              if (finalized.status?.type === 'running') {
                return { ...finalized, content, status: { type: 'complete', reason: 'unknown' } as const };
              }
              return { ...finalized, content };
            })
          );
        } else {
          // 整个 run 没有任何 assistant 消息返回，给出明确提示。
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: [{ type: 'text', text: '模型未返回任何内容，请检查模型配置、网络或账户余额后重试。' }],
              status: { type: 'incomplete', reason: 'error', error: 'empty response' },
            },
          ]);
        }
        currentAssistantTextRef.current = '';
        activeRunSessionIdRef.current = null;
        break;

      case 'RUN_ERROR': {
        setIsRunning(false);
        setRunPhase(null);
        clearInProgressMessage(ctx.sessionId);
        clearActiveRun(ctx.sessionId);
        activeRunSessionIdRef.current = null;
        const errorMsg = ev.message || 'Agent 运行出错';
        const classifiedMsg = classifyAgentError(errorMsg);
        // 终止原 assistant 消息中残留的「执行中」工具调用，避免永久停留在执行中。
        setMessages((prev) => prev.map((m) => (m.id === ctx.assistantMessageId && m.role === 'assistant' ? withToolCallsFinalized(m) : m)));
        const errorMessage: ThreadMessageLike = {
          id: generateId(),
          role: 'assistant',
          content: [{ type: 'text', text: classifiedMsg }],
          status: { type: 'incomplete', reason: 'error', error: errorMsg },
        };
        setMessages((prev) => [...prev, errorMessage]);
        break;
      }

      case 'CUSTOM': {
        if (ev.name !== 'agent.question') break;
        const payload = parseQuestionValue(ev.value);
        // gatewayd 发送的字段名为 snake_case 且 questions 嵌套在 interaction 下，
        // 需要兼容两种格式：gatewayd (instance_id/interaction.questions) 和标准 (instanceId/questions)。
        // 优先使用 gatewayd 实际返回的 instance_id（如 opencode/opencode-1），避免误用 payload.instanceId 的 UUID 导致 404。
        const instanceId = payload.instance_id ?? payload.instanceId ?? instanceIdRef.current ?? '';
        const rawQuestions = payload.questions ?? payload.interaction?.questions ?? [];
        const questions: AgentQuestionItem[] = Array.isArray(rawQuestions) ? rawQuestions.map((q: Record<string, unknown>) => ({
          id: (q.id as string) ?? undefined,
          header: (q.header as string) ?? (q.id as string) ?? undefined,
          question: (q.question as string) ?? (q.text as string) ?? undefined,
          text: (q.text as string) ?? undefined,
          options: Array.isArray(q.options) ? q.options as AgentQuestionOption[] : undefined,
        })) : [];
        const questionEvent: AgentQuestionEvent = {
          threadId: payload.threadId ?? payload.conversation_id ?? ctx.sessionId,
          instanceId,
          questions,
        };
        if (!questionEvent.instanceId) {
          console.warn('[useAgUiChat] agent.question event without instanceId, cannot respond', ev);
          break;
        }
        console.log('[useAgUiChat] agent.question received', questionEvent);
        setPendingQuestion(questionEvent);
        break;
      }

      default:
        break;
    }
  }, []);

  // 拉取会话历史消息并恢复未完成的 AI 回复快照（如有）。
  // loadMessages / tryRestoreSession / 断连重放收尾共用。
  const restoreSessionMessages = useCallback(async (targetSessionId: string, workspaceId?: string) => {
    const wsId = workspaceId || getCurrentWorkspaceId();
    const msgs = await api.get<BackendMessage[]>(`/v1/sessions/${targetSessionId}/messages?workspaceId=${encodeURIComponent(wsId)}`);
    const restoredMessages = msgs.map(backendMessageToThreadMessageLike);
    // 恢复未完成的 AI 回复：如果 localStorage 中有该会话的 in-progress 消息且后端未持久化，追加到末尾
    const inProgress = loadInProgressMessage(targetSessionId);
    if (inProgress && !restoredMessages.some((m) => m.id === inProgress.id)) {
      restoredMessages.push({
        ...inProgress,
        status: { type: 'incomplete' as const, reason: 'error' as const, error: '连接已中断，生成未完成' },
      });
    }
    setMessages(restoredMessages);
  }, []);

  // 启动断连重放：周期性拉取后端缓冲的 AG-UI 事件并复用 live 流的事件处理逻辑，
  // 直到收到终局事件（RUN_FINISHED / RUN_ERROR）后重新拉取服务端消息收尾。
  const startRunReattach = useCallback(
    (targetSessionId: string, runId: string, assistantMessageId: string | null) => {
      // 同一会话的重放循环只启动一次，避免重复调用产生多个定时器。
      if (reattachSessionIdRef.current === targetSessionId && reattachTimerRef.current) return;
      stopRunReattach();
      reattachSessionIdRef.current = targetSessionId;
      const ctx: AgUiEventProcessContext = { sessionId: targetSessionId, runId, assistantMessageId, currentTextMessageId: null };
      let pollInFlight = false;

      // 终局事件收尾：停止轮询并重新拉取服务端消息，
      // 用后端持久化的最终回复替换本地的合成占位消息。
      const finishReattach = async () => {
        stopRunReattach();
        try {
          await restoreSessionMessages(targetSessionId);
        } catch (err) {
          console.warn('[useAgUiChat] reload messages after replay failed:', err);
        }
      };

      const poll = async () => {
        if (reattachSessionIdRef.current !== targetSessionId || pollInFlight) return;
        pollInFlight = true;
        try {
          const events = await fetchSseReplayEvents(targetSessionId);
          if (!events) return;
          for (const ev of events) {
            if (ev.type === SSE_NO_PENDING_EVENTS_TYPE) continue;
            // 处理事件期间会话可能已切换，中止本次回放。
            if (reattachSessionIdRef.current !== targetSessionId) return;
            processAgUiEvent(ev, ctx);
            if (ev.type === 'RUN_FINISHED' || ev.type === 'RUN_ERROR') {
              await finishReattach();
              return;
            }
          }
        } finally {
          pollInFlight = false;
        }
      };

      console.log('[useAgUiChat] start sse replay reattach:', targetSessionId, runId);
      void poll();
      reattachTimerRef.current = setInterval(() => {
        void poll();
      }, SSE_REPLAY_POLL_INTERVAL_MS);
    },
    [processAgUiEvent, restoreSessionMessages, stopRunReattach]
  );

  // 恢复指定会话的 run 级状态：存在未过期的活跃 run 记录时恢复"思考中"并启动断连重放；
  // 过期记录直接丢弃，避免误恢复早已结束的 run。
  const maybeRestoreActiveRun = useCallback(
    (targetSessionId: string) => {
      const activeRun = loadActiveRun(targetSessionId);
      if (!activeRun) return;
      if (Date.now() - activeRun.startedAt > ACTIVE_RUN_TTL_MS) {
        clearActiveRun(targetSessionId);
        return;
      }
      setIsRunning(true);
      setRunPhase(activeRun.phase ?? PHASE_THINKING);
      // 纯思考阶段离开页面时本地没有任何 assistant 消息快照，
      // 补一条合成的运行中消息让"思考中"指示器渲染，重放事件也会汇入该消息。
      const syntheticId = generateId();
      setMessages((prev) => {
        if (prev.some((m) => m.role === 'assistant' && m.status?.type === 'running')) return prev;
        const synthetic: ThreadMessageLike = {
          id: syntheticId,
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          createdAt: new Date(),
          status: { type: 'running' },
        };
        return [...prev, synthetic];
      });
      startRunReattach(targetSessionId, activeRun.runId, syntheticId);
    },
    [startRunReattach]
  );

  const loadMessages = useCallback(async (targetSessionId: string | null) => {
    if (!targetSessionId) {
      setMessages([]);
      return;
    }
    try {
      await restoreSessionMessages(targetSessionId);
      maybeRestoreActiveRun(targetSessionId);
    } catch (err) {
      console.error('[useAgUiChat] load messages failed:', err);
      // 会话不属于当前工作区或当前用户时，静默清除旧 session 并创建新会话，不弹窗报错
      const isWorkspaceMismatch = err instanceof Error && err.message.includes('session not in this workspace');
      const isAccessDenied = err instanceof Error && err.message.includes('not allowed to access this session');
      if (!isWorkspaceMismatch && !isAccessDenied) {
        toast.error('加载会话历史失败');
      }
      if (isAccessDenied) {
        // 清除属于其他用户的旧 session，避免后续重复触发 403
        const wsId = getCurrentWorkspaceId();
        localStorage.removeItem(getSessionIdKey(wsId));
      }
      setMessages([]);
    }
  }, [restoreSessionMessages, maybeRestoreActiveRun]);

  const tryRestoreSession = useCallback(async (workspaceId?: string): Promise<string | null> => {
    const wsId = workspaceId || getCurrentWorkspaceId();
    const key = getSessionIdKey(wsId);
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    try {
      await restoreSessionMessages(saved, wsId);
      maybeRestoreActiveRun(saved);
      setSessionId(saved);
      setInstanceId(null);
      console.log('[useAgUiChat] session restored:', saved);
      return saved;
    } catch {
      console.log('[useAgUiChat] restore failed, session may have expired:', saved);
      localStorage.removeItem(key);
      return null;
    }
  }, [restoreSessionMessages, maybeRestoreActiveRun]);

  // 会话 ID 变更时持久化到 localStorage（按工作区隔离），用于页面刷新后恢复。
  useEffect(() => {
    if (sessionId) {
      const workspaceId = getCurrentWorkspaceId();
      localStorage.setItem(getSessionIdKey(workspaceId), sessionId);
    }
  }, [sessionId]);

  // 流式输出期间，将未完成的 AI 回复防抖缓存到 localStorage，用于页面刷新/关闭后恢复。
  // 500ms 防抖避免每个 SSE delta 都触发 localStorage 写入。
  useEffect(() => {
    if (!sessionId) return;
    const runningAssistant = messages.find((m) => m.role === 'assistant' && m.status?.type === 'running');
    if (!runningAssistant) return;
    const timer = setTimeout(() => {
      saveInProgressMessage(sessionId, runningAssistant);
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, sessionId]);

  const createSession = useCallback(
    async (pluginKey?: string): Promise<{ sessionId: string; instanceId: string } | null> => {
      try {
        const key = pluginKey || agentPluginKey;
        console.log('[useAgUiChat] createSession pluginKey=', key);
        const workspaceId = getCurrentWorkspaceId();
        const res = await api.post<{
          code: number;
          data?: { sessionId: string; instanceId?: string };
          message?: string;
        }>('/v1/sessions', {
          workspaceId,
          agentId: 'agent-default',
          agentType: 'chat',
          agent_key: key,
        });
        console.log('[useAgUiChat] createSession response', res);
        if (res.code !== 0 || !res.data?.sessionId) {
          toast.error(res.message || '创建会话失败');
          return null;
        }
        const id = res.data.sessionId;
        const instId = res.data.instanceId ?? '';
        console.log('[useAgUiChat] createSession success', id, instId);
        setSessionId(id);
        setInstanceId(instId);
        await loadMessages(id);
        return { sessionId: id, instanceId: instId };
      } catch (err) {
        console.error('[useAgUiChat] create session failed:', err);
        toast.error('创建会话失败');
        return null;
      }
    },
    [agentPluginKey, loadMessages]
  );

  const switchSession = useCallback(
    async (nextSessionId: string | null) => {
      console.log('[useAgUiChat] switchSession', nextSessionId);
      // 取消当前会话可能正在进行的 run，避免旧 SSE 事件污染新会话。
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // 清除当前会话的 in-progress 与活跃 run 缓存，避免切换后旧消息/旧运行态被恢复。
      if (sessionIdRef.current) {
        clearInProgressMessage(sessionIdRef.current);
        clearActiveRun(sessionIdRef.current);
      }
      activeRunSessionIdRef.current = null;
      stopRunReattach();
      setIsRunning(false);
      setRunPhase(null);
      setSessionId(nextSessionId);
      setInstanceId(null);
      await loadMessages(nextSessionId);
    },
    [loadMessages, stopRunReattach]
  );

  const cancelRun = useCallback(() => {
    console.log('[useAgUiChat] cancelRun');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopRunReattach();
    if (sessionIdRef.current) {
      clearInProgressMessage(sessionIdRef.current);
      clearActiveRun(sessionIdRef.current);
    }
    setIsRunning(false);
    setRunPhase(null);
    activeRunSessionIdRef.current = null;
    // 断连重放期间没有本地 SSE 可中断（abortController 为空），AbortError 分支不会触发，
    // 直接在本地把运行中的消息标记为已取消；live 流场景下该消息已是 incomplete，不会重复标记。
    setMessages((prev) =>
      prev.map((m) => {
        if (m.role !== 'assistant' || m.status?.type !== 'running') return m;
        return { ...withToolCallsFinalized(m), status: { type: 'incomplete', reason: 'cancelled' } as const };
      })
    );
  }, [stopRunReattach]);

  /**
   * 解析 agent.question 自定义事件的 value 负载。
   * 兼容 value 为 JSON 字符串或直接对象的情况。
   */
  const parseQuestionValue = (raw: unknown): Record<string, any> => {
    if (!raw) return {};
    let payload: any = raw;
    if (typeof raw === 'string') {
      try {
        payload = JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return payload ?? {};
  };

  /**
   * 回复当前 agent.question 事件。
   * 对于 marker 协议（[[QUESTION:...]]）直接通过普通消息发送回答，避免 gatewayd respond 不可靠问题；
   * 对于传统 agent.question 工具事件，保留 gatewayd respond 路径作为兼容。
   * 同时将用户回答作为 user 消息追加到会话流中，保持对话上下文可见。
   */
  const respondToQuestion = useCallback(
    async (message: string, displayText?: string) => {
      if (isRespondingToQuestionRef.current) {
        console.log('[useAgUiChat] respondToQuestion ignored: already responding');
        return;
      }
      isRespondingToQuestionRef.current = true;
      const question = pendingQuestion;
      if (!question) {
        console.warn('[useAgUiChat] respondToQuestion called without pending question');
        isRespondingToQuestionRef.current = false;
        return;
      }
      // 立即关闭提问弹窗，避免用户重复点击或等待接口响应。
      setPendingQuestion(null);
      // 将用户回答作为 user 消息追加到会话流，使对话上下文可见。
      // displayText 用于展示层（如“C. 选项描述”），实际发送给 agent 的仍是 message。
      // 展示时同时保留原问题，便于用户回顾上下文。
      const questionText = question.questions?.[0]?.question?.trim() || '';
      const answerText = displayText?.trim() || message.trim();
      const userAnswerContent = questionText ? `问题：${questionText}\n用户回答：${answerText}` : answerText;
      console.log('[useAgUiChat] respondToQuestion', { questionText, answerText, isMarkerQuestion: question.isMarkerQuestion, currentSessionId: sessionIdRef.current });
      try {
        if (question.isMarkerQuestion) {
          // 文本标记协议：把问题和回答作为普通 user 消息发送，触发新一轮 run。
          if (handleSendRef.current) {
            await handleSendRef.current(userAnswerContent);
          } else {
            console.warn('[useAgUiChat] handleSendRef not ready, cannot send marker answer');
            toast.error('发送回答失败，请刷新后重试');
          }
          return;
        }
        // 传统 agent.question 工具：追加用户回答消息后调用 gatewayd respond。
        const answerMessage: ThreadMessageLike = {
          id: generateId(),
          role: 'user',
          content: [{ type: 'text', text: userAnswerContent }],
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, answerMessage]);
        setIsRunning(true);
        setRunPhase(PHASE_THINKING);
        // question 事件中的 threadId 可能仍是 gatewayd 原始 threadId；如果此前 fallback 已切换过 sessionId，
        // 必须响应到当前活跃 session（sessionIdRef.current），否则 respond 会发到旧 thread，导致上下文断裂。
        const targetThreadId = sessionIdRef.current || question.threadId;
        const targetInstanceId = question.instanceId;
        const res = await api.post<RespondResponse>('/v1/agent/respond', {
          threadId: targetThreadId,
          instanceId: targetInstanceId,
          message,
        });
        console.log('[useAgUiChat] respondToQuestion response:', res);
        if (res.fallback && res.runId) {
          const fallbackSessionId = res.threadId || targetThreadId;
          console.log('[useAgUiChat] respondToQuestion fallback, starting reattach:', res.runId, 'session:', fallbackSessionId);
          if (fallbackSessionId !== sessionIdRef.current) {
            // 后端创建了全新的 thread 以绕过旧 agent 实例阻塞，前端切换到新 session。
            setSessionId(fallbackSessionId);
          }
          saveActiveRun({ runId: res.runId, sessionId: fallbackSessionId, startedAt: Date.now(), phase: PHASE_THINKING });
          startRunReattach(fallbackSessionId, res.runId, null);
        } else {
          console.log('[useAgUiChat] respondToQuestion direct ok, waiting for gatewayd continuation');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '回复 agent 失败';
        console.error('[useAgUiChat] respond to question failed:', err);
        toast.error(errMsg);
        cancelRun();
      } finally {
        isRespondingToQuestionRef.current = false;
      }
    },
    [pendingQuestion, cancelRun, startRunReattach]
  );

  /** 关闭待处理问题卡片并取消当前运行。 */
  const dismissQuestion = useCallback(() => {
    setPendingQuestion(null);
    cancelRun();
  }, [cancelRun]);

  const handleSend = useCallback(
    async (text: string, context: SendContext = {}) => {
      handleSendRef.current = handleSend;
      if (!text.trim() && !context.quotedCard) return;
      // 防止并发 run：如果当前已有 run 正在进行，忽略新的发送请求。
      // 避免 two runs interleaving 导致文字乱序和多个 AI 头像。
      if (isRunning) {
        console.log('[useAgUiChat] handleSend rejected: a run is already in progress');
        return;
      }
      // 用户发送新消息（包括回答问题）时关闭问题卡片。
      setPendingQuestion(null);
      console.log('[useAgUiChat] handleSend start, text=', text.slice(0, 50));

      let currentSessionId = sessionIdRef.current;
      if (!currentSessionId) {
        console.log('[useAgUiChat] no session, creating...');
        const created = await createSession();
        console.log('[useAgUiChat] createSession result=', created);
        if (!created) return;
        currentSessionId = created.sessionId;
      }
      console.log('[useAgUiChat] currentSessionId=', currentSessionId);

      const metadata: Record<string, unknown> = {};
      if (context.quotedCard) metadata.quotedCard = context.quotedCard;
      if (context.selectedRepos && context.selectedRepos.length > 0) metadata.selectedRepos = context.selectedRepos;
      metadata.originalText = text;

      const userMessageId = generateId();
      const userMessage: ThreadMessageLike = {
        id: userMessageId,
        role: 'user',
        content: [{ type: 'text', text }],
        metadata: { custom: metadata },
        createdAt: new Date(),
      };

      // 立即把用户消息加入当前会话，避免发送后消息消失。
      setMessages((prev) => [...prev, userMessage]);

      const runId = generateId();
      const repoNames = context.selectedRepos?.map(r => r.name);

      // 构建上下文项，将引用的任务卡片（需求/缺陷/用例）传递给后端。
      // value 直接使用对象，序列化后后端可通过 json.RawMessage 解析。
      const contextItems: { name: string; value: unknown }[] = [];
      if (context.quotedCard) {
        contextItems.push({ name: 'quotedCard', value: context.quotedCard });
      }
      if (context.selectedRepos && context.selectedRepos.length > 0) {
        contextItems.push({ name: 'selectedRepos', value: context.selectedRepos });
      }

      const runInput = {
        threadId: currentSessionId,
        runId,
        state: null,
        messages: [
          {
            id: userMessageId,
            role: 'user',
            content: wrapUserPrompt(text, currentSessionId, repoNames),
          },
        ],
        tools: [],
        context: contextItems,
        forwardedProps: {},
        agent_key: agentPluginKey,
      };

      setIsRunning(true);
      setRunPhase(PHASE_CONNECTING);
      activeRunSessionIdRef.current = currentSessionId;
      // 持久化 run 级状态：run 进行中页面导航/刷新后，据此恢复"思考中"并通过 SSE 重放断点续传。
      saveActiveRun({ runId, sessionId: currentSessionId, startedAt: Date.now(), phase: PHASE_CONNECTING });
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // 长时间未收到任何 SSE 事件时自动重置，避免前端一直显示“思考中”。
      // 变量声明在 try 外，保证 catch/finally 也能访问。
      let lastEventAt = Date.now();
      let noEventTimeoutFired = false;
      let noEventTimer: ReturnType<typeof setInterval> | null = null;
      const sendTime = Date.now();

      try {
        const workspaceId = getCurrentWorkspaceId();
        const agentUrl = `${AGENT_URL}?workspaceId=${encodeURIComponent(workspaceId)}`;
        const userMessages = runInput.messages.filter((m: any) => m.role === 'user');
        const lastUserMsg = userMessages[userMessages.length - 1];
        const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg?.content ?? '');
        const hasCommand = /^\//.test(userText);
        console.log('[useAgUiChat] >>> FETCH', { agentUrl, runId: runId, threadId: runInput.threadId, agentKey: runInput.agent_key, hasCommand, userTextPreview: userText.slice(0, 120), contextCount: runInput.context?.length ?? 0, timestamp: new Date().toISOString() });
        const response = await fetch(agentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(runInput),
          signal: abortController.signal,
        });

        const fetchElapsed = Date.now() - sendTime;
        console.log('[useAgUiChat] <<< FETCH response', { status: response.status, ok: response.ok, hasBody: !!response.body, elapsedMs: fetchElapsed, contentLength: response.headers.get('content-length'), contentType: response.headers.get('content-type') });
        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => '');
          throw new Error(`Agent run failed: ${response.status} ${body}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let sseBuffer = '';
        // 事件处理上下文：与断连重放共用的 processAgUiEvent 通过它回写 assistant 消息 ID。
        const eventCtx: AgUiEventProcessContext = { sessionId: currentSessionId, runId, assistantMessageId: null, currentTextMessageId: null };

        noEventTimer = setInterval(() => {
          if (Date.now() - lastEventAt > NO_EVENT_TIMEOUT_MS) {
            noEventTimeoutFired = true;
            if (noEventTimer) clearInterval(noEventTimer);
            abortController.abort();
          }
        }, NO_EVENT_TIMER_INTERVAL_MS);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const parts = sseBuffer.split(/\n\n/);
          sseBuffer = parts.pop() ?? '';
          for (const part of parts) {
            const events = parseSSE(part);
            for (const ev of events) {
              // 安全兜底：如果会话已切换，忽略旧 run 的事件。
              if (activeRunSessionIdRef.current !== currentSessionId) continue;

              lastEventAt = Date.now();
              processAgUiEvent(ev, eventCtx);
            }
          }
        }

        const streamEndTime = Date.now();
        console.log('[useAgUiChat] <<< SSE stream END', { runId, assistantMessageId: eventCtx.assistantMessageId, elapsedMs: streamEndTime - sendTime, activeRunSession: activeRunSessionIdRef.current, totalSSEEvents: 'see logs above' });
        // 兜底：SSE 流已结束但未收到 RUN_FINISHED/RUN_ERROR 时，
        // 强制重置运行状态，避免前端一直显示“思考中”。
        if (activeRunSessionIdRef.current === currentSessionId) {
          setIsRunning(false);
          setRunPhase(null);
          clearInProgressMessage(eventCtx.sessionId);
          clearActiveRun(eventCtx.sessionId);
          activeRunSessionIdRef.current = null;
          if (eventCtx.assistantMessageId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== eventCtx.assistantMessageId || m.role !== 'assistant') return m;
                const finalized = withToolCallsFinalized(m);
                if (finalized.status?.type === 'running') {
                  return { ...finalized, status: { type: 'incomplete', reason: 'error', error: '连接已中断，未收到完整响应' } as const };
                }
                return finalized;
              })
            );
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: [{ type: 'text', text: '连接已中断，未收到模型响应，请重试。' }],
                status: { type: 'incomplete', reason: 'error', error: 'connection closed' },
              },
            ]);
          }
        }
      } catch (err) {
        const catchTime = Date.now();
        const error = err instanceof Error ? err : new Error(String(err));
        console.log('[useAgUiChat] <<< CATCH', { runId, errorName: error.name, errorMessage: error.message, elapsedMs: catchTime - sendTime, noEventTimeoutFired });
        if (error.name === 'AbortError') {
          // abort 有三种来源：用户手动取消 / 切换会话 / 页面导航卸载（这些入口已各自清理状态，
          // activeRunSessionIdRef 已被置空）；以及长时间无事件的超时自动取消（真实失败，
          // 需要清理缓存避免之后被误恢复）。页面导航场景必须保留 localStorage 中的
          // 快照与活跃 run 记录，重进页面后据此恢复"思考中"并断点续传。
          const stillActive = activeRunSessionIdRef.current === currentSessionId;
          if (noEventTimeoutFired) {
            clearInProgressMessage(currentSessionId);
            clearActiveRun(currentSessionId);
            if (stillActive) {
              setIsRunning(false);
              setRunPhase(null);
              activeRunSessionIdRef.current = null;
              // 超时自动取消：给出明确超时提示，避免用户困惑。
              const timeoutMsg = '模型响应超时，未收到任何输出。请检查网络、模型配置或账户余额后重试。';
              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: 'assistant',
                  content: [{ type: 'text', text: timeoutMsg }],
                  status: { type: 'incomplete', reason: 'error', error: 'timeout' },
                },
              ]);
            }
            return;
          }
          if (stillActive) {
            setIsRunning(false);
            setRunPhase(null);
            activeRunSessionIdRef.current = null;
            // 用户手动取消：保留用户消息，把未完成的 assistant 消息标记为 incomplete。
            setMessages((prev) =>
              prev.map((m) => {
                if (m.role !== 'assistant' || m.status?.type !== 'running') return m;
                return { ...withToolCallsFinalized(m), status: { type: 'incomplete', reason: 'cancelled' } as const };
              })
            );
          }
          return;
        }
        console.error('[useAgUiChat] send failed:', error);
        toast.error(`发送失败：${error.message}`);
        // 真实失败：清理活跃 run 记录，避免之后被误恢复；仅当仍是当前活跃 run 时才重置
        // 运行状态，避免用户已切换会话后覆盖新会话恢复出的状态。
        clearActiveRun(currentSessionId);
        if (activeRunSessionIdRef.current === currentSessionId) {
          setIsRunning(false);
          setRunPhase(null);
          activeRunSessionIdRef.current = null;
        }
      } finally {
        console.log('[useAgUiChat] <<< FINALLY', { runId, msgCount: messages.length, elapsedMs: Date.now() - sendTime });
        if (noEventTimer) clearInterval(noEventTimer);
        abortControllerRef.current = null;
      }
    },
    [agentPluginKey, createSession, processAgUiEvent, isRunning]
  );

  // 使用自定义 ExternalStoreAdapter，直接由本地 state 驱动 assistant-ui runtime。
  const adapter = useMemo(
    () => ({
      messages,
      isRunning,
      convertMessage: (msg: ThreadMessageLike) => msg,
      onNew: async (message: { role: string; content: unknown; metadata?: { custom?: Record<string, unknown> } }) => {
        // assistant-ui composer 触发 onNew 时，我们已经在外部 handleSend 中处理发送。
        // 这里作为兜底：如果收到用户消息且当前未在运行，直接调用 handleSend。
        if (message.role === 'user') {
          const textParts = Array.isArray(message.content)
            ? message.content
                .filter((p) => (p as { type?: string }).type === 'text')
                .map((p) => (p as { text?: string }).text ?? '')
                .join('')
            : String(message.content ?? '');
          const meta = message.metadata?.custom ?? {};
          await handleSend(textParts, {
            quotedCard: meta.quotedCard as SendContext['quotedCard'],
            selectedRepos: meta.selectedRepos as SendContext['selectedRepos'],
          });
        }
      },
      onCancel: async () => cancelRun(),
    }),
    [messages, isRunning, handleSend, cancelRun]
  );

  const shared = useExternalStoreSharedOptions({});
  const runtime = useExternalStoreRuntime({ ...shared, ...adapter });

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  return {
    runtime,
    sessionId,
    instanceId,
    wsConnected: !isRunning,
    isRunning,
    runPhase,
    messages,
    sendMessage: handleSend,
    switchSession,
    createSession,
    cancelRun,
    tryRestoreSession,
    pendingQuestion,
    respondToQuestion,
    dismissQuestion,
  };
}
