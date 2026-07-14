import { Bot, ChevronDown, Lock, LockOpen, MoreHorizontal, Plus, Power, Save, Trash2, Users } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { PromptManagement } from '@/components/admin/PromptManagement';
import { SkillManagement } from '@/components/admin/SkillManagement';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { agentConfigApi } from '@/lib/agent-config-api';
import { getPlatformRoleLabel, PLATFORM_ROLE } from '@/lib/role-constants';
import { tenantApi } from '@/lib/tenant-api';
import { formatDateTime } from '@/lib/utils';
import type { AgentPolicy, AgentType, Tenant, TenantMember, WorkspaceAgentConfig } from '@/types';

// AgentPolicyForm 用于超管在租户新建/编辑时配置智能体策略。
interface AgentPolicyFormProps {
  agentTypes: AgentType[];
  globalModels: string[];
  policy: AgentPolicy;
  onChange: (policy: AgentPolicy) => void;
  disabled?: boolean;
}

const AgentPolicyForm: React.FC<AgentPolicyFormProps> = ({ agentTypes, globalModels, policy, onChange, disabled }) => {
  const updateField = <K extends keyof AgentPolicy>(field: K, value: AgentPolicy[K]) => {
    onChange({ ...policy, [field]: value });
  };

  const toggleAgentKey = (key: string, checked: boolean) => {
    const next = checked
      ? [...policy.allowedAgentKeys, key]
      : policy.allowedAgentKeys.filter(k => k !== key);
    updateField('allowedAgentKeys', next);
    // 取消允许时同步移除单独锁定
    if (!checked && policy.lockedAgentKeys?.includes(key)) {
      updateField('lockedAgentKeys', policy.lockedAgentKeys.filter(k => k !== key));
    }
  };

  // 切换单个 agent 的锁定状态（仅在未整体锁定时生效）
  const toggleAgentLock = (key: string, locked: boolean) => {
    const current = policy.lockedAgentKeys ?? [];
    const next = locked
      ? [...current, key]
      : current.filter(k => k !== key);
    updateField('lockedAgentKeys', next);
  };

  const updateAgentConfig = (key: string, patch: Partial<WorkspaceAgentConfig>) => {
    const current = policy.defaultAgentConfigs?.[key] ?? {
      id: '',
      workspaceId: '',
      agentKey: key,
      name: agentTypes.find(a => a.key === key)?.name ?? key,
      description: '',
      enabled: true,
      model: '',
      modelSource: 'builtin',
      baseUrl: '',
      apiKey: '',
      createdAt: '',
      updatedAt: '',
    };
    onChange({
      ...policy,
      defaultAgentConfigs: {
        ...policy.defaultAgentConfigs,
        [key]: { ...current, ...patch },
      },
    });
  };

  const updateAdvanced = (key: string, field: keyof NonNullable<WorkspaceAgentConfig['advancedConfig']>, value: number | undefined) => {
    const current = policy.defaultAgentConfigs?.[key];
    updateAgentConfig(key, {
      advancedConfig: {
        ...current?.advancedConfig,
        [field]: value,
      },
    });
  };

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
      <h4 className="text-sm font-medium">智能体策略</h4>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm">锁定智能体配置</Label>
          <p className="text-xs text-muted-foreground">开启后空间管理员只能查看，无法修改</p>
        </div>
        <Switch
          checked={policy.agentConfigLocked}
          onCheckedChange={checked => updateField('agentConfigLocked', checked)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm">允许使用的 Coding Agent</Label>
        <p className="text-xs text-muted-foreground">
          勾选允许后可单独锁定该智能体（锁定后空间管理员无法修改其配置）
        </p>
        <div className="space-y-2">
          {agentTypes.map(at => {
            const allowed = policy.allowedAgentKeys.includes(at.key);
            const locked = policy.agentConfigLocked || (policy.lockedAgentKeys ?? []).includes(at.key);
            return (
              <div key={at.key} className="flex items-center gap-3 p-2 rounded-md border border-border/50 bg-background">
                <Checkbox
                  id={`agent-${at.key}`}
                  checked={allowed}
                  onCheckedChange={checked => toggleAgentKey(at.key, checked === true)}
                  disabled={disabled}
                />
                <Label htmlFor={`agent-${at.key}`} className="text-sm font-normal cursor-pointer flex-1">
                  {at.name}
                </Label>
                {allowed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 px-2 text-xs ${locked ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                    disabled={disabled || policy.agentConfigLocked}
                    onClick={() => toggleAgentLock(at.key, !locked)}
                    title={policy.agentConfigLocked ? '整体锁定已开启，所有智能体均被锁定' : (locked ? '点击解锁' : '点击锁定')}
                  >
                    {locked ? <Lock className="h-3.5 w-3.5 mr-1" /> : <LockOpen className="h-3.5 w-3.5 mr-1" />}
                    {locked ? '已锁定' : '未锁定'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {policy.allowedAgentKeys.length > 0 && (
        <div className="space-y-3 pt-2 border-t">
          <Label className="text-sm">默认模型配置</Label>
          {policy.allowedAgentKeys.map(key => {
            const cfg = policy.defaultAgentConfigs?.[key] ?? {
              model: '',
              modelSource: 'builtin',
              baseUrl: '',
              apiKey: '',
            } as WorkspaceAgentConfig;
            const builtinModels = globalModels.length > 0 ? globalModels : ['gpt-4o'];
            return (
              <Collapsible key={key} defaultOpen>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="p-0 h-auto text-xs text-muted-foreground hover:text-foreground">
                    <ChevronDown className="h-3 w-3 mr-1" />
                    {agentTypes.find(a => a.key === key)?.name ?? key}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-xs">启用</Label>
                    </div>
                    <Switch
                      checked={cfg.enabled ?? true}
                      onCheckedChange={checked => updateAgentConfig(key, { enabled: checked })}
                      disabled={disabled}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-xs">使用自定义模型</Label>
                    </div>
                    <Checkbox
                      checked={cfg.modelSource === 'custom'}
                      onCheckedChange={checked =>
                        updateAgentConfig(key, { modelSource: checked ? 'custom' : 'builtin' })
                      }
                      disabled={disabled}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        {cfg.modelSource === 'custom' ? '模型名称' : '选择模型'}
                      </Label>
                      {cfg.modelSource === 'custom' ? (
                        <Input
                          placeholder="例如: custom-model-v1"
                          value={cfg.model}
                          onChange={e => updateAgentConfig(key, { model: e.target.value })}
                          disabled={disabled}
                        />
                      ) : (
                        <Select value={cfg.model} onValueChange={val => updateAgentConfig(key, { model: val })} disabled={disabled}>
                          <SelectTrigger>
                            <SelectValue placeholder="选择内置模型" />
                          </SelectTrigger>
                          <SelectContent>
                            {builtinModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">温度 (Temperature)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        disabled={disabled}
                        value={cfg.temperature ?? ''}
                        onChange={e =>
                          updateAgentConfig(key, { temperature: e.target.value ? parseFloat(e.target.value) : undefined })
                        }
                      />
                    </div>
                  </div>
                  {cfg.modelSource === 'custom' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Base URL</Label>
                        <Input
                          placeholder="https://api.example.com/v1"
                          value={cfg.baseUrl}
                          onChange={e => updateAgentConfig(key, { baseUrl: e.target.value })}
                          disabled={disabled}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">API Key</Label>
                        <Input
                          type="password"
                          placeholder="sk-..."
                          value={cfg.apiKey}
                          onChange={e => updateAgentConfig(key, { apiKey: e.target.value })}
                          disabled={disabled}
                        />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">最大 Token 数</Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="例如: 4096"
                        disabled={disabled}
                        value={cfg.advancedConfig?.maxTokens ?? ''}
                        onChange={e => updateAdvanced(key, 'maxTokens', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">上下文窗口</Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="例如: 128000"
                        disabled={disabled}
                        value={cfg.advancedConfig?.contextWindow ?? ''}
                        onChange={e => updateAdvanced(key, 'contextWindow', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Top K</Label>
                      <Input
                        type="number"
                        min="1"
                        placeholder="例如: 50"
                        disabled={disabled}
                        value={cfg.advancedConfig?.topK ?? ''}
                        onChange={e => updateAdvanced(key, 'topK', e.target.value ? parseInt(e.target.value, 10) : undefined)}
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
};

// 空间管理已对接真实 API，不再使用 mock 数据
export const AdminPage: React.FC = () => {
  const location = useLocation();
  const [configTab, setConfigTab] = useState('agents');
  
  const getTitle = () => {
    switch (location.pathname) {
      case '/admin/tenants': return '租户管理';
      case '/admin/skills': return '技能管理';
      case '/admin/prompts': return '提示词管理';
      case '/admin/config': return '全局配置';
      default: return 'DeepHarness管理后台';
    }
  };

  const isConfig = location.pathname === '/admin/config';

  const { user } = useAuth();

  // ── 租户管理状态 ──
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  // 租户列表客户端分页（遵循 DESIGN.md 5.7 底部分页规范）。
  const tenantPagination = useClientPagination({ total: tenants.length });
  const paginatedTenants = tenants.slice(tenantPagination.startIndex, tenantPagination.endIndex);

  const [newTenantOpen, setNewTenantOpen] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');

  const [editTenantOpen, setEditTenantOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [editTenantName, setEditTenantName] = useState('');

  const [deleteTenantOpen, setDeleteTenantOpen] = useState(false);
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null);

  const [viewMode, setViewMode] = useState(false);

  // 租户成员管理状态（嵌入编辑弹窗）
  const [tenantMembers, setTenantMembers] = useState<TenantMember[]>([]);
  const [tenantMembersLoading, setTenantMembersLoading] = useState(false);

  const defaultAgentPolicy = (): AgentPolicy => ({
    agentConfigLocked: false,
    lockedAgentKeys: [],
    allowedAgentKeys: [],
    defaultAgentConfigs: {},
  });

  const [newAgentPolicy, setNewAgentPolicy] = useState<AgentPolicy>(defaultAgentPolicy());
  const [editAgentPolicy, setEditAgentPolicy] = useState<AgentPolicy>(defaultAgentPolicy());
  const [globalModels, setGlobalModels] = useState<string[]>([]);

  const loadTenants = async () => {
    setTenantsLoading(true);
    try {
      const list = await tenantApi.list();
      setTenants(list);
    } catch {
      toast.error('加载租户列表失败');
    } finally {
      setTenantsLoading(false);
    }
  };

  useEffect(() => {
    if (location.pathname === '/admin/tenants') {
      loadTenants();
    }
  }, [location.pathname]);

  const openEditTenant = async (tenant: Tenant) => {
    setEditingTenant(tenant);
    setEditTenantName(tenant.name);
    setEditAgentPolicy({
      agentConfigLocked: tenant.agentConfigLocked ?? false,
      lockedAgentKeys: tenant.lockedAgentKeys ?? [],
      allowedAgentKeys: tenant.allowedAgentKeys ?? [],
      defaultAgentConfigs: tenant.defaultAgentConfigs ?? {},
    });
    setEditTenantOpen(true);
    await loadTenantMembers(tenant.id);
  };

  const viewTenant = async (tenant: Tenant) => {
    setViewMode(true);
    await openEditTenant(tenant);
  };

  const editTenant = async (tenant: Tenant) => {
    setViewMode(false);
    await openEditTenant(tenant);
  };

  const openDeleteTenant = (tenant: Tenant) => {
    setDeletingTenant(tenant);
    setDeleteTenantOpen(true);
  };

  const closeEditDialog = () => {
    setEditTenantOpen(false);
    setViewMode(false);
  };

  const handleCreateTenant = async () => {
    if (!newTenantName.trim()) {
      toast.error('租户名称不能为空');
      return;
    }
    try {
      const created = await tenantApi.create({
        name: newTenantName.trim(),
        agentPolicy: newAgentPolicy,
      });
      toast.success('新增租户成功');
      setNewTenantOpen(false);
      setNewTenantName('');
      setNewAgentPolicy(defaultAgentPolicy());
      await loadTenants();
      await openEditTenant(created);
    } catch {
      toast.error('新增租户失败');
    }
  };

  const handleUpdateTenant = async () => {
    if (!editingTenant) return;
    if (!editTenantName.trim()) {
      toast.error('租户名称不能为空');
      return;
    }
    try {
      await tenantApi.update(editingTenant.id, {
        name: editTenantName.trim(),
        agentPolicy: editAgentPolicy,
      });
      toast.success('编辑租户成功');
      closeEditDialog();
      setEditingTenant(null);
      await loadTenants();
    } catch {
      toast.error('编辑租户失败');
    }
  };

  const handleDeleteTenant = async () => {
    if (!deletingTenant) return;
    try {
      await tenantApi.delete(deletingTenant.id);
      toast.success('删除租户成功');
      setDeleteTenantOpen(false);
      setDeletingTenant(null);
      await loadTenants();
    } catch {
      toast.error('删除租户失败');
    }
  };

  // ── 租户成员管理（嵌入编辑弹窗） ──

  const loadTenantMembers = async (tenantId: string) => {
    setTenantMembersLoading(true);
    try {
      const list = await tenantApi.members(tenantId);
      setTenantMembers(list);
    } catch {
      toast.error('加载租户成员失败');
    } finally {
      setTenantMembersLoading(false);
    }
  };

  const handleToggleTenantAdmin = async (member: TenantMember) => {
    if (!editingTenant) return;
    const isAdmin = member.platformRole === PLATFORM_ROLE.TENANT_ADMIN;
    try {
      await tenantApi.setAdmin(editingTenant.id, member.id, !isAdmin);
      toast.success('角色已更新');
      await loadTenantMembers(editingTenant.id);
    } catch {
      toast.error('更新角色失败');
    }
  };

  const [agentTypes, setAgentTypes] = useState<AgentType[]>([]);
  const [agentTypesLoading, setAgentTypesLoading] = useState(false);

  useEffect(() => {
    if (location.pathname !== '/admin/config' && location.pathname !== '/admin/tenants') return;
    setAgentTypesLoading(true);
    agentConfigApi.listAgentTypes()
      .then(setAgentTypes)
      .catch(() => toast.error('加载智能体类型失败'))
      .finally(() => setAgentTypesLoading(false));
    agentConfigApi.listGlobalModels()
      .then(setGlobalModels)
      .catch(() => toast.error('加载全局模型池失败'));
  }, [location.pathname]);

  const toggleAgentType = async (key: string, enabled: boolean) => {
    try {
      const updated = await agentConfigApi.updateAgentType(key, enabled);
      setAgentTypes(prev => prev.map(at => at.key === key ? updated : at));
      toast.success(`${updated.name} 已${enabled ? '启用' : '禁用'}`);
    } catch {
      toast.error('更新智能体状态失败');
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {location.pathname === '/admin/tenants' && (
        <>
        <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
              <div>
                <h4 className="text-xl font-semibold text-foreground">租户列表 ({tenants.length})</h4>
                <p className="text-muted-foreground mt-1 text-sm">管理平台租户及其智能体策略</p>
              </div>
            <Dialog open={newTenantOpen} onOpenChange={setNewTenantOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2"/>新增租户</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>新增租户</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>租户名称</Label>
                    <Input
                      placeholder="输入租户名称"
                      value={newTenantName}
                      onChange={e => setNewTenantName(e.target.value)}
                    />
                  </div>
                  <AgentPolicyForm
                    agentTypes={agentTypes}
                    globalModels={globalModels}
                    policy={newAgentPolicy}
                    onChange={setNewAgentPolicy}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNewTenantOpen(false)}>取消</Button>
                  <Button onClick={handleCreateTenant}>保存</Button>
                </div>
              </DialogContent>
            </Dialog>
            </div>
            {tenantsLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/50">
              <Table className="min-w-max text-[15px]">
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">展示ID</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">租户ID</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">租户名称</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">允许的智能体</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground">创建时间</TableHead>
                    <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedTenants.length === 0 && (
                    <TableRow>
                       <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        暂无租户
                      </TableCell>
                    </TableRow>
                  )}
                  {paginatedTenants.map(t => {
                    const isAgentLocked = (key: string) => t.agentConfigLocked || (t.lockedAgentKeys ?? []).includes(key);
                    return (
                    <TableRow key={t.id} className="transition-colors hover:bg-primary/5">
                      <TableCell
                        className="px-4 py-5 font-mono text-xs cursor-pointer hover:underline whitespace-nowrap"
                        onClick={() => viewTenant(t)}
                      >{t.displayId || '-'}</TableCell>
                      <TableCell
                        className="px-4 py-5 font-mono text-xs text-muted-foreground cursor-pointer hover:underline whitespace-nowrap"
                        title={t.id}
                        onClick={() => viewTenant(t)}
                      >{t.id.slice(0, 12)}...</TableCell>
                      <TableCell className="px-4 py-5 font-medium">{t.name}</TableCell>
                      <TableCell className="px-4 py-5">
                        <div className="flex flex-wrap gap-1">
                          {(t.allowedAgentKeys ?? []).map(k => (
                            <Badge key={k} variant="outline" className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-0.5">
                              {isAgentLocked(k) && <Lock className="h-2.5 w-2.5 text-orange-500" />}
                              {k}
                            </Badge>
                          ))}
                          {(!t.allowedAgentKeys || t.allowedAgentKeys.length === 0) && (
                            <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                              {t.agentConfigLocked && <Lock className="h-2.5 w-2.5 text-orange-500" />}
                              全部允许
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-5 text-muted-foreground whitespace-nowrap">{formatDateTime(t.createdAt)}</TableCell>
                      <TableCell className="px-4 py-5 text-right whitespace-nowrap">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => viewTenant(t)}>查看</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => editTenant(t)}>编辑</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => openDeleteTenant(t)}>删除</DropdownMenuItem>
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
              total={tenants.length}
              currentPage={tenantPagination.currentPage}
              totalPages={tenantPagination.totalPages}
              onPageChange={tenantPagination.onPageChange}
            />
          </CardContent>
        </Card>

          <Dialog open={editTenantOpen} onOpenChange={(v) => { if (!v) closeEditDialog(); else setEditTenantOpen(v); }}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {viewMode ? '查看租户' : '编辑租户'}
                  {editingTenant?.displayId && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">{editingTenant.displayId}</span>
                  )}
                </DialogTitle>
              </DialogHeader>
              {editingTenant && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>租户名称</Label>
                    <Input
                      value={editTenantName}
                      onChange={e => setEditTenantName(e.target.value)}
                      disabled={viewMode}
                    />
                  </div>
                  <AgentPolicyForm
                    agentTypes={agentTypes}
                    globalModels={globalModels}
                    policy={editAgentPolicy}
                    onChange={setEditAgentPolicy}
                    disabled={viewMode}
                  />

                  {/* 租户管理员管理区域 — 与租户编辑合并 */}
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Users className="h-4 w-4" /> 租户成员与管理员
                    </div>
                    {tenantMembersLoading ? (
                      <div className="py-4 text-center text-sm text-muted-foreground">加载中...</div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>成员信息</TableHead>
                            <TableHead>平台角色</TableHead>
                            <TableHead className="text-right">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tenantMembers.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center text-muted-foreground py-4">
                                暂无成员
                              </TableCell>
                            </TableRow>
                          )}
                          {tenantMembers.map(m => (
                            <TableRow key={m.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-xs">
                                    {m.name?.charAt(0) || '?'}
                                  </div>
                                  <div>
                                    <div className="font-medium text-sm">{m.name || '未知'}</div>
                                    <div className="text-xs text-muted-foreground">{m.email}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                {m.platformRole === PLATFORM_ROLE.TENANT_ADMIN ? (
                                  <Badge>租户管理员</Badge>
                                ) : (
                                  <Badge variant="outline">普通用户</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {!viewMode && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleToggleTenantAdmin(m)}
                                  >
                                    {m.platformRole === PLATFORM_ROLE.TENANT_ADMIN ? '取消管理员' : '设为管理员'}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeEditDialog}>取消</Button>
                {viewMode ? (
                  <Button onClick={closeEditDialog}>关闭</Button>
                ) : (
                  <Button onClick={handleUpdateTenant}>保存</Button>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={deleteTenantOpen} onOpenChange={setDeleteTenantOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>删除租户</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground py-2">
                确定要删除租户 <span className="font-medium text-foreground">{deletingTenant?.name}</span> 吗？删除后不可恢复，该租户下所有空间和数据将受影响。
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteTenantOpen(false)}>取消</Button>
                <Button variant="destructive" onClick={handleDeleteTenant}>删除</Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {location.pathname === '/admin/prompts' && <PromptManagement />}

      {location.pathname === '/admin/skills' && <SkillManagement />}

      {isConfig && (
        <Tabs value={configTab} onValueChange={setConfigTab} className="w-full mb-6">
          <TabsList className="bg-transparent p-0 gap-1 border-b border-border/50 w-full justify-start rounded-none h-auto pb-px">
            <TabsTrigger value="agents" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2 border-b-2 border-transparent">智能体设置</TabsTrigger>
            <TabsTrigger value="norms" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2 border-b-2 border-transparent">规范设置</TabsTrigger>
            <TabsTrigger value="cicd" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent rounded-none px-4 py-2 border-b-2 border-transparent">CICD设置</TabsTrigger>
          </TabsList>
          
          <TabsContent value="norms" className="pt-4">
            <Card className="soft-shadow border-none">
              <CardContent className="pt-6 space-y-4">
                <Tabs defaultValue="coding">
                  <TabsList className="mb-4">
                    <TabsTrigger value="coding">编码规范</TabsTrigger>
                    <TabsTrigger value="design">设计规范</TabsTrigger>
                  </TabsList>
                  <TabsContent value="coding">
                    <Textarea className="min-h-[300px] font-mono text-sm" defaultValue="# 全局编码规范\n\n1. 所有组件必须使用 TypeScript\n2. 样式使用 Tailwind CSS\n" />
                  </TabsContent>
                  <TabsContent value="design">
                    <Textarea className="min-h-[300px] font-mono text-sm" defaultValue="# 全局设计规范\n\n1. 颜色应遵循 WCAG 2.1 标准\n2. 间距必须为 4px 的倍数\n" />
                  </TabsContent>
                </Tabs>
                <Button onClick={() => toast.success('全局规范保存成功')}><Save className="h-4 w-4 mr-2" /> 保存规范</Button>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="cicd" className="pt-4">
            <Card className="soft-shadow border-none">
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-4 max-w-xl">
                  <div className="space-y-2">
                    <Label>默认 GitLab API URL</Label>
                    <Input defaultValue="https://gitlab.com/api/v4" />
                  </div>
                  <div className="space-y-2">
                    <Label>全局 Runner 标识 (Tags)</Label>
                    <Input defaultValue="docker, linux" />
                  </div>
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="font-medium text-sm">强制代码审查</h4>
                      <p className="text-xs text-muted-foreground mt-1">合并到主分支前强制要求至少一次代码审查通过</p>
                    </div>
                    <Switch id="force-code-review" defaultChecked />
                  </div>
                  <Button onClick={() => toast.success('CICD配置保存成功')}><Save className="h-4 w-4 mr-2" /> 保存配置</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="agents" className="pt-4">
            {/* 列表样式遵循 DESIGN.md 5.7 列表/表格统一格式 */}
            <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
              <CardContent className="p-6">
                <div className="mb-5">
                  <h4 className="text-xl font-semibold text-foreground flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" /> 智能体范围配置
                  </h4>
                  <p className="text-muted-foreground mt-1 text-sm">控制平台内各智能体是否可供租户使用。</p>
                </div>
                {agentTypesLoading ? (
                  <p className="py-8 text-center text-muted-foreground">加载中...</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <Table className="min-w-max text-[15px]">
                      <TableHeader className="bg-muted/30">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="px-4 py-4 font-medium text-muted-foreground">智能体</TableHead>
                          <TableHead className="px-4 py-4 font-medium text-muted-foreground">标识</TableHead>
                          <TableHead className="px-4 py-4 font-medium text-muted-foreground">描述</TableHead>
                          <TableHead className="px-4 py-4 font-medium text-muted-foreground">状态</TableHead>
                          <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agentTypes.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">暂无智能体</TableCell>
                          </TableRow>
                        )}
                        {agentTypes.map(at => (
                          <TableRow key={at.key} className="transition-colors hover:bg-primary/5">
                            <TableCell className="px-4 py-5 font-medium">{at.name}</TableCell>
                            <TableCell className="px-4 py-5">
                              <Badge variant="outline" className="rounded-lg px-3 py-1.5">{at.key}</Badge>
                            </TableCell>
                            <TableCell className="px-4 py-5 max-w-[300px] truncate text-muted-foreground">{at.description}</TableCell>
                            <TableCell className="px-4 py-5">
                              {at.enabled ? (
                                <Badge className="rounded-lg px-3 py-1.5 font-medium bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">已启用</Badge>
                              ) : (
                                <Badge variant="outline" className="rounded-lg px-3 py-1.5">已禁用</Badge>
                              )}
                            </TableCell>
                            <TableCell className="px-4 py-5 text-right">
                              <Switch
                                checked={at.enabled}
                                onCheckedChange={(checked) => toggleAgentType(at.key, checked)}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};
