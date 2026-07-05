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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import MultiSelect from '@/components/ui/multi-select';
import { teamApi } from '@/lib/team-api';
import { workspaceApi } from '@/lib/workspace-api';
import { repositoryApi } from '@/lib/repository-api';
import { toast } from 'sonner';
import type { Skill, Prompt, WorkspacePrompt, PromptCategory, Workspace, WorkspaceMember, WorkitemProject, WorkspaceStandard, WorkspaceCICD, WorkspaceRepository, SettingsConfig } from '@/types';
import { useSearchParams } from 'react-router-dom';
import { usePermissions } from '@/hooks/use-permissions';
import { useAuth } from '@/contexts/AuthContext';
import { PLATFORM_ROLE, SPACE_ROLE, SUB_ROLE, getSubRoleLabel } from '@/lib/role-constants';
import { formatDateTime } from '@/lib/utils';

// 工作空间设置的初始空配置，真实数据由 useEffect 从 workspaceApi 加载填充。
const DEFAULT_SETTINGS: SettingsConfig = {
  meegoProject: '',
  gitlabUrl: '',
  codingStandard: '',
  designStandard: '',
  agentConfig: {
    agentName: 'opencode',
    modelSource: 'builtin',
    model: '',
    temperature: 0.7,
  },
};

// 尚未入库的本地仓库行 ID 前缀，保存时据此调用 create 而非 update。
const LOCAL_REPO_ID_PREFIX = 'local-';

// 未分类提示词的默认展示名称
const UNCATEGORIZED_NAME = '未分类';

// 空间提示词每页数量
const PROMPT_PAGE_SIZE = 8;

