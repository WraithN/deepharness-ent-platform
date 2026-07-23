import { Download, Eye, Loader2, Pencil, Plus, Terminal, Trash2, Upload } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { prototypeTemplateApi, STATUS_LABELS } from '@/lib/prototype-template-api';
import type { PrototypeTemplate, PrototypeTemplateStatus } from '@/lib/prototype-template-api';

/** 仅接受 zip 源码包（不应包含 node_modules）。 */
const ACCEPTED_FILE_EXT = '.zip';

/** 状态 -> Badge 变体。 */
const STATUS_BADGE_VARIANT: Record<PrototypeTemplateStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ready: 'default',
  installing: 'secondary',
  pending: 'outline',
  error: 'destructive',
};

/** 将错误对象转为可展示文本。 */
const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
};

/** 将 tags 字符串拆为标签数组。 */
const splitTags = (tags: string): string[] =>
  tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);

/** 格式化时间为本地短格式。 */
const formatTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const PrototypeTemplateManagement: React.FC = () => {
  const [templates, setTemplates] = useState<PrototypeTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<number | null>(null);

  // 上传弹窗
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', tags: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 编辑弹窗
  const [editTarget, setEditTarget] = useState<PrototypeTemplate | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', tags: '' });
  const [editSaving, setEditSaving] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<PrototypeTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 安装日志查看
  const [logTarget, setLogTarget] = useState<PrototypeTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await prototypeTemplateApi.list();
      setTemplates(list);
    } catch (err) {
      toast.error(getErrorMessage(err, '加载模版列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetUploadForm = () => {
    setForm({ name: '', description: '', tags: '' });
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!form.name.trim()) {
      toast.error('请填写模版名称');
      return;
    }
    if (!file) {
      toast.error('请选择 zip 源码包');
      return;
    }
    const fd = new FormData();
    fd.append('name', form.name.trim());
    fd.append('description', form.description.trim());
    fd.append('tags', form.tags.trim());
    fd.append('file', file);
    setUploading(true);
    try {
      await prototypeTemplateApi.upload(fd);
      toast.success('模版已上传，请点击「安装依赖」预装 node_modules');
      setUploadOpen(false);
      resetUploadForm();
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, '上传失败'));
    } finally {
      setUploading(false);
    }
  };

  const openEdit = (t: PrototypeTemplate) => {
    setEditTarget(t);
    setEditForm({ name: t.name, description: t.description, tags: t.tags });
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    if (!editForm.name.trim()) {
      toast.error('请填写模版名称');
      return;
    }
    setEditSaving(true);
    try {
      await prototypeTemplateApi.update(editTarget.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        tags: editForm.tags.trim(),
      });
      toast.success('已保存');
      setEditTarget(null);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, '保存失败'));
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await prototypeTemplateApi.delete(deleteTarget.id);
      toast.success('模版已删除');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(getErrorMessage(err, '删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  const handleInstall = async (t: PrototypeTemplate) => {
    setInstallingId(t.id);
    try {
      const updated = await prototypeTemplateApi.install(t.id);
      setTemplates((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      if (updated.status === 'ready') {
        toast.success(`「${updated.name}」依赖安装完成`);
      } else {
        toast.error(`「${updated.name}」依赖安装失败，请查看日志`);
        setLogTarget(updated);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, '安装失败'));
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h4 className="text-xl font-semibold text-foreground">原型模版管理</h4>
          <p className="text-muted-foreground mt-1 text-sm">
            上传工程原型模版（zip 源码包）并预装依赖；/proto-make 会按场景描述自动选用匹配模版，无匹配时回退单页 HTML。
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          上传模版
        </Button>
      </div>

      <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card">
        <CardHeader className="pb-3 border-b border-border/50">
          <CardTitle className="text-base">模版列表 ({templates.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : templates.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              暂无模版，点击右上角上传
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">名称</TableHead>
                  <TableHead>场景描述</TableHead>
                  <TableHead className="w-[160px]">标签</TableHead>
                  <TableHead className="w-[90px]">状态</TableHead>
                  <TableHead className="w-[90px]">依赖</TableHead>
                  <TableHead className="w-[140px]">创建时间</TableHead>
                  <TableHead className="w-[200px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[320px]">
                      <span className="line-clamp-2">{t.description || '—'}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {splitTags(t.tags).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0 h-4">{tag}</Badge>
                        ))}
                        {splitTags(t.tags).length === 0 && <span className="text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE_VARIANT[t.status]}>{STATUS_LABELS[t.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {t.hasNodeModules ? '已装' : '未装'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{formatTime(t.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={installingId === t.id}
                          onClick={() => handleInstall(t)}
                          title="安装/更新依赖"
                        >
                          {installingId === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <Download className="h-3.5 w-3.5 mr-1" />
                          )}
                          安装
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)} title="编辑">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {t.installLog ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLogTarget(t)} title="查看日志">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(t)}
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 上传弹窗 */}
      <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) resetUploadForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>上传原型模版</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>模版名称</Label>
              <Input
                placeholder="例如：中后台管理模版"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>场景描述（供 /proto-make 匹配选用）</Label>
              <Textarea
                placeholder="描述该模版适用的场景，例如：适用于含表格、表单、侧边栏的中后台管理系统"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>标签（逗号分隔）</Label>
              <Input
                placeholder="例如：中后台, React, AntD"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>zip 源码包（不含 node_modules）</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_EXT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
              />
              {file && <p className="text-xs text-muted-foreground">已选择：{file.name}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadOpen(false); resetUploadForm(); }} disabled={uploading}>取消</Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑弹窗 */}
      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑模版</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>模版名称</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>场景描述</Label>
              <Textarea rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>标签（逗号分隔）</Label>
              <Input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editSaving}>取消</Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 安装日志弹窗 */}
      <Dialog open={Boolean(logTarget)} onOpenChange={(open) => !open && setLogTarget(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              安装日志{logTarget ? ` - ${logTarget.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <pre className={cn('max-h-[60vh] overflow-auto rounded-lg bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-all')}>
            {logTarget?.installLog || '（无日志）'}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogTarget(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除模版「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将同时删除模版记录与磁盘上的源码目录，操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
