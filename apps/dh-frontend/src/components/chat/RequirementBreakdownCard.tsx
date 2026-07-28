import React, { useState, useEffect } from 'react';
import { GitBranch, Eye, EyeOff, Send, FileText, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { fileApi } from '@/lib/file-api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

export interface RequirementDescription {
  role?: string;
  scenario?: string;
  action?: string;
  value?: string;
  constraints?: string;
}

export interface AcceptanceCriteria {
  normal: string[];
  error: string[];
  ui: string[];
  boundary: string[];
}

export interface RequirementItem {
  id: string;
  parentId?: string | null;
  title: string;
  description?: RequirementDescription;
  acceptanceCriteria?: AcceptanceCriteria;
  priority?: 'P0' | 'P1' | 'P2';
  /** 若该需求项与库中已有需求匹配，agent 会回填此字段。有值时提交默认排除。 */
  workitemId?: string;
}

export interface RequirementBreakdownData {
  title: string;
  generatedAt: string;
  total: number;
  items: RequirementItem[];
}

const DEFAULT_TITLE = '需求拆分';
const REQ_BREAKDOWN_FILE_SUFFIX_REGEX = /req-breakdown\/(.+?)-req-breakdown\.md$/;
const MARKDOWN_HEADING_REGEX = /^#\s+(.+)$/m;
const AI_THINKING_LINE_REGEX = /^(Let me|I need to|Let me create|Let me organize|I will|I should|I think|Okay|Now|First|Then|Here|Finally)\b.*/gim;
const REQ_BREAKDOWN_JSON_REGEX = /\[\[REQ_BREAKDOWN_START\]\]([\s\S]*?)\[\[REQ_BREAKDOWN_END\]\]/;

const PRIORITY_TAG_CLASS: Record<string, string> = {
  P0: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  P1: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  P2: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const PRIORITY_ORDER = ['P0', 'P1', 'P2'] as const;

function extractTitle(text: string, filePath: string): string {
  if (filePath) {
    const nameMatch = filePath.match(REQ_BREAKDOWN_FILE_SUFFIX_REGEX);
    if (nameMatch) {
      return decodeURIComponent(nameMatch[1]);
    }
  }
  const headingMatch = text.match(MARKDOWN_HEADING_REGEX);
  if (headingMatch) {
    return headingMatch[1].trim();
  }
  return DEFAULT_TITLE;
}

function cleanText(text: string): string {
  return text
    .replace(/\[\[FILE:[^\]]+\]\]/g, '')
    .replace(/\[\[PROJECT:[^\]]+\]\]/g, '')
    .replace(/\[\[CARD:[^\]]+\]\]/g, '')
    .replace(/\[\[REQ_BREAKDOWN_START\]\][\s\S]*?\[\[REQ_BREAKDOWN_END\]\]/g, '')
    .replace(AI_THINKING_LINE_REGEX, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseRequirementBreakdownFromText(
  text: string,
  filePath: string
): RequirementBreakdownData | null {
  const match = text.match(REQ_BREAKDOWN_JSON_REGEX);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1].trim());
    if (!raw.items || !Array.isArray(raw.items)) return null;
    const items: RequirementItem[] = raw.items.map((it: unknown) => {
      const item = it as Record<string, unknown>;
      return {
        id: String(item.id ?? ''),
        parentId: item.parentId ?? null,
        title: String(item.title ?? ''),
        description: item.description as RequirementDescription | undefined,
        acceptanceCriteria: item.acceptanceCriteria as AcceptanceCriteria | undefined,
        priority: (item.priority as 'P0' | 'P1' | 'P2') ?? 'P2',
      };
    });
    return {
      title: raw.title || extractTitle(cleanText(text), filePath),
      generatedAt: new Date().toLocaleString('zh-CN'),
      total: items.length,
      items,
    };
  } catch {
    return null;
  }
}

// 匹配需求拆分 JSON 文件：路径中包含 req-breakdown 且以 .json 结尾。
const REQ_BREAKDOWN_JSON_FILE_REGEX = /req-breakdown.*\.json$/i;

