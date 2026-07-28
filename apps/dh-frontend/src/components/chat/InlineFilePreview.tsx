import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, FileText, Pencil, LayoutTemplate, Trash2, Send, Loader2, ExternalLink, List, MoreHorizontal, Archive, Download, FolderInput, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { fileApi, type FileContent } from '@/lib/file-api';
import { productSpaceApi } from '@/lib/productspace-api';
import { api } from '@/lib/api';
import type { WorkItemDTO, UserDTO } from '@/lib/api-types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface TocItem {
  level: number;
  text: string;
}

interface InlineFilePreviewProps {
  path: string;
  onClose: () => void;
  /** 做原型：将当前文档作为卡片放入输入框并自动选择 /proto-make */
  onProtoMake?: (path: string, title: string) => void;
  /** 关联的需求 ID；提供后点击采纳会自动关联需求并生成设计版本 */
  workitemId?: string;
  /** 关联的需求标题，用于展示 */
  requirementTitle?: string;
}

/** 从 markdown 内容中提取 h1-h4 标题，用于生成文档大纲。 */
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

/** 在新标签页打开文件查看页面。 */
function openFileViewPage(path: string) {
  const params = new URLSearchParams();
  params.set('path', path);
  window.open(`/file-view?${params.toString()}`, '_blank', 'noopener,noreferrer');
}

/**
 * 从文件名中提取展示标题，去掉 -prd.md / -research.md 等后缀。
 */
function buildDisplayTitle(fileName: string): string {
  return fileName.replace(/-(?:prd|research)\.(?:md|markdown)$/i, '').replace(/\.(?:md|markdown)$/i, '');
}

/**
 * 判断文件是否为 markdown 类型。
 */
function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * 内联文件预览组件。
 *
 * 在 Chat 页的分栏区域内渲染文件内容，不跳转新页面。
 * 标题栏右侧提供：提需求、编辑、做原型、作废 四个操作。
 */
