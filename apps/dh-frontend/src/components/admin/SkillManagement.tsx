import { ArrowDownFromLine, CheckCircle2, Eye, MoreHorizontal, Puzzle, Search, Trash2, XCircle } from 'lucide-react';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { teamApi } from '@/lib/team-api';
import type { PromptStatus, Skill, SkillCategory } from '@/types';
import { type CategoryItem, CategoryManager } from './CategoryManager';
import { CategoryMultiCell } from './CategoryMultiCell';
import { ALL_FILTER_VALUE, matchCategoryFilter, REVIEW_ACTIONS_BY_STATUS, type ReviewAction } from './review-actions';
import { StatusBadge } from './StatusBadge';

const DEFAULT_PAGE_SIZE = 10;
const REVIEW_SUCCESS_MESSAGE = '审核操作已生效';
const REVIEW_FAILED_MESSAGE = '审核操作失败';

// 超管技能管理：分页列表 + 分类管理 + 多分类编辑 + 审核操作菜单。
export const SkillManagement: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_FILTER_VALUE);
  const [viewingSkill, setViewingSkill] = useState<Skill | null>(null);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const res = await teamApi.listSkills(page, DEFAULT_PAGE_SIZE);
      setSkills(res.list);
      setTotal(res.total);
    } catch {
      toast.error('加载技能列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    setCategoryLoading(true);
    try {
      const list = await teamApi.listSkillCategories();
      setCategories(list);
    } catch {
      toast.error('加载技能分类失败');
    } finally {
      setCategoryLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, [page]);

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, categoryFilter]);

  const categoryItems: CategoryItem[] = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name, builtin: c.builtin })),
    [categories]
  );

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.name })),
    [categories]
  );

  const filteredSkills = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return skills
      .filter((s) => matchCategoryFilter(categoryFilter, s.category, s.categoryIds, categories))
      .filter(
        (s) =>
          !term ||
          s.name.toLowerCase().includes(term) ||
          (s.description || '').toLowerCase().includes(term) ||
          (s.category || '').toLowerCase().includes(term)
      );
  }, [skills, categoryFilter, categories, searchTerm]);

  const handleReview = async (skill: Skill, action: ReviewAction) => {
    try {
      const updated = await teamApi.reviewSkill(skill.id, action);
      setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, status: updated.status } : s)));
      toast.success(REVIEW_SUCCESS_MESSAGE);
    } catch {
      toast.error(REVIEW_FAILED_MESSAGE);
    }
  };

  const handleSaveCategories = async (skill: Skill, categoryIds: string[]) => {
    const updated = await teamApi.updateSkillCategories(skill.id, categoryIds);
    setSkills((prev) =>
      prev.map((s) => (s.id === skill.id ? { ...s, categoryIds: updated.categoryIds } : s))
    );
  };

  const handleDelete = async (skill: Skill) => {
    try {
      await teamApi.deleteSkill(skill.id);
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      setTotal((prev) => prev - 1);
      toast.success('删除技能成功');
    } catch {
      toast.error('删除技能失败');
    }
  };

  const handleCreateCategory = async (name: string) => {
    await teamApi.createSkillCategory(name);
    await loadCategories();
  };

  const handleDeleteCategory = async (id: string) => {
    await teamApi.deleteSkillCategory(id);
    await loadCategories();
  };

  return (
    <div className="space-y-6">
      <CategoryManager
        title="技能分类管理"
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
              <h4 className="text-xl font-semibold text-foreground">技能列表 ({total})</h4>
              <p className="text-muted-foreground mt-1 text-sm">管理平台技能的审核、上下架与分类</p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="搜索名称、描述、分类..."
                className="pl-10 bg-muted/30 rounded-lg"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <span className="text-sm text-muted-foreground mr-1">分类：</span>
            {[ALL_FILTER_VALUE, ...categories.map((c) => c.name)].map((cat) => (
              <Button
                key={cat}
                variant={categoryFilter === cat ? 'default' : 'outline'}
                size="sm"
                className="h-8 px-4 rounded-full whitespace-nowrap"
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
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">下载</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">评分</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">状态</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSkills.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        暂无匹配技能
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredSkills.map((s) => {
                    const status: PromptStatus = s.status ?? 'on_shelf';
                    const reviewActions = REVIEW_ACTIONS_BY_STATUS[status];
                    return (
                      <TableRow key={s.id} className="transition-colors hover:bg-primary/5">
                        <TableCell className="px-4 py-5 font-medium">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 shrink-0 rounded-full bg-primary/15 flex items-center justify-center">
                              <Puzzle className="h-4 w-4 text-primary" />
                            </div>
                            {s.name}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-5">
                          <CategoryMultiCell
                            options={categoryOptions}
                            value={s.categoryIds ?? []}
                            onSave={(ids) => handleSaveCategories(s, ids)}
                          />
                        </TableCell>
                        <TableCell className="px-4 py-5 whitespace-nowrap">{s.downloads}</TableCell>
                        <TableCell className="px-4 py-5 whitespace-nowrap">{s.rating.toFixed(1)}</TableCell>
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
                              <DropdownMenuItem onClick={() => setViewingSkill(s)}>
                                <Eye className="h-4 w-4" /> 查看
                              </DropdownMenuItem>
                              {reviewActions.map((item) => (
                                <DropdownMenuItem key={item.action} onClick={() => handleReview(s, item.action)}>
                                  {item.action === 'approve' && <CheckCircle2 className="h-4 w-4" />}
                                  {item.action === 'reject' && <XCircle className="h-4 w-4" />}
                                  {item.action === 'unshelf' && <ArrowDownFromLine className="h-4 w-4" />}
                                  {item.label}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                onClick={() => handleDelete(s)}
                              >
                                <Trash2 className="h-4 w-4" /> 删除
                              </DropdownMenuItem>
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

      <SkillDetailDialog skill={viewingSkill} categories={categories} onClose={() => setViewingSkill(null)} />
    </div>
  );
};

interface SkillDetailDialogProps {
  skill: Skill | null;
  categories: SkillCategory[];
  onClose: () => void;
}

// 技能只读详情弹窗：名称/描述/分类/标签/阶段/下载/评分/状态。
function SkillDetailDialog({ skill, categories, onClose }: SkillDetailDialogProps) {
  const categoryNames = useMemo(() => {
    if (!skill) return [];
    const linked = (skill.categoryIds ?? [])
      .map((id) => categories.find((c) => c.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    return linked.length > 0 ? linked : [skill.category || '通用'];
  }, [skill, categories]);

  return (
    <Dialog open={Boolean(skill)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{skill?.name}</DialogTitle>
          <DialogDescription>技能详情（只读）</DialogDescription>
        </DialogHeader>
        {skill && (
          <div className="space-y-3 text-sm">
            <DetailRow label="描述" value={skill.description || '-'} />
            <DetailRow label="分类" value={categoryNames.join('、')} />
            <DetailRow label="标签" value={(skill.tags ?? []).join('、') || '-'} />
            <DetailRow label="所属阶段" value={skill.phase || '-'} />
            <DetailRow label="下载量" value={String(skill.downloads)} />
            <DetailRow label="评分" value={skill.rating.toFixed(1)} />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-20 shrink-0">状态</span>
              <StatusBadge status={skill.status} />
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
