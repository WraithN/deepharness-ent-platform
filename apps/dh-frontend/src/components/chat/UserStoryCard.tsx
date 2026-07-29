import React, { useState } from 'react';
import { FileText, Eye, EyeOff, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

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
  isPreviewActive?: boolean;
  onPreview?: (data: UserStoryData) => void;
}

export const UserStoryCard: React.FC<UserStoryCardProps> = ({ data, isPreviewActive, onPreview }) => {
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(data.stories.map((_, i) => i)));
  const [submitting, setSubmitting] = useState(false);

  const priorityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0 };
  for (const item of data.stories) {
    priorityCounts[item.priority] = (priorityCounts[item.priority] || 0) + 1;
  }

  const presentCounts = PRIORITY_ORDER.filter((p) => priorityCounts[p] > 0);

  const handleOpenSubmitDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(new Set(data.stories.map((_, i) => i)));
    setSubmitDialogOpen(true);
  };

  const handleToggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(data.stories.map((_, i) => i)) : new Set());
  };

  const handleToggleOne = (idx: number, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(idx);
      else next.delete(idx);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      toast.error('请至少选择一条用户故事');
      return;
    }
    setSubmitting(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setSubmitDialogOpen(false);
    } catch {
      toast.error('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPreview?.(data);
  };

  return (
    <>
      <div
        className={cn(
          'w-full p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-500 cursor-pointer',
          isPreviewActive
            ? 'border-violet-500 bg-violet-50/80 dark:bg-violet-900/20 ring-2 ring-violet-500/20'
            : 'border-border/60 bg-card hover:border-violet-500/30'
        )}
        onClick={handlePreview}
      >
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
            <FileText className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground truncate">{data.title}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 font-medium">
                共 {data.total} 条
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{data.generatedAt}</p>

            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {presentCounts.map((p) => (
                <span
                  key={p}
                  className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', PRIORITY_TAG_CLASS[p])}
                >
                  {p} &times; {priorityCounts[p]}
                </span>
              ))}
              <button
                type="button"
                onClick={handlePreview}
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium transition-transform duration-200 hover:scale-105 active:scale-95',
                  isPreviewActive
                    ? 'text-violet-700 dark:text-violet-300 underline'
                    : 'text-violet-600 dark:text-violet-400 hover:underline'
                )}
              >
                {isPreviewActive ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {isPreviewActive ? '关闭预览' : '查看全部'}
              </button>
              <button
                type="button"
                onClick={handleOpenSubmitDialog}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                <Send className="h-3.5 w-3.5" />
                提交
              </button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>提交用户故事</DialogTitle>
            <DialogDescription>
              选择需要提交的用户故事，默认全选。
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2 border-b border-border/50">
            <Checkbox
              id="select-all"
              checked={selectedIds.size === data.stories.length && data.stories.length > 0}
              onCheckedChange={(checked) => handleToggleAll(checked === true)}
            />
            <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
              全选 ({selectedIds.size}/{data.stories.length})
            </label>
          </div>

          <div className="flex-1 overflow-y-auto py-2 space-y-3">
            {data.stories.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 rounded-xl border border-border/50 bg-muted/20"
              >
                <Checkbox
                  id={`story-${idx}`}
                  checked={selectedIds.has(idx)}
                  onCheckedChange={(checked) => handleToggleOne(idx, checked === true)}
                  className="mt-1"
                />
                <label htmlFor={`story-${idx}`} className="flex-1 min-w-0 cursor-pointer">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        PRIORITY_TAG_CLASS[item.priority],
                      )}
                    >
                      {item.priority}
                    </span>
                    <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{item.story}</p>
                </label>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDialogOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || selectedIds.size === 0}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              提交 ({selectedIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
