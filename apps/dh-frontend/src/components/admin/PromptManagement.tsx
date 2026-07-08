import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi } from '@/lib/team-api';
import { PaginationBar } from './PaginationBar';
import { CategoryManager, type CategoryItem } from './CategoryManager';
import type { Prompt, PromptStatus, TeamPromptCategory } from '@/types';

const DEFAULT_PAGE_SIZE = 10;

// 超管提示词管理：分页列表 + 分类管理 + 审核操作。
export const PromptManagement: React.FC = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [categories, setCategories] = useState<TeamPromptCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<PromptStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

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

  const filteredPrompts = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return prompts
      .filter((p) => statusFilter === 'all' || p.status === statusFilter)
      .filter((p) => categoryFilter === 'all' || p.useCase === categoryFilter)
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          (p.description || '').toLowerCase().includes(term) ||
          p.useCase.toLowerCase().includes(term)
      );
  }, [prompts, statusFilter, categoryFilter, searchTerm]);

  const handleReview = async (id: string, action: 'approve' | 'reject' | 'unshelf') => {
    try {
      await teamApi.reviewPrompt(id, action);
      toast.success('审核操作已生效');
      loadPrompts();
    } catch {
      toast.error('审核操作失败');
    }
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

      <Card className="soft-shadow border-none">
        <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
          <div>
            <CardTitle className="text-base">提示词列表</CardTitle>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                placeholder="搜索名称、描述、场景..."
                className="pl-8 w-[180px] sm:w-[240px]"
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
        </CardHeader>
        <div className="px-6 py-3 border-b flex flex-wrap gap-2 items-center">
          <span className="text-sm text-muted-foreground mr-1">分类：</span>
          {['all', ...categories.map((c) => c.name)].map((cat) => (
            <Button
              key={cat}
              variant={categoryFilter === cat ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === 'all' ? '全部' : cat}
            </Button>
          ))}
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">加载中...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPrompts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      暂无匹配提示词
                    </TableCell>
                  </TableRow>
                )}
                {filteredPrompts.map((p) => {
                  const status = p.status || 'on_shelf';
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.useCase}</TableCell>
                      <TableCell>
                        {status === 'on_shelf' && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">已上架</Badge>}
                        {status === 'pending_review' && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">审核中</Badge>}
                        {status === 'off_shelf' && <Badge className="bg-muted text-muted-foreground hover:bg-muted">已下架</Badge>}
                        {status === 'rejected' && <Badge className="bg-red-100 text-red-700 hover:bg-red-100">已拒绝</Badge>}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {status === 'pending_review' && (
                          <Button variant="outline" size="sm" onClick={() => handleReview(p.id, 'approve')}>
                            通过审核
                          </Button>
                        )}
                        {status === 'on_shelf' && (
                          <Button variant="outline" size="sm" onClick={() => handleReview(p.id, 'unshelf')}>
                            下架
                          </Button>
                        )}
                        {(status === 'off_shelf' || status === 'rejected') && (
                          <Button variant="outline" size="sm" onClick={() => handleReview(p.id, 'approve')}>
                            重新上架
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <PaginationBar
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
};
