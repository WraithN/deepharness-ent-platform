import { Check, CheckCircle, Copy, Eye, EyeOff, Loader2, Plus, Search, Sparkles, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { PLATFORM_ROLE, SPACE_ROLE } from '@/lib/role-constants';
import { teamApi } from '@/lib/team-api';
import { workspaceApi } from '@/lib/workspace-api';
import type { Prompt, PromptStatus } from '@/types';

const CATEGORIES = ['全部', '研发', '测试', '产品', '设计'];
const PROMPT_MARKET_PAGE_SIZE = 12;
// 复制按钮防抖冷却时长（毫秒）：点击后 5 秒内不可再次复制同一提示词。
const COPY_COOLDOWN_MS = 5000;

const PROMPT_STATUS_LABEL: Record<PromptStatus, string> = {
  pending_review: '审核中',
  on_shelf: '已上架',
  off_shelf: '已下架',
  rejected: '已拒绝',
};

const PROMPT_STATUS_VARIANT: Record<PromptStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  pending_review: 'secondary',
  on_shelf: 'default',
  off_shelf: 'outline',
  rejected: 'destructive',
};

export const PromptMarket: React.FC = () => {
  const { user, membership } = useAuth();
  const isTenantAdmin = user?.platformRole === PLATFORM_ROLE.TENANT_ADMIN || user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
  const isSuperAdmin = user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
  const isSpaceAdmin = membership?.spaceRole === SPACE_ROLE.SPACE_ADMIN;
  const canAddToWorkspace = isTenantAdmin || isSpaceAdmin;
  const currentWorkspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPrompt, setCreatePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  // 添加到空间操作中的提示词 ID（按钮 loading 态兼防抖，避免重复点击重复计数）。
  const [addingPromptId, setAddingPromptId] = useState<string | null>(null);
  // 复制按钮冷却截止时间戳（按提示词 ID），冷却期内按钮禁用，实现 5 秒防抖。
  const [copyCooldownUntil, setCopyCooldownUntil] = useState<Record<string, number>>({});

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await teamApi.listPrompts(1, 100);
      setPrompts(res.list);
    } catch (err) {
      console.error('Failed to load prompts:', err);
      toast.error('加载提示词失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const filteredPrompts = prompts.filter(prompt => {
    const matchSearch = prompt.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       prompt.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchCategory = selectedCategory === '全部' || prompt.useCase === selectedCategory || (
        (selectedCategory === '研发' && ['代码审查', '代码生成', 'Code'].includes(prompt.useCase)) ||
        (selectedCategory === '测试' && ['测试编写', 'Testing'].includes(prompt.useCase)) ||
        (selectedCategory === '产品' && ['需求分析', 'Product'].includes(prompt.useCase)) ||
        (selectedCategory === '设计' && ['UI优化', 'Design'].includes(prompt.useCase))
    );

    return matchSearch && (selectedCategory === '全部' || prompt.useCase.includes(selectedCategory) || matchCategory);
  });

  const { currentPage, totalPages, onPageChange, startIndex, endIndex } = useClientPagination({
    pageSize: PROMPT_MARKET_PAGE_SIZE,
    total: filteredPrompts.length,
    resetDeps: [searchTerm, selectedCategory],
  });
  const paginatedPrompts = filteredPrompts.slice(startIndex, endIndex);

  // 复制提示词内容到剪贴板，并上报一次复制使用（后端按用户+天去重计数）。
  // 前端 5 秒冷却防抖：冷却期内重复点击直接忽略并提示。
  const handleCopy = (prompt: Prompt) => {
    if (Date.now() < (copyCooldownUntil[prompt.id] ?? 0)) {
      toast.info('操作过于频繁，请 5 秒后再试');
      return;
    }
    setCopyCooldownUntil(prev => ({ ...prev, [prompt.id]: Date.now() + COPY_COOLDOWN_MS }));
    // 冷却结束后清除记录以触发重渲染，恢复按钮可用态。
    setTimeout(() => {
      setCopyCooldownUntil(prev => {
        const next = { ...prev };
        delete next[prompt.id];
        return next;
      });
    }, COPY_COOLDOWN_MS);
    navigator.clipboard.writeText(prompt.content || prompt.description).then(() => toast.success('提示词内容已复制到剪贴板'));
    teamApi.recordPromptUsage(prompt.id)
      .then(updated => setPrompts(prev => prev.map(p => p.id === updated.id ? { ...p, usageCount: updated.usageCount } : p)))
      .catch(err => console.warn('上报提示词复制次数失败:', err));
  };

  // 添加到空间即视为一次复制使用，后端会将市场提示词使用次数 +1。
  const handleAddToWorkspace = async (prompt: Prompt) => {
    if (!prompt.id || addingPromptId) return;
    setAddingPromptId(prompt.id);
    try {
      await workspaceApi.addPrompt(currentWorkspaceId, prompt.id);
      setPrompts(prev => prev.map(p => p.id === prompt.id ? { ...p, addedToSpace: true, usageCount: p.usageCount + 1 } : p));
      toast.success('提示词已添加到当前空间');
    } catch {
      toast.error('添加失败');
    } finally {
      setAddingPromptId(null);
    }
  };

  const handleReview = async (id: string, action: 'approve' | 'reject' | 'unshelf') => {
    try {
      await teamApi.reviewPrompt(id, action);
      toast.success('审核操作已生效');
      loadPrompts();
    } catch {
      toast.error('审核操作失败');
    }
  };

  const handleCreatePrompt = async () => {
    if (!createPrompt.trim()) {
      toast.error('请输入提示词描述');
      return;
    }
    setIsGenerating(true);
    try {
      const prompt = await teamApi.createPrompt({
        name: createPrompt.trim().slice(0, 30) || 'AI 生成自定义提示词',
        description: createPrompt.trim(),
        content: createPrompt.trim(),
        useCase: selectedCategory !== '全部' ? selectedCategory : '研发',
      });
      setPrompts([prompt, ...prompts]);
      setIsGenerating(false);
      setIsCreateOpen(false);
      setCreatePrompt('');
      toast.success('自定义提示词已提交审核，仅你和超管可见');
    } catch {
      setIsGenerating(false);
      toast.error('提示词生成失败');
    }
  };

  return (
    <div className="flex-1 space-y-6 max-w-7xl mx-auto w-full pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/50 pb-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">提示词市场</h2>
          <p className="text-muted-foreground mt-1">发现高质量的提示词模板，加速您的工作效率。</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="搜索提示词..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button><Sparkles className="w-4 h-4 mr-2" /> 新建</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-w-[calc(100%-2rem)]">
              <DialogHeader>
                <DialogTitle>AI 创建自定义提示词</DialogTitle>
                <DialogDescription>
                  输入您需要的场景和目标，AI 将帮您编写结构化的高质量 Prompt。
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Textarea 
                  placeholder="例如：我需要一个用于审查 React 组件代码质量和可访问性的提示词..."
                  className="min-h-[120px] resize-none"
                  value={createPrompt}
                  onChange={(e) => setCreatePrompt(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                <Button onClick={handleCreatePrompt} disabled={isGenerating}>
                  {isGenerating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> 生成中...</> : '提交审核'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        {CATEGORIES.map(category => (
          <Button
            key={category}
            variant={selectedCategory === category ? 'default' : 'outline'}
            className="rounded-full h-8 px-4 whitespace-nowrap"
            onClick={() => setSelectedCategory(category)}
          >
            {category}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {paginatedPrompts.map(prompt => {
            const status = prompt.status || 'on_shelf';
            const isOwner = user?.id === prompt.createdBy;
            const showReviewActions = isSuperAdmin && (status === 'pending_review' || status === 'on_shelf' || status === 'off_shelf' || status === 'rejected');
            const canEdit = isOwner && (status === 'pending_review' || status === 'rejected');

            return (
              <Card key={prompt.id} className="flex flex-col h-full soft-shadow border border-border/50 hover:border-primary/20 transition-colors">
                <CardHeader>
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <Badge variant="secondary">{prompt.useCase}</Badge>
                    <Badge variant={PROMPT_STATUS_VARIANT[status]}>
                      {PROMPT_STATUS_LABEL[status]}
                    </Badge>
                  </div>
                  <CardTitle className="line-clamp-1">{prompt.name}</CardTitle>
                  <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                    {prompt.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="text-sm text-muted-foreground bg-muted/30 p-2 rounded-md space-y-1">
                    <div>使用次数: {prompt.usageCount.toLocaleString()}</div>
                    <div>创建人: {prompt.createdByName || '系统'}</div>
                  </div>
                </CardContent>
                <CardFooter className="shrink-0 pt-0 gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={Date.now() < (copyCooldownUntil[prompt.id] ?? 0)}
                    onClick={() => handleCopy(prompt)}
                  >
                    <Copy className="mr-2 h-4 w-4" /> 复制
                  </Button>
                  {canAddToWorkspace && status === 'on_shelf' && (
                    <Button
                      variant={prompt.addedToSpace ? "secondary" : "default"}
                      className="flex-1"
                      disabled={prompt.addedToSpace || addingPromptId === prompt.id}
                      onClick={() => handleAddToWorkspace(prompt)}
                    >
                      {addingPromptId === prompt.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {prompt.addedToSpace ? '已添加' : '添加到空间'}
                    </Button>
                  )}
                  {showReviewActions && status === 'pending_review' && (
                    <>
                      <Button variant="default" size="sm" onClick={() => handleReview(prompt.id, 'approve')}>
                        <Check className="mr-1 h-3 w-3" /> 通过
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleReview(prompt.id, 'reject')}>
                        <XCircle className="mr-1 h-3 w-3" /> 拒绝
                      </Button>
                    </>
                  )}
                  {showReviewActions && status === 'on_shelf' && (
                    <Button variant="outline" size="sm" onClick={() => handleReview(prompt.id, 'unshelf')}>
                      <EyeOff className="mr-1 h-3 w-3" /> 下架
                    </Button>
                  )}
                  {showReviewActions && (status === 'off_shelf' || status === 'rejected') && (
                    <Button variant="outline" size="sm" onClick={() => handleReview(prompt.id, 'approve')}>
                      <Eye className="mr-1 h-3 w-3" /> 重新上架
                    </Button>
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => toast.info('编辑功能请在个人中心或 Admin 后台操作')}>
                      编辑
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
          {filteredPrompts.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              没有找到匹配的提示词
            </div>
          )}
        </div>
      )}

      <RecordPaginationBar
        total={filteredPrompts.length}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
};