export function useRequirementBreakdownData(
  text: string,
  fileAttachments: string[]
): {
  data: RequirementBreakdownData | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<RequirementBreakdownData | null>(() =>
    parseRequirementBreakdownFromText(text, fileAttachments[0] ?? '')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fileAttachments 每次渲染都是新数组引用，用 join 后的字符串作为稳定依赖避免无限循环
  const fileAttachmentsKey = fileAttachments.join('\n');

  useEffect(() => {
    const inlineData = parseRequirementBreakdownFromText(text, fileAttachments[0] ?? '');
    if (inlineData) {
      setData(inlineData);
      setLoading(false);
      setError(null);
      return;
    }
    const jsonFile = fileAttachments.find((p) => REQ_BREAKDOWN_JSON_FILE_REGEX.test(p));
    if (!jsonFile) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    fileApi
      .content(jsonFile)
      .then((file) => {
        try {
          const parsed = JSON.parse(file.content) as RequirementBreakdownData;
          if (!parsed.items || !Array.isArray(parsed.items)) {
            throw new Error('invalid structure');
          }
          setData(parsed);
          setError(null);
        } catch {
          setData(null);
          setError('JSON 解析失败');
        }
      })
      .catch(() => {
        setData(null);
        setError('文件读取失败');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fileAttachmentsKey]);

  return { data, loading, error };
}

export interface RequirementBreakdownSubmitResult {
  created: { id: string; workitemId: string }[];
}

interface RequirementBreakdownCardProps {
  data?: RequirementBreakdownData | null;
  loading?: boolean;
  error?: string | null;
  isPreviewActive?: boolean;
  onPreview?: (data: RequirementBreakdownData) => void;
  /** 提交选中的需求项，由父组件完成实际创建工作项并返回创建结果。 */
  onSubmit?: (items: RequirementItem[]) => Promise<RequirementBreakdownSubmitResult>;
}

export const RequirementBreakdownCard: React.FC<RequirementBreakdownCardProps> = ({
  data,
  loading,
  error,
  isPreviewActive,
  onPreview,
  onSubmit,
}) => {
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  // 记录已提交成功的需求项 id -> workitemId，避免重复提交。
  const [submittedMap, setSubmittedMap] = useState<Record<string, string>>({});
  // 仅未标记 workitemId 且未在本地提交过的需求项可提交
  const submittableItems = data?.items.filter((i) => !i.workitemId && !submittedMap[i.id]) ?? [];
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(submittableItems.map((i) => i.id)));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (data) {
      setSelectedIds(new Set(data.items.filter((i) => !i.workitemId && !submittedMap[i.id]).map((i) => i.id)));
    }
  }, [data, submittedMap]);

  if (!data) {
    return (
      <div className="w-full p-4 rounded-2xl border border-border/60 bg-card">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
            <GitBranch className="h-6 w-6 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">需求拆分</p>
            {loading && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                加载结构化数据中…
              </p>
            )}
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            {!loading && !error && <p className="text-xs text-muted-foreground mt-1">暂无数据</p>}
          </div>
        </div>
      </div>
    );
  }

  const topLevel = data.items.filter((i) => !i.parentId);
  const priorityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0 };
  for (const item of data.items) {
    priorityCounts[item.priority || 'P2'] = (priorityCounts[item.priority || 'P2'] || 0) + 1;
  }
  const presentCounts = PRIORITY_ORDER.filter((p) => priorityCounts[p] > 0);

  const handleOpenSubmitDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(new Set(submittableItems.map((i) => i.id)));
    setSubmitDialogOpen(true);
  };

  const handleToggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(submittableItems.map((i) => i.id)) : new Set());
  };

  const handleToggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) {
      toast.error('请至少选择一条需求');
      return;
    }
    if (!onSubmit) {
      toast.error('提交功能未配置');
      return;
    }
    const itemsToSubmit = submittableItems.filter((i) => selectedIds.has(i.id));
    setSubmitting(true);
    try {
      const result = await onSubmit(itemsToSubmit);
      setSubmittedMap((prev) => {
        const next = { ...prev };
        for (const c of result.created) {
          next[c.id] = c.workitemId;
        }
        return next;
      });
      toast.success(`已提交 ${result.created.length} 条需求`);
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
            <GitBranch className="h-6 w-6 text-violet-600 dark:text-violet-400" />
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
                  {p} × {priorityCounts[p]}
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
                {isPreviewActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
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

            {topLevel.length > 0 && (
              <div className="mt-3 space-y-1">
                {topLevel.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3 w-3 shrink-0 text-violet-500/70" />
                    <span className="truncate">{item.title}</span>
                    {item.priority && (
                      <Badge variant="secondary" className={cn('text-[10px] px-1 py-0', PRIORITY_TAG_CLASS[item.priority])}>
                        {item.priority}
                      </Badge>
                    )}
                  </div>
                ))}
                {topLevel.length > 3 && (
                  <p className="text-[10px] text-muted-foreground pl-5">还有 {topLevel.length - 3} 项主需求…</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>提交需求</DialogTitle>
            <DialogDescription>选择需要提交的需求项，默认全选。</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-2 border-b border-border/50">
            <Checkbox
              id="select-all-req"
              checked={submittableItems.length > 0 && selectedIds.size === submittableItems.length}
              onCheckedChange={(checked) => handleToggleAll(checked === true)}
            />
            <label htmlFor="select-all-req" className="text-sm font-medium cursor-pointer">
              全选 ({selectedIds.size}/{submittableItems.length})
            </label>
            {data.items.length !== submittableItems.length && (
              <span className="text-xs text-muted-foreground ml-auto">
                {data.items.length - submittableItems.length} 项已存在，已排除
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto py-2 space-y-3">
            {data.items.map((item) => {
              const isExisting = !!item.workitemId;
              return (
              <div key={item.id} className={cn(
                'flex items-start gap-3 p-3 rounded-xl border border-border/50 bg-muted/20',
                isExisting && 'opacity-60'
              )}>
                <Checkbox
                  id={`req-${item.id}`}
                  checked={selectedIds.has(item.id)}
                  onCheckedChange={(checked) => handleToggleOne(item.id, checked === true)}
                  className="mt-1"
                  disabled={isExisting}
                />
                <label htmlFor={`req-${item.id}`} className={cn('flex-1 min-w-0', !isExisting && 'cursor-pointer')}>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        PRIORITY_TAG_CLASS[item.priority || 'P2']
                      )}
                    >
                      {item.priority || 'P2'}
                    </span>
                    <span className="text-xs text-muted-foreground">#{item.id}</span>
                    {isExisting && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                        已存在
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{item.title}</p>
                </label>
              </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDialogOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || selectedIds.size === 0}>
              {submitting && <Send className="h-4 w-4 animate-spin mr-2" />}
              提交 ({selectedIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

interface RequirementBreakdownTreeProps {
  data: RequirementBreakdownData;
}

export const RequirementBreakdownTree: React.FC<RequirementBreakdownTreeProps> = ({ data }) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(data.items.filter((i) => !i.parentId).map((i) => i.id)));

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(data.items.map((i) => i.id)));
  const collapseAll = () => setExpanded(new Set());

  const itemMap = new Map(data.items.map((i) => [i.id, i]));
  const childrenOf = (parentId: string) => data.items.filter((i) => i.parentId === parentId);

  const renderItem = (item: RequirementItem, depth: number) => {
    const children = childrenOf(item.id);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(item.id);
    const desc = item.description;
    const ac = item.acceptanceCriteria;

    return (
      <div key={item.id} className={cn('border-l border-border/50', depth > 0 && 'ml-4')}>
        <div className="py-2 pl-3">
          <div className="flex items-start gap-2">
            {hasChildren && (
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="mt-0.5 text-muted-foreground hover:text-foreground"
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                <Badge variant="secondary" className={cn('text-[10px] px-1 py-0', PRIORITY_TAG_CLASS[item.priority || 'P2'])}>
                  {item.priority || 'P2'}
                </Badge>
                {item.workitemId && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 text-muted-foreground">
                    已存在
                  </Badge>
                )}
              </div>

              {desc && (desc.role || desc.scenario || desc.action || desc.value || desc.constraints) && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {desc.role && <p><span className="font-medium text-foreground/80">角色：</span>{desc.role}</p>}
                  {desc.scenario && <p><span className="font-medium text-foreground/80">场景：</span>{desc.scenario}</p>}
                  {desc.action && <p><span className="font-medium text-foreground/80">动作：</span>{desc.action}</p>}
                  {desc.value && <p><span className="font-medium text-foreground/80">价值：</span>{desc.value}</p>}
                  {desc.constraints && <p><span className="font-medium text-foreground/80">约束：</span>{desc.constraints}</p>}
                </div>
              )}

              {ac && (ac.normal?.length > 0 || ac.error?.length > 0 || ac.ui?.length > 0 || ac.boundary?.length > 0) && (
                <div className="mt-2 space-y-2">
                  <ACGroup title="正常流程验收" items={ac.normal} />
                  <ACGroup title="异常流程验收" items={ac.error} />
                  <ACGroup title="UI & 交互验收" items={ac.ui} />
                  <ACGroup title="边界约束验收" items={ac.boundary} />
                </div>
              )}
            </div>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="mt-1">
            {children.map((child) => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
        <div>
          <h2 className="text-base font-semibold">{data.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            共 {data.total} 条需求 · {data.items.filter((i) => !i.parentId).length} 项父需求
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={expandAll}>
            展开全部
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={collapseAll}>
            收起全部
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {data.items
          .filter((i) => !i.parentId)
          .map((item) => renderItem(item, 0))}
      </div>
    </div>
  );
};

function ACGroup({ title, items }: { title: string; items: string[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="bg-muted/30 rounded-lg p-2">
      <p className="text-xs font-medium text-foreground/80 mb-1">{title}</p>
      <ul className="space-y-1">
        {items.map((it, idx) => (
          <li key={idx} className="text-xs text-muted-foreground pl-2 border-l-2 border-violet-300/60">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RequirementBreakdownCard;
