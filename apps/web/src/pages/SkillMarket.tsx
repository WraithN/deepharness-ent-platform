import React, { useState } from 'react';
import { Search, Download, Star, CheckCircle, Plus, Sparkles, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { mockSkills } from '@/mock/data';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const CATEGORIES = ['全部', '研发', '测试', '产品', '设计'];

export const SkillMarket: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [skills, setSkills] = useState(mockSkills);
  
  // AI Create state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPrompt, setCreatePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const filteredSkills = skills.filter(skill => {
    const matchSearch = skill.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                       skill.description.toLowerCase().includes(searchTerm.toLowerCase());
    // Since mock data category might not match exactly, we do a loose check or assign mock categories randomly if needed.
    // For demo purpose, if category is '全部', return matchSearch.
    const matchCategory = selectedCategory === '全部' || skill.category === selectedCategory || (
        // Map some mock categories to these tags
        (selectedCategory === '研发' && ['代码生成', '代码优化', 'Code'].includes(skill.category)) ||
        (selectedCategory === '测试' && ['测试编写', 'Testing'].includes(skill.category)) ||
        (selectedCategory === '产品' && ['需求设计', 'Product'].includes(skill.category)) ||
        (selectedCategory === '设计' && ['UI设计', 'Design'].includes(skill.category))
    );
    // If mock data doesn't have these exact categories, let's just make it loose:
    return matchSearch && (selectedCategory === '全部' || skill.category.includes(selectedCategory) || matchCategory);
  });

  const handleInstall = (id: string) => {
    setSkills(skills.map(s => s.id === id ? { ...s, installed: true } : s));
    toast.success('技能已安装到当前工作空间');
  };

  const handleCreateSkill = () => {
    if (!createPrompt.trim()) {
      toast.error('请输入技能描述');
      return;
    }
    setIsGenerating(true);
    setTimeout(() => {
      const newSkill = {
        id: `custom-skill-${Date.now()}`,
        name: 'AI 生成自定义技能',
        description: createPrompt,
        category: selectedCategory !== '全部' ? selectedCategory : '研发',
        installed: true,
        downloads: 0,
        rating: 5.0
      };
      setSkills([newSkill, ...skills]);
      setIsGenerating(false);
      setIsCreateOpen(false);
      setCreatePrompt('');
      toast.success('自定义技能生成成功并已自动安装');
    }, 2000);
  };

  return (
    <div className="flex-1 space-y-6 max-w-7xl mx-auto w-full pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/50 pb-4 shrink-0">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">技能市场</h2>
          <p className="text-muted-foreground mt-1">发现并安装各种 AI 能力增强您的开发工作流。</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="搜索技能..."
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
                <DialogTitle>AI 创建自定义技能</DialogTitle>
                <DialogDescription>
                  用自然语言描述您需要的技能能力，AI 将自动分析并生成相应的 Skill 配置。
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Textarea 
                  placeholder="例如：创建一个技能，能够分析前端 React 组件性能并提供优化建议..."
                  className="min-h-[120px] resize-none"
                  value={createPrompt}
                  onChange={(e) => setCreatePrompt(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                <Button onClick={handleCreateSkill} disabled={isGenerating}>
                  {isGenerating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> 生成中...</> : '生成并安装'}
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
        {filteredSkills.map(skill => (
          <Card key={skill.id} className="flex flex-col h-full soft-shadow border border-border/50 hover:border-primary/20 transition-colors">
            <CardHeader>
              <div className="flex justify-between items-start mb-2">
                <Badge variant="secondary">{skill.category}</Badge>
                {skill.installed && (
                  <Badge variant="outline" className="text-primary border-primary">
                    <CheckCircle className="mr-1 h-3 w-3" /> 已安装
                  </Badge>
                )}
              </div>
              <CardTitle className="line-clamp-1">{skill.name}</CardTitle>
              <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                {skill.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="flex items-center gap-4 text-sm text-muted-foreground bg-muted/30 p-2 rounded-md w-fit">
                <div className="flex items-center">
                  <Download className="mr-1 h-3 w-3" />
                  {(skill.downloads / 1000).toFixed(1)}k
                </div>
                <div className="flex items-center">
                  <Star className="mr-1 h-3 w-3 text-amber-500" />
                  {skill.rating.toFixed(1)}
                </div>
              </div>
            </CardContent>
            <CardFooter className="shrink-0 pt-0">
              <Button 
                variant={skill.installed ? "secondary" : "default"} 
                className="w-full"
                disabled={skill.installed}
                onClick={() => handleInstall(skill.id)}
              >
                {skill.installed ? '已安装' : (
                  <>
                    <Plus className="mr-2 h-4 w-4" /> 安装到空间
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        ))}
        {filteredSkills.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            没有找到匹配的技能
          </div>
        )}
      </div>
    </div>
  );
};