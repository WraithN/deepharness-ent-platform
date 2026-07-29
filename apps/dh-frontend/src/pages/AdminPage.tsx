import { Copy, Eye, Lock, MoreHorizontal, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { AgentPolicyForm } from '@/components/admin/AgentPolicyForm';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { agentConfigApi } from '@/lib/agent-config-api';
import { getPlatformRoleLabel, PLATFORM_ROLE } from '@/lib/role-constants';
import { tenantApi } from '@/lib/tenant-api';
import { formatDateTime } from '@/lib/utils';
import type { AgentPolicy, AgentType, ModelVendorGroup, Tenant, TenantMember } from '@/types';

// 新成员默认密码（与后端 schema 及 AddTenantMember 保持一致）
const DEFAULT_MEMBER_PASSWORD = '123456';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 空间管理已对接真实 API，不再使用 mock 数据
export const AdminPage: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();

  // ── 租户管理状态 ──
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  // 租户列表客户端分页（遵循 DESIGN.md 5.7 底部分页规范）。
  const tenantPagination = useClientPagination({ total: tenants.length });
  const paginatedTenants = tenants.slice(tenantPagination.startIndex, tenantPagination.endIndex);

  const [newTenantOpen, setNewTenantOpen] = useState(false);
  const [isCopyingTenant, setIsCopyingTenant] = useState(false);
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
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // 新增/复制租户时的初始成员（租户尚未创建，先作为 pending 列表，保存时统一创建）
  type PendingMember = { email: string; name: string; isAdmin: boolean };
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [pendingMemberEmail, setPendingMemberEmail] = useState('');
  const [pendingMemberName, setPendingMemberName] = useState('');
  const [pendingMemberIsAdmin, setPendingMemberIsAdmin] = useState(false);

  const defaultAgentPolicy = (): AgentPolicy => ({
    agentConfigLocked: false,
    lockedAgentKeys: [],
    allowedAgentKeys: [],
    defaultAgentConfigs: {},
  });

  const [newAgentPolicy, setNewAgentPolicy] = useState<AgentPolicy>(defaultAgentPolicy());
  const [editAgentPolicy, setEditAgentPolicy] = useState<AgentPolicy>(defaultAgentPolicy());
  const [modelGroups, setModelGroups] = useState<ModelVendorGroup[]>([]);

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

  /** 复制租户：清空名称与成员，保留智能体策略等其他配置。 */
  const duplicateTenant = (tenant: Tenant) => {
    setNewTenantName('');
    setNewAgentPolicy({
      agentConfigLocked: tenant.agentConfigLocked ?? false,
      lockedAgentKeys: tenant.lockedAgentKeys ?? [],
      allowedAgentKeys: tenant.allowedAgentKeys ?? [],
      defaultAgentConfigs: tenant.defaultAgentConfigs ?? {},
    });
    resetPendingMembers();
    setIsCopyingTenant(true);
    setNewTenantOpen(true);
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
    if (newAgentPolicy.allowedAgentKeys.length === 0) {
      toast.error('请至少指定一个允许使用的智能体');
      return;
    }
    if (!pendingMembers.some(m => m.isAdmin)) {
      toast.error('请至少指定一个租户管理员');
      return;
    }
    try {
      const created = await tenantApi.create({
        name: newTenantName.trim(),
        agentPolicy: newAgentPolicy,
      });

      // 创建初始成员并设置管理员（空间管理员对应租户管理员角色）
      for (const pm of pendingMembers) {
        try {
          const member = await tenantApi.addMember(created.id, { email: pm.email, name: pm.name });
          if (pm.isAdmin) {
            await tenantApi.setAdmin(created.id, member.id, true);
          }
        } catch {
          toast.error(`添加成员 ${pm.email} 失败`);
        }
      }

      setNewTenantOpen(false);
      setNewTenantName('');
      setNewAgentPolicy(defaultAgentPolicy());
      resetPendingMembers();
      setIsCopyingTenant(false);
      await loadTenants();
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
      await loadTenantMembers(editingTenant.id);
    } catch {
      toast.error('更新角色失败');
    }
  };

  const handleAddMember = async () => {
    if (!editingTenant) return;
    const email = newMemberEmail.trim();
    const name = newMemberName.trim();
    if (!email || !name) {
      toast.error('邮箱和姓名不能为空');
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      toast.error('请输入有效的邮箱地址');
      return;
    }
    setIsAddingMember(true);
    try {
      await tenantApi.addMember(editingTenant.id, { email, name });
      setNewMemberEmail('');
      setNewMemberName('');
      await loadTenantMembers(editingTenant.id);
    } catch {
      toast.error('添加成员失败');
    } finally {
      setIsAddingMember(false);
    }
  };

  // 新增/复制租户时的 pending 成员管理
  const handleAddPendingMember = () => {
    const email = pendingMemberEmail.trim();
    const name = pendingMemberName.trim();
    if (!email || !name) {
      toast.error('邮箱和姓名不能为空');
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      toast.error('请输入有效的邮箱地址');
      return;
    }
    if (pendingMembers.some(m => m.email === email)) {
      toast.error('该邮箱已添加');
      return;
    }
    setPendingMembers(prev => [...prev, { email, name, isAdmin: pendingMemberIsAdmin }]);
    setPendingMemberEmail('');
    setPendingMemberName('');
  };

  const handleRemovePendingMember = (email: string) => {
    setPendingMembers(prev => prev.filter(m => m.email !== email));
  };

  const handleTogglePendingAdmin = (email: string) => {
    setPendingMembers(prev => prev.map(m => m.email === email ? { ...m, isAdmin: !m.isAdmin } : m));
  };

  const resetPendingMembers = () => {
    setPendingMembers([]);
    setPendingMemberEmail('');
    setPendingMemberName('');
    setPendingMemberIsAdmin(false);
  };

  const [agentTypes, setAgentTypes] = useState<AgentType[]>([]);
  const [agentTypesLoading, setAgentTypesLoading] = useState(false);

  useEffect(() => {
    if (location.pathname !== '/admin/tenants') return;
    setAgentTypesLoading(true);
    agentConfigApi.listAgentTypes()
      .then(setAgentTypes)
      .catch(() => toast.error('加载智能体类型失败'))
      .finally(() => setAgentTypesLoading(false));
    agentConfigApi.listGlobalModelGroups()
      .then(setModelGroups)
      .catch(() => toast.error('加载全局模型池失败'));
  }, [location.pathname]);

  const toggleAgentType = async (key: string, enabled: boolean) => {
    try {
      const updated = await agentConfigApi.updateAgentType(key, enabled);
      setAgentTypes(prev => prev.map(at => at.key === key ? updated : at));
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
            <Dialog open={newTenantOpen} onOpenChange={(open) => {
              if (!open) {
                setIsCopyingTenant(false);
                resetPendingMembers();
              }
              setNewTenantOpen(open);
            }}>
              <DialogTrigger asChild>
                <Button onClick={() => {
                  setIsCopyingTenant(false);
                  setNewTenantName('');
                  setNewAgentPolicy(defaultAgentPolicy());
                  resetPendingMembers();
                }}><Plus className="h-4 w-4 mr-2"/>新增租户</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{isCopyingTenant ? '复制租户' : '新增租户'}</DialogTitle>
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
                    modelGroups={modelGroups}
                    policy={newAgentPolicy}
                    onChange={setNewAgentPolicy}
                  />

                  {/* 初始租户管理员与成员：保存时随租户一起创建 */}
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Users className="h-4 w-4" /> 租户成员与管理员
                    </div>
                    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="pending-member-email">邮箱</Label>
                          <Input
                            id="pending-member-email"
                            type="email"
                            placeholder="输入成员邮箱"
                            value={pendingMemberEmail}
                            onChange={e => setPendingMemberEmail(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="pending-member-name">姓名</Label>
                          <Input
                            id="pending-member-name"
                            placeholder="输入成员姓名"
                            value={pendingMemberName}
                            onChange={e => setPendingMemberName(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="pending-member-admin"
                          checked={pendingMemberIsAdmin}
                          onCheckedChange={checked => setPendingMemberIsAdmin(checked === true)}
                        />
                        <Label htmlFor="pending-member-admin" className="text-sm font-normal cursor-pointer">
                          设为租户管理员
                        </Label>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <Button
                          size="sm"
                          onClick={handleAddPendingMember}
                          disabled={!pendingMemberEmail.trim() || !pendingMemberName.trim()}
                        >
                          <UserPlus className="h-4 w-4 mr-2" />
                          添加成员
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          新成员默认密码为 {DEFAULT_MEMBER_PASSWORD}，首次登录后建议修改。
                        </p>
                      </div>
                    </div>
                    {pendingMembers.length > 0 && (
                      <div className="border rounded-lg overflow-hidden max-h-[220px] overflow-y-auto">
                        <Table>
                          <TableHeader className="bg-muted/30 sticky top-0">
                            <TableRow>
                              <TableHead>成员信息</TableHead>
                              <TableHead>平台角色</TableHead>
                              <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pendingMembers.map(m => (
                              <TableRow key={m.email}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-xs">
                                      {m.name.charAt(0) || '?'}
                                    </div>
                                    <div>
                                      <div className="font-medium text-sm">{m.name}</div>
                                      <div className="text-xs text-muted-foreground">{m.email}</div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {m.isAdmin ? (
                                    <Badge>租户管理员</Badge>
                                  ) : (
                                    <Badge variant="outline">普通用户</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right whitespace-nowrap">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleTogglePendingAdmin(m.email)}
                                  >
                                    {m.isAdmin ? '取消管理员' : '设为管理员'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => handleRemovePendingMember(m.email)}
                                  >
                                    移除
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
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
                            <DropdownMenuItem onClick={() => viewTenant(t)}>
                              <Eye className="h-4 w-4" /> 查看
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => editTenant(t)}>
                              <Pencil className="h-4 w-4" /> 编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicateTenant(t)}>
                              <Copy className="h-4 w-4" /> 复制
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                              onClick={() => openDeleteTenant(t)}
                            >
                              <Trash2 className="h-4 w-4" /> 删除
                            </DropdownMenuItem>
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
                    modelGroups={modelGroups}
                    policy={editAgentPolicy}
                    onChange={setEditAgentPolicy}
                    disabled={viewMode}
                  />

                  {/* 租户管理员管理区域 — 与租户编辑合并 */}
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Users className="h-4 w-4" /> 租户成员与管理员
                    </div>
                    {!viewMode && (
                      <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="new-member-email">邮箱</Label>
                            <Input
                              id="new-member-email"
                              type="email"
                              placeholder="输入成员邮箱"
                              value={newMemberEmail}
                              onChange={e => setNewMemberEmail(e.target.value)}
                              disabled={isAddingMember}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="new-member-name">姓名</Label>
                            <Input
                              id="new-member-name"
                              placeholder="输入成员姓名"
                              value={newMemberName}
                              onChange={e => setNewMemberName(e.target.value)}
                              disabled={isAddingMember}
                            />
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <Button
                            onClick={handleAddMember}
                            disabled={!newMemberEmail.trim() || !newMemberName.trim() || isAddingMember}
                            size="sm"
                          >
                            <UserPlus className="h-4 w-4 mr-2" />
                            {isAddingMember ? '添加中...' : '添加成员'}
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            新成员默认密码为 {DEFAULT_MEMBER_PASSWORD}，首次登录后建议修改。
                          </p>
                        </div>
                      </div>
                    )}
                    {tenantMembersLoading ? (
                      <div className="py-4 text-center text-sm text-muted-foreground">加载中...</div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                        <Table>
                          <TableHeader className="bg-muted/30 sticky top-0">
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
                      </div>
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
    </div>
  );
};