export const Settings: React.FC = () => {
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'basic';
  const [activeTab, setActiveTab] = useState(defaultTab);

  const { canEditSettings } = usePermissions();
  const isReadOnly = !canEditSettings;
  const { user, membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  const [settings, setSettings] = useState<SettingsConfig>(DEFAULT_SETTINGS);
  const [searchTerm, setSearchTerm] = useState('');
  const [promptSearchTerm, setPromptSearchTerm] = useState('');
  const [promptCategories, setPromptCategories] = useState<PromptCategory[]>([]);
  const [selectedPromptCategory, setSelectedPromptCategory] = useState<string>('全部');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [promptPage, setPromptPage] = useState(1);
  const [promptDetailOpen, setPromptDetailOpen] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<WorkspacePrompt | null>(null);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [prompts, setPrompts] = useState<WorkspacePrompt[]>([]);
  const [marketPrompts, setMarketPrompts] = useState<Prompt[]>([]);
  const [marketPromptsLoading, setMarketPromptsLoading] = useState(false);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [workitemProject, setWorkitemProject] = useState<WorkitemProject | null>(null);
  const [workspaceStandards, setWorkspaceStandards] = useState<WorkspaceStandard[]>([]);
  const [cicd, setCicd] = useState<WorkspaceCICD | null>(null);
  const [cicdBranches, setCicdBranches] = useState('main, master');
  const [cicdWebhook, setCicdWebhook] = useState('');
  const [cicdScript, setCicdScript] = useState('npm run build\nnpm run test\nnpm run deploy');

  useEffect(() => {
    let cancelled = false;
    teamApi.listSkills()
      .then(loadedSkills => {
        if (cancelled) return;
        setSkills(loadedSkills);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load team skills:', err);
        toast.error('加载团队技能失败');
      });
    return () => { cancelled = true; };
  }, []);

  const loadWorkspacePrompts = async (wsId: string) => {
    try {
      const loadedPrompts = await workspaceApi.listPrompts(wsId);
      setPrompts(loadedPrompts);
    } catch (err) {
      console.error('Failed to load workspace prompts:', err);
      toast.error('加载空间提示词失败');
    }
  };

  const loadPromptCategories = async (wsId: string) => {
    try {
      const loadedCategories = await workspaceApi.listPromptCategories(wsId);
      setPromptCategories(loadedCategories);
    } catch (err) {
      console.error('Failed to load prompt categories:', err);
      toast.error('加载提示词分类失败');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    Promise.all([
      workspaceApi.listPrompts(wsId),
      workspaceApi.listPromptCategories(wsId),
    ]).then(([loadedPrompts, loadedCategories]) => {
      if (cancelled) return;
      setPrompts(loadedPrompts);
      setPromptCategories(loadedCategories);
    }).catch(err => {
      if (cancelled) return;
      console.error('Failed to load workspace prompts or categories:', err);
      toast.error('加载空间提示词失败');
    });
    return () => { cancelled = true; };
  }, [membership?.workspaceId]);

  useEffect(() => {
    setPromptPage(1);
  }, [promptSearchTerm, selectedPromptCategory]);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
    Promise.all([
      workspaceApi.get(workspaceId).catch(() => null),
      workspaceApi.members(workspaceId).catch(() => []),
      workspaceApi.getWorkitemProject(workspaceId).catch(() => null),
      workspaceApi.listStandards(workspaceId).catch(() => []),
      workspaceApi.getCICD(workspaceId).catch(() => null),
      repositoryApi.list(workspaceId).catch(() => []),
    ]).then(([ws, mems, wp, stds, cicdCfg, repos]) => {
      if (cancelled) return;
      setWorkspace(ws);
      setWorkspaceMembers(mems);
      setWorkitemProject(wp);
      setWorkspaceStandards(stds);
      setCicd(cicdCfg);
      if (cicdCfg) {
        setCicdBranches(cicdCfg.triggerBranches || 'main, master');
        setCicdWebhook(cicdCfg.webhookUrl || '');
        setCicdScript(cicdCfg.script || 'npm run build\nnpm run test\nnpm run deploy');
      }
      if (wp) {
        setSettings(prev => ({ ...prev, meegoProject: wp.externalKey || '' }));
        setReqPlatform(wp.platform || 'meego');
      }
      setGitRepos(repos as WorkspaceRepository[]);
      if (stds.length > 0) {
        const coding = stds.find(s => s.type === 'coding');
        const design = stds.find(s => s.type === 'design');
        setSettings(prev => ({
          ...prev,
          codingStandard: coding?.content || prev.codingStandard,
          designStandard: design?.content || prev.designStandard,
        }));
      }
    }).catch(err => {
      console.error('Failed to load workspace settings:', err);
      toast.error('加载空间配置失败');
    });
    return () => { cancelled = true; };
  }, []);

  const [skillMarketOpen, setSkillMarketOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillCategory, setSkillCategory] = useState('全部');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillPhase, setSkillPhase] = useState('需求设计');

  const [createSkillOpen, setCreateSkillOpen] = useState(false);
  const [createSkillPrompt, setCreateSkillPrompt] = useState('');
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);

  const isTenantAdmin = user?.platformRole === PLATFORM_ROLE.TENANT_ADMIN || user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
  const isSpaceAdmin = membership?.spaceRole === SPACE_ROLE.SPACE_ADMIN;
  const canManageWorkspacePrompts = isTenantAdmin || isSpaceAdmin;

  const [promptMarketOpen, setPromptMarketOpen] = useState(false);
  const [promptMarketSearch, setPromptMarketSearch] = useState('');
  const [promptMarketCategory, setPromptMarketCategory] = useState('全部');

  const skillCategories = ['全部', ...Array.from(new Set(skills.map(s => s.category)))];
  const marketPromptCategories = ['全部', ...Array.from(new Set(marketPrompts.map(p => p.useCase)))];

  const filteredSkills = skills.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(skillSearch.toLowerCase()) || s.description.toLowerCase().includes(skillSearch.toLowerCase());
    const matchCategory = skillCategory === '全部' || s.category === skillCategory;
    return matchSearch && matchCategory;
  });

  const openPromptMarket = async () => {
    setPromptMarketOpen(true);
    setMarketPromptsLoading(true);
    try {
      const list = await teamApi.listPrompts();
      const existingIds = new Set(prompts.map(p => p.libraryPromptId).filter(Boolean));
      setMarketPrompts(list.filter(p => p.status === 'on_shelf' && !existingIds.has(p.id)));
    } catch (err) {
      console.error('Failed to load market prompts:', err);
      toast.error('加载提示词市场失败');
    } finally {
      setMarketPromptsLoading(false);
    }
  };

  const handleAddMarketPrompt = async (promptId: string) => {
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      const added = await workspaceApi.addPrompt(wsId, promptId);
      setPrompts(prev => [added, ...prev]);
      setMarketPrompts(prev => prev.filter(p => p.id !== promptId));
      toast.success('已添加到空间');
    } catch {
      toast.error('添加失败');
    }
  };

  const handleRemoveWorkspacePrompt = async (promptId: string) => {
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      await workspaceApi.removePrompt(wsId, promptId);
      setPrompts(prev => prev.filter(p => p.id !== promptId));
      toast.success('已移除');
    } catch {
      toast.error('移除失败');
    }
  };

  const handleUpdatePromptCategories = async (promptId: string, categoryIds: string[]) => {
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      const updated = await workspaceApi.updatePromptCategories(wsId, promptId, categoryIds);
      setPrompts(prev => prev.map(p => p.id === promptId ? updated : p));
      if (selectedPrompt?.id === promptId) {
        setSelectedPrompt(updated);
      }
      toast.success('分类已更新');
    } catch {
      toast.error('更新分类失败');
    }
  };

  const openPromptDetail = (prompt: WorkspacePrompt) => {
    setSelectedPrompt(prompt);
    setPromptDetailOpen(true);
  };

  const closePromptDetail = () => {
    setPromptDetailOpen(false);
    setSelectedPrompt(null);
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      toast.error('请输入分类名称');
      return;
    }
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      const created = await workspaceApi.createPromptCategory(wsId, name);
      setPromptCategories(prev => [...prev, created]);
      setNewCategoryName('');
      toast.success('分类已添加');
    } catch {
      toast.error('添加分类失败，可能已存在');
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      await workspaceApi.deletePromptCategory(wsId, categoryId);
      setPromptCategories(prev => prev.filter(c => c.id !== categoryId));
      if (selectedPromptCategory === categoryId) {
        setSelectedPromptCategory('全部');
      }
      toast.success('分类已删除');
    } catch {
      toast.error('删除分类失败，可能该分类下仍有提示词');
    }
  };

  // 空间提示词按分类筛选与分页
  const promptCategoryFilterOptions = [
    { id: 'all', name: '全部' },
    ...promptCategories.map(c => ({ id: c.id, name: c.name })),
    { id: 'uncategorized', name: UNCATEGORIZED_NAME },
  ];

  const filteredWorkspacePrompts = prompts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(promptSearchTerm.toLowerCase()) ||
                        p.content.toLowerCase().includes(promptSearchTerm.toLowerCase());
    const categoryNames = p.categories.map(c => c.name);
    const hasCategory = categoryNames.length > 0;
    const matchCategory = selectedPromptCategory === '全部' ||
                          (selectedPromptCategory === UNCATEGORIZED_NAME
                            ? !hasCategory
                            : categoryNames.includes(selectedPromptCategory));
    return matchSearch && matchCategory;
  });

  const promptTotalPages = Math.max(1, Math.ceil(filteredWorkspacePrompts.length / PROMPT_PAGE_SIZE));
  const paginatedPrompts = filteredWorkspacePrompts.slice(
    (promptPage - 1) * PROMPT_PAGE_SIZE,
    promptPage * PROMPT_PAGE_SIZE
  );

  const filteredPromptsMarket = marketPrompts.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(promptMarketSearch.toLowerCase()) || p.description.toLowerCase().includes(promptMarketSearch.toLowerCase());
    const matchCategory = promptMarketCategory === '全部' || p.useCase === promptMarketCategory;
    return matchSearch && matchCategory;
  });
  
  const [reqPlatform, setReqPlatform] = useState('meego');
  const [gitRepos, setGitRepos] = useState<WorkspaceRepository[]>([]);

  const handleGitUrlChange = (id: string, url: string) => {
    setGitRepos(repos => repos.map(repo => repo.id === id ? { ...repo, url } : repo));
  };

  const handleRepoTypeChange = (id: string, type: WorkspaceRepository['type']) => {
    setGitRepos(repos => repos.map(repo => repo.id === id ? { ...repo, type } : repo));
  };

  const handleRepoBranchChange = (id: string, defaultBranch: string) => {
    setGitRepos(repos => repos.map(repo => repo.id === id ? { ...repo, defaultBranch } : repo));
  };

  const handleAddRepo = () => {
    // 仅在前端新增一行空白仓库，待用户填写后在 handleSaveBasic 中统一入库
    const tempRepo: WorkspaceRepository = {
      id: `${LOCAL_REPO_ID_PREFIX}${Date.now()}`,
      workspaceId: workspace?.id || '',
      name: '',
      url: '',
      type: 'dev',
      cloneStatus: 'pending',
      createdAt: '',
      updatedAt: '',
    };
    setGitRepos([...gitRepos, tempRepo]);
  };

  const handleRemoveRepo = (id: string) => {
    // 本地未入库的行直接从状态移除，无需调用 API
    if (id.startsWith(LOCAL_REPO_ID_PREFIX)) {
      setGitRepos(gitRepos.filter(repo => repo.id !== id));
      return;
    }
    const workspaceId = workspace?.id || 'ws-default';
    repositoryApi.delete(workspaceId, id)
      .then(() => setGitRepos(gitRepos.filter(repo => repo.id !== id)))
      .catch(() => toast.error('删除仓库失败'));
  };

  const handleSave = () => {
    toast.success('设置已保存');
  };

  const handleSaveWorkitem = async () => {
    const wsId = workspace?.id || 'ws-default';
    try {
      await workspaceApi.setWorkitemProject(wsId, {
        platform: reqPlatform,
        externalKey: settings.meegoProject,
        name: workspace?.name || settings.meegoProject,
      });
      toast.success('需求管理配置已保存');
    } catch {
      toast.error('保存需求管理配置失败');
    }
  };

  const handleSaveRepos = async () => {
    const wsId = workspace?.id || 'ws-default';
    try {
      const savedRepos = await Promise.all(gitRepos.map(async r => {
        if (r.id.startsWith(LOCAL_REPO_ID_PREFIX)) {
          if (!r.url) return r;
          return repositoryApi.create(wsId, {
            url: r.url, type: r.type, defaultBranch: r.defaultBranch,
          });
        }
        await repositoryApi.update(wsId, r.id, {
          url: r.url, type: r.type, defaultBranch: r.defaultBranch,
        });
        return r;
      }));
      setGitRepos(savedRepos);
      toast.success('代码仓库配置已保存');
    } catch {
      toast.error('保存代码仓库配置失败');
    }
  };

  const handleSaveStandards = async () => {
    const workspaceId = workspace?.id || 'ws-default';
    try {
      const coding = workspaceStandards.find(s => s.type === 'coding');
      const design = workspaceStandards.find(s => s.type === 'design');
      await Promise.all([
        workspaceApi.saveStandard(workspaceId, {
          id: coding?.id,
          type: 'coding',
          name: '编码规范',
          content: settings.codingStandard,
        }),
        workspaceApi.saveStandard(workspaceId, {
          id: design?.id,
          type: 'design',
          name: '设计规范',
          content: settings.designStandard,
        }),
      ]);
      toast.success('研发规范已保存');
    } catch {
      toast.error('保存研发规范失败');
    }
  };

  const handleSaveCICD = async () => {
    const workspaceId = workspace?.id || 'ws-default';
    try {
      await workspaceApi.saveCICD(workspaceId, {
        triggerBranches: cicdBranches,
        webhookUrl: cicdWebhook,
        script: cicdScript,
      });
      toast.success('CICD 配置已保存');
    } catch {
      toast.error('保存 CICD 配置失败');
    }
  };

  const displayUsers = workspaceMembers.map(m => ({
    id: m.userId,
    name: m.userId,
    spaceRole: m.role,
    subRole: m.subRole,
    joinedAt: m.joinedAt,
  }));

  const filteredUsers = displayUsers.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getSubRoleLabel(user.subRole).toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.spaceRole.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // getRoleBadge 根据空间权限与职能子角色渲染徽章；space_admin 显示管理员样式并附带职能后缀
  const getRoleBadge = (spaceRole: string, subRole?: string) => {
    if (spaceRole === SPACE_ROLE.SPACE_ADMIN) {
      return <Badge className="bg-primary"><Shield className="w-3 h-3 mr-1"/> 空间管理员{subRole ? `·${getSubRoleLabel(subRole)}` : ''}</Badge>;
    }
    switch (subRole) {
      case SUB_ROLE.PM: return <Badge variant="secondary"><Settings2 className="w-3 h-3 mr-1"/> 产品经理</Badge>;
      case SUB_ROLE.DESIGNER: return <Badge variant="secondary" className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">设计师</Badge>;
      case SUB_ROLE.DEVELOPER: return <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300">开发者</Badge>;
      case SUB_ROLE.TESTER: return <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300">测试人员</Badge>;
      default: return <Badge variant="outline"><UserIcon className="w-3 h-3 mr-1"/> 成员</Badge>;
    }
  };

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('developer');

  const handleInvite = () => {
    setIsInviteOpen(true);
  };

  const submitInvite = () => {
    if (!inviteEmail) {
      toast.error('请输入成员邮箱');
      return;
    }
    const workspaceId = workspace?.id || 'ws-default';
    // inviteRole 取值：space_admin | pm | designer | developer | tester
    const isSpaceAdmin = inviteRole === SPACE_ROLE.SPACE_ADMIN;
    const role = isSpaceAdmin ? SPACE_ROLE.SPACE_ADMIN : SPACE_ROLE.MEMBER;
    const subRole = isSpaceAdmin ? SUB_ROLE.DEVELOPER : inviteRole;
    workspaceApi.addMember(workspaceId, { userId: inviteEmail, role, subRole })
      .then(() => {
        toast.success(`已添加成员 ${inviteEmail}`);
        setIsInviteOpen(false);
        setInviteEmail('');
        setWorkspaceMembers(prev => [...prev, { workspaceId, userId: inviteEmail, role: role as WorkspaceMember['role'], subRole: subRole as WorkspaceMember['subRole'], joinedAt: new Date().toISOString() }]);
      })
      .catch(() => toast.error('添加成员失败'));
  };

  return (
    <div className="flex-1 space-y-6 w-full pb-12">
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
                {!isReadOnly && (
                  <Button onClick={handleSaveWorkitem} size="sm" className="mt-3"><Save className="mr-2 h-3.5 w-3.5" /> 保存需求配置</Button>
                )}
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
                
                <div className="space-y-2">
                  {gitRepos.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">暂无仓库配置</p>
                  )}
                  {gitRepos.map((repo) => (
                    <div key={repo.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
                      <div className="flex-1">
                        <Input 
                          placeholder="仓库地址（如 https://gitlab.com/org/repo.git）"
                          value={repo.url} 
                          onChange={e => handleGitUrlChange(repo.id, e.target.value)} 
                          className="bg-background"
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="w-[130px]">
                        <Input 
                          placeholder="main"
                          value={repo.defaultBranch || ''} 
                          onChange={e => handleRepoBranchChange(repo.id, e.target.value)} 
                          className="bg-background"
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="w-[110px]">
                        <Select disabled={isReadOnly} value={repo.type} onValueChange={(val) => handleRepoTypeChange(repo.id, val as WorkspaceRepository['type'])}>
                          <SelectTrigger className="bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dev">开发库</SelectItem>
                            <SelectItem value="case">用例库</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" disabled={isReadOnly} title="设置规范">
                              <SlidersHorizontal className="h-4 w-4" />
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
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={isReadOnly} title="删除仓库">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除</AlertDialogTitle>
                              <AlertDialogDescription>
                                确定要删除这个仓库配置吗？此操作不可撤销。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleRemoveRepo(repo.id)}>删除</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {!isReadOnly && gitRepos.length > 0 && (
                <Button onClick={handleSaveRepos} className="mt-6"><Save className="mr-2 h-4 w-4" /> 保存仓库配置</Button>
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
                <Button onClick={handleSaveStandards} className="mt-6"><Save className="mr-2 h-4 w-4" /> 保存规范</Button>
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
                <Input placeholder="例如: main, master, release/*" value={cicdBranches} onChange={e => setCicdBranches(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Webhook URL</Label>
                <Input placeholder="输入构建触发的 Webhook URL" type="url" value={cicdWebhook} onChange={e => setCicdWebhook(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>部署脚本命令</Label>
                <Textarea 
                  className="min-h-[120px] text-sm bg-muted/20"
                  style={{ fontFamily: '"JetBrains Mono", monospace' }}
                  value={cicdScript}
                  onChange={e => setCicdScript(e.target.value)}
                />
              </div>
              <Button onClick={handleSaveCICD}><Save className="mr-2 h-4 w-4" /> 保存配置</Button>
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
                        options={skills.map(s => ({ value: s.name, label: s.name }))}
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
                {canManageWorkspacePrompts && (
                  <Button size="sm" onClick={() => { openPromptMarket(); }}><Plus className="w-4 h-4 mr-2" />添加提示词</Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {promptCategoryFilterOptions.map(option => (
                    <Button
                      key={option.id}
                      variant={selectedPromptCategory === option.name ? 'default' : 'outline'}
                      className="rounded-full h-8 px-3 whitespace-nowrap"
                      onClick={() => setSelectedPromptCategory(option.name)}
                    >
                      {option.name}
                      {option.id !== 'all' && option.id !== 'uncategorized' && canManageWorkspacePrompts && (
                        <span
                          className="ml-1.5 inline-flex items-center justify-center rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(option.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </span>
                      )}
                    </Button>
                  ))}
                  {canManageWorkspacePrompts && (
                    <div className="flex items-center gap-2 ml-auto">
                      <Input
                        placeholder="新分类名称"
                        className="h-8 w-[140px]"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory(); }}
                      />
                      <Button size="sm" className="h-8 px-3" onClick={handleCreateCategory}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {paginatedPrompts.map((prompt) => (
                    <Card
                      key={prompt.id}
                      className="bg-muted/10 border-border/50 border-dashed hover:border-primary/50 transition-colors group cursor-pointer flex flex-col h-full"
                      onClick={() => openPromptDetail(prompt)}
                    >
                      <CardContent className="p-4 flex flex-col h-full">
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <h4 className="font-medium text-sm flex items-center min-w-0">
                            <FileText className="h-4 w-4 mr-2 text-primary shrink-0" />
                            <span className="line-clamp-1">{prompt.name}</span>
                          </h4>
                          <div
                            className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-primary/10 hover:text-primary" onClick={() => {
                              navigator.clipboard.writeText(prompt.content).then(() => toast.success('内容已复制到剪贴板'));
                            }}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            {canManageWorkspacePrompts && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleRemoveWorkspacePrompt(prompt.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {prompt.categories.length > 0 ? prompt.categories.map(c => (
                            <Badge key={c.id} variant="outline" className="text-xs h-6">{c.name}</Badge>
                          )) : (
                            <Badge variant="outline" className="text-xs h-6">{UNCATEGORIZED_NAME}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed flex-1">
                          {prompt.content}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                  {paginatedPrompts.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground">未找到匹配的提示词</div>
                  )}
                </div>

                {filteredWorkspacePrompts.length > PROMPT_PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-muted-foreground">
                      共 {filteredWorkspacePrompts.length} 条，第 {promptPage} / {promptTotalPages} 页
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={promptPage <= 1}
                        onClick={() => setPromptPage(p => Math.max(1, p - 1))}
                      >
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={promptPage >= promptTotalPages}
                        onClick={() => setPromptPage(p => Math.min(promptTotalPages, p + 1))}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 提示词详情弹窗 -- 查看完整内容并管理分类 */}
        <Dialog open={promptDetailOpen} onOpenChange={(open) => { if (!open) closePromptDetail(); }}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            {selectedPrompt && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <span className="line-clamp-1">{selectedPrompt.name}</span>
                  </DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">分类：</span>
                    {canManageWorkspacePrompts ? (
                      <div className="min-w-[200px] flex-1">
                        <MultiSelect
                          options={promptCategories.map(c => ({ value: c.id, label: c.name }))}
                          value={selectedPrompt.categories.map(c => c.id)}
                          onChange={(values) => handleUpdatePromptCategories(selectedPrompt.id, values)}
                        />
                      </div>
                    ) : (
                      <>
                        {selectedPrompt.categories.length > 0 ? selectedPrompt.categories.map(c => (
                          <Badge key={c.id} variant="outline" className="text-xs h-6">{c.name}</Badge>
                        )) : (
                          <Badge variant="outline" className="text-xs h-6">{UNCATEGORIZED_NAME}</Badge>
                        )}
                      </>
                    )}
                  </div>
                  {selectedPrompt.description && (
                    <p className="text-sm text-muted-foreground">{selectedPrompt.description}</p>
                  )}
                  <div className="relative">
                    <Textarea
                      value={selectedPrompt.content}
                      readOnly
                      className="min-h-[240px] resize-none font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t shrink-0">
                  <Button variant="outline" onClick={() => {
                    navigator.clipboard.writeText(selectedPrompt.content).then(() => toast.success('内容已复制到剪贴板'));
                  }}>
                    <Copy className="h-4 w-4 mr-2" /> 复制
                  </Button>
                  <Button variant="outline" onClick={closePromptDetail}>关闭</Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

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
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择角色" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="space_admin">空间管理员</SelectItem>
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
                  <CardTitle className="text-base">空间成员 ({displayUsers.length})</CardTitle>
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
                            {getRoleBadge(user.spaceRole, user.subRole)}
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {formatDateTime(user.joinedAt)}
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
                Promise.all(selectedSkillIds.map(id => teamApi.updateSkillInstalled(id, true)))
                  .then(() => {
                    setSkills(prev => prev.map(s => selectedSkillIds.includes(s.id) ? { ...s, installed: true } : s));
                    toast.success(`已将 ${selectedSkillIds.length} 个技能添加到「${skillPhase}」阶段`);
                    setSkillMarketOpen(false);
                    setSelectedSkillIds([]);
                  })
                  .catch(() => toast.error('添加技能失败'));
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
                const name = createSkillPrompt.trim().slice(0, 20) || 'AI 生成自定义技能';
                teamApi.createSkill({
                  name,
                  description: createSkillPrompt.trim(),
                  category: skillCategory !== '全部' ? skillCategory : '通用',
                  tags: '',
                  icon: 'Puzzle',
                  phase: skillPhase,
                  rating: 5.0,
                }).then(skill => {
                  setSkills(prev => [skill, ...prev]);
                  setIsGeneratingSkill(false);
                  toast.success('自定义技能生成成功并已自动安装');
                  setCreateSkillOpen(false);
                  setCreateSkillPrompt('');
                }).catch(() => {
                  setIsGeneratingSkill(false);
                  toast.error('技能生成失败');
                });
              }}
              disabled={isGeneratingSkill}
            >
              {isGeneratingSkill ? '生成中...' : '生成技能'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 提示词市场弹窗 -- 用于从市场添加已上架提示词到当前空间 */}
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
                  {marketPromptCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {marketPromptsLoading && (
                <div className="text-center py-8 text-sm text-muted-foreground">加载中...</div>
              )}
              {!marketPromptsLoading && filteredPromptsMarket.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">未找到可添加的提示词</div>
              )}
              {!marketPromptsLoading && filteredPromptsMarket.map(prompt => (
                <div
                  key={prompt.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-muted/30 transition-colors"
                >
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
                  <Button size="sm" onClick={() => handleAddMarketPrompt(prompt.id)}>添加</Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t text-sm shrink-0">
              <span className="text-muted-foreground">共 {filteredPromptsMarket.length} 条</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t shrink-0">
            <Button variant="outline" onClick={() => setPromptMarketOpen(false)}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};