export const InlineFilePreview: React.FC<InlineFilePreviewProps> = ({ path, onClose, onProtoMake, workitemId, requirementTitle }) => {
  const { user: currentUser, membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 编辑模式状态。
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // 提需求弹窗状态。
  const [reqDialogOpen, setReqDialogOpen] = useState(false);
  const [reqAssignee, setReqAssignee] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 作废确认弹窗状态。
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 受理人列表（从用户接口加载）。
  const [assignees, setAssignees] = useState<UserDTO[]>([]);

  // TOC 大纲显示/隐藏。
  const [showToc, setShowToc] = useState(true);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // 采纳到产品空间状态。
  const [importing, setImporting] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [checkingAdoptStatus, setCheckingAdoptStatus] = useState(false);

  const displayContent = useMemo(() => {
    if (!fileContent) return '';
    if (isMarkdownFile(fileContent.path)) {
      return fileContent.content;
    }
    const lang = fileContent.language || '';
    return `\`\`\`${lang}\n${fileContent.content}\n\`\`\``;
  }, [fileContent]);

  const isMarkdown = isMarkdownFile(path);

  // 提取 markdown 标题作为文档大纲。
  const tocItems = useMemo(() => {
    if (!isMarkdown || !displayContent) return [];
    return extractToc(displayContent);
  }, [displayContent, isMarkdown]);

  // 点击 TOC 项时滚动到对应的 heading 元素。
  const handleTocClick = (index: number) => {
    const container = contentScrollRef.current;
    if (!container) return;
    const headings = container.querySelectorAll('h1, h2, h3, h4');
    const target = headings[index];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const loadFile = async (targetPath: string) => {
    setLoading(true);
    setError(null);
    setFileContent(null);
    try {
      const content = await fileApi.content(targetPath);
      setFileContent(content);
    } catch (err) {
      console.error('[InlineFilePreview] load failed:', err);
      setError('加载文件失败或文件不存在');
      toast.error('加载文件失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFile(path);
  }, [path]);

  // 查询采纳状态：刷新页面后仍能正确显示"已采纳"。
  useEffect(() => {
    if (!workspaceId || !isMarkdown) return;
    let cancelled = false;
    setCheckingAdoptStatus(true);
    productSpaceApi
      .importDocStatus(workspaceId, path)
      .then((res) => {
        if (!cancelled) setAdopted(res.adopted);
      })
      .catch(() => {
        if (!cancelled) setAdopted(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingAdoptStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path, isMarkdown]);

  // 加载用户列表用于受理人下拉框，排除管理员角色（super_admin）。
  useEffect(() => {
    api.get<UserDTO[]>('/v1/identity/users')
      .then(users => setAssignees(users.filter(u => u.platformRole !== 'super_admin')))
      .catch(err => console.error('[InlineFilePreview] load users failed:', err));
  }, []);

  const fileName = fileContent?.name || path.split('/').pop() || path;
  const displayTitle = buildDisplayTitle(fileName);

  // 提需求：提交到后端创建 requirement workitem。
  const handleSubmitRequirement = async () => {
    setSubmitting(true);
    try {
      await api.post<WorkItemDTO>('/v1/workitems', {
        tenantId: currentUser?.tenantId || '',
        projectId: 'p1',
        type: 'requirement',
        title: displayTitle,
        description: fileContent?.content || '',
        status: 'backlog',
        priority: 'medium',
        assigneeId: reqAssignee,
        source: 'internal',
      });
      toast.success('需求已提交');
      setReqDialogOpen(false);
      setReqAssignee('');
    } catch (e) {
      console.error('[InlineFilePreview] submit requirement failed:', e);
      toast.error('提交需求失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 编辑：进入编辑模式。
  const handleStartEdit = () => {
    setEditContent(fileContent?.content || '');
    setEditing(true);
  };

  // 编辑：保存。
  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await fileApi.save(path, editContent);
      setFileContent(prev => prev ? { ...prev, content: editContent } : prev);
      setEditing(false);
      toast.success('保存成功');
    } catch (e) {
      console.error('[InlineFilePreview] save failed:', e);
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 存档：保存到飞书知识库。
  const handleArchive = async () => {
    try {
      const res = await fileApi.saveToFeishu(path);
      toast.success(res.message || '已存档到飞书知识库');
    } catch (e) {
      console.error('[InlineFilePreview] archive failed:', e);
      toast.error('存档失败');
    }
  };

  // 作废：删除文件。
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fileApi.delete(path);
      toast.success('文档已作废');
      setDeleteDialogOpen(false);
      onClose();
    } catch (e) {
      console.error('[InlineFilePreview] delete failed:', e);
      toast.error('作废失败');
    } finally {
      setDeleting(false);
    }
  };

  // 采纳到产品空间：将当前文档采纳到产品空间 docs 目录并生成版本。
  const handleAdopt = async () => {
    if (!workspaceId) {
      toast.error('未选择工作空间');
      return;
    }
    if (!isMarkdown) {
      toast.error('仅支持采纳 Markdown 文档');
      return;
    }
    setImporting(true);
    try {
      await productSpaceApi.importDoc(workspaceId, path, workitemId);
      toast.success(workitemId ? '文档已采纳并生成设计版本' : '文档已采纳到产品空间');
      setAdopted(true);
    } catch (e) {
      console.error('[InlineFilePreview] adopt failed:', e);
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg || '采纳失败，请确认是否已加入该工作空间');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isMarkdown && <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h3 className="text-sm font-medium truncate" title={fileName}>
            {displayTitle}
          </h3>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 文档大纲切换（仅 markdown 且有标题时显示） */}
          {isMarkdown && tocItems.length > 0 && !editing && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowToc(v => !v)} title="文档大纲">
              <List className={cn('h-4 w-4', showToc && 'text-primary')} />
            </Button>
          )}
          {/* 编辑 */}
          {editing ? (
            <>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditing(false)} disabled={saving}>
                取消
              </Button>
              <Button variant="ghost" size="sm" className="h-8" onClick={handleSaveEdit} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleStartEdit} title="编辑" disabled={loading || !!error}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {/* 新页面打开 */}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openFileViewPage(path)} title="在新页面打开" disabled={loading || !!error}>
            <ExternalLink className="h-4 w-4" />
          </Button>
          {/* 采纳到产品空间（仅 markdown） */}
          {workspaceId && isMarkdown && (
            <Button
              variant={adopted ? 'outline' : 'default'}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleAdopt}
              disabled={importing || adopted || checkingAdoptStatus || loading || !!error}
              title={requirementTitle ? `关联需求：${requirementTitle}` : '采纳到产品空间'}
            >
              {importing || checkingAdoptStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : adopted ? <Check className="h-3.5 w-3.5" /> : <FolderInput className="h-3.5 w-3.5" />}
              {adopted ? '已采纳' : '采纳到产品空间'}
            </Button>
          )}
          {/* 更多操作：提需求、做原型、作废 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="更多" disabled={loading || !!error}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setReqDialogOpen(true)}>
                <Send className="h-4 w-4 mr-2" />提需求
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onProtoMake?.(path, displayTitle)}>
                <LayoutTemplate className="h-4 w-4 mr-2" />做原型
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleArchive}>
                <Archive className="h-4 w-4 mr-2" />存档
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(fileApi.downloadUrl(path), '_blank')}>
                <Download className="h-4 w-4 mr-2" />下载
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="h-4 w-4 mr-2" />作废
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 关闭预览 */}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="关闭预览">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 内容区域：左侧 TOC 大纲 + 右侧文档内容 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 文档大纲侧边栏 */}
        {showToc && isMarkdown && tocItems.length > 0 && !editing && !loading && !error && (
          <div className="w-48 shrink-0 border-r border-border/40 bg-muted/20 overflow-y-auto py-2 px-1">
            <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide px-2 py-1 mb-1">大纲</div>
            {tocItems.map((item, idx) => (
              <button
                key={idx}
                onClick={() => handleTocClick(idx)}
                className="block w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded px-2 py-1 truncate transition-colors"
                style={{ paddingLeft: `${0.5 + (item.level - 1) * 0.75}rem` }}
                title={item.text}
              >
                {item.text}
              </button>
            ))}
          </div>
        )}

        {/* 文档内容 */}
        <div ref={contentScrollRef} className="flex-1 overflow-auto p-4">
        {loading && (
          <p className="text-sm text-muted-foreground">正在加载文件内容...</p>
        )}
        {!loading && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {!loading && !error && fileContent && (
          editing ? (
            <Textarea
              className="w-full h-full min-h-[500px] font-mono resize-none border-none focus-visible:ring-0"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="在此编辑文档内容..."
            />
          ) : (
            <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
              <MarkdownView content={displayContent} collapsible={false} />
            </div>
          )
        )}
      </div>
      </div>

      {/* 提需求弹窗 */}
      <Dialog open={reqDialogOpen} onOpenChange={setReqDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>提需求</DialogTitle>
          </DialogHeader>
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
              <Label className="text-xs text-muted-foreground">需求文档</Label>
              <Input value={`https://deepharness.internal/docs/${encodeURIComponent(fileName)}`} disabled />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">需求受理人</Label>
              <Select value={reqAssignee} onValueChange={setReqAssignee}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择受理人" />
                </SelectTrigger>
                <SelectContent>
                  {assignees.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmitRequirement} disabled={submitting || !reqAssignee}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 作废确认弹窗 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认作废文档？</AlertDialogTitle>
            <AlertDialogDescription>
              作废后文档将被永久删除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              确认作废
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
