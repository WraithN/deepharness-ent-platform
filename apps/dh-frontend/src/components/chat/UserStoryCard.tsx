import React, { useState } from 'react';
import { FileText, Eye, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface UserStoryItem {
  priority: 'P0' | 'P1' | 'P2';
  story: string;
  criteria: string[];
}

export interface UserStoryData {
  title: string;
  generatedAt: string;
  total: number;
  stories: UserStoryItem[];
}

const DEFAULT_TITLE = '用户故事';
const STORY_FILE_SUFFIX_REGEX = /stories\/(.+?)-user-stories\.md$/;
const MARKDOWN_HEADING_REGEX = /^#\s+(.+)$/m;
const REQUIREMENT_NAME_REGEX = /\*\*需求名称[：:]\s*(.+?)\*\*/;
const AI_THINKING_LINE_REGEX = /^(Let me|I need to|Let me create|Let me organize|I will|I should|I think|Okay|Now|First|Then|Here|Finally)\b.*/gim;
const US_PATTERN_REGEX = /(?:^|\n)(?:[-*]\s*)?US[-_]\d+[:：\s]*(.+?)(?=(?:\n(?:[-*]\s*)?US[-_]\d+[:：\s])|$)/gis;
const AS_PATTERN_REGEX = /作为(.+?)，我希望(.+?)，以便(.+?)[。.!\n]/;
const GIVEN_WHEN_THEN_REGEX = /(?:Given|When|Then)[：:\s]*(.+?)(?=(?:Given|When|Then)[：:\s]|$)/gis;
const PRIORITY_REGEX = /\bP([012])\b/;

const PRIORITY_TAG_CLASS: Record<string, string> = {
  P0: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  P1: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  P2: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const PRIORITY_ORDER = ['P0', 'P1', 'P2'] as const;

/**
 * 从文件路径或正文里提取卡片标题。
 */
function extractTitle(text: string, filePath: string): string {
  if (filePath) {
    const nameMatch = filePath.match(STORY_FILE_SUFFIX_REGEX);
    if (nameMatch) {
      return decodeURIComponent(nameMatch[1]);
    }
  }

  const headingMatch = text.match(MARKDOWN_HEADING_REGEX);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  const bracketMatch = text.match(REQUIREMENT_NAME_REGEX);
  if (bracketMatch) {
    return bracketMatch[1].trim();
  }

  return DEFAULT_TITLE;
}

/**
 * 清理原始文本：移除标记、AI 思考过程与空行。
 */
function cleanStoryText(text: string): string {
  return text
    .replace(/\[\[FILE:[^\]]+\]\]/g, '')
    .replace(/\[\[PROJECT:[^\]]+\]\]/g, '')
    .replace(/\[\[CARD:[^\]]+\]\]/g, '')
    .replace(AI_THINKING_LINE_REGEX, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从文本块中提取优先级（P0/P1/P2）。
 */
function extractPriority(block: string): 'P0' | 'P1' | 'P2' {
  const match = block.match(PRIORITY_REGEX);
  return match ? (`P${match[1]}` as 'P0' | 'P1' | 'P2') : 'P2';
}

/**
 * 从文本块中提取验收标准（Given/When/Then）。
 */
function extractCriteria(block: string): string[] {
  const criteria: string[] = [];
  const iterator = block.matchAll(GIVEN_WHEN_THEN_REGEX);
  for (const match of iterator) {
    const line = match[0].trim();
    if (line) criteria.push(line);
  }
  return criteria;
}

/**
 * 尝试按 "作为...，我希望...，以便..." 格式解析故事。
 */
function parseAsStories(text: string): UserStoryItem[] {
  const stories: UserStoryItem[] = [];
  const blocks = text.split(/(?=作为)/).filter((block) => block.trim().startsWith('作为'));

  for (const block of blocks) {
    const match = block.match(AS_PATTERN_REGEX);
    const story = match
      ? `作为${match[1].trim()}，我希望${match[2].trim()}，以便${match[3].trim()}。`
      : block.trim().split('\n')[0].trim();

    stories.push({
      priority: extractPriority(block),
      story,
      criteria: extractCriteria(block),
    });
  }

  return stories;
}

/**
 * 尝试按 US-001 / US_001 等编号条目解析故事。
 */
function parseUsCodeStories(text: string): UserStoryItem[] {
  const stories: UserStoryItem[] = [];
  const matches = text.matchAll(US_PATTERN_REGEX);

  for (const match of matches) {
    const block = match[1].trim();
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const story = lines[0] || block;

    stories.push({
      priority: extractPriority(block),
      story,
      criteria: extractCriteria(block),
    });
  }

  return stories;
}

/**
 * 兜底：将正文前若干非空行作为一条汇总故事。
 */
function createFallbackStory(text: string): UserStoryItem {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const summary = lines.slice(0, 3).join('\n') || text;
  return {
    priority: extractPriority(text),
    story: summary,
    criteria: extractCriteria(text),
  };
}

export function parseUserStoryFromText(text: string, filePath: string): UserStoryData | null {
  const cleanText = cleanStoryText(text);
  if (!cleanText) return null;

  const title = extractTitle(cleanText, filePath);

  let stories = parseAsStories(cleanText);
  if (stories.length === 0) {
    stories = parseUsCodeStories(cleanText);
  }
  if (stories.length === 0) {
    stories = [createFallbackStory(cleanText)];
  }

  return {
    title,
    generatedAt: new Date().toLocaleString('zh-CN'),
    total: stories.length,
    stories,
  };
}

interface UserStoryCardProps {
  data: UserStoryData;
}

export const UserStoryCard: React.FC<UserStoryCardProps> = ({ data }) => {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const priorityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0 };
  for (const item of data.stories) {
    priorityCounts[item.priority] = (priorityCounts[item.priority] || 0) + 1;
  }

  const presentCounts = PRIORITY_ORDER.filter((p) => priorityCounts[p] > 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success('用户故事已提交成功');
    } catch {
      toast.error('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleExpanded = () => setExpanded(!expanded);

  return (
    <>
      <div
        className="relative w-full p-6 rounded-2xl border border-border/60 bg-card cursor-pointer hover:shadow-md transition-all duration-300"
        style={{
          backgroundImage: 'radial-gradient(#e9e9f8 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 10px 10px',
        }}
        onClick={toggleExpanded}
      >
        <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-4">
          <FileText className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>

        <h3 className="text-lg font-semibold text-foreground mb-1">
          {data.title}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">{data.generatedAt}</p>

        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {presentCounts.map((p) => (
            <span
              key={p}
              className={cn('text-xs px-2.5 py-1 rounded-full font-medium', PRIORITY_TAG_CLASS[p])}
            >
              {p} &times; {priorityCounts[p]}
            </span>
          ))}
          <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
            总计 {data.total}条
          </span>
        </div>

        <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
              className="relative w-10 h-10 rounded-lg border border-border bg-card text-foreground/70 hover:bg-accent hover:text-foreground hover:border-primary/40 flex items-center justify-center transition-colors shadow-sm"
              title="一键查看所有故事点"
            >
            <Eye className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
            className="relative w-10 h-10 rounded-lg bg-violet-600 text-white hover:bg-violet-700 flex items-center justify-center transition-colors disabled:opacity-60"
            title="一键提交全部故事点"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 p-4 rounded-2xl border border-border/60 bg-card">
          <h4 className="text-lg font-semibold mb-4">
            {data.title}（共{data.total}条）
          </h4>
          <div className="space-y-4">
            {data.stories.map((item, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-border/50 p-5 bg-muted/20"
              >
                <span
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-full font-medium inline-block mb-3',
                    PRIORITY_TAG_CLASS[item.priority],
                  )}
                >
                  {item.priority}
                </span>
                <p className="text-sm text-foreground leading-relaxed mb-3">
                  {item.story}
                </p>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  验收标准 Given / When / Then
                </p>
                <ul className="space-y-2">
                  {item.criteria.map((line, ci) => (
                    <li
                      key={ci}
                      className="text-xs text-muted-foreground leading-relaxed flex gap-2"
                    >
                      <span className="text-primary shrink-0 mt-0.5">&#8226;</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
