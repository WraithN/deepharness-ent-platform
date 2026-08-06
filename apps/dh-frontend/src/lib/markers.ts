/**
 * AI 回复标记解析工具 - 单一事实来源
 *
 * 所有 [[MARKER:...]] 标记的 regex、解析函数和清洗函数集中在此模块，
 * 供 AssistantMessage、useAgUiChat、ProcessDetail 等消费方统一引用。
 *
 * ## 标记类型与交互操作
 *
 * | 标记 | 解析为 | UI 组件 | 用户可执行操作 |
 * |------|--------|---------|----------------|
 * | `[[FILE:path]]` | 文件路径列表 | FileAttachmentCard | 点击在预览面板打开文件 (onFilePreview)，支持关联需求 ID |
 * | `[[PROJECT:path]]` | 工程目录路径 | ProjectCard / PrototypeCard | 点击预览工程 (onProjectPreview)；路径含 /products/prototypes/ 时渲染为 PrototypeCard (onPrototypePreview)，并屏蔽同目录下的普通 FILE/PROJECT 卡片 |
 * | `[[CARD:user_story]]` | 用户故事数据 | UserStoryCard | 点击预览用户故事内容 (onUserStoryPreview)，在预览面板高亮展示 |
 * | `[[CARD:req_breakdown]]` | 需求拆分 JSON | RequirementBreakdownCard | 点击预览拆分详情 (onReqBreakdownPreview)；点击提交将拆分项写入需求 (onReqBreakdownSubmit，异步) |
 * | `[[QUESTION:问题\|A.选项\|B.选项]]` | 问题 + 选项 | 内联问题卡片 (pendingQuestion) | 用户选择选项后作为新 user 消息发送给 agent (respondToQuestion)，触发新一轮 run；可关闭 (dismissQuestion，同时取消当前 run) |
 * | `[[REQ_NAME:name]]` | 需求名称字符串 | 无独立卡片，注入 PrototypeCard 标题 | 用于自动匹配已有需求 ID (resolvedWorkitemId)，使原型采纳时关联到正确需求 |
 * | `[[REQ_BREAKDOWN_START]]...[[REQ_BREAKDOWN_END]]` | 需求拆分 JSON 块 | 同 [[CARD:req_breakdown]] | 同上 |
 * | `[[REVIEW_REPORT_START]]...[[REVIEW_REPORT_END]]` | 评审报告数据 | ReviewReportCard | 点击预览报告 (onReviewReportPreview)；点击采纳将报告写入需求 (onReviewAdopt，异步)；点击修复触发 agent 修复 (onReviewFix) |
 *
 * ## 通用行为
 *
 * - 所有标记都会从展示文本中被 stripAllMarkers() 移除，避免在 Markdown 气泡中重复显示。
 * - 卡片仅在消息生成完成 (!isRunning) 后展示，避免输出过程中提前出现卡片。
 * - 路径中包含中文占位符（如"绝对路径""需求名称"）的标记会被 hasUnresolvedPlaceholders() 过滤，不生成卡片。
 */

// ── Regex 常量 ──

export const FILE_MARKER_REGEX = /\[\[FILE:([^\]]+)\]\]/g;
export const PROJECT_MARKER_REGEX = /\[\[PROJECT:([^\]]+)\]\]/g;
export const CARD_MARKER_REGEX = /\[\[CARD:([^\]]+)\]\]/g;
export const REQ_NAME_MARKER_REGEX = /\[\[REQ_NAME:([^\]]+)\]\]/g;
export const QUESTION_MARKER_REGEX = /\[\[QUESTION:([\s\S]*?)\]\]/g;
export const REQ_BREAKDOWN_JSON_REGEX = /\[\[REQ_BREAKDOWN_START\]\][\s\S]*?\[\[REQ_BREAKDOWN_END\]\]/g;
export const REVIEW_REPORT_MARKER_REGEX = /\[\[REVIEW_REPORT_START\]\][\s\S]*?\[\[REVIEW_REPORT_END\]\]|\[\[REVIEW_REPORT:\{[^\]]*\}\]\]/g;

// ── 类型 ──

/** 解析后的提问选项 */
export interface ParsedQuestionOption {
  label: string;
  value: string;
}

/** 解析后的提问标记 */
export interface ParsedQuestion {
  questionText: string;
  options: ParsedQuestionOption[];
}

// ── 占位符校验 ──

