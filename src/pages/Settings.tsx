import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Save, UserPlus, Search, MoreHorizontal, Shield, Settings2, User as UserIcon, Puzzle, FileText, Trash2, Plus, Code2, Copy, CheckCircle, UploadCloud, Box, ListTodo, Camera, UserCircle, SlidersHorizontal, Wand2, Star, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import MultiSelect from '@/components/ui/multi-select';
import { mockSettings, mockUsers, mockCurrentUser, mockSkills, mockPrompts } from '@/mock/data';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';

export const Settings: React.FC = () => {
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'basic';
  const [activeTab, setActiveTab] = useState(defaultTab);
  
  const userRole = localStorage.getItem('userRole') || 'user';
  const isReadOnly = userRole === 'user';

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  const [settings, setSettings] = useState(mockSettings);
  const [users, setUsers] = useState(mockUsers);
  const [searchTerm, setSearchTerm] = useState('');
  const [promptSearchTerm, setPromptSearchTerm] = useState('');

  const [skillMarketOpen, setSkillMarketOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillCategory, setSkillCategory] = useState('全部');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillPhase, setSkillPhase] = useState('需求设计');

  const [createSkillOpen, setCreateSkillOpen] = useState(false);
  const [createSkillPrompt, setCreateSkillPrompt] = useState('');
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);

  const [createPromptOpen, setCreatePromptOpen] = useState(false);
  const [createPromptDesc, setCreatePromptDesc] = useState('');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  const [promptMarketOpen, setPromptMarketOpen] = useState(false);
  const [promptMarketSearch, setPromptMarketSearch] = useState('');
  const [promptMarketCategory, setPromptMarketCategory] = useState('全部');
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);

  const skillCategories = ['全部', ...Array.from(new Set(mockSkills.map(s => s.category)))];
  const promptCategories = ['全部', ...Array.from(new Set(mockPrompts.map(p => p.useCase)))];

  const filteredSkills = mockSkills.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase());
    const matchCategory = skillCategory === '全部' || s.category === skillCategory;
    return matchSearch && matchCategory;
  });

  const filteredPromptsMarket = mockPrompts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(promptMarketSearch.toLowerCase()) || p.description.toLowerCase().includes(promptMarketSearch.toLowerCase());
    const matchCategory = promptMarketCategory === '全部' || p.useCase === promptMarketCategory;
    return matchSearch && matchCategory;
  });
  
  const [reqPlatform, setReqPlatform] = useState('meego');
  const [gitRepos, setGitRepos] = useState<{id: string, url: string, name: string, type: 'dev' | 'case'}[]>([
    { id: '1', url: mockSettings.gitlabUrl || '', name: '主项目', type: 'dev' }
  ]);

  const handleGitUrlChange = (id: string, url: string) => {
    setGitRepos(repos => repos.map(repo => {
      if (repo.id === id) {
        let name = repo.name;
        if (!name || name === '主项目' || name === '') {
          const match = url.match(/\/([^\/]+)(?:\.git)?$/);
          if (match && match[1]) {
            name = match[1].replace('.git', '');
          }
        }
        return { ...repo, url, name };
      }
      return repo;
    }));
  };

  const handleAddRepo = () => {
    setGitRepos([...gitRepos, { id: Date.now().toString(), url: '', name: '', type: 'dev' }]);
  };

  const handleRemoveRepo = (id: string) => {
    if (gitRepos.length > 1) {
      setGitRepos(gitRepos.filter(repo => repo.id !== id));
    } else {
      toast.error('至少需要保留一个 Git 仓库');
    }
  };

  const handleSave = () => {
    toast.success('设置已保存');
  };

  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin': return <Badge className="bg-primary"><Shield className="w-3 h-3 mr-1"/> 管理员</Badge>;
      case 'pm': return <Badge variant="secondary"><Settings2 className="w-3 h-3 mr-1"/> 产品经理</Badge>;
      case 'designer': return <Badge variant="secondary" className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">设计师</Badge>;
      case 'developer': return <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300">开发者</Badge>;
      case 'tester': return <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300">测试人员</Badge>;
      default: return <Badge variant="outline"><UserIcon className="w-3 h-3 mr-1"/> 成员</Badge>;
    }
  };

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  
  const handleInvite = () => {
    setIsInviteOpen(true);
  };

  const submitInvite = () => {
    if (!inviteEmail) {
      toast.error('请输入成员邮箱');
      return;
    }
    toast.success(`邀请已发送至 ${inviteEmail}`);
    setIsInviteOpen(false);
    setInviteEmail('');
  };

  return (
    <div className="flex-1 space-y-6 max-w-7xl mx-auto w-full pb-12">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 flex-wrap h-auto gap-1 justify-start bg-transparent p-0">
          <TabsTrigger value="basic" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-full px-4 border border-transparent data-[state=active]:border-border/50">基础配置</TabsTrigger>
          <TabsTrigger value="agent" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-full px-4 border border-transparent data-[state=active]:border-border/50">智能体配置</TabsTrigger>
          <TabsTrigger value="skills" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-full px-4 border border-transparent data-[state=active]:border-border/50">技能配置</TabsTrigger>
          <TabsTrigger value="prompts" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-full px-4 border border-transparent data-[state=active]:border-border/50">提示词配置</TabsTrigger>
          <TabsTrigger value="standards" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-full px-4 border border-transparent data-[state=active]:border-border/50">研发规范</TabsTrigger>
          <TabsTrigger value="cicd" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-full px-4 border border-transparent data-[state=active]:border-border/50">CICD配置</TabsTrigger>
          <TabsTrigger value="members" className="data-[state=active]:bg-card data-[state=active]:shadow-sm rounded-full px-4 border border-transparent data-[state=active]:border-border/50">成员管理</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card className="soft-shadow border-none">
            <CardHeader>
              <CardTitle>基础配置</CardTitle>
              <CardDescription>配置项目集成的外部系统地址。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground border-b border-border/50 pb-2">需求管理</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>需求管理平台</Label>
                    <Select disabled={isReadOnly} value={reqPlatform} onValueChange={setReqPlatform}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择平台" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="meego">Meego</SelectItem>
                        <SelectItem value="jira">Jira</SelectItem>
                        <SelectItem value="pingcode">PingCode</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {reqPlatform === 'meego' && (
                    <div className="space-y-2">
                      <Label htmlFor="meego">项目 ID</Label>
                      <Input 
                        disabled={isReadOnly}
                        id="meego" 
                        placeholder="输入项目ID..."
                        value={settings.meegoProject} 
                        onChange={e => setSettings({...settings, meegoProject: e.target.value})} 
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4 pt-4 mt-6 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground">代码仓库</h3>
                  {!isReadOnly && (
                    <Button variant="outline" size="sm" onClick={handleAddRepo} className="h-8">
                      <Plus className="w-3 h-3 mr-1" /> 新增仓库
                    </Button>
                  )}
                </div>
                
                <div className="space-y-3">
                  {gitRepos.map((repo, index) => (
                    <div key={repo.id} className="flex flex-col sm:flex-row gap-3 items-end p-3 rounded-lg border border-border/50 bg-muted/10">
                      <div className="space-y-2 flex-1 w-full">
                        <Label className="text-xs text-muted-foreground">Git 仓库地址</Label>
                        <Input 
                          placeholder="https://gitlab.com/org/repo.git"
                          value={repo.url} 
                          onChange={e => handleGitUrlChange(repo.id, e.target.value)} 
                          className="bg-background"
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="space-y-2 w-full sm:w-1/4">
                        <Label className="text-xs text-muted-foreground">仓库类型</Label>
                        <Select disabled={isReadOnly} value={repo.type} onValueChange={(val: 'dev' | 'case' | 'product') => setGitRepos(repos => repos.map(r => r.id === repo.id ? { ...r, type: val as any } : r))}>
                          <SelectTrigger className="bg-background">
                            <SelectValue placeholder="类型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dev">开发库</SelectItem>
                            <SelectItem value="case">用例库</SelectItem>
                            <SelectItem value="product">产品库</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 w-full sm:w-[150px]">
                        <Label className="text-xs text-muted-foreground">仓库名称</Label>
                        <Input 
                          placeholder="repo-name"
                          value={repo.name} 
                          onChange={e => setGitRepos(repos => repos.map(r => r.id === repo.id ? { ...r, name: e.target.value } : r))} 
                          className="bg-background"
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="flex items-center gap-1 shrink-0 mb-0.5">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 gap-1 text-xs">
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                              设置规范
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl h-[80vh] flex flex-col">
                            <DialogHeader>
                              <DialogTitle>仓库规范配置 ({repo.name || '未命名'})</DialogTitle>
                            </DialogHeader>
                            <Tabs defaultValue="engineering" className="flex-1 flex flex-col mt-4 min-h-0">
                              <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="engineering">工程规范</TabsTrigger>
                                <TabsTrigger value="design">设计规范</TabsTrigger>
                              </TabsList>
                              <TabsContent value="engineering" className="flex-1 min-h-0 mt-4">
                                <Textarea className="w-full h-full font-mono text-sm resize-none" placeholder="输入工程规范 (Markdown 格式)..." disabled={isReadOnly} defaultValue="# 工程规范\n\n1. 目录结构\n2. 命名规范" />
                              </TabsContent>
                              <TabsContent value="design" className="flex-1 min-h-0 mt-4">
                                <Textarea className="w-full h-full font-mono text-sm resize-none" placeholder="输入设计规范 (Markdown 格式)..." disabled={isReadOnly} defaultValue="# 设计规范\n\n1. 组件设计\n2. 主题配置" />
                              </TabsContent>
                            </Tabs>
                            <div className="flex justify-end mt-4 pt-4 border-t border-border/50">
                              <Button disabled={isReadOnly} onClick={() => toast.success('规范已保存')}>保存规范</Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button disabled={isReadOnly} variant="ghost" size="icon" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive h-9 w-9" onClick={() => handleRemoveRepo(repo.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {!isReadOnly && (
                <Button onClick={handleSave} className="mt-6"><Save className="mr-2 h-4 w-4" /> 保存配置</Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="standards">
          <Card className="soft-shadow border-none">
            <CardHeader>
              <CardTitle>研发规范</CardTitle>
              <CardDescription>定义团队的编码和设计规范，AI 助手将基于这些规范进行评审和生成。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Tabs defaultValue="coding" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="coding">编码规范</TabsTrigger>
                  <TabsTrigger value="design">设计规范</TabsTrigger>
                </TabsList>
                <TabsContent value="coding">
                  <div className="space-y-2">
                    <Textarea 
                      className="min-h-[400px] text-sm bg-muted/20 font-mono resize-y"
                      placeholder="请输入编码规范 (Markdown 格式)..."
                      disabled={isReadOnly}
                      value={settings.codingStandard}
                      onChange={e => setSettings({...settings, codingStandard: e.target.value})}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="design">
                  <div className="space-y-2">
                    <Textarea 
                      className="min-h-[400px] text-sm bg-muted/20 font-mono resize-y"
                      placeholder="请输入设计规范 (Markdown 格式)..."
                      disabled={isReadOnly}
                      value={settings.designStandard}
                      onChange={e => setSettings({...settings, designStandard: e.target.value})}
                    />
                  </div>
                </TabsContent>
              </Tabs>
              {!isReadOnly && (
                <Button onClick={handleSave} className="mt-6"><Save className="mr-2 h-4 w-4" /> 保存规范</Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cicd">
          <Card className="soft-shadow border-none">
            <CardHeader>
              <CardTitle>CICD 配置</CardTitle>
              <CardDescription>配置项目的持续集成与持续部署流水线设置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>部署触发分支</Label>
                <Input placeholder="例如: main, master, release/*" defaultValue="main, master" />
              </div>
              <div className="space-y-2">
                <Label>Webhook URL</Label>
                <Input placeholder="输入构建触发的 Webhook URL" type="url" />
              </div>
              <div className="space-y-2">
                <Label>部署脚本命令</Label>
                <Textarea 
                  className="min-h-[120px] text-sm bg-muted/20"
                  style={{ fontFamily: '"JetBrains Mono", monospace' }}
                  defaultValue="npm run build&#10;npm run test&#10;npm run deploy"
                />
              </div>
              <Button onClick={() => toast.success('CICD配置已保存')}><Save className="mr-2 h-4 w-4" /> 保存配置</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skills">
          <Card className="soft-shadow border-none">
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardDescription>配置不同研发阶段所使用的默认技能组合。</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { setCreateSkillPrompt(''); setCreateSkillOpen(true); }}><Wand2 className="w-4 h-4 mr-2" />创建技能</Button>
                <Button size="sm" onClick={() => { setSkillSearch(''); setSkillCategory('全部'); setSelectedSkillIds([]); setSkillPhase('需求设计'); setSkillMarketOpen(true); }}><Plus className="w-4 h-4 mr-2" />去市场添加</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {[
                  { phase: '需求设计', icon: ListTodo, defaultSkill: 'PRD生成专家', color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-900/30' },
                  { phase: 'UI 设计', icon: Box, defaultSkill: '前端组件设计系统', color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/30' },
                  { phase: '架构方案', icon: Shield, defaultSkill: '系统架构设计专家', color: 'text-indigo-500', bg: 'bg-indigo-100 dark:bg-indigo-900/30' },
                  { phase: '代码开发', icon: Code2, defaultSkill: 'Go 代码审查与规范', color: 'text-green-500', bg: 'bg-green-100 dark:bg-green-900/30' },
                  { phase: '单元测试', icon: CheckCircle, defaultSkill: 'Jest 自动化测试', color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900/30' },
                  { phase: '集成 & UAT 验收', icon: CheckCircle, defaultSkill: '集成测试验证助手', color: 'text-cyan-500', bg: 'bg-cyan-100 dark:bg-cyan-900/30' },
                  { phase: '预发布验证', icon: UploadCloud, defaultSkill: '预发布巡检助手', color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/30' },
                  { phase: '生产上线运维', icon: UploadCloud, defaultSkill: '自动部署与发布脚本', color: 'text-rose-500', bg: 'bg-rose-100 dark:bg-rose-900/30' },
                ].map((item, index) => (
                  <div 
                    key={index} 
                    className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border/50 rounded-xl bg-card hover:border-primary/50 transition-colors soft-shadow overflow-visible"
                    style={{ zIndex: 50 - index }}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`h-12 w-12 rounded-lg flex items-center justify-center shrink-0 ${item.bg}`}>
                        <item.icon className={`h-6 w-6 ${item.color}`} />
                      </div>
                      <div>
                        <h4 className="font-semibold text-base">{item.phase}阶段</h4>
                        <p className="text-sm text-muted-foreground mt-0.5">配置此阶段优先使用的AI技能</p>
                      </div>
                    </div>
                    <div className="w-full sm:w-80 shrink-0">
                      <MultiSelect 
                        options={[
                          { value: item.defaultSkill, label: item.defaultSkill },
                          { value: '通用智能体', label: '通用智能体 (默认)' },
                          { value: '代码扫描专家', label: '代码扫描专家' },
                          { value: '数据库优化助手', label: '数据库优化助手' }
                        ]}
                        defaultSelected={[item.defaultSkill]}
                        onChange={(selected) => {
                          console.log('Selected skills for', item.phase, ':', selected);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompts">
          <Card className="soft-shadow border-none">
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardDescription>管理当前空间常用的提示词模板。</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="搜索提示词..." 
                    className="pl-8 h-9 w-[200px]"
                    value={promptSearchTerm}
                    onChange={(e) => setPromptSearchTerm(e.target.value)}
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => { setCreatePromptDesc(''); setCreatePromptOpen(true); }}><Wand2 className="w-4 h-4 mr-2" />创建提示词</Button>
                <Button size="sm" onClick={() => { setPromptMarketSearch(''); setPromptMarketCategory('全部'); setSelectedPromptIds([]); setPromptMarketOpen(true); }}><Plus className="w-4 h-4 mr-2" />添加提示词</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                {[
                  { 
                    phase: '需求设计阶段', 
                    prompts: [
                      { id: 1, title: '编写PRD文档模板', content: '请作为产品经理，根据以下需求生成一份结构化的PRD文档，包含：1. 背景与目标 2. 用户场景 3. 功能详情 4. 业务流程图 5. 数据埋点要求。当前需求：' },
                      { id: 2, title: '竞品分析框架', content: '请帮我对【功能模块】进行竞品分析，主要对比对象包括：... 比较维度应包含用户体验、功能完整度、商业模式等。' }
                    ]
                  },
                  { 
                    phase: '代码开发阶段', 
                    prompts: [
                      { id: 3, title: 'React组件生成标准', content: '请生成一个React组件，要求：使用TypeScript，TailwindCSS进行样式编写，遵循响应式设计，分离逻辑与视图，并添加适当的JSDoc注释。' },
                      { id: 4, title: 'Go API 接口规范', content: '实现一个RESTful API端点，语言为Go，使用Gin框架。要求包含参数验证、统一的错误处理封装、以及完整的Swagger注释。' }
                    ]
                  }
                ].map(group => ({
                  ...group,
                  prompts: group.prompts.filter(p => 
                    p.title.toLowerCase().includes(promptSearchTerm.toLowerCase()) || 
                    p.content.toLowerCase().includes(promptSearchTerm.toLowerCase())
                  )
                })).filter(group => group.prompts.length > 0).map((group, groupIdx) => (
                  <div key={groupIdx} className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground border-b border-border/50 pb-2">{group.phase}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {group.prompts.map((prompt) => (
                        <Card key={prompt.id} className="bg-muted/10 border-border/50 border-dashed hover:border-primary/50 transition-colors group">
                          <CardContent className="p-4 flex flex-col h-full">
                            <div className="flex items-start justify-between mb-2">
                              <h4 className="font-medium text-sm flex items-center">
                                <FileText className="h-4 w-4 mr-2 text-primary" />
                                {prompt.title}
                              </h4>
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary" onClick={() => toast.success('内容已复制到剪贴板')}>
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => toast.success('已删除')}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed flex-1">
                              {prompt.content}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agent">
          <Card className="soft-shadow border-none">
            <CardHeader>
              <CardTitle>智能体设置</CardTitle>
              <CardDescription>配置空间专属 AI 助手的引擎及模型参数。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>智能体类型</Label>
                <Select
                  disabled={isReadOnly}
                  value={settings.agentConfig.agentName}
                  onValueChange={(val: 'opencode' | 'claude code') => setSettings({
                    ...settings, 
                    agentConfig: { ...settings.agentConfig, agentName: val }
                  })}
                >
                  <SelectTrigger className="w-full md:w-[300px]">
                    <SelectValue placeholder="选择智能体" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="opencode">OpenCode</SelectItem>
                    <SelectItem value="claude code">Claude Code</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between border border-border/50 rounded-lg p-4 bg-muted/10">
                  <div className="space-y-0.5">
                    <Label className="text-base font-medium">使用自定义模型</Label>
                    <p className="text-sm text-muted-foreground">开启后可配置您自己的模型服务地址和名称</p>
                  </div>
                  <Checkbox 
                    disabled={isReadOnly}
                    checked={settings.agentConfig.modelSource === 'custom'}
                    onCheckedChange={(checked) => setSettings({
                      ...settings,
                      agentConfig: { ...settings.agentConfig, modelSource: checked ? 'custom' : 'builtin' }
                    })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">{settings.agentConfig.modelSource === 'builtin' ? '选择模型' : '模型名称'}</Label>
                    {settings.agentConfig.modelSource === 'builtin' ? (
                      <Select
                        disabled={isReadOnly}
                        value={settings.agentConfig.model}
                        onValueChange={val => setSettings({
                          ...settings, 
                          agentConfig: {...settings.agentConfig, model: val}
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择内置模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {settings.agentConfig.agentName === 'claude code' ? (
                            <>
                              <SelectItem value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</SelectItem>
                              <SelectItem value="claude-3-opus-20240229">Claude 3 Opus</SelectItem>
                              <SelectItem value="claude-3-haiku-20240307">Claude 3 Haiku</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                              <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                              <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input 
                        disabled={isReadOnly}
                        placeholder="例如: custom-model-v1"
                        value={settings.agentConfig.model}
                        onChange={e => setSettings({
                          ...settings, 
                          agentConfig: {...settings.agentConfig, model: e.target.value}
                        })}
                      />
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">API Key</Label>
                    <Input 
                      disabled={isReadOnly}
                      type="password"
                      placeholder="输入 API Key"
                      value={settings.agentConfig.apiKey || ''}
                      onChange={e => setSettings({
                        ...settings, 
                        agentConfig: {...settings.agentConfig, apiKey: e.target.value}
                      })}
                    />
                  </div>
                </div>

                {settings.agentConfig.modelSource === 'custom' && (
                  <div className="space-y-2 pt-2">
                    <Label className="text-muted-foreground text-xs">Base URL</Label>
                    <Input 
                      disabled={isReadOnly}
                      placeholder="https://api.example.com/v1"
                      value={settings.agentConfig.baseUrl || ''}
                      onChange={e => setSettings({
                        ...settings, 
                        agentConfig: {...settings.agentConfig, baseUrl: e.target.value}
                      })}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2">
                <Label>生成温度 (Temperature)</Label>
                <div className="flex items-center gap-4">
                  <Input 
                    disabled={isReadOnly}
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    className="w-32"
                    value={settings.agentConfig.temperature}
                    onChange={e => setSettings({
                      ...settings, 
                      agentConfig: {...settings.agentConfig, temperature: parseFloat(e.target.value)}
                    })}
                  />
                  <span className="text-sm text-muted-foreground">数值越大生成内容越具随机性，范围 0.0 - 1.0</span>
                </div>
              </div>

              {!isReadOnly && (
                <Button onClick={handleSave} className="mt-6"><Save className="mr-2 h-4 w-4" /> 保存配置</Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-medium">成员管理</h3>
                <p className="text-sm text-muted-foreground mt-1">管理当前工作空间的成员权限与角色。</p>
              </div>
              {!isReadOnly && (
                <Button onClick={handleInvite}>
                  <UserPlus className="mr-2 h-4 w-4" /> 添加成员
                </Button>
              )}
            </div>

            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
              <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)]">
                <DialogHeader>
                  <DialogTitle>添加成员</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">成员邮箱</Label>
                    <Input 
                      id="invite-email" 
                      placeholder="name@company.com" 
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>角色权限</Label>
                    <Select defaultValue="developer">
                      <SelectTrigger>
                        <SelectValue placeholder="选择角色" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">租户管理员</SelectItem>
                        <SelectItem value="pm">产品经理</SelectItem>
                        <SelectItem value="developer">开发人员</SelectItem>
                        <SelectItem value="tester">测试人员</SelectItem>
                        <SelectItem value="designer">设计师</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsInviteOpen(false)}>取消</Button>
                  <Button onClick={submitInvite}>发送邀请</Button>
                </div>
              </DialogContent>
            </Dialog>

            <Card className="soft-shadow border-none overflow-hidden">
              <CardHeader className="py-4 border-b bg-muted/10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <CardTitle className="text-base">空间成员 ({users.length})</CardTitle>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder="搜索成员姓名或角色..."
                      className="pl-8 bg-background"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-max">
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="w-[300px]">成员信息</TableHead>
                        <TableHead>角色权限</TableHead>
                        <TableHead>加入时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                                {user.name.charAt(0)}
                              </div>
                              <div className="font-medium">{user.name}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {getRoleBadge(user.role)}
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {user.joinedAt}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => toast.success('操作已点击')}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredUsers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                            未找到匹配的成员
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* 技能市场弹窗 */}
      <Dialog open={skillMarketOpen} onOpenChange={setSkillMarketOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>去市场添加技能</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索技能..."
                  className="pl-8 h-9"
                  value={skillSearch}
                  onChange={e => setSkillSearch(e.target.value)}
                />
              </div>
              <Select value={skillCategory} onValueChange={setSkillCategory}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue placeholder="分类" />
                </SelectTrigger>
                <SelectContent>
                  {skillCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredSkills.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">未找到匹配的技能</div>
              )}
              {filteredSkills.map(skill => (
                <div
                  key={skill.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedSkillIds.includes(skill.id) ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/30 hover:bg-muted/30'}`}
                  onClick={() => {
                    setSelectedSkillIds(prev =>
                      prev.includes(skill.id) ? prev.filter(id => id !== skill.id) : [...prev, skill.id]
                    );
                  }}
                >
                  <Checkbox checked={selectedSkillIds.includes(skill.id)} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{skill.name}</span>
                      <Badge variant="outline" className="text-[10px] h-5">{skill.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{skill.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {skill.rating}</span>
                      <span className="flex items-center gap-0.5"><Download className="h-3 w-3" /> {skill.downloads.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex items-center justify-between pt-2 border-t text-sm shrink-0">
              <span className="text-muted-foreground">共 {filteredSkills.length} 条</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => {}} disabled><ChevronLeft className="h-4 w-4" /></Button>
                <div className="h-8 flex items-center justify-center px-3 border border-border/50 rounded-md bg-muted/30">1</div>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => {}} disabled><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>

            {selectedSkillIds.length > 0 && (
              <div className="shrink-0 flex items-center gap-3 pt-2 border-t">
                <span className="text-sm text-muted-foreground shrink-0">已选择 {selectedSkillIds.length} 个，添加到阶段：</span>
                <Select value={skillPhase} onValueChange={setSkillPhase}>
                  <SelectTrigger className="w-[180px] h-9">
                    <SelectValue placeholder="选择阶段" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="需求设计">需求设计</SelectItem>
                    <SelectItem value="UI 设计">UI 设计</SelectItem>
                    <SelectItem value="架构方案">架构方案</SelectItem>
                    <SelectItem value="代码开发">代码开发</SelectItem>
                    <SelectItem value="单元测试">单元测试</SelectItem>
                    <SelectItem value="集成 & UAT 验收">集成 & UAT 验收</SelectItem>
                    <SelectItem value="预发布验证">预发布验证</SelectItem>
                    <SelectItem value="生产上线运维">生产上线运维</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t shrink-0">
            <Button variant="outline" onClick={() => setSkillMarketOpen(false)}>取消</Button>
            <Button
              disabled={selectedSkillIds.length === 0}
              onClick={() => {
                toast.success(`已将 ${selectedSkillIds.length} 个技能添加到「${skillPhase}」阶段`);
                setSkillMarketOpen(false);
                setSelectedSkillIds([]);
              }}
            >
              添加 ({selectedSkillIds.length})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 创建技能弹窗 */}
      <Dialog open={createSkillOpen} onOpenChange={setCreateSkillOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>AI 创建自定义技能</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              用自然语言描述您需要的技能能力，AI 将自动分析并生成相应的技能配置。
            </p>
            <div className="space-y-2">
              <Label>技能描述</Label>
              <Textarea
                className="min-h-[120px] resize-none"
                placeholder="例如：创建一个技能，能够分析前端 React 组件性能并提供优化建议..."
                value={createSkillPrompt}
                onChange={(e) => setCreateSkillPrompt(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateSkillOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                if (!createSkillPrompt.trim()) {
                  toast.error('请输入技能描述');
                  return;
                }
                setIsGeneratingSkill(true);
                setTimeout(() => {
                  setIsGeneratingSkill(false);
                  toast.success('自定义技能生成成功并已自动安装');
                  setCreateSkillOpen(false);
                  setCreateSkillPrompt('');
                }, 1500);
              }}
              disabled={isGeneratingSkill}
            >
              {isGeneratingSkill ? '生成中...' : '生成技能'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 创建提示词弹窗 */}
      <Dialog open={createPromptOpen} onOpenChange={setCreatePromptOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>AI 创建自定义提示词</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              输入您需要的场景和目标，AI 将帮您编写结构化的高质量提示词。
            </p>
            <div className="space-y-2">
              <Label>提示词描述</Label>
              <Textarea
                className="min-h-[120px] resize-none"
                placeholder="例如：我需要一个用于审查 React 组件代码质量和可访问性的提示词..."
                value={createPromptDesc}
                onChange={(e) => setCreatePromptDesc(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreatePromptOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                if (!createPromptDesc.trim()) {
                  toast.error('请输入提示词描述');
                  return;
                }
                setIsGeneratingPrompt(true);
                setTimeout(() => {
                  setIsGeneratingPrompt(false);
                  toast.success('自定义提示词生成成功并已添加');
                  setCreatePromptOpen(false);
                  setCreatePromptDesc('');
                }, 1500);
              }}
              disabled={isGeneratingPrompt}
            >
              {isGeneratingPrompt ? '生成中...' : '生成提示词'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 提示词市场弹窗 */}
      <Dialog open={promptMarketOpen} onOpenChange={setPromptMarketOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>添加提示词</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索提示词..."
                  className="pl-8 h-9"
                  value={promptMarketSearch}
                  onChange={e => setPromptMarketSearch(e.target.value)}
                />
              </div>
              <Select value={promptMarketCategory} onValueChange={setPromptMarketCategory}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue placeholder="分类" />
                </SelectTrigger>
                <SelectContent>
                  {promptCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredPromptsMarket.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">未找到匹配的提示词</div>
              )}
              {filteredPromptsMarket.map(prompt => (
                <div
                  key={prompt.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedPromptIds.includes(prompt.id) ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/30 hover:bg-muted/30'}`}
                  onClick={() => {
                    setSelectedPromptIds(prev =>
                      prev.includes(prompt.id) ? prev.filter(id => id !== prompt.id) : [...prev, prompt.id]
                    );
                  }}
                >
                  <Checkbox checked={selectedPromptIds.includes(prompt.id)} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{prompt.name}</span>
                      <Badge variant="outline" className="text-[10px] h-5">{prompt.useCase}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{prompt.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Download className="h-3 w-3" /> {prompt.usageCount.toLocaleString()} 次使用</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex items-center justify-between pt-2 border-t text-sm shrink-0">
              <span className="text-muted-foreground">共 {filteredPromptsMarket.length} 条</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => {}} disabled><ChevronLeft className="h-4 w-4" /></Button>
                <div className="h-8 flex items-center justify-center px-3 border border-border/50 rounded-md bg-muted/30">1</div>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => {}} disabled><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>

          </div>
          <div className="flex justify-end gap-2 pt-2 border-t shrink-0">
            <Button variant="outline" onClick={() => setPromptMarketOpen(false)}>取消</Button>
            <Button
              disabled={selectedPromptIds.length === 0}
              onClick={() => {
                toast.success(`已将 ${selectedPromptIds.length} 个提示词添加到空间常用列表`);
                setPromptMarketOpen(false);
                setSelectedPromptIds([]);
              }}
            >
              添加 ({selectedPromptIds.length})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};