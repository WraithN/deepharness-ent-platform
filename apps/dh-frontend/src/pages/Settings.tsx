import { Bot, Box, Camera, Check, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Code2, Copy, Download, FileText, ListTodo, Loader2, Lock, MessageSquareQuote, MoreHorizontal, Palette, Plus, Puzzle, Save, Search, Share2, Shield, SlidersHorizontal, Star, Trash2, UserCircle, UserPlus, Users, Wand2, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { ModelVendorSelect } from '@/components/ModelVendorSelect';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { RepoStandardsDialog } from '@/components/RepoStandardsDialog';
import { StandardGenerateDialog } from '@/components/StandardGenerateDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MultiSelect from '@/components/ui/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { usePermissions } from '@/hooks/use-permissions';
import { agentConfigApi } from '@/lib/agent-config-api';
import { ApiError } from '@/lib/api';
import { isBuiltinPromptCategoryName, sortPromptCategoriesByBuiltin } from '@/lib/prompt-categories';
import { repositoryApi } from '@/lib/repository-api';
import { getPlatformRoleLabel, getSubRoleLabel, PLATFORM_ROLE, type PlatformRole, SPACE_ROLE, type SpaceRole, SUB_ROLE, type SubRole } from '@/lib/role-constants';
import { useTemplates } from '@/hooks/use-templates';
import { teamApi } from '@/lib/team-api';
import { formatDateTime } from '@/lib/utils';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import { workspaceApi } from '@/lib/workspace-api';
import type { ModelVendorGroup, Prompt, PromptCategory, SettingsConfig, Skill, SkillCategory, WorkitemPlatform, WorkitemProject, Workspace, WorkspaceAgentConfig, WorkspaceMember, WorkspacePrompt, WorkspaceRepository, WorkspaceStandard } from '@/types';

// 空间提示词分享审核状态展示配置（取值与后端 team_prompts.status 对齐）。
const PROMPT_SHARE_STATUS_LABELS: Record<string, string> = {
  pending_review: '审核中',
  on_shelf: '已上架',
  off_shelf: '已下架',
  rejected: '已拒绝',
};
const PROMPT_SHARE_STATUS_CLASS: Record<string, string> = {
  pending_review: 'border-amber-300 text-amber-600',
  on_shelf: 'border-green-300 text-green-600',
  rejected: 'border-destructive/50 text-destructive',
  off_shelf: 'border-muted-foreground/40 text-muted-foreground',
};

// 工作空间设置的初始空配置，真实数据由 useEffect 从 workspaceApi 加载填充。
const DEFAULT_SETTINGS: SettingsConfig = {
  reqProjectId: '',
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

// 需求管理平台接口失败时的回退列表，保证下拉框始终可用。
const DEFAULT_WORKITEM_PLATFORMS: WorkitemPlatform[] = [
  { key: 'meego', name: 'Meego', needsProjectId: true, projectIdPlaceholder: '输入 Meego 项目 ID...' },
  { key: 'jira', name: 'Jira', needsProjectId: true, projectIdPlaceholder: '输入 Jira 项目 Key（如 PROJ）...' },
  { key: 'pingcode', name: 'PingCode', needsProjectId: true, projectIdPlaceholder: '输入 PingCode 项目 ID...' },
];

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
  modelGroups: ModelVendorGroup[];
  onChange: (config: WorkspaceAgentConfig) => void;
}

const AgentConfigCard: React.FC<AgentConfigCardProps> = ({ config, readOnly, locked, modelGroups, onChange }) => {
  // 后端未返回厂商分组时的本地兜底模型列表
  const fallbackModels = BUILTIN_MODELS[config.agentKey] ?? BUILTIN_MODELS['opencode'];
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
            {locked && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400" title="该智能体已被超级管理员锁定，仅可查看">
                <Lock className="h-3.5 w-3.5" />
                已锁定
              </span>
            )}
            <div className="flex items-center gap-1.5 mr-2">
              <Checkbox
                id={`default-agent-${config.agentKey}`}
                disabled={disabled || !config.enabled}
                checked={config.isDefault}
                onCheckedChange={checked => updateField('isDefault', checked === true)}
              />
              <Label htmlFor={`default-agent-${config.agentKey}`} className="text-xs text-muted-foreground cursor-pointer">
                默认智能体
              </Label>
            </div>
            <span className="text-xs text-muted-foreground">{config.enabled ? '已启用' : '已禁用'}</span>
            <Switch
              disabled={disabled}
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
                <ModelVendorSelect
                  disabled={disabled}
                  value={config.model}
                  onValueChange={val => updateField('model', val)}
                  groups={modelGroups}
                  fallbackModels={fallbackModels}
                />
              )}
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
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
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
                    <Label className="text-xs text-muted-foreground">温度 (Temperature)</Label>
                    <Input
                      disabled={disabled}
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      placeholder="例如: 0.7"
                      value={config.temperature ?? ''}
                      onChange={e => updateField('temperature', e.target.value ? parseFloat(e.target.value) : undefined)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">无事件超时（秒）</Label>
                    <Input
                      disabled={disabled}
                      type="number"
                      min="1"
                      placeholder="例如: 120"
                      value={config.timeout ?? ''}
                      onChange={e => updateField('timeout', e.target.value ? parseInt(e.target.value, 10) : undefined)}
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

  const codingStandardTemplates = useTemplates('development', true);
  const designStandardTemplates = useTemplates('design', true);

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
  const [promptDetailCategoryIds, setPromptDetailCategoryIds] = useState<string[]>([]);
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
  const [agentConfigs, setAgentConfigs] = useState<WorkspaceAgentConfig[]>([]);
  const [agentConfigsLoading, setAgentConfigsLoading] = useState(false);
  const [modelGroups, setModelGroups] = useState<ModelVendorGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    agentConfigApi.listGlobalModelGroups()
      .then(groups => {
        if (cancelled) return;
        setModelGroups(groups);
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
      const wsId = getCurrentWorkspaceId();
      const [res, categories] = await Promise.all([
        teamApi.listSkills(page, SKILL_PAGE_SIZE, wsId),
        teamApi.listSkillCategories(wsId),
      ]);
      setSkills(res.list);
      setSkillTotal(res.total);
      setSkillPage(res.page);
      setSkillCategories(categories);
    } catch (err) {
      console.error('Failed to load team skills:', err);
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    loadSkills(1);
  }, [workspaceId]);

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
    const wsId = getCurrentWorkspaceId();
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
    const workspaceId = getCurrentWorkspaceId();
    setAgentConfigsLoading(true);
    agentConfigApi.listWorkspaceConfigs(workspaceId)
      .then(configs => {
        if (cancelled) return;
        setAgentConfigs(configs.map(cfg => ({
          ...cfg,
          timeout: cfg.timeout ?? 120,
        })));
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
    const workspaceId = getCurrentWorkspaceId();
    Promise.all([
      workspaceApi.get(workspaceId).catch((): Workspace | null => null),
      workspaceApi.members(workspaceId).catch((): WorkspaceMember[] => []),
      workspaceApi.getWorkitemProject(workspaceId).catch((): WorkitemProject | null => null),
      workspaceApi.listStandards(workspaceId).catch((): WorkspaceStandard[] => []),
      repositoryApi.list(workspaceId).catch((): WorkspaceRepository[] => []),
      workspaceApi.listWorkitemPlatforms().catch((): WorkitemPlatform[] => []),
    ]).then(([ws, mems, wp, stds, repos, platforms]) => {
      if (cancelled) return;
      setWorkspace(ws);
      setWorkspaceMembers(mems);
      setWorkitemProject(wp);
      setWorkspaceStandards(stds);
      if (wp) {
        setSettings(prev => ({ ...prev, reqProjectId: wp.externalKey || '' }));
        setReqPlatform(wp.platform || '');
      }
      setWorkitemPlatforms(platforms);
      // 未配置过需求平台时默认选中配置列表中的第一个平台。
      if (!wp?.platform && platforms.length > 0) {
        setReqPlatform(platforms[0].key);
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
    const wsId = workspace?.id || getCurrentWorkspaceId();
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
  // 成员列表每页条数（客户端分页，搜索词变化时重置到第 1 页）
  const MEMBER_PAGE_SIZE = 10;

  const [createSkillOpen, setCreateSkillOpen] = useState(false);
  const [createSkillPrompt, setCreateSkillPrompt] = useState('');
  const [isGeneratingSkill, setIsGeneratingSkill] = useState(false);

  const isTenantAdmin = user?.platformRole === PLATFORM_ROLE.TENANT_ADMIN || user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
  const isSpaceAdmin = membership?.spaceRole === SPACE_ROLE.SPACE_ADMIN;
  const canManageWorkspacePrompts = isTenantAdmin || isSpaceAdmin;

  const [promptMarketOpen, setPromptMarketOpen] = useState(false);
  const [promptMarketSearch, setPromptMarketSearch] = useState('');
  const [promptMarketCategory, setPromptMarketCategory] = useState('全部');
  // 提示词市场弹窗多选状态与批量添加中标志（防止重复点击重复计数）。
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [isAddingMarketPrompts, setIsAddingMarketPrompts] = useState(false);
  // 复制/分享操作中的提示词 ID（按钮 loading 态，兼作防抖）。
  const [copyingPromptId, setCopyingPromptId] = useState<string | null>(null);
  const [sharingPromptId, setSharingPromptId] = useState<string | null>(null);
  // 提示词详情弹窗编辑态：仅自定义提示词（非市场来源）可编辑内容。
  const [promptEditForm, setPromptEditForm] = useState({ name: '', description: '', content: '' });
  const [isSavingPromptContent, setIsSavingPromptContent] = useState(false);

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
      const res = await teamApi.listSkills(1, 100, workspaceId);
      setMarketSkills(res.list);
    } catch (err) {
      console.error('Failed to load market skills:', err);
    } finally {
      setMarketSkillsLoading(false);
    }
  };

  const openPromptMarket = async () => {
    setPromptMarketOpen(true);
    setMarketPromptsLoading(true);
    setPromptMarketSearch('');
    setPromptMarketCategory('全部');
    setSelectedPromptIds([]);
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

  // 批量将市场提示词加入空间：每次加入会使市场提示词使用次数 +1（后端处理）。
  // 逐条结算，部分失败时保留未成功的条目供重试。
  const handleAddSelectedPrompts = async () => {
    if (selectedPromptIds.length === 0) return;
    const wsId = getCurrentWorkspaceId();
    setIsAddingMarketPrompts(true);
    try {
      const results = await Promise.allSettled(selectedPromptIds.map(id => workspaceApi.addPrompt(wsId, id)));
      const added = results
        .filter((r): r is PromiseFulfilledResult<WorkspacePrompt> => r.status === 'fulfilled')
        .map(r => r.value);
      const failedCount = results.length - added.length;
      if (added.length > 0) {
        setPrompts(prev => [...added, ...prev]);
        const addedLibIds = new Set(added.map(p => p.libraryPromptId));
        setMarketPrompts(prev => prev.filter(p => !addedLibIds.has(p.id)));
      }
      setSelectedPromptIds([]);
      if (failedCount > 0) {
        toast.error(`${failedCount} 个提示词添加失败，请重试`);
      } else {
        setPromptMarketOpen(false);
      }
    } finally {
      setIsAddingMarketPrompts(false);
    }
  };

  const handleRemoveWorkspacePrompt = async (promptId: string) => {
    const wsId = getCurrentWorkspaceId();
    try {
      await workspaceApi.removePrompt(wsId, promptId);
      setPrompts(prev => prev.filter(p => p.id !== promptId));
      
    } catch {
      toast.error('移除失败');
    }
  };

  const handleUpdatePromptCategories = async (promptId: string, categoryIds: string[]) => {
    const wsId = getCurrentWorkspaceId();
    try {
      const updated = await workspaceApi.updatePromptCategories(wsId, promptId, categoryIds);
      setPrompts(prev => prev.map(p => p.id === promptId ? updated : p));
      if (selectedPrompt?.id === promptId) {
        setSelectedPrompt(updated);
      }
      
    } catch {
      toast.error('更新分类失败');
    }
  };

  const handleUpdatePromptEnabled = async (promptId: string, enabled: boolean) => {
    const wsId = getCurrentWorkspaceId();
    try {
      const updated = await workspaceApi.updatePromptEnabled(wsId, promptId, enabled);
      setPrompts(prev => prev.map(p => p.id === promptId ? updated : p));
      if (selectedPrompt?.id === promptId) {
        setSelectedPrompt(updated);
      }
      
    } catch {
      toast.error('操作失败');
    }
  };

  // 复制为空间自定义副本：市场来源提示词不可直接修改，复制生成 is_custom 副本后可编辑。
  // copyingPromptId 作为按钮 loading 态兼防抖，避免重复点击导致市场使用次数重复 +1。
  const handleCopyWorkspacePrompt = async (prompt: WorkspacePrompt) => {
    const wsId = getCurrentWorkspaceId();
    setCopyingPromptId(prompt.id);
    try {
      const copy = await workspaceApi.copyPrompt(wsId, prompt.id);
      setPrompts(prev => [copy, ...prev]);
      
      // 在详情弹窗中复制时，直接切换到副本并同步编辑态。
      if (selectedPrompt?.id === prompt.id) {
        setSelectedPrompt(copy);
        setPromptDetailCategoryIds(copy.categories.map(c => c.id));
        setPromptEditForm({ name: copy.name, description: copy.description, content: copy.content });
      }
    } catch {
      toast.error('复制失败');
    } finally {
      setCopyingPromptId(null);
    }
  };

  // 分享自定义提示词到市场：创建 pending_review 审核条目，由超管在市场页审核。
  const handleShareWorkspacePrompt = async (promptId: string) => {
    const wsId = getCurrentWorkspaceId();
    setSharingPromptId(promptId);
    try {
      const updated = await workspaceApi.sharePrompt(wsId, promptId);
      setPrompts(prev => prev.map(p => p.id === promptId ? updated : p));
      if (selectedPrompt?.id === promptId) {
        setSelectedPrompt(updated);
      }
      
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '分享失败');
    } finally {
      setSharingPromptId(null);
    }
  };

  const handleSavePromptContent = async () => {
    if (!selectedPrompt) return;
    const wsId = getCurrentWorkspaceId();
    setIsSavingPromptContent(true);
    try {
      const updated = await workspaceApi.updatePromptContent(wsId, selectedPrompt.id, {
        name: promptEditForm.name.trim(),
        description: promptEditForm.description.trim(),
        content: promptEditForm.content,
        useCase: selectedPrompt.useCase,
      });
      setPrompts(prev => prev.map(p => p.id === updated.id ? updated : p));
      setSelectedPrompt(updated);
      
    } catch {
      toast.error('保存失败');
    } finally {
      setIsSavingPromptContent(false);
    }
  };

  const openPromptDetail = (prompt: WorkspacePrompt) => {
    setSelectedPrompt(prompt);
    setPromptDetailCategoryIds(prompt.categories.map(c => c.id));
    setPromptEditForm({ name: prompt.name, description: prompt.description, content: prompt.content });
    setPromptDetailOpen(true);
  };

  const closePromptDetail = () => {
    setPromptDetailOpen(false);
    setSelectedPrompt(null);
    setPromptDetailCategoryIds([]);
  };

  // 判断提示词详情弹窗中的分类是否发生过变更，用于控制保存按钮可用状态。
  const hasPromptCategoryChanges = React.useMemo(() => {
    if (!selectedPrompt) return false;
    const currentIds = new Set(promptDetailCategoryIds);
    const originalIds = new Set(selectedPrompt.categories.map(c => c.id));
    return currentIds.size !== originalIds.size || [...currentIds].some(id => !originalIds.has(id));
  }, [promptDetailCategoryIds, selectedPrompt]);

  // 判断详情弹窗中的内容是否发生过变更（仅自定义提示词可编辑内容）。
  const hasPromptContentChanges = React.useMemo(() => {
    if (!selectedPrompt || selectedPrompt.libraryPromptId) return false;
    return promptEditForm.name !== selectedPrompt.name
      || promptEditForm.description !== selectedPrompt.description
      || promptEditForm.content !== selectedPrompt.content;
  }, [promptEditForm, selectedPrompt]);

  // 保存按钮统一提交内容变更与分类变更（市场来源提示词仅允许改分类）。
  const handleSavePromptDetail = async () => {
    if (!selectedPrompt) return;
    if (hasPromptContentChanges) {
      await handleSavePromptContent();
    }
    if (hasPromptCategoryChanges) {
      await handleUpdatePromptCategories(selectedPrompt.id, promptDetailCategoryIds);
    }
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
    const wsId = getCurrentWorkspaceId();
    try {
      const created = await workspaceApi.createPromptCategory(wsId, name);
      setPromptCategories(prev => [...prev, created]);
      setNewCategoryName('');
      setIsAddingCategory(false);
      
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
      const created = await teamApi.createSkillCategory(name, workspaceId);
      setSkillCategories(prev => [...prev, created]);
      setNewSkillCategoryName('');
      setIsAddingSkillCategory(false);
      
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
    const wsId = getCurrentWorkspaceId();
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
      await teamApi.deleteSkillCategory(categoryId, workspaceId);
      setSkillCategories(prev => prev.filter(c => c.id !== categoryId));
      if (categoryName && selectedSkillCategory === categoryName) {
        setSelectedSkillCategory('全部');
      }
      
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
  
  const [reqPlatform, setReqPlatform] = useState('');
  const [workitemPlatforms, setWorkitemPlatforms] = useState<WorkitemPlatform[]>([]);
  // 平台接口异常时回退内置列表；当前选中平台的元信息驱动项目 ID 输入框的展示与占位。
  const effectivePlatforms = workitemPlatforms.length > 0 ? workitemPlatforms : DEFAULT_WORKITEM_PLATFORMS;
  const selectedPlatform = effectivePlatforms.find(p => p.key === reqPlatform);
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
    const workspaceId = getCurrentWorkspaceId();
    repositoryApi.delete(workspaceId, id)
      .then(() => setGitRepos(gitRepos.filter(repo => repo.id !== id)))
      .catch(() => toast.error('删除仓库失败'));
  };

  const handleSave = () => {
    
  };

  const handleSaveAgentConfigs = async () => {
    const wsId = getCurrentWorkspaceId();
    if (workspace?.agentConfigLocked) {
      toast.error('当前空间智能体配置已被锁定，无法保存');
      return;
    }
    // 过滤掉被单独锁定的 agent，仅保存未锁定的配置
    const lockedKeys = workspace?.lockedAgentKeys ?? [];
    const savableConfigs = agentConfigs.filter(cfg => !lockedKeys.includes(cfg.agentKey));
    if (savableConfigs.length === 0) {
      toast.error('所有智能体均被锁定，无需保存');
      return;
    }
    try {
      await Promise.all(savableConfigs.map(cfg => agentConfigApi.saveWorkspaceConfig(wsId, {
        agentKey: cfg.agentKey,
        enabled: cfg.enabled,
        isDefault: cfg.isDefault,
        model: cfg.model,
        modelSource: cfg.modelSource,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        temperature: cfg.temperature,
        timeout: cfg.timeout,
        advancedConfig: cfg.advancedConfig,
      })));
      
    } catch {
      toast.error('保存智能体配置失败');
    }
  };

  const handleSaveWorkitem = async () => {
    const wsId = getCurrentWorkspaceId();
    try {
      await workspaceApi.setWorkitemProject(wsId, {
        platform: reqPlatform,
        externalKey: settings.reqProjectId,
        name: workspace?.name || settings.reqProjectId,
      });
      
    } catch {
      toast.error('保存需求管理配置失败');
    }
  };

  const handleSaveRepos = async () => {
    const wsId = getCurrentWorkspaceId();
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
      
    } catch {
      toast.error('保存代码仓库配置失败');
    }
  };

  const handleSaveStandards = async () => {
    const workspaceId = getCurrentWorkspaceId();
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
      
    } catch {
      toast.error('保存研发规范失败');
    }
  };

  type DisplayMember = {
    id: string;
    displayId: string;
    name: string;
    email: string;
    platformRole: PlatformRole;
    spaceRole: SpaceRole;
    subRole?: SubRole;
    joinedAt: string;
  };

  const displayUsers: DisplayMember[] = workspaceMembers.map(m => ({
    id: m.userId,
    displayId: m.displayId,
    name: m.name || m.displayId,
    email: m.email,
    platformRole: m.platformRole,
    spaceRole: m.role,
    subRole: m.subRole,
    joinedAt: m.joinedAt,
  }));

  const filteredUsers = displayUsers.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getSubRoleLabel(user.subRole).toLowerCase().includes(searchTerm.toLowerCase()) ||
    getPlatformRoleLabel(user.platformRole).toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.spaceRole.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const {
    currentPage: memberPage,
    totalPages: memberTotalPages,
    onPageChange: onMemberPageChange,
    startIndex: memberStart,
    endIndex: memberEnd,
  } = useClientPagination({ pageSize: MEMBER_PAGE_SIZE, total: filteredUsers.length, resetDeps: [searchTerm] });
  const paginatedMembers = filteredUsers.slice(memberStart, memberEnd);

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
      case SUB_ROLE.PM: return <Badge variant="secondary" className="rounded-lg px-3 py-1.5 font-medium">{label}</Badge>;
      case SUB_ROLE.DESIGNER: return <Badge variant="secondary" className="rounded-lg px-3 py-1.5 font-medium bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">{label}</Badge>;
      case SUB_ROLE.DEVELOPER: return <Badge variant="secondary" className="rounded-lg px-3 py-1.5 font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300">{label}</Badge>;
      case SUB_ROLE.TESTER: return <Badge variant="secondary" className="rounded-lg px-3 py-1.5 font-medium bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300">{label}</Badge>;
      default: return <Badge variant="outline" className="rounded-lg px-3 py-1.5">{label || '成员'}</Badge>;
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
    const workspaceId = getCurrentWorkspaceId();
    // inviteRole 取值：pm | designer | developer | tester
    // 设置空间管理员仅租户管理员可操作（前端隐藏勾选框，此处再兜底一次）
    const role = inviteAsAdmin && isTenantAdmin ? SPACE_ROLE.SPACE_ADMIN : SPACE_ROLE.MEMBER;
    const subRole = inviteRole;
    workspaceApi.addMember(workspaceId, { userId: inviteEmail, role, subRole })
      .then(() => {
        
        setIsInviteOpen(false);
        setInviteEmail('');
        setInviteRole('developer');
        setInviteAsAdmin(false);
        loadMembers();
      })
      .catch(() => toast.error('添加成员失败'));
  };

  const handleSetAdmin = (user: typeof displayUsers[number], asAdmin: boolean) => {
    const workspaceId = getCurrentWorkspaceId();
    const role = asAdmin ? SPACE_ROLE.SPACE_ADMIN : SPACE_ROLE.MEMBER;
    workspaceApi.updateMemberRole(workspaceId, user.id, { role, subRole: user.subRole })
      .then(() => {
        
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
    const workspaceId = getCurrentWorkspaceId();
    setIsProcessing(true);
    workspaceApi.removeMember(workspaceId, memberToDelete.id, assetAssigneeId || undefined)
      .then(() => {
        
        setIsDeleteDialogOpen(false);
        setMemberToDelete(null);
        setAssetAssigneeId('');
        loadMembers();
      })
      .catch(() => toast.error('删除成员失败'))
      .finally(() => setIsProcessing(false));
  };

  // 渲染成员列表操作下拉菜单。
  // 规则：所有人可查看成员；空间管理员可删除普通成员；
  // 租户管理员（含超级管理员）额外可删除空间管理员、设置/取消空间管理员。
  function renderMemberActions(member: DisplayMember) {
    if (user?.id === member.id) {
      return <DropdownMenuItem disabled>当前登录用户</DropdownMenuItem>;
    }

    const canManageMembers = !isReadOnly || isTenantAdmin;
    if (!canManageMembers) {
      return <DropdownMenuItem disabled>无操作权限</DropdownMenuItem>;
    }

    const isTargetSpaceAdmin = member.spaceRole === SPACE_ROLE.SPACE_ADMIN;
    // 空间管理员任免仅租户管理员可操作；空间管理员只能删除普通成员
    const canDeleteMember = !isTargetSpaceAdmin || isTenantAdmin;

    return (
      <>
        {isTenantAdmin && (
          <DropdownMenuItem onClick={() => handleSetAdmin(member, !isTargetSpaceAdmin)}>
            {isTargetSpaceAdmin ? '取消空间管理员' : '设为空间管理员'}
          </DropdownMenuItem>
        )}
        {isTenantAdmin && canDeleteMember && <DropdownMenuSeparator />}
        {canDeleteMember ? (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => handleDeleteMember(member)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            删除成员
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>无操作权限</DropdownMenuItem>
        )}
      </>
    );
  }

  return (
    <div className="flex-1 space-y-6 w-full pb-12">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground">空间配置</h1>
        <p className="text-sm text-muted-foreground mt-1">配置当前空间的基础能力与运行规则</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="aurora-tab-bar level-1 mb-6">
          <TabsTrigger value="basic" className="aurora-tab-item level-1">
            <SlidersHorizontal className="h-4 w-4" />
            基础配置
          </TabsTrigger>
          <TabsTrigger value="agent" className="aurora-tab-item level-1">
            <Bot className="h-4 w-4" />
            智能体配置
          </TabsTrigger>
          <TabsTrigger value="skills" className="aurora-tab-item level-1">
            <Puzzle className="h-4 w-4" />
            技能配置
          </TabsTrigger>
          <TabsTrigger value="prompts" className="aurora-tab-item level-1">
            <MessageSquareQuote className="h-4 w-4" />
            提示词配置
          </TabsTrigger>
          <TabsTrigger value="standards" className="aurora-tab-item level-1">
            <FileText className="h-4 w-4" />
            研发规范
          </TabsTrigger>
          <TabsTrigger value="members" className="aurora-tab-item level-1">
            <Users className="h-4 w-4" />
            成员管理
          </TabsTrigger>
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
                        {effectivePlatforms.map(p => (
                          <SelectItem key={p.key} value={p.key}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedPlatform?.needsProjectId && (
                    <div className="space-y-2">
                      <Label htmlFor="reqProjectId">项目 ID</Label>
                      <Input
                        disabled={isReadOnly}
                        id="reqProjectId"
                        placeholder={selectedPlatform.projectIdPlaceholder || '输入项目ID...'}
                        value={settings.reqProjectId}
                        onChange={e => setSettings({...settings, reqProjectId: e.target.value})}
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
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="w-[130px]">
                        <Input 
                          placeholder="main"
                          value={repo.defaultBranch || ''} 
                          onChange={e => handleRepoBranchChange(repo.id, e.target.value)} 
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="w-[110px]">
                        <Select disabled={isReadOnly} value={repo.type} onValueChange={(val) => handleRepoTypeChange(repo.id, val as WorkspaceRepository['type'])}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dev">开发库</SelectItem>
                            <SelectItem value="case">用例库</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <RepoStandardsDialog workspaceId={workspaceId} repo={repo} isReadOnly={isReadOnly} />
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
              <RecordPaginationBar
                total={gitRepos.length}
                currentPage={gitRepoPagination.currentPage}
                totalPages={gitRepoPagination.totalPages}
                onPageChange={gitRepoPagination.onPageChange}
              />
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
                <TabsList className="aurora-tab-bar level-2 mb-4">
                  <TabsTrigger value="coding" className="aurora-tab-item level-2">
                    <Code2 className="h-4 w-4" />
                    编码规范
                  </TabsTrigger>
                  <TabsTrigger value="design" className="aurora-tab-item level-2">
                    <Palette className="h-4 w-4" />
                    设计规范
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="coding">
                  {!isReadOnly && (
                    <div className="mb-2 flex justify-end">
                      <StandardGenerateDialog
                        kind="coding"
                        workspaceId={workspaceId}
                        onGenerated={content => setSettings(prev => ({ ...prev, codingStandard: content }))}
                      />
                    </div>
                  )}
                  {codingStandardTemplates.loading && (
                    <div className="mb-2 flex items-center justify-end text-xs text-muted-foreground">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      加载模板中...
                    </div>
                  )}
                  <MarkdownEditor
                    value={settings.codingStandard}
                    onChange={value => setSettings({ ...settings, codingStandard: value })}
                    placeholder="请输入编码规范（支持 Markdown）..."
                    readOnly={isReadOnly}
                    templates={codingStandardTemplates.templates}
                  />
                </TabsContent>
                <TabsContent value="design">
                  {!isReadOnly && (
                    <div className="mb-2 flex justify-end">
                      <StandardGenerateDialog
                        kind="design"
                        workspaceId={workspaceId}
                        onGenerated={content => setSettings(prev => ({ ...prev, designStandard: content }))}
                      />
                    </div>
                  )}
                  {designStandardTemplates.loading && (
                    <div className="mb-2 flex items-center justify-end text-xs text-muted-foreground">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      加载模板中...
                    </div>
                  )}
                  <MarkdownEditor
                    value={settings.designStandard}
                    onChange={value => setSettings({ ...settings, designStandard: value })}
                    placeholder="请输入设计规范（支持 Markdown）..."
                    readOnly={isReadOnly}
                    templates={designStandardTemplates.templates}
                  />
                </TabsContent>
              </Tabs>
              {!isReadOnly && (
                <Button onClick={handleSaveStandards} className="mt-6"><Save className="mr-2 h-4 w-4" /> 保存规范</Button>
              )}
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
                    <span title="技能配置功能暂未开放">
                      <Button size="sm" variant="outline" disabled onClick={() => { setCreateSkillPrompt(''); setCreateSkillOpen(true); }}><Wand2 className="w-4 h-4 mr-2" />创建技能</Button>
                    </span>
                    <span title="技能配置功能暂未开放">
                      <Button size="sm" disabled onClick={openSkillMarket}><Plus className="w-4 h-4 mr-2" />去市场添加</Button>
                    </span>
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
                        <span title="技能配置功能暂未开放">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full h-9 w-9 p-0"
                            disabled
                            onClick={() => setIsAddingSkillCategory(true)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </span>
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
                              <span title="技能配置功能暂未开放">
                                <Switch
                                  checked={skill.installed}
                                  disabled
                                  onCheckedChange={checked => {
                                    teamApi.updateSkillInstalled(skill.id, checked, workspaceId)
                                      .then(() => {
                                        setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, installed: checked } : s));
                                                                              })
                                      .catch(() => toast.error('操作失败'));
                                  }}
                                />
                              </span>
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
                    <RecordPaginationBar
                      total={skillTotal}
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
                              {prompt.libraryPromptId && (
                                <Badge variant="secondary" className="text-[10px] h-5">市场</Badge>
                              )}
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
                        {prompt.createdByName && (
                          <span className="flex items-center gap-0.5 truncate"><UserCircle className="h-3 w-3 shrink-0" /> {prompt.createdByName}</span>
                        )}
                        <span className="ml-auto shrink-0">{prompt.enabled ? '已启用' : '未启用'}</span>
                      </div>
                      {canManageWorkspacePrompts && (
                        <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                          {prompt.libraryPromptId ? (
                            // 市场来源提示词不可直接修改，复制为空间自定义副本后可编辑
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              disabled={copyingPromptId === prompt.id}
                              onClick={() => handleCopyWorkspacePrompt(prompt)}
                            >
                              {copyingPromptId === prompt.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Copy className="h-3 w-3 mr-1" />}
                              复制为副本
                            </Button>
                          ) : prompt.shareStatus ? (
                            <Badge variant="outline" className={`text-[10px] h-5 ${PROMPT_SHARE_STATUS_CLASS[prompt.shareStatus] ?? ''}`}>
                              {PROMPT_SHARE_STATUS_LABELS[prompt.shareStatus] ?? prompt.shareStatus}
                            </Badge>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs px-2"
                              disabled={sharingPromptId === prompt.id}
                              onClick={() => handleShareWorkspacePrompt(prompt.id)}
                            >
                              {sharingPromptId === prompt.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Share2 className="h-3 w-3 mr-1" />}
                              分享到市场
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {paginatedPrompts.length === 0 && (
                    <div className="col-span-full text-center py-12 text-sm text-muted-foreground">未找到匹配的提示词</div>
                  )}
                </div>

                <RecordPaginationBar
                  total={filteredWorkspacePrompts.length}
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
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
            {selectedPrompt && (
              <>
                <DialogHeader className="px-6 py-4 border-b">
                  <DialogTitle className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <span className="line-clamp-1">{selectedPrompt.name}</span>
                  </DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                  {canManageWorkspacePrompts ? (
                    // 市场来源提示词（libraryPromptId 非空）控件全部灰化禁用，只能查看，复制为副本后可编辑
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-muted-foreground">名称</label>
                        <Input
                          value={promptEditForm.name}
                          onChange={(e) => setPromptEditForm(prev => ({ ...prev, name: e.target.value }))}
                          className="h-9"
                          disabled={!!selectedPrompt.libraryPromptId}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-muted-foreground">描述</label>
                        <Input
                          value={promptEditForm.description}
                          onChange={(e) => setPromptEditForm(prev => ({ ...prev, description: e.target.value }))}
                          className="h-9"
                          placeholder="简要描述该提示词的用途"
                          disabled={!!selectedPrompt.libraryPromptId}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-muted-foreground">内容</label>
                        <Textarea
                          value={promptEditForm.content}
                          onChange={(e) => setPromptEditForm(prev => ({ ...prev, content: e.target.value }))}
                          className="min-h-[224px] resize-none rounded-lg text-sm"
                          readOnly={!!selectedPrompt.libraryPromptId}
                          disabled={!!selectedPrompt.libraryPromptId}
                        />
                      </div>
                      {selectedPrompt.libraryPromptId && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="h-3 w-3" /> 市场提示词不可修改，点击下方「复制为副本」后可编辑
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {selectedPrompt.description && (
                        <label className="text-sm text-muted-foreground">{selectedPrompt.description}</label>
                      )}
                      <Textarea
                        value={selectedPrompt.content}
                        readOnly
                        className="min-h-[224px] resize-none bg-muted/30 rounded-lg text-sm"
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-muted-foreground">分类</label>
                    {canManageWorkspacePrompts ? (
                      <MultiSelect
                        options={sortedPromptCategories.map(c => ({ value: c.id, label: c.name }))}
                        value={promptDetailCategoryIds}
                        onChange={setPromptDetailCategoryIds}
                        dropdownPosition="top"
                        disabled={!!selectedPrompt.libraryPromptId}
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 min-h-[44px] px-3 py-2 rounded-lg border border-input bg-card/80">
                        {selectedPrompt.categories.length > 0 ? selectedPrompt.categories.map(c => (
                          <Badge key={c.id} variant="outline" className="text-xs h-6">{c.name}</Badge>
                        )) : (
                          <Badge variant="outline" className="text-xs h-6">{UNCATEGORIZED_NAME}</Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-6 py-3.5 border-t bg-muted/30 flex justify-end gap-2 shrink-0">
                  <Button variant="outline" onClick={() => {
                    navigator.clipboard.writeText(selectedPrompt.content);
                  }}>
                    <Copy className="h-4 w-4 mr-2" /> 复制
                  </Button>
                  {selectedPrompt.libraryPromptId && canManageWorkspacePrompts && (
                    <Button
                      variant="outline"
                      disabled={copyingPromptId === selectedPrompt.id}
                      onClick={() => handleCopyWorkspacePrompt(selectedPrompt)}
                    >
                      {copyingPromptId === selectedPrompt.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />}
                      复制为副本
                    </Button>
                  )}
                  <Button variant="outline" onClick={closePromptDetail}>关闭</Button>
                  {canManageWorkspacePrompts && (
                    <Button
                      onClick={handleSavePromptDetail}
                      disabled={!!selectedPrompt.libraryPromptId || isSavingPromptContent || (!hasPromptCategoryChanges && !hasPromptContentChanges)}
                    >
                      {isSavingPromptContent && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      保存
                    </Button>
                  )}
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
                  const agentLocked = workspace?.agentConfigLocked === true || (workspace?.lockedAgentKeys ?? []).includes(cfg.agentKey);
                  return (
                    <AgentConfigCard
                      key={cfg.agentKey}
                      config={cfg}
                      readOnly={isReadOnly}
                      locked={agentLocked}
                      modelGroups={modelGroups}
                      onChange={next => setAgentConfigs(prev => prev.map(c => {
                        if (c.agentKey === next.agentKey) return next;
                        // 单选默认智能体：设置新的默认时清空其他
                        if (next.isDefault) return { ...c, isDefault: false };
                        return c;
                      }))}
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
                <h3 className="text-2xl font-semibold tracking-tight">成员管理</h3>
                <p className="text-muted-foreground mt-1">管理当前工作空间的成员权限与角色。</p>
              </div>
              {(!isReadOnly || isTenantAdmin) && (
                <Button onClick={handleInvite} className="shadow-md">
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
                  {/* 设置空间管理员仅租户管理员（含超级管理员）可操作 */}
                  {isTenantAdmin && (
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
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsInviteOpen(false)}>取消</Button>
                  <Button onClick={submitInvite}>发送邀请</Button>
                </div>
              </DialogContent>
            </Dialog>

            <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                  <h4 className="text-xl font-semibold text-foreground">空间成员 ({displayUsers.length})</h4>
                  <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder="搜索成员姓名或角色..."
                      className="pl-10 bg-muted/30 rounded-lg"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <Table className="min-w-max text-[15px]">
                    <TableHeader className="bg-muted/30">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-4 py-4 font-medium text-muted-foreground">ID</TableHead>
                        <TableHead className="px-4 py-4 font-medium text-muted-foreground w-[240px]">成员信息</TableHead>
                        <TableHead className="px-4 py-4 font-medium text-muted-foreground">成员角色</TableHead>
                        <TableHead className="px-4 py-4 font-medium text-muted-foreground">是否空间管理员</TableHead>
                        <TableHead className="px-4 py-4 font-medium text-muted-foreground">是否租户管理员</TableHead>
                        <TableHead className="px-4 py-4 font-medium text-muted-foreground">加入时间</TableHead>
                        <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedMembers.map((member) => (
                        <TableRow key={member.id} className="transition-colors hover:bg-primary/5">
                          <TableCell className="px-4 py-5 font-mono text-xs text-muted-foreground">{member.displayId}</TableCell>
                          <TableCell className="px-4 py-5">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 shrink-0 rounded-full bg-primary/15 flex items-center justify-center text-primary font-medium">
                                {member.name.charAt(0)}
                              </div>
                              <div>
                                <div className="font-medium text-foreground">{member.name}</div>
                                <div className="text-sm text-muted-foreground mt-0.5">{member.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-5">{getSubRoleBadge(member.subRole)}</TableCell>
                          <TableCell className="px-4 py-5">
                            {member.spaceRole === SPACE_ROLE.SPACE_ADMIN ? (
                              <Badge className="bg-primary rounded-lg px-3 py-1.5 font-medium">是</Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-lg px-3 py-1.5">否</Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-5">
                            {member.platformRole === PLATFORM_ROLE.TENANT_ADMIN || member.platformRole === PLATFORM_ROLE.SUPER_ADMIN ? (
                              <Badge className="bg-primary rounded-lg px-3 py-1.5 font-medium">是</Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-lg px-3 py-1.5">否</Badge>
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-5 text-muted-foreground whitespace-nowrap">
                            {formatDateTime(member.joinedAt)}
                          </TableCell>
                          <TableCell className="px-4 py-5 text-right whitespace-nowrap">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {renderMemberActions(member)}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredUsers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            未找到匹配的成员
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <RecordPaginationBar
                  total={filteredUsers.length}
                  currentPage={memberPage}
                  totalPages={memberTotalPages}
                  onPageChange={onMemberPageChange}
                />
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
        <DialogContent className="sm:max-w-[680px] max-h-[85vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="text-xl font-semibold">去市场添加技能</DialogTitle>
          </DialogHeader>

          {/* 搜索筛选栏 */}
          <div className="px-6 pt-5 flex gap-3 shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索技能..."
                className="w-full pl-9 pr-3 py-2.5 h-10 rounded-lg"
                value={skillSearch}
                onChange={e => setSkillSearch(e.target.value)}
              />
            </div>
            <Select value={skillCategory} onValueChange={setSkillCategory}>
              <SelectTrigger className="min-w-[120px] w-[120px] h-10 rounded-lg px-3 py-2.5">
                <SelectValue placeholder="分类" />
              </SelectTrigger>
              <SelectContent>
                {marketSkillCategoryOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 技能列表区域 */}
          <div className="px-6 py-4 flex-1 overflow-y-auto min-h-0 flex flex-col gap-2">
            {marketSkillsLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!marketSkillsLoading && filteredMarketSkills.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">未找到匹配的技能</div>
            )}
            {!marketSkillsLoading && filteredMarketSkills.map(skill => {
              const isSelected = selectedSkillIds.includes(skill.id);
              // 勾选状态统一由 Checkbox 的 onCheckedChange 驱动（同提示词市场弹窗，避免 label 双触发）。
              const toggleSelected = () =>
                setSelectedSkillIds(prev =>
                  prev.includes(skill.id) ? prev.filter(id => id !== skill.id) : [...prev, skill.id]
                );
              return (
                <label
                  key={skill.id}
                  className={`flex gap-3 p-3.5 rounded-lg border cursor-pointer transition-all hover:border-input hover:shadow-sm ${
                    isSelected ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <Checkbox checked={isSelected} onCheckedChange={toggleSelected} className="mt-1 h-4 w-4 shrink-0 border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-foreground">{skill.name}</span>
                      <Badge variant="secondary" className="text-xs h-5 px-2 py-0.5">{skill.category}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{skill.description}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        {skill.rating}
                      </span>
                      <span className="flex items-center gap-1">
                        <Download className="h-3.5 w-3.5" />
                        {skill.downloads.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* 分页行 */}
          <div className="px-6 pb-3 flex justify-between items-center shrink-0">
            <span className="text-sm text-muted-foreground">共 {filteredMarketSkills.length} 条</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-md border-input bg-background hover:bg-muted" onClick={() => {}} disabled>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="h-8 w-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm">1</span>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 rounded-md border-input bg-background hover:bg-muted" onClick={() => {}} disabled>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 底部按钮栏 */}
          <div className="px-6 py-4 border-t bg-muted/30 flex justify-end gap-3 shrink-0">
            <Button
              variant="outline"
              className="px-5 py-2 h-10 rounded-lg border-input bg-background text-foreground hover:bg-muted hover:border-input/80 transition-all"
              onClick={() => setSkillMarketOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={selectedSkillIds.length === 0}
              className="px-5 py-2 h-10 rounded-lg transition-all"
              onClick={() => {
                Promise.all(selectedSkillIds.map(id => teamApi.updateSkillInstalled(id, true, workspaceId)))
                  .then(() => {
                    loadSkills(skillPage);
                    
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
                }, workspaceId).then(skill => {
                  setSkills(prev => [skill, ...prev]);
                  setIsGeneratingSkill(false);
                  
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
        <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="text-xl font-semibold">添加提示词</DialogTitle>
          </DialogHeader>

          {/* 搜索筛选行 */}
          <div className="px-6 pt-5 flex gap-3 items-center shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索提示词..."
                className="w-full pl-9 pr-3 py-2.5 h-10 rounded-lg"
                value={promptMarketSearch}
                onChange={e => setPromptMarketSearch(e.target.value)}
              />
            </div>
            <Select value={promptMarketCategory} onValueChange={setPromptMarketCategory}>
              <SelectTrigger className="min-w-[130px] w-[130px] h-10 rounded-lg px-3 py-2.5">
                <SelectValue placeholder="分类" />
              </SelectTrigger>
              <SelectContent>
                {marketPromptCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 列表内容区 */}
          <div className="px-6 py-4 flex-1 overflow-y-auto min-h-0">
            <div className="space-y-3">
              {marketPromptsLoading && (
                <div className="text-center py-8 text-sm text-muted-foreground">加载中...</div>
              )}
              {!marketPromptsLoading && filteredPromptsMarket.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">未找到可添加的提示词</div>
              )}
              {!marketPromptsLoading && filteredPromptsMarket.map(prompt => {
                const isSelected = selectedPromptIds.includes(prompt.id);
                // 勾选状态统一由 Checkbox 的 onCheckedChange 驱动：label 点击会原生转发到内部 button，
                // 若同时在 label 上挂 onClick 会导致一次点击触发两次切换（互相抵消）。
                const toggleSelected = () =>
                  setSelectedPromptIds(prev =>
                    prev.includes(prompt.id) ? prev.filter(id => id !== prompt.id) : [...prev, prompt.id]
                  );
                return (
                  <label
                    key={prompt.id}
                    className={`flex gap-3 p-3.5 rounded-lg border cursor-pointer transition-all hover:border-input hover:shadow-sm ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                  >
                    <Checkbox checked={isSelected} onCheckedChange={toggleSelected} className="mt-1 h-4 w-4 shrink-0 border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex gap-2 items-center mb-2">
                        <span className="text-base font-medium text-foreground">{prompt.name}</span>
                        <Badge variant="secondary" className="text-xs h-5 px-2 py-0.5">{prompt.useCase}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{prompt.description}</p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Download className="h-3.5 w-3.5" />
                          {prompt.usageCount.toLocaleString()} 次使用
                        </span>
                        {prompt.createdByName && (
                          <span className="flex items-center gap-1">
                            <UserCircle className="h-3.5 w-3.5" />
                            {prompt.createdByName}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* 统计文案 */}
            {!marketPromptsLoading && (
              <div className="mt-4 text-sm text-muted-foreground">共 {filteredPromptsMarket.length} 条</div>
            )}
          </div>

          {/* 底部操作栏 */}
          <div className="px-6 py-4 border-t bg-muted/30 flex justify-end gap-3 shrink-0">
            <Button
              variant="outline"
              className="px-5 py-2 h-10 rounded-lg border-input bg-background text-foreground hover:bg-muted hover:border-input/80 transition-all"
              onClick={() => setPromptMarketOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={selectedPromptIds.length === 0 || isAddingMarketPrompts}
              className="px-5 py-2 h-10 rounded-lg transition-all"
              onClick={handleAddSelectedPrompts}
            >
              {isAddingMarketPrompts && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              添加 ({selectedPromptIds.length})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};