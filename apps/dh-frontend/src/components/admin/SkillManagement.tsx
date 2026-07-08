import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Puzzle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi } from '@/lib/team-api';
import { PaginationBar } from './PaginationBar';
import { CategoryManager, type CategoryItem } from './CategoryManager';
import type { Skill, SkillCategory } from '@/types';

const DEFAULT_PAGE_SIZE = 10;

// 超管技能管理：分页列表 + 分类管理。
export const SkillManagement: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

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

  const filteredSkills = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return skills
      .filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
      .filter(
        (s) =>
          !term ||
          s.name.toLowerCase().includes(term) ||
          (s.description || '').toLowerCase().includes(term) ||
          (s.category || '').toLowerCase().includes(term)
      );
  }, [skills, categoryFilter, searchTerm]);

  const handleToggle = async (skill: Skill) => {
    try {
      const updated = await teamApi.updateSkillInstalled(skill.id, !skill.installed);
      setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, installed: updated.installed } : s)));
      toast.success(`${updated.name} 已${updated.installed ? '上架' : '下架'}`);
    } catch {
      toast.error('更新技能状态失败');
    }
  };

  const handleDelete = async (skill: Skill) => {
    try {
      await teamApi.deleteSkill(skill.id);
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
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

      <Card className="soft-shadow border-none">
        <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
          <div>
            <CardTitle className="text-base">技能列表</CardTitle>
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              placeholder="搜索名称、描述、分类..."
              className="pl-8 w-[180px] sm:w-[240px]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
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
                  <TableHead>下载</TableHead>
                  <TableHead>评分</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSkills.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      暂无匹配技能
                    </TableCell>
                  </TableRow>
                )}
                {filteredSkills.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Puzzle className="h-4 w-4 text-primary" />
                        </div>
                        {s.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.category || '通用'}</Badge>
                    </TableCell>
                    <TableCell>{s.downloads}</TableCell>
                    <TableCell>{s.rating.toFixed(1)}</TableCell>
                    <TableCell>
                      {s.installed ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">已上架</Badge>
                      ) : (
                        <Badge variant="secondary">已下架</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Switch checked={s.installed} onCheckedChange={() => handleToggle(s)} />
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(s)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
