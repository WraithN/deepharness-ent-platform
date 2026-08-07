import { Eye, Loader2, MoreHorizontal, Pencil, Plus, Terminal, Trash2, Workflow } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { commandApi, type CommandRequest } from '@/lib/command-api';
import {
  type CommandConfig,
  COMMAND_CATEGORY_LABELS,
  COMMAND_CATEGORY_ORDER,
  getCommandCategory,
} from '@/lib/commands';
import { featureFlagApi, COMET_FLOW_FLAG_KEY } from '@/lib/feature-flags-api';

const COMMAND_MANAGEMENT_DESC = '管理系统指令与自定义指令，查看所属分类及对应的提示词模板';
const FILTER_ALL = 'all';
const FILTER_ALL_LABEL = '全部';
const BUILTIN_BADGE_LABEL = '内置';
const CUSTOM_BADGE_LABEL = '自定义';
const BUILTIN_EDIT_NOTICE = '系统内置指令的核心字段不可修改，仅可切换启用状态';
const TEMPLATE_PLACEHOLDER = '运行时会用用户输入填充 {ARGS}、用工作空间目录填充 {WORKSPACE_PATH}';
const COMET_PLACEHOLDER = 'Comet 流程开启时替代提示词模板；留空表示不接入 Comet';

/** 创建/编辑指令的表单状态。 */
interface CommandFormState {
  cmd: string;
  label: string;
  desc: string;
  icon: string;
  allowTask: boolean;
  allowRepos: boolean;
  requireRepos: boolean;
  requireTask: boolean;
  maxRepos: number;
  enabled: boolean;
  template: string;
  cometTemplate: string;
}

const DEFAULT_FORM: CommandFormState = {
  cmd: '',
  label: '',
  desc: '',
  icon: '',
  allowTask: false,
  allowRepos: false,
  requireRepos: false,
  requireTask: false,
  maxRepos: 0,
  enabled: true,
  template: '',
  cometTemplate: '',
};

/** 将 CommandConfig 转为表单状态。 */
function commandToForm(cmd: CommandConfig): CommandFormState {
  return {
    cmd: cmd.cmd,
    label: cmd.label,
    desc: cmd.desc,
    icon: cmd.icon,
    allowTask: cmd.allowTask,
    allowRepos: cmd.allowRepos,
    requireRepos: cmd.requireRepos,
    requireTask: cmd.requireTask,
    maxRepos: cmd.maxRepos,
    enabled: cmd.enabled,
    template: cmd.template ?? '',
    cometTemplate: cmd.cometTemplate ?? '',
  };
}

/** 将表单状态转为 API 请求体。 */
function formToRequest(form: CommandFormState): CommandRequest {
  return {
    cmd: form.cmd,
    label: form.label,
    desc: form.desc,
    icon: form.icon,
    allowTask: form.allowTask,
    allowRepos: form.allowRepos,
    requireRepos: form.requireRepos,
    requireTask: form.requireTask,
    maxRepos: form.maxRepos,
    enabled: form.enabled,
    template: form.template,
    cometTemplate: form.cometTemplate,
  };
}

/** 指令约束徽章：代码库/任务相关约束的可视化展示。 */
const ConstraintBadges: React.FC<{ cmd: CommandConfig }> = ({ cmd }) => {
  const badges: { label: string; variant: 'default' | 'outline' | 'secondary' | 'destructive' }[] = [];
  if (!cmd.enabled) {
    badges.push({ label: '已禁用', variant: 'destructive' });
  }
  if (cmd.requireRepos) {
    badges.push({ label: '需代码库', variant: 'default' });
  } else if (cmd.allowRepos) {
    badges.push({ label: '支持代码库', variant: 'outline' });
  }
  if (cmd.requireTask) {
    badges.push({ label: '需任务卡', variant: 'default' });
  } else if (cmd.allowTask) {
    badges.push({ label: '支持任务', variant: 'outline' });
  }
  if (cmd.maxRepos > 0) {
    badges.push({ label: `最多 ${cmd.maxRepos} 个`, variant: 'outline' });
  }
  if (badges.length === 0) {
    return <span className="text-xs text-muted-foreground">无</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map(b => (
        <Badge key={b.label} variant={b.variant} className="rounded-md px-2 py-0.5 text-xs font-normal">
          {b.label}
        </Badge>
      ))}
    </div>
  );
};

