import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RecordPaginationBar } from '@/components/RecordPaginationBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useClientPagination } from '@/hooks/use-client-pagination';
import { cicdConfigApi, type CICDConfigRequest } from '@/lib/cicd-config-api';
import { formatDateTime } from '@/lib/utils';
import type { CICDConfig } from '@/types';

const DEFAULT_FORM: CICDConfigRequest = {
  name: '',
  triggerBranches: '',
  webhookUrl: '',
  script: '',
};

/** 全局 CICD 配置管理：超管在能力配置中维护多个平台级 CICD 配置，供租户关联。 */
export const CICDConfigManagement: React.FC = () => {
  const [configs, setConfigs] = useState<CICDConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CICDConfig | null>(null);
  const [form, setForm] = useState<CICDConfigRequest>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const pagination = useClientPagination({ total: configs.length });
  const paginatedConfigs = configs.slice(pagination.startIndex, pagination.endIndex);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const list = await cicdConfigApi.list();
      setConfigs(list);
    } catch {
      toast.error('加载 CICD 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEdit = (cfg: CICDConfig) => {
    setEditing(cfg);
    setForm({
      name: cfg.name,
      triggerBranches: cfg.triggerBranches,
      webhookUrl: cfg.webhookUrl,
      script: cfg.script,
      config: cfg.config,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(DEFAULT_FORM);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('配置名称不能为空');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await cicdConfigApi.update(editing.id, form);
        toast.success('CICD 配置已更新');
      } else {
        await cicdConfigApi.create(form);
        toast.success('CICD 配置已创建');
      }
      closeDialog();
      await loadConfigs();
    } catch {
      toast.error(editing ? '更新 CICD 配置失败' : '创建 CICD 配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await cicdConfigApi.delete(id);
      toast.success('CICD 配置已删除');
      await loadConfigs();
    } catch {
      toast.error('删除 CICD 配置失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h4 className="text-xl font-semibold text-foreground">CICD 配置管理</h4>
        <p className="text-muted-foreground mt-1 text-sm">管理平台级 CICD 配置，供租户按需关联</p>
      </div>

      <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle className="text-base">配置列表</CardTitle>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              新增配置
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              加载中...
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <Table className="min-w-max text-[15px]">
                  <TableHeader className="bg-muted/30">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">名称</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">触发分支</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">Webhook</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground">创建时间</TableHead>
                      <TableHead className="px-4 py-4 font-medium text-muted-foreground text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedConfigs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          暂无 CICD 配置
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedConfigs.map(cfg => (
                        <TableRow key={cfg.id} className="transition-colors hover:bg-primary/5">
                          <TableCell className="px-4 py-5 font-medium">{cfg.name}</TableCell>
                          <TableCell className="px-4 py-5 text-muted-foreground whitespace-nowrap">
                            {cfg.triggerBranches || '-'}
                          </TableCell>
                          <TableCell className="px-4 py-5 text-muted-foreground max-w-xs truncate">
                            {cfg.webhookUrl || '-'}
                          </TableCell>
                          <TableCell className="px-4 py-5 text-muted-foreground whitespace-nowrap">
                            {formatDateTime(cfg.createdAt)}
                          </TableCell>
                          <TableCell className="px-4 py-5 text-right whitespace-nowrap">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(cfg)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={deletingId === cfg.id}
                              onClick={() => handleDelete(cfg.id)}
                            >
                              {deletingId === cfg.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <RecordPaginationBar
                total={configs.length}
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                onPageChange={pagination.onPageChange}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑 CICD 配置' : '新增 CICD 配置'}</DialogTitle>
            <DialogDescription>
              创建后可在租户管理中将其关联到指定租户。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>配置名称</Label>
              <Input
                placeholder="例如：默认 GitLab CI"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>触发分支</Label>
              <Input
                placeholder="例如：main, release/*"
                value={form.triggerBranches}
                onChange={e => setForm({ ...form, triggerBranches: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <Input
                placeholder="https://example.com/webhook"
                value={form.webhookUrl}
                onChange={e => setForm({ ...form, webhookUrl: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>CI/CD 脚本</Label>
              <Textarea
                placeholder="例如：.gitlab-ci.yml 内容"
                rows={8}
                value={form.script}
                onChange={e => setForm({ ...form, script: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