/** 未解析占位符列表：AI 模板中的描述性文字，非真实路径 */
const UNRESOLVED_PLACEHOLDERS = [
  '绝对路径', '需求名称', '调研主题', '工程名',
  '功能名称', '功能名', '分析主题', '用户故事',
] as const;

/** 检查路径是否包含未解析的中文占位符 */
export function hasUnresolvedPlaceholders(filePath: string): boolean {
  return UNRESOLVED_PLACEHOLDERS.some(pattern => filePath.includes(pattern));
}

// ── 解析函数 ──

/** 从文本中提取所有 [[FILE:...]] 路径，过滤占位符 */
export function parseFileMarkers(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(FILE_MARKER_REGEX)) {
    const path = match[1]?.trim();
    if (path && !paths.includes(path) && !hasUnresolvedPlaceholders(path)) {
      paths.push(path);
    }
  }
  return paths;
}

/** 从文本中提取所有 [[PROJECT:...]] 路径，过滤占位符 */
export function parseProjectMarkers(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(PROJECT_MARKER_REGEX)) {
    const path = match[1]?.trim();
    if (path && !paths.includes(path) && !hasUnresolvedPlaceholders(path)) {
      paths.push(path);
    }
  }
  return paths;
}

/** 从文本中提取所有 [[CARD:...]] 类型（去重） */
export function parseCardTypes(text: string): string[] {
  const types: string[] = [];
  for (const match of text.matchAll(CARD_MARKER_REGEX)) {
    const type = match[1]?.trim();
    if (type && !types.includes(type)) {
      types.push(type);
    }
  }
  return types;
}

/** 从文本中提取第一个 [[REQ_NAME:...]] 值 */
export function parseReqName(text: string): string | undefined {
  const match = text.match(REQ_NAME_MARKER_REGEX);
  if (!match) return undefined;
  // .match with /g returns array of full matches; use matchAll for capture group
  for (const m of text.matchAll(REQ_NAME_MARKER_REGEX)) {
    return m[1]?.trim();
  }
  return undefined;
}

/**
 * 从文本末尾解析 [[QUESTION:问题|A. 选项一|B. 选项二|...]] 标记。
 * 仅取最后一个标记，返回去掉标记后的 cleanText、问题正文及选项列表。
 */
export function parseQuestionMarker(rawText: string): { cleanText: string } & ParsedQuestion | null {
  const matches = Array.from(rawText.matchAll(QUESTION_MARKER_REGEX));
  if (matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1];
  const inner = lastMatch[1].trim();
  if (!inner) return null;

  const parts = inner.split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const [questionText, ...optionParts] = parts;
  const options: ParsedQuestionOption[] = optionParts.map((opt, idx) => {
    const letter = String.fromCharCode(65 + idx);
    const m = opt.match(/^([A-Z])\.\s*(.*)$/);
    if (m) {
      const text = m[2]?.trim() || opt;
      return { label: text, value: `${m[1]}. ${text}` };
    }
    return { label: opt, value: `${letter}. ${opt}` };
  });

  const before = rawText.slice(0, lastMatch.index);
  const after = rawText.slice((lastMatch.index ?? 0) + lastMatch[0].length);
  const cleanText = (before + after).trim();

  return { cleanText, questionText: questionText.trim(), options };
}

// ── 清洗函数 ──

/** 所有标记 regex 列表，用于从展示文本中移除 */
const ALL_MARKER_REGEXES = [
  FILE_MARKER_REGEX,
  PROJECT_MARKER_REGEX,
  REQ_NAME_MARKER_REGEX,
  CARD_MARKER_REGEX,
  REQ_BREAKDOWN_JSON_REGEX,
  REVIEW_REPORT_MARKER_REGEX,
  QUESTION_MARKER_REGEX,
] as const;

/** 从文本中移除所有已知标记，返回干净文本 */
export function stripAllMarkers(text: string): string {
  let result = text;
  for (const regex of ALL_MARKER_REGEXES) {
    result = result.replace(regex, '');
  }
  return result.trim();
}

/**
 * 从多段文本中提取所有标记路径（FILE + PROJECT），合并返回。
 * 用于从消息的所有 text 部件中统一收集附件路径。
 */
export function parseAllFilePaths(textParts: string[]): { files: string[]; projects: string[] } {
  const files: string[] = [];
  const projects: string[] = [];
  for (const text of textParts) {
    if (!text) continue;
    for (const path of parseFileMarkers(text)) {
      if (!files.includes(path)) files.push(path);
    }
    for (const path of parseProjectMarkers(text)) {
      if (!projects.includes(path)) projects.push(path);
    }
  }
  return { files, projects };
}
