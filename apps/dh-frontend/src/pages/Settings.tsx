import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Save, UserPlus, Search, MoreHorizontal, Shield, Puzzle, FileText, Trash2, Plus, Code2, Copy, Check, CheckCircle, UploadCloud, Box, ListTodo, Camera, UserCircle, SlidersHorizontal, Wand2, Star, Download, X, ChevronLeft, ChevronRight, Bot, ChevronDown, Loader2, MessageSquareQuote, AlertCircle, Lock } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import MultiSelect from '@/components/ui/multi-select';
import { PaginationBar } from '@/components/admin/PaginationBar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { teamApi } from '@/lib/team-api';
import { workspaceApi } from '@/lib/workspace-api';
import { ApiError } from '@/lib/api';
import { repositoryApi } from '@/lib/repository-api';
import { agentConfigApi } from '@/lib/agent-config-api';
import { isBuiltinPromptCategoryName, sortPromptCategoriesByBuiltin } from '@/lib/prompt-categories';
import { toast } from 'sonner';
import type { Skill, SkillCategory, Prompt, WorkspacePrompt, PromptCategory, Workspace, WorkspaceMember, WorkitemProject, WorkspaceStandard, WorkspaceCICD, WorkspaceRepository, SettingsConfig, WorkspaceAgentConfig, AgentType } from '@/types';
import { useSearchParams } from 'react-router-dom';
import { usePermissions } from '@/hooks/use-permissions';
import { useClientPagination } from '@/hooks/use-client-pagination';
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

const BUILTIN_MODELS: Record<string, string[]> = {
  'opencode': ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  'claude-code': ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
  'codex': ['gpt-4o', 'gpt-4-turbo'],
};

// 未分类提示词的默认展示名称
const UNCATEGORIZED_NAME = '未分类';

// 空间提示词每页数量
const PROMPT_PAGE_SIZE = 8;

// 代码仓库每页数量
const GIT_REPO_PAGE_SIZE = 10;

interface AgentConfigCardProps {
  config: WorkspaceAgentConfig;
  readOnly: boolean;
  locked: boolean;
  globalModels: string[];
  platformEnabled: boolean;
  onChange: (config: WorkspaceAgentConfig) => void;
}