/** 布尔约束开关行（表单内复用）。 */
const FormSwitchRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <div className="flex items-center justify-between">
    <Label className="text-sm font-normal">{label}</Label>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

export const CommandManagement: React.FC = () => {
  const [commands, setCommands] = useState<CommandConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewCmd, setPreviewCmd] = useState<CommandConfig | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(FILTER_ALL);
  const [cometFlowEnabled, setCometFlowEnabled] = useState(false);
  const [cometFlowLoading, setCometFlowLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CommandConfig | null>(null);
  const [form, setForm] = useState<CommandFormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [togglingCmd, setTogglingCmd] = useState<string | null>(null);
  const [deletingCmd, setDeletingCmd] = useState<string | null>(null);

  // ── 数据加载 ──

  const loadCommands = async () => {
    setLoading(true);
    try {
      const list = await commandApi.list();
      setCommands(list ?? []);
    } catch (err) {
      console.error('[CommandManagement] load commands failed:', err);
      toast.error('加载指令失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCommands();
  }, []);

  useEffect(() => {
    featureFlagApi.list()
      .then(flags => {
        const comet = flags.find(f => f.flagKey === COMET_FLOW_FLAG_KEY);
        setCometFlowEnabled(comet?.enabled ?? false);
      })
      .catch(err => {
        console.error('[CommandManagement] load feature flags failed:', err);
      })
      .finally(() => setCometFlowLoading(false));
  }, []);

  // ── Comet 流程开关 ──

  const toggleCometFlow = (enabled: boolean) => {
    setCometFlowLoading(true);
    featureFlagApi.update(COMET_FLOW_FLAG_KEY, enabled)
      .then(() => {
        setCometFlowEnabled(enabled);
        toast.success(enabled ? '已开启 Comet 流程' : '已关闭 Comet 流程');
      })
      .catch(err => {
        console.error('[CommandManagement] toggle comet flow failed:', err);
        toast.error('切换 Comet 流程失败');
      })
      .finally(() => setCometFlowLoading(false));
  };

  // ── 指令 CRUD ──

  const openCreate = () => {
    setEditing(null);
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEdit = (cmd: CommandConfig) => {
    setEditing(cmd);
    setForm(commandToForm(cmd));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(DEFAULT_FORM);
  };

  const validateForm = (): boolean => {
    if (!editing && !form.cmd.trim()) {
      toast.error('指令名称不能为空');
      return false;
    }
    if (!form.label.trim()) {
      toast.error('指令标签不能为空');
      return false;
    }
    if (!form.template.trim()) {
      toast.error('提示词模板不能为空');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      if (editing) {
        await commandApi.update(editing.cmd, formToRequest(form));
        toast.success('指令已更新');
      } else {
        await commandApi.create(formToRequest(form));
        toast.success('指令已创建');
      }
      closeDialog();
      await loadCommands();
    } catch (err) {
      console.error('[CommandManagement] save failed:', err);
      toast.error(editing ? '更新指令失败' : '创建指令失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (cmd: CommandConfig, enabled: boolean) => {
    setTogglingCmd(cmd.cmd);
    try {
      await commandApi.update(cmd.cmd, { ...formToRequest(commandToForm(cmd)), enabled });
      setCommands(prev => prev.map(c => (c.cmd === cmd.cmd ? { ...c, enabled } : c)));
      toast.success(enabled ? '已启用' : '已禁用');
    } catch (err) {
      console.error('[CommandManagement] toggle failed:', err);
      toast.error('切换状态失败');
    } finally {
      setTogglingCmd(null);
    }
  };

  const handleDelete = async (cmd: string) => {
    setDeletingCmd(cmd);
    try {
      await commandApi.delete(cmd);
      toast.success('指令已删除');
      await loadCommands();
    } catch (err) {
      console.error('[CommandManagement] delete failed:', err);
      toast.error('删除指令失败');
    } finally {
      setDeletingCmd(null);
    }
  };

  // ── 筛选与分页 ──

  const filterOptions = useMemo(() => {
    const usedKeys = new Set(commands.map(c => getCommandCategory(c.cmd)));
    const options: { key: string; label: string }[] = [{ key: FILTER_ALL, label: FILTER_ALL_LABEL }];
    for (const cat of COMMAND_CATEGORY_ORDER) {
      if (usedKeys.has(cat)) {
        options.push({ key: cat, label: COMMAND_CATEGORY_LABELS[cat] });
      }
    }
    return options;
  }, [commands]);

  const filteredCommands = useMemo(() => {
    if (activeCategory === FILTER_ALL) return commands;
    return commands.filter(c => getCommandCategory(c.cmd) === activeCategory);
  }, [commands, activeCategory]);

  const pagination = useClientPagination({ total: filteredCommands.length, resetDeps: [activeCategory] });
  const paginatedCommands = filteredCommands.slice(pagination.startIndex, pagination.endIndex);
  const isBuiltinEditing = editing?.isBuiltin ?? false;
  const updateForm = (patch: Partial<CommandFormState>) => setForm(prev => ({ ...prev, ...patch }));

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h4 className="text-xl font-semibold text-foreground">指令管理</h4>
        <p className="text-muted-foreground mt-1 text-sm">{COMMAND_MANAGEMENT_DESC}</p>
      </div>

      {/* Comet 流程开关：控制代码类指令底层是否走 Comet Classic 工作流 */}
      <div className="flex items-center justify-between rounded-xl border border-border/50 bg-card p-4">
        <div className="flex items-center gap-3">
          <Workflow className="h-5 w-5 text-primary" />
          <div>
            <div className="text-sm font-medium">Comet 流程</div>
            <div className="text-xs text-muted-foreground">开启后，代码类指令底层走 Comet Classic 工作流；关闭则使用原有指令流程</div>
          </div>
        </div>
        <Switch checked={cometFlowEnabled} disabled={cometFlowLoading} onCheckedChange={toggleCometFlow} />
      </div>

      <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              指令列表
              <span className="text-sm font-normal text-muted-foreground">({filteredCommands.length})</span>
            </CardTitle>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              新增指令
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* 分类筛选 */}
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <span className="text-sm text-muted-foreground">分类：</span>
            {filterOptions.map(opt => (
              <Button
                key={opt.key}
                variant={activeCategory === opt.key ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => setActiveCategory(opt.key)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              加载指令...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <Table className="min-w-max text-[15px]">
                  <TableHeader className="bg-muted/30">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">指令</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">分类</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">描述</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">约束</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">启用</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedCommands.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          暂无指令
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedCommands.map(cmd => {
                        const catKey = getCommandCategory(cmd.cmd);
                        return (
                          <TableRow key={cmd.cmd} className="transition-colors hover:bg-primary/5">
                            <TableCell
                              className="px-4 py-5 whitespace-nowrap cursor-pointer hover:underline"
                              onClick={() => setPreviewCmd(cmd)}
                            >
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-primary font-medium">{cmd.cmd}</span>
                                  <Badge variant={cmd.isBuiltin ? 'secondary' : 'outline'} className="rounded px-1.5 py-0 text-[10px]">
                                    {cmd.isBuiltin ? BUILTIN_BADGE_LABEL : CUSTOM_BADGE_LABEL}
                                  </Badge>
                                </div>
                                <span className="text-xs text-muted-foreground">{cmd.label}</span>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-5 whitespace-nowrap">
                              <Badge variant="outline" className="rounded-md px-3 py-1 text-xs">
                                {COMMAND_CATEGORY_LABELS[catKey]}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 py-5 max-w-xs">
                              <span className="text-muted-foreground">{cmd.desc || '-'}</span>
                            </TableCell>
                            <TableCell className="px-4 py-5">
                              <ConstraintBadges cmd={cmd} />
                            </TableCell>
                            <TableCell className="px-4 py-5">
                              <Switch
                                checked={cmd.enabled}
                                disabled={togglingCmd === cmd.cmd}
                                onCheckedChange={(v) => handleToggleEnabled(cmd, v)}
                              />
                            </TableCell>
                            <TableCell className="px-4 py-5 text-right whitespace-nowrap">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setPreviewCmd(cmd)}>
                                    <Eye className="h-4 w-4" /> 查看
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openEdit(cmd)}>
                                    <Pencil className="h-4 w-4" /> 编辑
                                  </DropdownMenuItem>
                                  {!cmd.isBuiltin && (
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      disabled={deletingCmd === cmd.cmd}
                                      onClick={() => handleDelete(cmd.cmd)}
                                    >
                                      <Trash2 className="h-4 w-4" /> 删除
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              <RecordPaginationBar
                total={filteredCommands.length}
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                onPageChange={pagination.onPageChange}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* 提示词模板预览弹窗 */}
      <Dialog open={!!previewCmd} onOpenChange={(open) => !open && setPreviewCmd(null)}>
        <DialogContent className="max-w-3xl w-full p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh]">
          {previewCmd && (
            <>
              <div className="p-6 border-b border-border/50 shrink-0 bg-muted/10">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 pr-10">
                    <span className="font-mono text-primary">{previewCmd.cmd}</span>
                    <span className="text-sm font-normal text-muted-foreground">{previewCmd.label}</span>
                  </DialogTitle>
                  <DialogDescription className="sr-only">指令提示词模板</DialogDescription>
                </DialogHeader>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <p className="text-xs text-muted-foreground mb-3">
                  运行时会用用户输入填充 <code className="font-mono">{'{ARGS}'}</code>、用工作空间目录填充 <code className="font-mono">{'{WORKSPACE_PATH}'}</code>，并在前面拼接通用规则。
                </p>
                <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono bg-muted/40 rounded-lg p-4 border border-border/50">
                  {previewCmd.template || '（未配置提示词模板）'}
                </pre>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 创建/编辑指令弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑指令' : '新增指令'}</DialogTitle>
            <DialogDescription>
              {isBuiltinEditing ? BUILTIN_EDIT_NOTICE : '自定义指令可配置全部字段，创建后可在列表中编辑或删除'}
            </DialogDescription>
          </DialogHeader>
          {isBuiltinEditing ? (
            <div className="py-4">
              <FormSwitchRow label="启用" checked={form.enabled} onChange={(v) => updateForm({ enabled: v })} />
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {!editing && (
                <div className="space-y-2">
                  <Label>指令名称</Label>
                  <Input placeholder="例如：/my-command" value={form.cmd} onChange={e => updateForm({ cmd: e.target.value })} />
                </div>
              )}
              <div className="space-y-2">
                <Label>标签</Label>
                <Input placeholder="例如：我的指令" value={form.label} onChange={e => updateForm({ label: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>描述</Label>
                <Input placeholder="指令用途说明" value={form.desc} onChange={e => updateForm({ desc: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>图标名称</Label>
                <Input placeholder="lucide-react 图标名，如 terminal" value={form.icon} onChange={e => updateForm({ icon: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>提示词模板</Label>
                <Textarea placeholder={TEMPLATE_PLACEHOLDER} rows={6} value={form.template} onChange={e => updateForm({ template: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Comet 模板（可选）</Label>
                <Textarea placeholder={COMET_PLACEHOLDER} rows={4} value={form.cometTemplate} onChange={e => updateForm({ cometTemplate: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <FormSwitchRow label="支持任务卡" checked={form.allowTask} onChange={(v) => updateForm({ allowTask: v })} />
                <FormSwitchRow label="支持代码库" checked={form.allowRepos} onChange={(v) => updateForm({ allowRepos: v })} />
                <FormSwitchRow label="必须任务卡" checked={form.requireTask} onChange={(v) => updateForm({ requireTask: v })} />
                <FormSwitchRow label="必须代码库" checked={form.requireRepos} onChange={(v) => updateForm({ requireRepos: v })} />
              </div>
              <div className="space-y-2">
                <Label>最大代码库数（0 = 不限）</Label>
                <Input type="number" min={0} value={form.maxRepos} onChange={e => updateForm({ maxRepos: Number(e.target.value) || 0 })} />
              </div>
              <FormSwitchRow label="启用" checked={form.enabled} onChange={(v) => updateForm({ enabled: v })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
