import React, { useState, useEffect } from 'react';
import { Search, Copy, CheckCircle, Plus, Sparkles, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { teamApi } from '@/lib/team-api';
import { toast } from 'sonner';
import type { Prompt } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const CATEGORIES = ['全部', '研发', '测试', '产品', '设计'];

export const PromptMarket: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [prompts, setPrompts] = useState<Prompt[]>([]);

  useEffect(() => {
    teamApi.listPrompts()
      .then(setPrompts)
      .catch(err => {
        console.error('Failed to load prompts:', err);
        toast.error('加载提示词失败');
      });
  }, []);

  // AI Create state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPrompt, setCreatePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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

  const handleAdd = (id: string) => {
    teamApi.updatePromptAdded(id, true)
      .then(() => {
        setPrompts(prompts.map(p => p.id === id ? { ...p, addedToSpace: true } : p));
        toast.success('提示词已添加到空间常用列表');
      })
      .catch(() => toast.error('添加失败'));
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content).then(() => toast.success('提示词内容已复制到剪贴板'));
  };

  const handleCreatePrompt = () => {
    if (!createPrompt.trim()) {
      toast.error('请输入提示词描述');
      return;
    }
    setIsGenerating(true);
    teamApi.createPrompt({
      name: createPrompt.trim().slice(0, 30) || 'AI 生成自定义提示词',
      description: createPrompt.trim(),
      content: createPrompt.trim(),
      useCase: selectedCategory !== '全部' ? selectedCategory : '研发',
    }).then(prompt => {
      setPrompts([prompt, ...prompts]);
      setIsGenerating(false);
      setIsCreateOpen(false);
      setCreatePrompt('');
      toast.success('自定义提示词生成成功并已添加');
    }).catch(() => {
      setIsGenerating(false);
      toast.error('提示词生成失败');
    });
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
              className="pl-8 bg-background"
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
                  {isGenerating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> 生成中...</> : '生成并添加'}
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredPrompts.map(prompt => (
          <Card key={prompt.id} className="flex flex-col h-full soft-shadow border border-border/50 hover:border-primary/20 transition-colors">
            <CardHeader>
              <div className="flex justify-between items-start mb-2">
                <Badge variant="secondary">{prompt.useCase}</Badge>
                {prompt.addedToSpace && (
                  <Badge variant="outline" className="text-primary border-primary">
                    <CheckCircle className="mr-1 h-3 w-3" /> 已添加
                  </Badge>
                )}
              </div>
              <CardTitle className="line-clamp-1">{prompt.name}</CardTitle>
              <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                {prompt.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="text-sm text-muted-foreground bg-muted/30 p-2 rounded-md">
                使用次数: {(prompt.usageCount / 1000).toFixed(1)}k
              </div>
            </CardContent>
            <CardFooter className="shrink-0 pt-0 gap-2">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={() => handleCopy(prompt.content || prompt.description)}
              >
                <Copy className="mr-2 h-4 w-4" /> 复制
              </Button>
              <Button 
                variant={prompt.addedToSpace ? "secondary" : "default"} 
                className="flex-1"
                disabled={prompt.addedToSpace}
                onClick={() => handleAdd(prompt.id)}
              >
                {prompt.addedToSpace ? '已添加' : '添加到空间'}
              </Button>
            </CardFooter>
          </Card>
        ))}
        {filteredPrompts.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            没有找到匹配的提示词
          </div>
        )}
      </div>
    </div>
  );
};