const AgentConfigCard: React.FC<AgentConfigCardProps> = ({ config, readOnly, locked, globalModels, platformEnabled, onChange }) => {
  const builtinModels = globalModels.length > 0 ? globalModels : (BUILTIN_MODELS[config.agentKey] ?? BUILTIN_MODELS['opencode']);
  // 锁定后该卡片所有输入均禁用
  const disabled = readOnly || locked;

  const updateField = <K extends keyof WorkspaceAgentConfig>(field: K, value: WorkspaceAgentConfig[K]) => {
    onChange({ ...config, [field]: value });
  };

  const updateAdvanced = (field: keyof NonNullable<WorkspaceAgentConfig['advancedConfig']>, value: number | undefined) => {
    const next: WorkspaceAgentConfig = {
      ...config,
      advancedConfig: {
        ...config.advancedConfig,
        [field]: value,
      },
    };
    onChange(next);
  };

  return (
    <Card className="border border-border/50 bg-card">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h4 className="font-medium text-sm">{config.name}</h4>
              <p className="text-xs text-muted-foreground">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!platformEnabled && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" title="该智能体尚未在平台范围启用，空间级启用不会生效">
                <AlertCircle className="h-3.5 w-3.5" />
                平台未启用
              </span>
            )}
            {locked && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" title="该智能体已被超级管理员锁定，仅可查看">
                <Lock className="h-3.5 w-3.5" />
                已锁定
              </span>
            )}
            <span className="text-xs text-muted-foreground">{config.enabled ? '已启用' : '已禁用'}</span>
            <Switch
              disabled={disabled || !platformEnabled}
              checked={config.enabled}
              onCheckedChange={checked => updateField('enabled', checked)}
            />
          </div>
        </div>

        {config.enabled && (
          <div className="space-y-4 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">使用自定义模型</Label>
                <p className="text-xs text-muted-foreground">开启后可配置自己的模型服务地址</p>
              </div>
              <Checkbox
                disabled={disabled}
                checked={config.modelSource === 'custom'}
                onCheckedChange={checked => updateField('modelSource', checked ? 'custom' : 'builtin')}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{config.modelSource === 'custom' ? '模型名称' : '选择模型'}</Label>
                {config.modelSource === 'custom' ? (
                  <Input
                    disabled={disabled}
                    placeholder="例如: custom-model-v1"
                    value={config.model}
                    onChange={e => updateField('model', e.target.value)}
                  />
                ) : (
                  <Select
                    disabled={disabled}
                    value={config.model}
                    onValueChange={val => updateField('model', val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择内置模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {builtinModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">温度 (Temperature)</Label>
                <Input
                  disabled={disabled}
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={config.temperature ?? ''}
                  onChange={e => updateField('temperature', e.target.value ? parseFloat(e.target.value) : undefined)}
                />
              </div>
            </div>

            {config.modelSource === 'custom' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Base URL</Label>
                  <Input
                    disabled={disabled}
                    placeholder="https://api.example.com/v1"
                    value={config.baseUrl}
                    onChange={e => updateField('baseUrl', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">API Key</Label>
                  <Input
                    disabled={disabled}
                    type="password"
                    placeholder="sk-..."
                    value={config.apiKey}
                    onChange={e => updateField('apiKey', e.target.value)}
                  />
                </div>
              </div>
            )}

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="p-0 h-auto text-xs text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3 w-3 mr-1" /> 高级配置
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">最大 Token 数</Label>
                    <Input
                      disabled={disabled}
                      type="number"
                      min="1"
                      placeholder="例如: 4096"
                      value={config.advancedConfig?.maxTokens ?? ''}
                      onChange={e => updateAdvanced('maxTokens', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">上下文窗口</Label>
                    <Input
                      disabled={disabled}
                      type="number"
                      min="1"
                      placeholder="例如: 128000"
                      value={config.advancedConfig?.contextWindow ?? ''}
                      onChange={e => updateAdvanced('contextWindow', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Top P</Label>
                    <Input
                      disabled={disabled}
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      placeholder="例如: 1.0"
                      value={config.advancedConfig?.topP ?? ''}
                      onChange={e => updateAdvanced('topP', e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Top K</Label>
                    <Input
                      disabled={disabled}
                      type="number"
                      min="1"
                      placeholder="例如: 50"
                      value={config.advancedConfig?.topK ?? ''}
                      onChange={e => updateAdvanced('topK', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

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
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [promptPage, setPromptPage] = useState(1);
  const [promptDetailOpen, setPromptDetailOpen] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<WorkspacePrompt | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<{ id: string; name: string; type: 'prompt' | 'skill' } | null>(null);
  const [categoryDeleteConfirmOpen, setCategoryDeleteConfirmOpen] = useState(false);

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

  const [agentConfigs, setAgentConfigs] = useState<WorkspaceAgentConfig[]>([]);
  const [agentConfigsLoading, setAgentConfigsLoading] = useState(false);
  const [platformAgentTypes, setPlatformAgentTypes] = useState<AgentType[]>([]);
  const [globalModels, setGlobalModels] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    agentConfigApi.listGlobalModels()
      .then(models => {
        if (cancelled) return;
        setGlobalModels(models);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load global models:', err);
      });
    return () => { cancelled = true; };
  }, []);

  const loadSkills = async (page: number = 1) => {
    setSkillsLoading(true);
    try {
      const [res, categories] = await Promise.all([
        teamApi.listSkills(page, SKILL_PAGE_SIZE),
        teamApi.listSkillCategories(),
      ]);
      setSkills(res.list);
      setSkillTotal(res.total);
      setSkillPage(res.page);
      setSkillCategories(categories);
    } catch (err) {
      console.error('Failed to load team skills:', err);
      toast.error('加载团队技能失败');
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    loadSkills(1);
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
    setAgentConfigsLoading(true);
    Promise.all([
      agentConfigApi.listWorkspaceConfigs(workspaceId),
      agentConfigApi.listAgentTypes().catch((): AgentType[] => []),
    ])
      .then(([configs, types]) => {
        if (cancelled) return;
        setAgentConfigs(configs);
        setPlatformAgentTypes(types);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load agent configs:', err);
        toast.error('加载智能体配置失败');
      })
      .finally(() => setAgentConfigsLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
    Promise.all([
      workspaceApi.get(workspaceId).catch((): Workspace | null => null),
      workspaceApi.members(workspaceId).catch((): WorkspaceMember[] => []),
      workspaceApi.getWorkitemProject(workspaceId).catch((): WorkitemProject | null => null),
      workspaceApi.listStandards(workspaceId).catch((): WorkspaceStandard[] => []),
      workspaceApi.getCICD(workspaceId).catch((): WorkspaceCICD | null => null),
      repositoryApi.list(workspaceId).catch((): WorkspaceRepository[] => []),
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

  const loadMembers = React.useCallback(() => {
    const wsId = workspace?.id || membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    workspaceApi.members(wsId)
      .then(mems => setWorkspaceMembers(mems))
      .catch(() => toast.error('加载成员列表失败'));
  }, [workspace?.id, membership?.workspaceId]);

  const [skillMarketOpen, setSkillMarketOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [skillCategory, setSkillCategory] = useState('全部');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skillPhase, setSkillPhase] = useState('需求设计');
  const [marketSkills, setMarketSkills] = useState<Skill[]>([]);
  const [marketSkillsLoading, setMarketSkillsLoading] = useState(false);

  const [skillCategories, setSkillCategories] = useState<SkillCategory[]>([]);
  const [selectedSkillCategory, setSelectedSkillCategory] = useState<string>('全部');
  const [skillPage, setSkillPage] = useState(1);
  const [skillTotal, setSkillTotal] = useState(0);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [isAddingSkillCategory, setIsAddingSkillCategory] = useState(false);
  const [newSkillCategoryName, setNewSkillCategoryName] = useState('');
  const SKILL_PAGE_SIZE = 12;

  const [createSkillOpen, setCreateSkillOpen] = useState(false);
  const [createSkillPrompt, setCreateSkillPrompt] = useState('');
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);

  const isTenantAdmin = user?.platformRole === PLATFORM_ROLE.TENANT_ADMIN || user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
  const isSpaceAdmin = membership?.spaceRole === SPACE_ROLE.SPACE_ADMIN;
  const canManageWorkspacePrompts = isTenantAdmin || isSpaceAdmin;

  const [promptMarketOpen, setPromptMarketOpen] = useState(false);
  const [promptMarketSearch, setPromptMarketSearch] = useState('');
  const [promptMarketCategory, setPromptMarketCategory] = useState('全部');

  const marketSkillCategoryOptions = ['全部', ...skillCategories.map(c => c.name)];
  const marketPromptCategories = ['全部', ...Array.from(new Set(marketPrompts.map(p => p.useCase)))];

  // 判断技能是否匹配当前搜索词与分类筛选条件（搜索框为空时命中全部）。
  const matchesSkillFilter = (s: Skill, search: string, category: string) => {
    const term = search.trim().toLowerCase();
    const matchSearch = term === '' || s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term);
    const matchCategory = category === '全部' || s.category === category;
    return matchSearch && matchCategory;
  };

  const filteredMarketSkills = marketSkills.filter(s => matchesSkillFilter(s, skillSearch, skillCategory));
  const displaySkills = skills.filter(s => matchesSkillFilter(s, skillSearch, selectedSkillCategory));

  const openSkillMarket = async () => {
    setSkillMarketOpen(true);
    setMarketSkillsLoading(true);
    setSkillSearch('');
    setSkillCategory('全部');
    setSelectedSkillIds([]);
    setSkillPhase('需求设计');
    try {
      const res = await teamApi.listSkills(1, 100);
      setMarketSkills(res.list);
    } catch (err) {
      console.error('Failed to load market skills:', err);
      toast.error('加载技能市场失败');
    } finally {
      setMarketSkillsLoading(false);
    }
  };

  const openPromptMarket = async () => {
    setPromptMarketOpen(true);
    setMarketPromptsLoading(true);
    try {
      const res = await teamApi.listPrompts(1, 100);
      const existingIds = new Set(prompts.map(p => p.libraryPromptId).filter(Boolean));
      setMarketPrompts(res.list.filter(p => p.status === 'on_shelf' && !existingIds.has(p.id)));
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

  const handleUpdatePromptEnabled = async (promptId: string, enabled: boolean) => {
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      const updated = await workspaceApi.updatePromptEnabled(wsId, promptId, enabled);
      setPrompts(prev => prev.map(p => p.id === promptId ? updated : p));
      if (selectedPrompt?.id === promptId) {
        setSelectedPrompt(updated);
      }
      toast.success(enabled ? '提示词已启用' : '提示词已停用');
    } catch {
      toast.error('操作失败');
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
    if (isBuiltinPromptCategoryName(name)) {
      toast.error('该分类名称为系统内置，无需创建');
      return;
    }
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      const created = await workspaceApi.createPromptCategory(wsId, name);
      setPromptCategories(prev => [...prev, created]);
      setNewCategoryName('');
      setIsAddingCategory(false);
      toast.success('分类已添加');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('暂无权限添加分类');
      } else {
        toast.error('添加分类失败，可能已存在');
      }
    }
  };

  const handleCreateSkillCategory = async () => {
    const name = newSkillCategoryName.trim();
    if (!name) {
      toast.error('请输入分类名称');
      return;
    }
    try {
      const created = await teamApi.createSkillCategory(name);
      setSkillCategories(prev => [...prev, created]);
      setNewSkillCategoryName('');
      setIsAddingSkillCategory(false);
      toast.success('分类已添加');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('暂无权限添加技能分类，请联系租户管理员');
      } else {
        toast.error('添加分类失败，可能已存在');
      }
    }
  };

  const handleDeletePromptCategory = async (categoryId: string) => {
    const category = promptCategories.find(c => c.id === categoryId);
    if (!category) return;
    if (category.isBuiltin || isBuiltinPromptCategoryName(category.name)) {
      toast.error('系统内置分类不可删除');
      return;
    }
    const hasAssociation = prompts.some(p => p.categories.some(c => c.id === categoryId));
    if (hasAssociation) {
      setCategoryToDelete({ id: categoryId, name: category.name, type: 'prompt' });
      setCategoryDeleteConfirmOpen(true);
      return;
    }
    await executeDeletePromptCategory(categoryId);
  };

  const executeDeletePromptCategory = async (categoryId: string) => {
    const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
    try {
      await workspaceApi.deletePromptCategory(wsId, categoryId);
      setPromptCategories(prev => prev.filter(c => c.id !== categoryId));
      if (selectedPromptCategory === categoryId) {
        setSelectedPromptCategory('全部');
      }
      // 删除后关联的提示词展示为未分类。
      setPrompts(prev => prev.map(p => ({
        ...p,
        categories: p.categories.filter(c => c.id !== categoryId),
      })));
      toast.success('分类已删除');
    } catch {
      toast.error('删除分类失败');
    } finally {
      setCategoryDeleteConfirmOpen(false);
      setCategoryToDelete(null);
    }
  };

  const handleDeleteSkillCategory = async (categoryId: string) => {
    const category = skillCategories.find(c => c.id === categoryId);
    if (!category) return;
    if (category.builtin) {
      toast.error('系统内置分类不可删除');
      return;
    }
    const hasAssociation = skills.some(s => s.category === category.name);
    if (hasAssociation) {
      setCategoryToDelete({ id: categoryId, name: category.name, type: 'skill' });
      setCategoryDeleteConfirmOpen(true);
      return;
    }
    await executeDeleteSkillCategory(categoryId);
  };

  const executeDeleteSkillCategory = async (categoryId: string) => {
    const categoryName = skillCategories.find(c => c.id === categoryId)?.name;
    try {
      await teamApi.deleteSkillCategory(categoryId);
      setSkillCategories(prev => prev.filter(c => c.id !== categoryId));
      if (categoryName && selectedSkillCategory === categoryName) {
        setSelectedSkillCategory('全部');
      }
      toast.success('分类已删除');
    } catch {
      toast.error('删除分类失败');
    } finally {
      setCategoryDeleteConfirmOpen(false);
      setCategoryToDelete(null);
    }
  };

  // 空间提示词按分类筛选与分页
  const sortedPromptCategories = React.useMemo(() => sortPromptCategoriesByBuiltin(promptCategories), [promptCategories]);
  const promptCategoryFilterOptions: { id: string; name: string; isBuiltin?: boolean }[] = [
    { id: 'all', name: '全部' },
    ...sortedPromptCategories.map(c => ({ id: c.id, name: c.name, isBuiltin: c.isBuiltin })),
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
    // 跳转到新仓库所在页（末页），确保用户可见
    const newTotalPages = Math.max(1, Math.ceil((gitRepos.length + 1) / GIT_REPO_PAGE_SIZE));
    gitRepoPagination.onPageChange(newTotalPages);
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

  const handleSaveAgentConfigs = async () => {
    const wsId = workspace?.id || 'ws-default';
    if (workspace?.agentConfigLocked) {
      toast.error('当前空间智能体配置已被锁定，无法保存');
      return;
    }
    // 过滤掉被单独锁定的 agent，仅保存未锁定的配置
    const lockedKeys = workspace?.lockedAgentKeys ?? [];
    const savableConfigs = agentConfigs.filter(cfg => !lockedKeys.includes(cfg.agentKey));
    if (savableConfigs.length === 0) {
      toast.info('所有智能体均被锁定，无需保存');
      return;
    }
    try {
      await Promise.all(savableConfigs.map(cfg => agentConfigApi.saveWorkspaceConfig(wsId, {
        agentKey: cfg.agentKey,
        enabled: cfg.enabled,
        model: cfg.model,
        modelSource: cfg.modelSource,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        temperature: cfg.temperature,
        advancedConfig: cfg.advancedConfig,
      })));
      toast.success('智能体配置已保存');
    } catch {
      toast.error('保存智能体配置失败');
    }
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
    displayId: m.displayId,
    name: m.name || m.displayId,
    email: m.email,
    spaceRole: m.role,
    subRole: m.subRole,
    joinedAt: m.joinedAt,
  }));

  const filteredUsers = displayUsers.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getSubRoleLabel(user.subRole).toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.spaceRole.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 代码仓库客户端分页
  const gitRepoPagination = useClientPagination({
    pageSize: GIT_REPO_PAGE_SIZE,
    total: gitRepos.length,
  });
  const paginatedGitRepos = gitRepos.slice(gitRepoPagination.startIndex, gitRepoPagination.endIndex);

  // getSubRoleBadge 根据职能子角色渲染徽章，文案与添加成员弹窗保持一致，不带图标
  const getSubRoleBadge = (subRole?: string) => {
    const label = getSubRoleLabel(subRole);
    switch (subRole) {
      case SUB_ROLE.PM: return <Badge variant="secondary">{label}</Badge>;
      case SUB_ROLE.DESIGNER: return <Badge variant="secondary" className="bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">{label}</Badge>;
      case SUB_ROLE.DEVELOPER: return <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300">{label}</Badge>;
      case SUB_ROLE.TESTER: return <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300">{label}</Badge>;
      default: return <Badge variant="outline">{label || '成员'}</Badge>;
    }
  };

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('developer');
  const [inviteAsAdmin, setInviteAsAdmin] = useState(false);

  const [memberToDelete, setMemberToDelete] = useState<typeof displayUsers[number] | null>(null);
  const [assetAssigneeId, setAssetAssigneeId] = useState<string>('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleInvite = () => {
    setIsInviteOpen(true);
  };

  const submitInvite = () => {
    if (!inviteEmail) {
      toast.error('请输入成员邮箱');
      return;
    }
    const workspaceId = workspace?.id || 'ws-default';
    // inviteRole 取值：pm | designer | developer | tester
    const role = inviteAsAdmin ? SPACE_ROLE.SPACE_ADMIN : SPACE_ROLE.MEMBER;
    const subRole = inviteRole;
    workspaceApi.addMember(workspaceId, { userId: inviteEmail, role, subRole })
      .then(() => {
        toast.success(`已添加成员 ${inviteEmail}`);
        setIsInviteOpen(false);
        setInviteEmail('');
        setInviteRole('developer');
        setInviteAsAdmin(false);
        loadMembers();
      })
      .catch(() => toast.error('添加成员失败'));
  };

  const handleSetAdmin = (user: typeof displayUsers[number], asAdmin: boolean) => {
    const workspaceId = workspace?.id || 'ws-default';
    const role = asAdmin ? SPACE_ROLE.SPACE_ADMIN : SPACE_ROLE.MEMBER;
    workspaceApi.updateMemberRole(workspaceId, user.id, { role, subRole: user.subRole })
      .then(() => {
        toast.success(asAdmin ? '已设为空间管理员' : '已取消空间管理员');
        loadMembers();
      })
      .catch(() => toast.error('设置失败'));
  };

  const handleDeleteMember = (user: typeof displayUsers[number]) => {
    setMemberToDelete(user);
    setAssetAssigneeId('');
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteMember = () => {
    if (!memberToDelete) return;
    const workspaceId = workspace?.id || 'ws-default';
    setIsProcessing(true);
    workspaceApi.removeMember(workspaceId, memberToDelete.id, assetAssigneeId || undefined)
      .then(() => {
        toast.success('成员已删除');
        setIsDeleteDialogOpen(false);
        setMemberToDelete(null);
        setAssetAssigneeId('');
        loadMembers();
      })
      .catch(() => toast.error('删除成员失败'))
      .finally(() => setIsProcessing(false));
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
                  {paginatedGitRepos.map((repo) => (
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
              {gitRepos.length > 0 && (
                <PaginationBar
                  currentPage={gitRepoPagination.currentPage}
                  totalPages={gitRepoPagination.totalPages}
                  onPageChange={gitRepoPagination.onPageChange}
                />
              )}
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
            <CardHeader className="pb-2">
              <CardDescription>按分类管理当前空间已安装和可用的技能。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="搜索技能名称或描述..."
                      className="pl-8 h-9"
                      value={skillSearch}
                      onChange={e => { setSkillSearch(e.target.value); setSkillPage(1); }}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => { setCreateSkillPrompt(''); setCreateSkillOpen(true); }}><Wand2 className="w-4 h-4 mr-2" />创建技能</Button>
                    <Button size="sm" onClick={openSkillMarket}><Plus className="w-4 h-4 mr-2" />去市场添加</Button>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {([{ id: 'all', name: '全部' }, ...skillCategories.map(c => ({ id: c.id, name: c.name, builtin: c.builtin }))] as { id: string; name: string; builtin?: boolean }[]).map(option => (
                      <Button
                        key={option.id}
                        variant={selectedSkillCategory === option.name ? 'default' : 'outline'}
                        size="sm"
                        className="h-9 rounded-full"
                        onClick={() => { setSelectedSkillCategory(option.name); setSkillPage(1); }}
                      >
                        {option.name}
                        {option.id !== 'all' && !option.builtin && isTenantAdmin && (
                          <span
                            className="ml-1.5 inline-flex items-center justify-center rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSkillCategory(option.id);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </Button>
                    ))}
                    {isTenantAdmin && (
                      isAddingSkillCategory ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            placeholder="新分类名称"
                            className="h-9 w-[140px] rounded-full px-3"
                            value={newSkillCategoryName}
                            onChange={(e) => setNewSkillCategoryName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCreateSkillCategory();
                              if (e.key === 'Escape') {
                                setNewSkillCategoryName('');
                                setIsAddingSkillCategory(false);
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-9 w-9 p-0 rounded-full"
                            onClick={handleCreateSkillCategory}
                            title="确认"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 w-9 p-0 rounded-full text-muted-foreground hover:text-foreground"
                            onClick={() => { setNewSkillCategoryName(''); setIsAddingSkillCategory(false); }}
                            title="取消"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full h-9 w-9 p-0"
                          onClick={() => setIsAddingSkillCategory(true)}
                          title="新增分类"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </div>

                {skillsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {displaySkills.map(skill => (
                          <div
                            key={skill.id}
                            className="flex flex-col p-4 rounded-xl border border-border/50 bg-card soft-shadow hover:border-primary/30 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                  <Puzzle className="h-5 w-5 text-primary" />
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-medium text-sm truncate">{skill.name}</h4>
                                  <Badge variant="outline" className="text-[10px] h-5 mt-0.5 inline-flex items-center gap-1">
                                    {skillCategories.some(c => c.name === skill.category) ? skill.category : UNCATEGORIZED_NAME}
                                    {(() => {
                                      const cat = skillCategories.find(c => c.name === skill.category);
                                      if (cat && !cat.builtin && isTenantAdmin) {
                                        return (
                                          <span
                                            className="inline-flex items-center justify-center rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteSkillCategory(cat.id);
                                            }}
                                          >
                                            <X className="h-2.5 w-2.5" />
                                          </span>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </Badge>
                                </div>
                              </div>
                              <Switch
                                checked={skill.installed}
                                onCheckedChange={checked => {
                                  teamApi.updateSkillInstalled(skill.id, checked)
                                    .then(() => {
                                      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, installed: checked } : s));
                                      toast.success(checked ? '技能已安装到当前空间' : '技能已卸载');
                                    })
                                    .catch(() => toast.error('操作失败'));
                                }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-3 line-clamp-2 flex-1">{skill.description}</p>
                            <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-0.5"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {skill.rating}</span>
                              <span className="flex items-center gap-0.5"><Download className="h-3 w-3" /> {skill.downloads.toLocaleString()}</span>
                              <span className="ml-auto">{skill.installed ? '已启用' : '未启用'}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                    {displaySkills.length === 0 && (
                      <div className="text-center py-10 text-sm text-muted-foreground">未找到匹配的技能</div>
                    )}
                    <PaginationBar
                      currentPage={skillPage}
                      totalPages={Math.max(1, Math.ceil(skillTotal / SKILL_PAGE_SIZE))}
                      onPageChange={loadSkills}
                    />
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompts">
          <Card className="soft-shadow border-none">
            <CardHeader className="pb-2">
              <CardDescription>按分类管理当前空间已启用的提示词模板。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="搜索提示词名称或内容..."
                      className="pl-8 h-9"
                      value={promptSearchTerm}
                      onChange={(e) => { setPromptSearchTerm(e.target.value); setPromptPage(1); }}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canManageWorkspacePrompts && (
                      <Button size="sm" onClick={() => { openPromptMarket(); }}><Plus className="w-4 h-4 mr-2" />添加提示词</Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {promptCategoryFilterOptions.map(option => (
                      <Button
                        key={option.id}
                        variant={selectedPromptCategory === option.name ? 'default' : 'outline'}
                        size="sm"
                        className="h-9 rounded-full whitespace-nowrap"
                        onClick={() => { setSelectedPromptCategory(option.name); setPromptPage(1); }}
                      >
                        {option.name}
                        {option.id !== 'all' && option.id !== 'uncategorized' && canManageWorkspacePrompts && !option.isBuiltin && !isBuiltinPromptCategoryName(option.name) && (
                          <span
                            className="ml-1.5 inline-flex items-center justify-center rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeletePromptCategory(option.id);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </Button>
                    ))}
                    {canManageWorkspacePrompts && (
                      isAddingCategory ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            placeholder="新分类名称"
                            className="h-9 w-[140px] rounded-full px-3"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCreateCategory();
                              if (e.key === 'Escape') {
                                setNewCategoryName('');
                                setIsAddingCategory(false);
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-9 w-9 p-0 rounded-full"
                            onClick={handleCreateCategory}
                            title="确认"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 w-9 p-0 rounded-full text-muted-foreground hover:text-foreground"
                            onClick={() => { setNewCategoryName(''); setIsAddingCategory(false); }}
                            title="取消"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full h-9 w-9 p-0"
                          onClick={() => setIsAddingCategory(true)}
                          title="新增分类"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {paginatedPrompts.map((prompt) => (
                    <div
                      key={prompt.id}
                      className="flex flex-col p-4 rounded-xl border border-border/50 bg-card soft-shadow cursor-pointer hover:border-primary/30 transition-colors"
                      onClick={() => openPromptDetail(prompt)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-medium text-sm truncate">{prompt.name}</h4>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {prompt.categories.length > 0 ? prompt.categories.slice(0, 4).map(c => (
                                <Badge key={c.id} variant="outline" className="text-[10px] h-5">{c.name}</Badge>
                              )) : (
                                <Badge variant="outline" className="text-[10px] h-5">{UNCATEGORIZED_NAME}</Badge>
                              )}
                              {prompt.categories.length > 4 && (
                                <Badge variant="outline" className="text-[10px] h-5">+{prompt.categories.length - 4}</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        {canManageWorkspacePrompts && (
                          <Switch
                            checked={prompt.enabled}
                            onClick={(e) => e.stopPropagation()}
                            onCheckedChange={checked => handleUpdatePromptEnabled(prompt.id, checked)}
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 line-clamp-2 flex-1">{prompt.content}</p>
                      <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5"><MessageSquareQuote className="h-3 w-3" /> {prompt.usageCount.toLocaleString()}</span>
                        <span className="ml-auto">{prompt.enabled ? '已启用' : '未启用'}</span>
                      </div>
                    </div>
                  ))}
                  {paginatedPrompts.length === 0 && (
                    <div className="col-span-full text-center py-12 text-sm text-muted-foreground">未找到匹配的提示词</div>
                  )}
                </div>

                <PaginationBar
                  currentPage={promptPage}
                  totalPages={promptTotalPages}
                  onPageChange={setPromptPage}
                />
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
                          options={sortedPromptCategories.map(c => ({ value: c.id, label: c.name }))}
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

        {/* 分类删除确认弹窗 -- 分类关联了技能/提示词时二次确认 */}
        <AlertDialog open={categoryDeleteConfirmOpen} onOpenChange={setCategoryDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除分类？</AlertDialogTitle>
              <AlertDialogDescription>
                分类「{categoryToDelete?.name}」下仍有{categoryToDelete?.type === 'skill' ? '技能' : '提示词'}，删除后这些{categoryToDelete?.type === 'skill' ? '技能' : '提示词'}将展示为「未分类」。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setCategoryDeleteConfirmOpen(false); setCategoryToDelete(null); }}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (categoryToDelete?.type === 'skill') {
                    executeDeleteSkillCategory(categoryToDelete.id);
                  } else if (categoryToDelete?.type === 'prompt') {
                    executeDeletePromptCategory(categoryToDelete.id);
                  }
                }}
                className="bg-destructive hover:bg-destructive/90"
              >
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <TabsContent value="agent">
          <Card className="soft-shadow border-none">
            <CardHeader>
              <CardTitle>智能体配置</CardTitle>
              <CardDescription>为当前空间启用并配置各智能体的模型与高级参数。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {workspace?.agentConfigLocked && (
                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  当前租户的智能体配置已被超级管理员整体锁定，仅可查看，不可修改。
                </div>
              )}
              {!workspace?.agentConfigLocked && (workspace?.lockedAgentKeys ?? []).length > 0 && (
                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  以下智能体已被超级管理员单独锁定：{(workspace?.lockedAgentKeys ?? []).join('、')}。其他智能体可正常编辑。
                </div>
              )}
              {agentConfigsLoading ? (
                <p className="text-center py-8 text-muted-foreground">加载中...</p>
              ) : agentConfigs.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">暂无可用智能体，请联系超管开启平台智能体范围。</p>
              ) : (
                agentConfigs.map(cfg => {
                  const platformType = platformAgentTypes.find(t => t.key === cfg.agentKey);
                  const platformEnabled = platformType ? platformType.enabled : true;
                  const agentLocked = workspace?.agentConfigLocked === true || (workspace?.lockedAgentKeys ?? []).includes(cfg.agentKey);
                  return (
                    <AgentConfigCard
                      key={cfg.agentKey}
                      config={cfg}
                      readOnly={isReadOnly}
                      locked={agentLocked}
                      globalModels={globalModels}
                      platformEnabled={platformEnabled}
                      onChange={next => setAgentConfigs(prev => prev.map(c => c.agentKey === next.agentKey ? next : c))}
                    />
                  );
                })
              )}

              {!isReadOnly && !workspace?.agentConfigLocked && agentConfigs.length > 0 && (
                <Button onClick={handleSaveAgentConfigs} className="mt-6">
                  <Save className="mr-2 h-4 w-4" /> 保存智能体配置
                </Button>
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
                    <Label>角色</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择角色" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pm">产品经理</SelectItem>
                        <SelectItem value="developer">开发人员</SelectItem>
                        <SelectItem value="tester">测试人员</SelectItem>
                        <SelectItem value="designer">UI设计师</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="invite-admin"
                      checked={inviteAsAdmin}
                      onCheckedChange={checked => setInviteAsAdmin(checked === true)}
                    />
                    <Label htmlFor="invite-admin" className="text-sm font-normal cursor-pointer">
                      同时设置为空间管理员
                    </Label>
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
                        <TableHead>ID</TableHead>
                        <TableHead className="w-[220px]">成员信息</TableHead>
                        <TableHead>成员角色</TableHead>
                        <TableHead>是否管理员</TableHead>
                        <TableHead>加入时间</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{member.displayId}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                                {member.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-medium">{member.name}</div>
                                <div className="text-xs text-muted-foreground">{member.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{getSubRoleBadge(member.subRole)}</TableCell>
                          <TableCell>
                            {member.spaceRole === SPACE_ROLE.SPACE_ADMIN ? (
                              <Badge className="bg-primary">是</Badge>
                            ) : (
                              <Badge variant="outline">否</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {formatDateTime(member.joinedAt)}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {user?.id !== member.id && !isReadOnly && (
                                  <>
                                    {member.spaceRole === SPACE_ROLE.SPACE_ADMIN ? (
                                      <DropdownMenuItem onClick={() => handleSetAdmin(member, false)}>
                                        取消空间管理员
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem onClick={() => handleSetAdmin(member, true)}>
                                        设为空间管理员
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => handleDeleteMember(member)}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      删除成员
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {(user?.id === member.id || isReadOnly) && (
                                  <DropdownMenuItem disabled>
                                    {user?.id === member.id ? '当前登录用户' : '无操作权限'}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredUsers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            未找到匹配的成员
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除成员？</AlertDialogTitle>
                  <AlertDialogDescription>
                    删除后，{memberToDelete?.name}（{memberToDelete?.email}）将失去当前工作空间的访问权限。
                    请指定其负责的工作项、文档等资产归属方。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4 space-y-3">
                  <div className="space-y-2">
                    <Label>资产归属方</Label>
                    <Select value={assetAssigneeId} onValueChange={setAssetAssigneeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择接收成员" />
                      </SelectTrigger>
                      <SelectContent>
                        {displayUsers
                          .filter(u => u.id !== memberToDelete?.id)
                          .map(u => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.displayId} · {u.name}（{getSubRoleLabel(u.subRole)}）
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      不选择时，被删除成员创建/负责的资产将保留原归属记录。
                    </p>
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setMemberToDelete(null)}>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={confirmDeleteMember}
                    disabled={isProcessing}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    确认删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
                  {marketSkillCategoryOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {marketSkillsLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!marketSkillsLoading && filteredMarketSkills.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">未找到匹配的技能</div>
              )}
              {!marketSkillsLoading && filteredMarketSkills.map(skill => (
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
              <span className="text-muted-foreground">共 {filteredMarketSkills.length} 条</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => {}} disabled><ChevronLeft className="h-4 w-4" /></Button>
                <div className="h-8 flex items-center justify-center px-3 border border-border/50 rounded-md bg-muted/30">1</div>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => {}} disabled><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>

          </div>
          <div className="flex justify-end gap-2 pt-2 border-t shrink-0">
            <Button variant="outline" onClick={() => setSkillMarketOpen(false)}>取消</Button>
            <Button
              disabled={selectedSkillIds.length === 0}
              onClick={() => {
                Promise.all(selectedSkillIds.map(id => teamApi.updateSkillInstalled(id, true)))
                  .then(() => {
                    loadSkills(skillPage);
                    toast.success(`已将 ${selectedSkillIds.length} 个技能安装到当前空间`);
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