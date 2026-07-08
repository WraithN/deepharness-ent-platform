import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileCode2, Loader2, AlertCircle, ArrowLeft, Download, ChevronDown, List, MoreHorizontal, Pencil, Send, LayoutTemplate, Archive, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { fileApi, type FileContent, type FileVersionInfo } from '@/lib/file-api';
import { api } from '@/lib/api';
import type { WorkItemDTO, UserDTO } from '@/lib/api-types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PROTO_MAKE_PENDING_KEY } from '@/lib/constants';

interface TocItem {
  level: number;
  text: string;
}

function extractToc(md: string): TocItem[] {
  const lines = md.split('\n');
  const items: TocItem[] = [];
  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match) {
      items.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return items;
}

function buildDisplayTitle(fileName: string): string {
  return fileName.replace(/-(?:prd|research)\.(?:md|markdown)$/i, '').replace(/\.(?:md|markdown)$/i, '');
}

/**
 * 文件查看页面（全屏，无侧边栏和顶部导航）。
 * 按钮布局与 InlineFilePreview 保持一致：大纲、编辑、下载、更多（提需求/做原型/存档/作废）。
 */
export const FileView: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const path = searchParams.get('path') || '';
  const { user: currentUser } = useAuth();

  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<FileVersionInfo[]>([]);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);

  // TOC 大纲显示/隐藏。
  const [showToc, setShowToc] = useState(true);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // 编辑模式。
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // 提需求弹窗。
  const [reqDialogOpen, setReqDialogOpen] = useState(false);
  const [reqAssignee, setReqAssignee] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [assignees, setAssignees] = useState<UserDTO[]>([]);

  // 作废确认。
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isMarkdown = /\.(md|markdown)$/i.test(path);
  const fileName = fileContent?.name || path.split('/').pop() || path;
  const displayTitle = buildDisplayTitle(fileName);

  const displayContent = useMemo(() => {
    if (!fileContent) return '';
    if (isMarkdown) return fileContent.content;
    const lang = fileContent.language || '';
    return `\`\`\`${lang}\n${fileContent.content}\n\`\`\``;
  }, [fileContent, isMarkdown]);

  const tocItems = useMemo(() => {
    if (!isMarkdown || !displayContent) return [];
    return extractToc(displayContent);
  }, [displayContent, isMarkdown]);

  const handleTocClick = (index: number) => {
    const container = contentScrollRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h1, h2, h3, h4');
    const target = headings[index];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!path) { setError('缺少文件路径参数'); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError(null); setFileContent(null);
    fileApi.content(path).then(content => {
      if (cancelled) return;
      setFileContent(content);
      if (content.versions?.length) setVersions(content.versions);
    }).catch(err => {
      if (cancelled) return;
      console.error('[FileView] load failed:', err);
      setError('加载文件失败或文件不存在');
      toast.error('加载文件失败');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    api.get<UserDTO[]>('/v1/identity/users')
      .then(users => setAssignees(users.filter(u => u.platformRole !== 'super_admin')))
      .catch(err => console.error('[FileView] load users failed:', err));
  }, []);

  const handleStartEdit = () => { setEditContent(fileContent?.content || ''); setEditing(true); };
  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await fileApi.save(path, editContent);
      setFileContent(prev => prev ? { ...prev, content: editContent } : prev);
      setEditing(false);
      toast.success('保存成功');
    } catch { toast.error('保存失败'); }
    finally { setSaving(false); }
  };

  const handleArchive = async () => {
    try {
      const res = await fileApi.saveToFeishu(path);
      toast.success(res.message || '已存档到飞书知识库');
    } catch { toast.error('存档失败'); }
  };

  // 做原型：通过 localStorage 通知聊天页面触发 /proto-make 流程（跨标签页通信）。
  const handleProtoMake = () => {
    localStorage.setItem(PROTO_MAKE_PENDING_KEY, JSON.stringify({ path, title: displayTitle, ts: Date.now() }));
    toast.success('已通知聊天页面，正在切换...');
    setTimeout(() => window.close(), 800);
  };

  const handleSubmitRequirement = async () => {
    setSubmitting(true);
    try {
      await api.post<WorkItemDTO>('/v1/workitems', {
        tenantId: currentUser?.tenantId || '', projectId: 'p1', type: 'requirement',
        title: displayTitle, description: fileContent?.content || '',
        status: 'backlog', priority: 'medium', assigneeId: reqAssignee, source: 'internal',
      });
      toast.success('需求已提交');
      setReqDialogOpen(false); setReqAssignee('');
    } catch { toast.error('提交需求失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fileApi.delete(path);
      toast.success('文档已作废');
      setDeleteDialogOpen(false);
      window.close();
    } catch { toast.error('作废失败'); }
    finally { setDeleting(false); }
  };

  const handleVersionSwitch = (versionPath: string) => {
    setVersionMenuOpen(false);
    if (versionPath === path) return;
    const newParams = new URLSearchParams(searchParams);
    newParams.set('path', versionPath);
    setSearchParams(newParams);
  };

  const titleDisplay = useMemo(() => {
    if (!fileContent) return path || '文件查看';
    const baseName = fileContent.baseName || '';
    const ext = fileContent.ext || '';
    const version = fileContent.version;
    const fn = baseName && ext ? `${baseName}${ext}` : fileContent.name;
    return version !== undefined && version > 0 ? `${fn} v${version}` : fn;
  }, [fileContent, path]);

  const isLatestVersion = useMemo(() => {
    if (!versions.length || !fileContent) return true;
    return (fileContent.version ?? 0) >= Math.max(...versions.map(v => v.version));
  }, [versions, fileContent]);

  const disabled = loading || !!error;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* 标题栏 */}
      <div className="border-b border-border/50 bg-card px-4 py-2.5 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.close()} title="关闭">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileCode2 className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h1 className="text-sm font-medium truncate">{displayTitle}</h1>
          {versions.length > 1 && (
            <div className="relative">
              <button type="button" onClick={() => setVersionMenuOpen(!versionMenuOpen)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border border-border/50 bg-muted/50 hover:bg-muted transition-colors" title="切换版本">
                <span className="text-muted-foreground">{isLatestVersion ? '最新' : `v${fileContent?.version ?? 0}`}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {versionMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setVersionMenuOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-20 min-w-[160px] rounded-md border border-border/50 bg-popover shadow-md py-1 max-h-60 overflow-y-auto">
                    {versions.slice().reverse().map(v => (
                      <button key={v.path} type="button" onClick={() => handleVersionSwitch(v.path)}
                        className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-2',
                          v.path === path ? 'bg-primary/10 text-primary font-medium' : 'text-foreground')}>
                        <span>v{v.version}</span>
                        {v.path === path && <span className="text-primary">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 大纲 */}
          {isMarkdown && tocItems.length > 0 && !editing && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowToc(v => !v)} title="文档大纲">
              <List className={cn('h-4 w-4', showToc && 'text-primary')} />
            </Button>
          )}
          {/* 编辑 */}
          {editing ? (
            <>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditing(false)} disabled={saving}>取消</Button>
              <Button variant="ghost" size="sm" className="h-8" onClick={handleSaveEdit} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleStartEdit} title="编辑" disabled={disabled}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {/* 更多操作 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="更多" disabled={disabled}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setReqDialogOpen(true)}>
                <Send className="h-4 w-4 mr-2" />提需求
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleProtoMake}>
                <LayoutTemplate className="h-4 w-4 mr-2" />做原型
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleArchive}>
                <Archive className="h-4 w-4 mr-2" />存档
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileContent && window.open(fileApi.downloadUrl(fileContent.path), '_blank')}>
                <Download className="h-4 w-4 mr-2" />下载
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="h-4 w-4 mr-2" />作废
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 内容区域：左侧 TOC + 右侧文档 */}
      <div className="flex-1 flex min-h-0">
        {showToc && isMarkdown && tocItems.length > 0 && !editing && !loading && !error && (
          <div className="w-56 shrink-0 border-r border-border/40 bg-muted/20 overflow-y-auto py-3 px-2">
            <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide px-2 py-1 mb-1">大纲</div>
            {tocItems.map((item, idx) => (
              <button key={idx} onClick={() => handleTocClick(idx)}
                className="block w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded px-2 py-1.5 truncate transition-colors"
                style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.75}rem` }} title={item.text}>
                {item.text}
              </button>
            ))}
          </div>
        )}

        <div ref={contentScrollRef} className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto p-6">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /><span>正在加载文件内容...</span>
              </div>
            )}
            {!loading && error && (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-destructive">
                <AlertCircle className="h-8 w-8" /><p>{error}</p>
              </div>
            )}
            {!loading && fileContent && (
              editing ? (
                <Textarea className="w-full min-h-[60vh] font-mono resize-none border border-border/50 rounded-xl p-4"
                  value={editContent} onChange={e => setEditContent(e.target.value)} placeholder="在此编辑文档内容..." />
              ) : (
                <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
                  <MarkdownView content={displayContent} collapsible={false} />
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* 提需求弹窗 */}
      <Dialog open={reqDialogOpen} onOpenChange={setReqDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>提需求</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">需求提出人</Label>
              <Input value={currentUser?.name ?? '未登录'} disabled />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">需求标题</Label>
              <Input value={displayTitle} disabled />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">需求受理人</Label>
              <Select value={reqAssignee} onValueChange={setReqAssignee}>
                <SelectTrigger><SelectValue placeholder="请选择受理人" /></SelectTrigger>
                <SelectContent>
                  {assignees.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmitRequirement} disabled={submitting || !reqAssignee}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 作废确认弹窗 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认作废文档？</AlertDialogTitle>
            <AlertDialogDescription>作废后文档将被永久删除，此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}确认作废
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
