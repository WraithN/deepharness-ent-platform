import { MoreHorizontal, Search } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { teamApi } from '@/lib/team-api';
import type { Prompt, PromptStatus, TeamPromptCategory } from '@/types';
import { type CategoryItem, CategoryManager } from './CategoryManager';
import { CategoryMultiCell } from './CategoryMultiCell';
import { ALL_FILTER_VALUE, matchCategoryFilter, REVIEW_ACTIONS_BY_STATUS, type ReviewAction } from './review-actions';
import { StatusBadge } from './StatusBadge';

const DEFAULT_PAGE_SIZE = 10;
const REVIEW_SUCCESS_MESSAGE = '审核操作已生效';
const REVIEW_FAILED_MESSAGE = '审核操作失败';

// 超管提示词管理：分页列表 + 分类管理 + 多分类编辑 + 审核操作菜单。
export const PromptManagement: React.FC = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [categories, setCategories] = useState<TeamPromptCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<PromptStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_FILTER_VALUE);
  const [viewingPrompt, setViewingPrompt] = useState<Prompt | null>(null);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const res = await teamApi.listPrompts(page, DEFAULT_PAGE_SIZE);
      setPrompts(res.list);
      setTotal(res.total);
    } catch {
      toast.error('加载提示词失败');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    setCategoryLoading(true);
    try {
      const list = await teamApi.listPromptCategories();
      setCategories(list);
    } catch {
      toast.error('加载提示词分类失败');
    } finally {
      setCategoryLoading(false);
    }
  };

  useEffect(() => {
    loadPrompts();
  }, [page]);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, categoryFilter]);

  const categoryItems: CategoryItem[] = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name, builtin: c.builtin })),
    [categories]
  );

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.name })),
    [categories]
  );

  const filteredPrompts = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return prompts
      .filter((p) => statusFilter === 'all' || p.status === statusFilter)
      .filter((p) => matchCategoryFilter(categoryFilter, p.useCase, p.categoryIds, categories))
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          (p.description || '').toLowerCase().includes(term) ||
          p.useCase.toLowerCase().includes(term)
      );
  }, [prompts, statusFilter, categoryFilter, categories, searchTerm]);

  const handleReview = async (prompt: Prompt, action: ReviewAction) => {
    try {
      const updated = await teamApi.reviewPrompt(prompt.id, action);
      setPrompts((prev) => prev.map((p) => (p.id === prompt.id ? { ...p, status: updated.status } : p)));
      toast.success(REVIEW_SUCCESS_MESSAGE);
    } catch {
      toast.error(REVIEW_FAILED_MESSAGE);
    }
  };

  const handleSaveCategories = async (prompt: Prompt, categoryIds: string[]) => {
    const updated = await teamApi.updatePromptCategories(prompt.id, categoryIds);
    setPrompts((prev) =>
      prev.map((p) => (p.id === prompt.id ? { ...p, categoryIds: updated.categoryIds } : p))
    );
  };

  const handleCreateCategory = async (name: string) => {
    await teamApi.createPromptCategory(name);
    await loadCategories();
  };

  const handleDeleteCategory = async (id: string) => {
    await teamApi.deletePromptCategory(id);
    await loadCategories();
  };

  return (
    <div className="space-y-6">
      <CategoryManager
        title="提示词分类管理"
        categories={categoryItems}
        onCreate={handleCreateCategory}
        onDelete={handleDeleteCategory}
        loading={categoryLoading}
      />

      {/* 列表样式遵循 DESIGN.md 5.7 列表/表格统一格式 */}
      <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
            <div>
              <h4 className="text-xl font-semibold text-foreground">提示词列表 ({total})</h4>
              <p className="text-muted-foreground mt-1 text-sm">审核与管理系统提示词</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="搜索名称、描述、场景..."
                  className="pl-10 bg-muted/30 rounded-lg"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PromptStatus | 'all')}>
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder="所有状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有状态</SelectItem>
                  <SelectItem value="on_shelf">已上架</SelectItem>
                  <SelectItem value="pending_review">审核中</SelectItem>
                  <SelectItem value="off_shelf">已下架</SelectItem>
                  <SelectItem value="rejected">已拒绝</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <span className="text-sm text-muted-foreground mr-1">分类：</span>
            {[ALL_FILTER_VALUE, ...categories.map((c) => c.name)].map((cat) => (
              <Button
                key={cat}
                variant={categoryFilter === cat ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === ALL_FILTER_VALUE ? '全部' : cat}
              </Button>
            ))}
          </div>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <Table className="min-w-max text-[15px]">
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">名称</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">分类</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">状态</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrompts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        暂无匹配提示词
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredPrompts.map((p) => {
                    const status: PromptStatus = p.status ?? 'on_shelf';
                    const reviewActions = REVIEW_ACTIONS_BY_STATUS[status];
                    return (
                      <TableRow key={p.id} className="transition-colors hover:bg-primary/5">
                        <TableCell className="px-4 py-5 font-medium">{p.name}</TableCell>
                        <TableCell className="px-4 py-5">
                          <CategoryMultiCell
                            options={categoryOptions}
                            value={p.categoryIds ?? []}
                            onSave={(ids) => handleSaveCategories(p, ids)}
                          />
                        </TableCell>
                        <TableCell className="px-4 py-5">
                          <StatusBadge status={status} />
                        </TableCell>
                        <TableCell className="px-4 py-5 text-right whitespace-nowrap">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="rounded-md">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setViewingPrompt(p)}>查看</DropdownMenuItem>
                              {reviewActions.map((item) => (
                                <DropdownMenuItem key={item.action} onClick={() => handleReview(p, item.action)}>
                                  {item.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <RecordPaginationBar
            total={total}
            currentPage={page}
            totalPages={Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <PromptDetailDialog
        prompt={viewingPrompt}
        categories={categories}
        onClose={() => setViewingPrompt(null)}
      />
    </div>
  );
};

interface PromptDetailDialogProps {
  prompt: Prompt | null;
  categories: TeamPromptCategory[];
  onClose: () => void;
}

// 提示词只读详情弹窗：名称/描述/内容/分类/场景/状态/使用次数/创建人。
function PromptDetailDialog({ prompt, categories, onClose }: PromptDetailDialogProps) {
  const categoryNames = useMemo(() => {
    if (!prompt) return [];
    const linked = (prompt.categoryIds ?? [])
      .map((id) => categories.find((c) => c.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    return linked.length > 0 ? linked : [prompt.useCase || '-'];
  }, [prompt, categories]);

  return (
    <Dialog open={Boolean(prompt)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{prompt?.name}</DialogTitle>
          <DialogDescription>提示词详情（只读）</DialogDescription>
        </DialogHeader>
        {prompt && (
          <div className="space-y-3 text-sm">
            <DetailRow label="描述" value={prompt.description || '-'} />
            <div className="flex gap-2">
              <span className="text-muted-foreground w-20 shrink-0">内容</span>
              <pre className="flex-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-xs text-foreground">
                {prompt.content || '-'}
              </pre>
            </div>
            <DetailRow label="分类" value={categoryNames.join('、')} />
            <DetailRow label="场景" value={prompt.useCase || '-'} />
            <DetailRow label="使用次数" value={String(prompt.usageCount)} />
            <DetailRow label="创建人" value={prompt.createdByName || '-'} />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-20 shrink-0">状态</span>
              <StatusBadge status={prompt.status} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
