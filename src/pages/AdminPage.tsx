import React, { useState } from 'react';
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
import { Search, Plus, Save, Power, CheckCircle2, XCircle } from 'lucide-react';
import MultiSelect from '@/components/ui/multi-select';
import { toast } from 'sonner';

// 修复：移除未定义的 Checkbox 引用，改用 MultiSelect + Switch
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

  const [spaces, setSpaces] = useState([
    { id: 1, name: '前端空间', admins: 'admin1@company.com, admin2@company.com', agentIds: [1], customAgent: true, customCicd: false },
    { id: 2, name: '后端空间', admins: 'backend_admin@company.com', agentIds: [2], customAgent: true, customCicd: true },
  ]);

  const [agents, setAgents] = useState([
    { id: 1, name: '默认 Claude', type: 'claudecode', model: 'claude-3-5-sonnet', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-...', temperature: 0.7, prompt: '你是一个专业的全栈工程师，擅长 React, TypeScript 和 Node.js。', useCache: true },
    { id: 2, name: '内部 OpenCode', type: 'opencode', model: 'opencode-v2', baseUrl: 'https://api.internal.com', apiKey: 'sk-...', temperature: 0.2, prompt: '', useCache: true },
  ]);

  const [editAgentOpen, setEditAgentOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);

  const [skills, setSkills] = useState([
    { id: 1, name: '多模态理解', type: '模型类', status: 'published' },
    { id: 2, name: '微信支付', type: '工具类', status: 'reviewing' },
    { id: 3, name: '汇率转换', type: '工具类', status: 'disabled' },
  ]);

  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [editSpaceOpen, setEditSpaceOpen] = useState(false);
  const [editingSpace, setEditingSpace] = useState<any>(null);

  const openEditSpace = (space: any) => {
    setEditingSpace(space);
    setEditSpaceOpen(true);
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
                    <Input placeholder="输入空间名称" />
                  </div>
                  <div className="space-y-2">
                    <Label>管理员 (多个用逗号分隔)</Label>
                    <Input placeholder="admin1@test.com, admin2@test.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>使用的智能体</Label>
                    <MultiSelect
                      options={agents.map(a => ({ value: String(a.id), label: a.name }))}
                      defaultSelected={['1']}
                      onChange={(selected) => console.log('Selected agents:', selected)}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Label htmlFor="new-custom-agent" className="cursor-pointer">允许设置自定义智能体</Label>
                    <Switch id="new-custom-agent" defaultChecked />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Label htmlFor="new-custom-cicd" className="cursor-pointer">允许设置自定义CICD</Label>
                    <Switch id="new-custom-cicd" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNewSpaceOpen(false)}>取消</Button>
                  <Button onClick={() => { toast.success('新增空间成功'); setNewSpaceOpen(false); }}>保存</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>空间名称</TableHead>
                  <TableHead>管理员</TableHead>
                  <TableHead>自定义智能体</TableHead>
                  <TableHead>自定义CICD</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spaces.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.admins}</TableCell>
                    <TableCell>{s.customAgent ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                    <TableCell>{s.customCicd ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEditSpace(s)}>编辑</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                    <Input defaultValue={editingSpace.name} />
                  </div>
                  <div className="space-y-2">
                    <Label>管理员 (多个用逗号分隔)</Label>
                    <Input defaultValue={editingSpace.admins} />
                  </div>
                  <div className="space-y-2">
                    <Label>使用的智能体</Label>
                    <MultiSelect
                      options={agents.map(a => ({ value: String(a.id), label: a.name }))}
                      defaultSelected={editingSpace.agentIds?.map(String) ?? []}
                      onChange={(selected) => console.log('Selected agents:', selected)}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Label htmlFor="edit-custom-agent" className="cursor-pointer">允许设置自定义智能体</Label>
                    <Switch id="edit-custom-agent" defaultChecked={editingSpace.customAgent} />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Label htmlFor="edit-custom-cicd" className="cursor-pointer">允许设置自定义CICD</Label>
                    <Switch id="edit-custom-cicd" defaultChecked={editingSpace.customCicd} />
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditSpaceOpen(false)}>取消</Button>
                <Button onClick={() => { toast.success('编辑空间成功'); setEditSpaceOpen(false); }}>保存</Button>
              </div>
            </DialogContent>
          </Dialog>
        </Card>
      )}

      {(location.pathname === '/admin/skills' || location.pathname === '/admin/prompts') && (
        <Card className="soft-shadow border-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
            <div>
              <CardTitle className="text-base">{getTitle()}列表</CardTitle>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input placeholder="搜索名称..." className="pl-8 w-[150px] sm:w-[200px]" />
              </div>
              <Select defaultValue="all">
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder="所有状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有状态</SelectItem>
                  <SelectItem value="published">已上架</SelectItem>
                  <SelectItem value="reviewing">待审核</SelectItem>
                  <SelectItem value="disabled">已禁用</SelectItem>
                </SelectContent>
              </Select>
              <Select defaultValue="all">
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder="所有类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有类型</SelectItem>
                  <SelectItem value="model">模型类</SelectItem>
                  <SelectItem value="tool">工具类</SelectItem>
                </SelectContent>
              </Select>
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
              <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
                <CardTitle className="text-base">智能体配置</CardTitle>
                <Dialog open={editAgentOpen} onOpenChange={setEditAgentOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setEditingAgent(null)}><Plus className="h-4 w-4 mr-2"/>新增智能体</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>{editingAgent ? '编辑智能体' : '新增智能体'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto px-1">
                      <div className="space-y-2">
                        <Label>智能体名称</Label>
                        <Input defaultValue={editingAgent?.name || ''} placeholder="例如: 默认 Claude" />
                      </div>
                      <div className="space-y-2">
                        <Label>智能体类型</Label>
                        <Select defaultValue={editingAgent?.type || 'claudecode'}>
                          <SelectTrigger>
                            <SelectValue placeholder="选择类型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="claudecode">ClaudeCode</SelectItem>
                            <SelectItem value="opencode">OpenCode</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>默认模型</Label>
                        <Input defaultValue={editingAgent?.model || ''} placeholder="例如: claude-3-5-sonnet" />
                      </div>
                      <div className="space-y-2">
                        <Label>Base URL</Label>
                        <Input defaultValue={editingAgent?.baseUrl || ''} placeholder="https://api.anthropic.com" />
                      </div>
                      <div className="space-y-2">
                        <Label>API Key</Label>
                        <Input defaultValue={editingAgent?.apiKey || ''} type="password" placeholder="sk-..." />
                      </div>
                      <div className="space-y-2">
                        <Label>Temperature (0.0 - 2.0)</Label>
                        <Input defaultValue={editingAgent?.temperature ?? 0.7} type="number" step="0.1" min="0" max="2" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setEditAgentOpen(false)}>取消</Button>
                      <Button onClick={() => { toast.success(editingAgent ? '编辑智能体成功' : '新增智能体成功'); setEditAgentOpen(false); }}>保存</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>默认模型</TableHead>
                      <TableHead>Base URL</TableHead>
                      <TableHead>Temperature</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={a.type === 'claudecode' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}>
                            {a.type}
                          </Badge>
                        </TableCell>
                        <TableCell>{a.model}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{a.baseUrl}</TableCell>
                        <TableCell>{a.temperature}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => { setEditingAgent(a); setEditAgentOpen(true); }}>编辑</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};
