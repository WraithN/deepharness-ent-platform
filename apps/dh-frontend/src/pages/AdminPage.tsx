import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, Save, Power, Bot, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { agentConfigApi } from '@/lib/agent-config-api';
import { workspaceApi } from '@/lib/workspace-api';
import { teamApi } from '@/lib/team-api';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime } from '@/lib/utils';
import type { AgentType, Workspace, Prompt, PromptStatus } from '@/types';

// 空间管理已对接真实 API，不再使用 mock 数据
export const AdminPage: React.FC = () => {
  const location = useLocation();
  const [configTab, setConfigTab] = useState('agents');
  
  const getTitle = () => {
    switch (location.pathname) {
      case '/admin/spaces': return '空间管理';
      case '/admin/skills': return '技能管理';
      case '/admin/prompts': return '提示词管理';
      case '/admin/config': return '全局配置';
      default: return 'DeepHarness管理后台';
    }
  };

  const isConfig = location.pathname === '/admin/config';

  const { user } = useAuth();

  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);

  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceDescription, setNewSpaceDescription] = useState('');

  const [editSpaceOpen, setEditSpaceOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<Workspace | null>(null);
  const [editSpaceName, setEditSpaceName] = useState('');
  const [editSpaceDescription, setEditSpaceDescription] = useState('');

  const [deleteSpaceOpen, setDeleteSpaceOpen] = useState(false);
  const [deletingSpace, setDeletingSpace] = useState<Workspace | null>(null);

  const loadSpaces = async () => {
    setSpacesLoading(true);
    try {
      const list = await workspaceApi.list('');
      setSpaces(list);
    } catch {
      toast.error('加载工作空间列表失败');
    } finally {
      setSpacesLoading(false);
    }
  };

  useEffect(() => {
    if (location.pathname === '/admin/spaces') {
      loadSpaces();
    }
  }, [location.pathname]);

  const openEditSpace = (space: Workspace) => {
    setEditingSpace(space);
    setEditSpaceName(space.name);
    setEditSpaceDescription(space.description || '');
    setEditSpaceOpen(true);
  };

  const openDeleteSpace = (space: Workspace) => {
    setDeletingSpace(space);
    setDeleteSpaceOpen(true);
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) {
      toast.error('空间名称不能为空');
      return;
    }
    if (!user) {
      toast.error('未登录');
      return;
    }
    try {
      await workspaceApi.create({
        tenantId: user.tenantId,
        name: newSpaceName.trim(),
        description: newSpaceDescription.trim(),
        ownerUserId: user.id,
      });
      toast.success('新增空间成功');
      setNewSpaceOpen(false);
      setNewSpaceName('');
      setNewSpaceDescription('');
      await loadSpaces();
    } catch {
      toast.error('新增空间失败');
    }
  };

  const handleUpdateSpace = async () => {
    if (!editingSpace) return;
    if (!editSpaceName.trim()) {
      toast.error('空间名称不能为空');
      return;
    }
    try {
      await workspaceApi.update(editingSpace.id, {
        name: editSpaceName.trim(),
        description: editSpaceDescription.trim(),
      });
      toast.success('编辑空间成功');
      setEditSpaceOpen(false);
      setEditingSpace(null);
      await loadSpaces();
    } catch {
      toast.error('编辑空间失败');
    }
  };

  const handleDeleteSpace = async () => {
    if (!deletingSpace) return;
    try {
      await workspaceApi.delete(deletingSpace.id);
      toast.success('删除空间成功');
      setDeleteSpaceOpen(false);
      setDeletingSpace(null);
      await loadSpaces();
    } catch {
      toast.error('删除空间失败');
    }
  };

  const [agentTypes, setAgentTypes] = useState<AgentType[]>([]);
  const [agentTypesLoading, setAgentTypesLoading] = useState(false);

  useEffect(() => {
    if (!isConfig) return;
    setAgentTypesLoading(true);
    agentConfigApi.listAgentTypes()
      .then(setAgentTypes)
      .catch(() => toast.error('加载智能体类型失败'))
      .finally(() => setAgentTypesLoading(false));
  }, [isConfig]);

  const toggleAgentType = async (key: string, enabled: boolean) => {
    try {
      const updated = await agentConfigApi.updateAgentType(key, enabled);
      setAgentTypes(prev => prev.map(at => at.key === key ? updated : at));
      toast.success(`${updated.name} 已${enabled ? '启用' : '禁用'}`);
    } catch {
      toast.error('更新智能体状态失败');
    }
  };

  const [skills, setSkills] = useState([
    { id: 1, name: '多模态理解', type: '模型类', status: 'published' },
    { id: 2, name: '微信支付', type: '工具类', status: 'reviewing' },
    { id: 3, name: '汇率转换', type: '工具类', status: 'disabled' },
  ]);

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptSearchTerm, setPromptSearchTerm] = useState('');
  const [promptStatusFilter, setPromptStatusFilter] = useState<PromptStatus | 'all'>('all');

  const loadPrompts = useCallback(async () => {
    try {
      const list = await teamApi.listPrompts();
      setPrompts(list);
    } catch (err) {
      console.error('Failed to load prompts:', err);
      toast.error('加载提示词失败');
    }
  }, []);

  useEffect(() => {
    if (location.pathname === '/admin/prompts') {
      loadPrompts();
    }
  }, [location.pathname, loadPrompts]);

  const handleReviewPrompt = async (id: string, action: 'approve' | 'reject' | 'unshelf') => {
    try {
      await teamApi.reviewPrompt(id, action);
      toast.success('审核操作已生效');
      loadPrompts();
    } catch {
      toast.error('审核操作失败');
    }
  };
  return (
    <div className="space-y-6 pb-12">
      {location.pathname === '/admin/spaces' && (
        <Card className="soft-shadow border-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
            <div>
              <CardTitle className="text-base">工作空间列表</CardTitle>
            </div>
            <Dialog open={newSpaceOpen} onOpenChange={setNewSpaceOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2"/>新增空间</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>新增工作空间</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>空间名称</Label>
                    <Input
                      placeholder="输入空间名称"
                      value={newSpaceName}
                      onChange={e => setNewSpaceName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>空间描述</Label>
                    <Textarea
                      placeholder="输入空间描述"
                      value={newSpaceDescription}
                      onChange={e => setNewSpaceDescription(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNewSpaceOpen(false)}>取消</Button>
                  <Button onClick={handleCreateSpace}>保存</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            {spacesLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">加载中...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>空间名称</TableHead>
                    <TableHead>描述</TableHead>
                    <TableHead>租户</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spaces.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        暂无工作空间
                      </TableCell>
                    </TableRow>
                  )}
                  {spaces.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{s.description || '-'}</TableCell>
                      <TableCell>{s.tenantId}</TableCell>
                      <TableCell>{formatDateTime(s.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEditSpace(s)}>编辑</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => openDeleteSpace(s)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>

          <Dialog open={editSpaceOpen} onOpenChange={setEditSpaceOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>编辑工作空间</DialogTitle>
              </DialogHeader>
              {editingSpace && (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>空间名称</Label>
                    <Input
                      value={editSpaceName}
                      onChange={e => setEditSpaceName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>空间描述</Label>
                    <Textarea
                      value={editSpaceDescription}
                      onChange={e => setEditSpaceDescription(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditSpaceOpen(false)}>取消</Button>
                <Button onClick={handleUpdateSpace}>保存</Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={deleteSpaceOpen} onOpenChange={setDeleteSpaceOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>删除工作空间</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground py-2">
                确定要删除工作空间 <span className="font-medium text-foreground">{deletingSpace?.name}</span> 吗？删除后不可恢复。
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteSpaceOpen(false)}>取消</Button>
                <Button variant="destructive" onClick={handleDeleteSpace}>删除</Button>
              </div>
            </DialogContent>
          </Dialog>
        </Card>
      )}

      {location.pathname === '/admin/prompts' && (
        <Card className="soft-shadow border-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
            <div>
              <CardTitle className="text-base">提示词列表</CardTitle>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="搜索名称..."
                  className="pl-8 w-[150px] sm:w-[200px]"
                  value={promptSearchTerm}
                  onChange={(e) => setPromptSearchTerm(e.target.value)}
                />
              </div>
              <Select value={promptStatusFilter} onValueChange={(v) => setPromptStatusFilter(v as PromptStatus | 'all')}>
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder="所有状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有状态</SelectItem>
                  <SelectItem value="on_shelf">已上架</SelectItem>
                  <SelectItem value="pending_review">审核中</SelectItem>
                  <SelectItem value="off_shelf">已下架</SelectItem>
                  <SelectItem value="rejected">已拒绝</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>场景</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prompts
                  .filter(p => promptStatusFilter === 'all' || p.status === promptStatusFilter)
                  .filter(p =>
                    p.name.toLowerCase().includes(promptSearchTerm.toLowerCase()) ||
                    (p.description || '').toLowerCase().includes(promptSearchTerm.toLowerCase())
                  )
                  .map(p => {
                    const status = p.status || 'on_shelf';
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.useCase}</TableCell>
                        <TableCell>
                          {status === 'on_shelf' && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">已上架</Badge>}
                          {status === 'pending_review' && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">审核中</Badge>}
                          {status === 'off_shelf' && <Badge className="bg-muted text-muted-foreground hover:bg-muted">已下架</Badge>}
                          {status === 'rejected' && <Badge className="bg-red-100 text-red-700 hover:bg-red-100">已拒绝</Badge>}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          {status === 'pending_review' && (
                            <Button variant="outline" size="sm" onClick={() => handleReviewPrompt(p.id, 'approve')}>通过审核</Button>
                          )}
                          {status === 'on_shelf' && (
                            <Button variant="outline" size="sm" onClick={() => handleReviewPrompt(p.id, 'unshelf')}>下架</Button>
                          )}
                          {(status === 'off_shelf' || status === 'rejected') && (
                            <Button variant="outline" size="sm" onClick={() => handleReviewPrompt(p.id, 'approve')}>重新上架</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {location.pathname === '/admin/skills' && (
        <Card className="soft-shadow border-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
            <div>
              <CardTitle className="text-base">技能列表</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.type}</TableCell>
                    <TableCell>
                      {s.status === 'published' && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">已上架</Badge>}
                      {s.status === 'reviewing' && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">待审核</Badge>}
                      {s.status === 'disabled' && <Badge className="bg-muted text-muted-foreground hover:bg-muted">已禁用</Badge>}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {s.status === 'reviewing' && <Button variant="outline" size="sm" onClick={() => toast.success('已通过审核并上架')}>通过审核</Button>}
                      {s.status === 'published' && <Button variant="outline" size="sm" onClick={() => toast.success('已下架')}>下架</Button>}
                      {s.status !== 'disabled' && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => toast.success('已禁用')}>禁用</Button>}
                      {s.status === 'disabled' && <Button variant="ghost" size="sm" className="text-primary" onClick={() => toast.success('已解禁')}>恢复</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
            <Card className="soft-shadow border-none">
              <CardHeader className="pb-2 border-b">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">智能体范围配置</CardTitle>
                </div>
                <CardDescription>控制平台内各智能体是否可供租户使用。</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {agentTypesLoading ? (
                  <p className="py-8 text-center text-muted-foreground">加载中...</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>智能体</TableHead>
                        <TableHead>标识</TableHead>
                        <TableHead>描述</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agentTypes.map(at => (
                        <TableRow key={at.key}>
                          <TableCell className="font-medium">{at.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{at.key}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[300px] truncate text-muted-foreground">{at.description}</TableCell>
                          <TableCell>
                            {at.enabled ? (
                              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">已启用</Badge>
                            ) : (
                              <Badge variant="secondary">已禁用</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Switch
                              checked={at.enabled}
                              onCheckedChange={(checked) => toggleAgentType(at.key, checked)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};
