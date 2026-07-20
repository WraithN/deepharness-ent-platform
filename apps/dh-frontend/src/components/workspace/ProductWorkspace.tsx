import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { FileText, LayoutGrid, Eye, History, Plus, Search, Trash2, Save, Loader2, Send, Clock, ChevronLeft, ChevronRight, ChevronDown, Folder, FolderPlus, Pin, MoreVertical, FolderInput, Pencil, Share2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { KanbanWorkspace } from './KanbanWorkspace';
import { PrototypeWorkspace } from './PrototypeWorkspace';
import { VersionHistoryMode } from './VersionHistoryMode';
import { STATUS_LABEL, STATUS_VARIANT } from './doc-status';
import { productDocApi, type ProductDoc, type ProductDocFolder, type ProductDocVersion, type ShareComment } from '@/lib/productdoc-api';
import { ShareCommentsPanel } from './ShareCommentsPanel';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

const DEFAULT_DOC_CONTENT = `# 新文档

请在此处编写产品文档内容。

## 概述

## 目标

## 详细说明
`;


type ProductTab = 'doc' | 'kanban' | 'prototype' | 'history';

/** 目录最多支持的层级数（与后端 MaxFolderDepth 保持一致） */
const MAX_FOLDER_DEPTH = 6;

/** 目录行的事件回调集合 */
interface FolderRowHandlers {
  onCreateDoc: (folderId: string) => void;
  onCreateSub: (parentId: string) => void;
  onRename: (folder: ProductDocFolder) => void;
  onTogglePin: (folder: ProductDocFolder) => void;
  onDelete: (folder: ProductDocFolder) => void;
  onFolderDragOver: (e: React.DragEvent, folderId: string) => void;
  onFolderDragLeave: (folderId: string) => void;
  onDocDrop: (e: React.DragEvent, folder: ProductDocFolder) => void;
}

interface FolderRowProps extends FolderRowHandlers {
  folder: ProductDocFolder;
  level: number;
  isDropTarget: boolean;
  /** 是否有子目录或文档（决定是否展示展开/收起 chevron） */
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (folderId: string) => void;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

/** 目录行：右侧 hover 显示快捷图标按钮（新建文档/子目录、重命名）与更多菜单（置顶、删除）。
 *  重命名为行内编辑：回车保存，Esc 或失焦取消。 */
const FolderRow: React.FC<FolderRowProps> = ({
  folder, level, isDropTarget, hasChildren, isCollapsed, onToggleCollapse,
  isRenaming, renameValue,
  onRenameValueChange, onRenameSubmit, onRenameCancel,
  onCreateDoc, onCreateSub, onRename, onTogglePin, onDelete,
  onFolderDragOver, onFolderDragLeave, onDocDrop,
}) => (
  <div
    className={cn(
      'flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-muted/50 group transition-colors',
      isDropTarget && 'bg-primary/10 ring-1 ring-primary/40'
    )}
    style={{ paddingLeft: level * 12 + 8 }}
    onDragOver={e => onFolderDragOver(e, folder.id)}
    onDragLeave={() => onFolderDragLeave(folder.id)}
    onDrop={e => onDocDrop(e, folder)}
  >
    {/* 有子内容时展示展开/收起 chevron，否则占位保持对齐 */}
    {hasChildren ? (
      <button
        className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:bg-muted shrink-0"
        onClick={() => onToggleCollapse(folder.id)}
        title={isCollapsed ? '展开' : '收起'}
      >
        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
    ) : (
      <span className="h-5 w-5 shrink-0" />
    )}
    <Folder className={cn('h-4 w-4 shrink-0', level === 0 ? 'text-amber-500' : 'text-amber-400/80')} />
    {isRenaming ? (
      <Input
        value={renameValue}
        onChange={e => onRenameValueChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onRenameSubmit();
          if (e.key === 'Escape') onRenameCancel();
        }}
        onBlur={onRenameCancel}
        onClick={e => e.stopPropagation()}
        className="h-6 flex-1 text-sm px-1.5 py-0"
        autoFocus
      />
    ) : (
      <span className="text-sm font-medium truncate flex-1">{folder.name}</span>
    )}
    {(folder.pinned || folder.isDefault) && <Pin className="h-3 w-3 text-primary shrink-0" />}
    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
      <button
        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
        onClick={() => onCreateDoc(folder.isDefault ? '' : folder.id)}
        title="在此新建文档"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {/* 默认“未分类”目录不可创建子目录；超过最大层级也不可再建 */}
      {!folder.isDefault && level + 1 < MAX_FOLDER_DEPTH && (
        <button
          className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
          onClick={() => onCreateSub(folder.id)}
          title="新建子目录"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      )}
      {/* 默认“未分类”目录始终置顶：隐藏重命名与置顶/删除菜单 */}
      {!folder.isDefault && (
        <>
          <button
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
            onClick={() => onRename(folder)}
            title="重命名"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted">
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onTogglePin(folder)}>
                <Pin className="h-4 w-4 mr-2" />{folder.pinned ? '取消置顶' : '置顶'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => onDelete(folder)}>
                <Trash2 className="h-4 w-4 mr-2" />删除目录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  </div>
);

interface FolderTreeProps {
  folder: ProductDocFolder;
  level: number;
  folders: ProductDocFolder[];
  docsOf: (folder: ProductDocFolder) => ProductDoc[];
  dropTargetId: string;
  collapsedIds: Set<string>;
  onToggleCollapse: (folderId: string) => void;
  renamingId: string;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  rowHandlers: FolderRowHandlers;
  renderDoc: (doc: ProductDoc, indent: number) => React.ReactNode;
}

/** 递归渲染目录及其子目录（最多 MAX_FOLDER_DEPTH 层）与目录内文档。 */
const FolderTree: React.FC<FolderTreeProps> = ({
  folder, level, folders, docsOf, dropTargetId, collapsedIds, onToggleCollapse,
  renamingId, renameValue, onRenameValueChange, onRenameSubmit, onRenameCancel,
  rowHandlers, renderDoc,
}) => {
  const renameProps = {
    isRenaming: renamingId === folder.id,
    renameValue,
    onRenameValueChange,
    onRenameSubmit,
    onRenameCancel,
  };
  const subFolders = folders.filter(f => f.parentId === folder.id);
  const childDocs = docsOf(folder);
  const isCollapsed = collapsedIds.has(folder.id);
  return (
    <div>
      <FolderRow
        folder={folder}
        level={level}
        isDropTarget={dropTargetId === folder.id}
        hasChildren={subFolders.length > 0 || childDocs.length > 0}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        {...renameProps}
        {...rowHandlers}
      />
      {!isCollapsed && (
        <div className="flex flex-col gap-1">
          {subFolders.map(sub => (
            <FolderTree
              key={sub.id}
              folder={sub}
              level={level + 1}
              folders={folders}
              docsOf={docsOf}
              dropTargetId={dropTargetId}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              rowHandlers={rowHandlers}
              renderDoc={renderDoc}
            />
          ))}
          {childDocs.map(doc => renderDoc(doc, level + 1))}
        </div>
      )}
    </div>
  );
};

interface DocMoveMenuProps {
  doc: ProductDoc;
  folders: ProductDocFolder[];
  onMove: (folderId: string) => void;
  onShowHistory: () => void;
  onPublish: () => void;
  onShare: () => void;
  onDelete: () => void;
}

/** 文档行 hover 菜单：版本历史、移动目录、发布（仅草稿）、分享（仅已发布）、删除。 */
const DocMoveMenu: React.FC<DocMoveMenuProps> = ({ doc, folders, onMove, onShowHistory, onPublish, onShare, onDelete }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
      <DropdownMenuItem onClick={onShowHistory}>
        <History className="h-4 w-4 mr-2" />版本历史
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput className="h-4 w-4 mr-2" />移动到
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
          {folders.map(f => (
            <DropdownMenuItem key={f.id} onClick={() => onMove(f.isDefault ? '' : f.id)}>
              {f.parentId ? `　└ ${f.name}` : f.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      {/* 发布仅草稿可见；分享仅已发布可见 */}
      {doc.status === 'draft' && (
        <DropdownMenuItem onClick={onPublish}>
          <Send className="h-4 w-4 mr-2" />发布
        </DropdownMenuItem>
      )}
      {doc.status === 'published' && (
        <DropdownMenuItem onClick={onShare}>
          <Share2 className="h-4 w-4 mr-2" />分享
        </DropdownMenuItem>
      )}
      <DropdownMenuItem className="text-destructive" onClick={onDelete}>
        <Trash2 className="h-4 w-4 mr-2" />删除
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  doc: ProductDoc | null;
}

/** 文档版本历史弹窗：左侧版本列表，右侧选中版本的内容预览。 */
const VersionHistoryDialog: React.FC<VersionHistoryDialogProps> = ({ open, onOpenChange, workspaceId, doc }) => {
  const [versions, setVersions] = useState<ProductDocVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<ProductDocVersion | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId || !doc) return;
    setLoading(true);
    productDocApi
      .versions(workspaceId, doc.id)
      .then(data => {
        setVersions(data);
        setSelectedVersion(data[0] ?? null);
      })
      .catch(() => toast.error('加载版本历史失败'))
      .finally(() => setLoading(false));
  }, [open, workspaceId, doc]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-w-[calc(100%-2rem)] h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            {doc?.title} 的版本历史
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 flex overflow-hidden">
          <div className="w-56 border-r border-border/50 bg-muted/10 flex flex-col shrink-0">
            <ScrollArea className="flex-1 p-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : versions.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">暂无版本历史</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {versions.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersion(v)}
                      className={cn(
                        'text-left p-2.5 rounded-lg border transition-all',
                        selectedVersion?.id === v.id
                          ? 'bg-background border-primary/30 shadow-sm'
                          : 'border-border/50 hover:border-primary/20'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">版本 {v.version}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{v.changeSummary || '无说明'}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{new Date(v.createdAt).toLocaleString()}</p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
          <ScrollArea className="flex-1 p-4">
            {selectedVersion ? (
              <MarkdownView content={selectedVersion.content} collapsible={false} />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                选择一个版本查看内容
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * 产品空间工作台（PM 专属）。
 *
 * 顶部 Tab 切换：文档 / 看板 / 原型 / 版本历史。
 * 所有文案与图标均采用产品化语义，隐藏 Git/研发术语。
 */
export const ProductWorkspace: React.FC = () => {
  // 支持深链直达指定 Tab（如分享原型链接 ?tab=prototype&prototype=<itemId>）
  const [activeTab, setActiveTab] = useState<ProductTab>(() => {
    const param = new URLSearchParams(window.location.search).get('tab');
    const validTabs: ProductTab[] = ['doc', 'kanban', 'prototype', 'history'];
    return validTabs.includes(param as ProductTab) ? (param as ProductTab) : 'doc';
  });

  const tabs = [
    { key: 'doc' as const, label: '文档', icon: FileText },
    { key: 'kanban' as const, label: '看板', icon: LayoutGrid },
    { key: 'prototype' as const, label: '原型', icon: Eye },
    { key: 'history' as const, label: '版本历史', icon: History },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px] gap-4 w-full pb-8">
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as ProductTab)} className="w-full">
        <TabsList className="aurora-tab-bar level-1 mb-0">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.key} value={tab.key} className="aurora-tab-item level-1">
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <Card className="flex-1 overflow-hidden border-none claude-card flex flex-col relative">
        {activeTab === 'doc' && <DocMode />}
        {activeTab === 'kanban' && <KanbanWorkspace />}
        {activeTab === 'prototype' && <PrototypeWorkspace />}
        {activeTab === 'history' && <VersionHistoryMode />}
      </Card>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 文档模式
// ─────────────────────────────────────────────────────────────────────────────

const DocMode: React.FC = () => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  const [docs, setDocs] = useState<ProductDoc[]>([]);
  const [folders, setFolders] = useState<ProductDocFolder[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  // 分享批注：仅已发布文档加载，面板可展开/收起
  const [shareComments, setShareComments] = useState<ShareComment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // 新建文档时预选的目标目录（空字符串表示未分类）
  const [createInFolderId, setCreateInFolderId] = useState('');
  // 待删除确认的文档（详情页删除按钮或文档行菜单均可触发）
  const [docToDelete, setDocToDelete] = useState<ProductDoc | null>(null);

  // 文档拖拽移动：被拖拽的文档 ID 与当前拖入的目录 ID
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState('');

  // 目录新建对话框：parentId 为空表示一级目录
  const [folderDialog, setFolderDialog] = useState<{ open: boolean; parentId: string; name: string }>({
    open: false, parentId: '', name: '',
  });
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<ProductDocFolder | null>(null);

  // 目录行内重命名：当前编辑的目录 ID 与名称草稿（空字符串表示未在重命名）
  const [renamingFolderId, setRenamingFolderId] = useState('');
  const [renamingName, setRenamingName] = useState('');

  // 已收起的目录 ID 集合（默认全部展开）
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());

  // 版本历史弹窗当前查看的文档
  const [historyDoc, setHistoryDoc] = useState<ProductDoc | null>(null);

  // 编辑器底部状态栏：最近保存时间
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const toggleFolderCollapse = (folderId: string) => {
    setCollapsedFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const loadDocs = async () => {
    if (!workspaceId) return;
    console.log('[DH-DEBUG] DocMode loadDocs', workspaceId);
    setLoadingDocs(true);
    try {
      const list = await productDocApi.list(workspaceId);
      setDocs(list);
    } catch {
      toast.error('加载文档列表失败');
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadFolders = async () => {
    if (!workspaceId) return;
    try {
      const list = await productDocApi.listFolders(workspaceId);
      setFolders(list);
    } catch {
      toast.error('加载目录失败');
    }
  };

  useEffect(() => {
    console.log('[DH-DEBUG] DocMode effect: loadDocs+loadFolders, workspaceId =', workspaceId);
    loadDocs();
    loadFolders();
  }, [workspaceId]);

  const selectedDoc = useMemo(
    () => docs.find(d => d.id === selectedDocId) ?? null,
    [docs, selectedDocId]
  );

  useEffect(() => {
    if (selectedDoc) {
      setTitle(selectedDoc.title);
      setContent(selectedDoc.content);
      setLastSavedAt(new Date(selectedDoc.updatedAt));
    } else if (!isCreating) {
      setTitle('');
      setContent('');
      setLastSavedAt(null);
    }
  }, [selectedDoc, isCreating]);

  // 加载分享批注：仅已发布文档有分享入口，切换文档时重置面板
  useEffect(() => {
    if (!workspaceId || !selectedDocId || selectedDoc?.status !== 'published') {
      setShareComments([]);
      setCommentsOpen(false);
      return;
    }
    productDocApi
      .listDocShareComments(workspaceId, selectedDocId)
      .then(list => setShareComments(list ?? []))
      .catch(() => setShareComments([]));
  }, [workspaceId, selectedDocId, selectedDoc?.status]);

  const openCommentCount = useMemo(
    () => shareComments.filter(c => c.status === 'open').length,
    [shareComments]
  );

  /** 关闭（标记已解决）指定分享批注，成功后局部更新列表 */
  const handleResolveComment = async (commentId: string) => {
    if (!workspaceId || !selectedDocId) return;
    try {
      const updated = await productDocApi.resolveShareComment(workspaceId, selectedDocId, commentId);
      setShareComments(prev => prev.map(c => (c.id === commentId ? updated : c)));
      toast.success('批注已关闭');
    } catch {
      toast.error('关闭批注失败');
    }
  };

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return docs;
    const q = searchQuery.toLowerCase();
    // 目录名命中时，其下文档一并展示
    const matchedFolderIds = new Set(
      folders.filter(f => f.name.toLowerCase().includes(q)).map(f => f.id)
    );
    return docs.filter(
      d =>
        d.title.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q) ||
        (!!d.folderId && matchedFolderIds.has(d.folderId))
    );
  }, [docs, folders, searchQuery]);

  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return folders.filter(f => f.name.toLowerCase().includes(q));
  }, [folders, searchQuery]);

  const handleCreate = (folderId = '') => {
    setIsCreating(true);
    setSelectedDocId(null);
    setCreateInFolderId(folderId);
    setTitle('未命名文档');
    setContent(DEFAULT_DOC_CONTENT);
  };

  // 移动文档到指定目录；folderId 为空字符串表示移回根目录
  const handleMoveDoc = async (docId: string, folderId: string) => {
    if (!workspaceId) return;
    try {
      const updated = await productDocApi.update(workspaceId, docId, { folderId });
      setDocs(prev => prev.map(d => (d.id === docId ? updated : d)));
      toast.success(folderId ? '已移动到目录' : '已移回未分类');
    } catch {
      toast.error('移动文档失败');
    }
  };

  const openCreateFolderDialog = (parentId = '') => {
    setFolderDialog({ open: true, parentId, name: '' });
  };

  // 行内重命名：点击重命名图标后目录名变为输入框
  const startInlineRename = (folder: ProductDocFolder) => {
    setRenamingFolderId(folder.id);
    setRenamingName(folder.name);
  };

  const cancelInlineRename = () => {
    setRenamingFolderId('');
    setRenamingName('');
  };

  const submitInlineRename = async () => {
    const folderId = renamingFolderId;
    const name = renamingName.trim();
    cancelInlineRename();
    if (!workspaceId || !folderId || !name) return;
    try {
      await productDocApi.updateFolder(workspaceId, folderId, { name });
      await loadFolders();
      toast.success('目录已重命名');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '重命名失败');
    }
  };

  const submitFolderDialog = async () => {
    if (!workspaceId) return;
    const name = folderDialog.name.trim();
    if (!name) {
      toast.error('请输入目录名称');
      return;
    }
    setFolderSaving(true);
    try {
      await productDocApi.createFolder(workspaceId, { name, parentId: folderDialog.parentId || undefined });
      toast.success('目录已创建');
      setFolderDialog(prev => ({ ...prev, open: false }));
      await loadFolders();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '目录操作失败');
    } finally {
      setFolderSaving(false);
    }
  };

  const handleTogglePin = async (folder: ProductDocFolder) => {
    if (!workspaceId) return;
    try {
      await productDocApi.updateFolder(workspaceId, folder.id, { pinned: !folder.pinned });
      await loadFolders();
      toast.success(folder.pinned ? '已取消置顶' : '已置顶');
    } catch {
      toast.error('操作失败');
    }
  };

  const confirmDeleteFolder = async () => {
    if (!workspaceId || !folderToDelete) return;
    try {
      await productDocApi.deleteFolder(workspaceId, folderToDelete.id);
      toast.success('目录已删除，其中文档已移回未分类');
      await Promise.all([loadFolders(), loadDocs()]);
    } catch {
      toast.error('删除目录失败');
    } finally {
      setFolderToDelete(null);
    }
  };

  const handleSaveDraft = async () => {
    if (!workspaceId) return;
    if (!title.trim()) {
      toast.error('请输入文档标题');
      return;
    }

    setSaving(true);
    try {
      if (isCreating) {
        const doc = await productDocApi.create(workspaceId, {
          title: title.trim(),
          content,
          status: 'draft',
          folderId: createInFolderId || undefined,
        });
        setDocs(prev => [doc, ...prev]);
        setSelectedDocId(doc.id);
        setIsCreating(false);
        setCreateInFolderId('');
        setLastSavedAt(new Date());
        toast.success('文档已创建');
      } else if (selectedDocId) {
        const doc = await productDocApi.update(workspaceId, selectedDocId, {
          title: title.trim(),
          content,
        });
        setDocs(prev => prev.map(d => (d.id === doc.id ? doc : d)));
        setLastSavedAt(new Date());
        toast.success('草稿已保存');
      }
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!workspaceId || !selectedDocId) return;
    setPublishing(true);
    try {
      await productDocApi.publish(workspaceId, selectedDocId, {
        changeSummary: `发布于 ${new Date().toLocaleString()}`,
      });
      await loadDocs();
      setLastSavedAt(new Date());
      toast.success('版本已发布');
    } catch {
      toast.error('发布失败');
    } finally {
      setPublishing(false);
    }
  };

  // 从文档行菜单发布指定文档
  const handlePublishDoc = async (docId: string) => {
    if (!workspaceId) return;
    try {
      await productDocApi.publish(workspaceId, docId, {
        changeSummary: `发布于 ${new Date().toLocaleString()}`,
      });
      await loadDocs();
      toast.success('版本已发布');
    } catch {
      toast.error('发布失败');
    }
  };

  // 生成分享短链并复制到剪贴板（仅已发布文档可用，后端幂等返回同一链接）
  const handleShareDoc = async (docId: string) => {
    if (!workspaceId) return;
    try {
      const share = await productDocApi.createShare(workspaceId, docId);
      const url = `${window.location.origin}/s/${share.token}`;
      await navigator.clipboard.writeText(url);
      toast.success('分享链接已复制', { description: url });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '生成分享链接失败');
    }
  };

  const handleDelete = () => {
    if (!selectedDoc) return;
    setDocToDelete(selectedDoc);
  };

  const confirmDelete = async () => {
    if (!workspaceId || !docToDelete) return;
    try {
      await productDocApi.delete(workspaceId, docToDelete.id);
      setDocs(prev => prev.filter(d => d.id !== docToDelete.id));
      if (selectedDocId === docToDelete.id) setSelectedDocId(null);
      toast.success('文档已删除');
    } catch {
      toast.error('删除失败');
    } finally {
      setDocToDelete(null);
    }
  };

  // ── 目录树渲染辅助 ──
  const defaultFolder = folders.find(f => f.isDefault);
  const rootFolders = folders.filter(f => !f.parentId);
  // 未归类文档（folderId 为空）归属默认“未分类”目录展示
  const docsOfFolder = (folder: ProductDocFolder) =>
    docs.filter(d => (folder.isDefault ? !d.folderId || d.folderId === folder.id : d.folderId === folder.id));

  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== folderId) setDropTargetId(folderId);
  };

  const handleFolderDragLeave = (folderId: string) => {
    setDropTargetId(prev => (prev === folderId ? '' : prev));
  };

  const handleDocDrop = (e: React.DragEvent, folder: ProductDocFolder) => {
    e.preventDefault();
    setDropTargetId('');
    const docId = e.dataTransfer.getData('text/plain');
    if (!docId) return;
    // 拖到默认目录等价于清空 folderId（回到未分类）
    const targetFolderId = folder.isDefault ? '' : folder.id;
    const doc = docs.find(d => d.id === docId);
    if (!doc || (doc.folderId ?? '') === targetFolderId) return;
    handleMoveDoc(docId, targetFolderId);
  };

  const renderDocRow = (doc: ProductDoc, indent: number) => (
    <div
      key={doc.id}
      className={cn('relative group', draggedDocId === doc.id && 'opacity-50')}
      style={{ paddingLeft: indent * 12 }}
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('text/plain', doc.id);
        e.dataTransfer.effectAllowed = 'move';
        setDraggedDocId(doc.id);
      }}
      onDragEnd={() => setDraggedDocId(null)}
    >
      <button
        onClick={() => {
          setSelectedDocId(doc.id);
          setIsCreating(false);
        }}
        className={cn(
          'w-full text-left px-3 py-2 pr-8 rounded-lg transition-colors',
          selectedDocId === doc.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'
        )}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 opacity-70" />
          <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0 shrink-0', STATUS_VARIANT[doc.status])}>
            {STATUS_LABEL[doc.status] ?? doc.status}
          </Badge>
          <span className="text-sm font-medium truncate flex-1">{doc.title}</span>
          {doc.category && <span className="text-[10px] text-muted-foreground truncate shrink-0">{doc.category}</span>}
        </div>
      </button>
      <div className="absolute right-1 top-2">
        <DocMoveMenu
          doc={doc}
          folders={folders}
          onMove={folderId => handleMoveDoc(doc.id, folderId)}
          onShowHistory={() => setHistoryDoc(doc)}
          onPublish={() => handlePublishDoc(doc.id)}
          onShare={() => handleShareDoc(doc.id)}
          onDelete={() => setDocToDelete(doc)}
        />
      </div>
    </div>
  );

  const folderRowHandlers: FolderRowHandlers = {
    onCreateDoc: handleCreate,
    onCreateSub: openCreateFolderDialog,
    onRename: startInlineRename,
    onTogglePin: handleTogglePin,
    onDelete: setFolderToDelete,
    onFolderDragOver: handleFolderDragOver,
    onFolderDragLeave: handleFolderDragLeave,
    onDocDrop: handleDocDrop,
  };

  const renderFolderTree = () => (
    <div className="flex flex-col gap-1">
      {rootFolders.map(folder => (
        <FolderTree
          key={folder.id}
          folder={folder}
          level={0}
          folders={folders}
          docsOf={docsOfFolder}
          dropTargetId={dropTargetId}
          collapsedIds={collapsedFolderIds}
          onToggleCollapse={toggleFolderCollapse}
          renamingId={renamingFolderId}
          renameValue={renamingName}
          onRenameValueChange={setRenamingName}
          onRenameSubmit={submitInlineRename}
          onRenameCancel={cancelInlineRename}
          rowHandlers={folderRowHandlers}
          renderDoc={renderDocRow}
        />
      ))}
    </div>
  );

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full rounded-xl border border-border/50">
      <ResizablePanel defaultSize={22} minSize={18} maxSize={35} className="bg-muted/10 border-r border-border/50">
        <div className="h-full flex flex-col">
          <div className="p-3 border-b border-border/50 bg-muted/20 shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">文档目录</span>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openCreateFolderDialog()} title="新建目录">
                  <FolderPlus className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCreate()} title="新建文档">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索文档..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>
          <ScrollArea className="flex-1 p-2">
            {loadingDocs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : searchQuery ? (
              filteredDocs.length === 0 && filteredFolders.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">未找到匹配的文档或目录</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {/* 命中的目录：点击后清空搜索回到目录树 */}
                  {filteredFolders.map(folder => (
                    <button
                      key={folder.id}
                      onClick={() => setSearchQuery('')}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-muted/50 text-left transition-colors"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="text-sm font-medium truncate">{folder.name}</span>
                    </button>
                  ))}
                  {filteredDocs.map(doc => renderDocRow(doc, 0))}
                </div>
              )
            ) : docs.length === 0 && folders.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">
                暂无文档，点击右上角新建
              </div>
            ) : (
              renderFolderTree()
            )}
          </ScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={78}>
        {selectedDoc || isCreating ? (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90 gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {isCreating && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setIsCreating(false)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="文档标题"
                  className="h-8 font-medium max-w-md bg-transparent border-none focus-visible:ring-0 px-0"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* 发布按钮仅草稿态可见 */}
                {!isCreating && selectedDoc?.status === 'draft' && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handlePublish}
                    disabled={publishing}
                    title="发布版本"
                  >
                    {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                )}
                {/* 分享按钮仅已发布（正式）文档可见 */}
                {!isCreating && selectedDoc?.status === 'published' && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleShareDoc(selectedDoc.id)}
                    title="分享文档"
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                )}
                {/* 分享批注面板开关：仅已发布文档可见，角标显示未解决数 */}
                {!isCreating && selectedDoc?.status === 'published' && (
                  <Button
                    variant={commentsOpen ? 'secondary' : 'outline'}
                    size="icon"
                    className="h-8 w-8 relative"
                    onClick={() => setCommentsOpen(o => !o)}
                    title="分享批注"
                  >
                    <MessageSquare className="h-4 w-4" />
                    {openCommentCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 text-center">
                        {openCommentCount}
                      </span>
                    )}
                  </Button>
                )}
                <Button size="icon" className="h-8 w-8" onClick={handleSaveDraft} disabled={saving} title={isCreating ? '创建' : '保存'}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </Button>
                {!isCreating && selectedDocId && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={handleDelete} title="删除">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex min-h-0">
              <div className="flex-1 min-w-0 overflow-hidden">
                <MarkdownEditor value={content} onChange={setContent} lastSavedAt={lastSavedAt} />
              </div>
              {commentsOpen && !isCreating && selectedDocId && (
                <ShareCommentsPanel
                  comments={shareComments}
                  onResolve={handleResolveComment}
                  onClose={() => setCommentsOpen(false)}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <FileText className="h-12 w-12 opacity-20" />
            <p>在左侧选择一个文档，或新建文档开始编辑</p>
            <Button variant="outline" size="sm" onClick={() => handleCreate()}>
              <Plus className="h-4 w-4 mr-1.5" />
              新建文档
            </Button>
          </div>
        )}
      </ResizablePanel>

      <AlertDialog open={!!docToDelete} onOpenChange={open => !open && setDocToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除文档</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除文档「{docToDelete?.title}」吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 目录新建对话框 */}
      <Dialog open={folderDialog.open} onOpenChange={open => setFolderDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-sm max-w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle>
              {folderDialog.parentId ? '新建子目录' : '新建目录'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              placeholder="目录名称"
              value={folderDialog.name}
              onChange={e => setFolderDialog(prev => ({ ...prev, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && submitFolderDialog()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFolderDialog(prev => ({ ...prev, open: false }))}>
                取消
              </Button>
              <Button onClick={submitFolderDialog} disabled={folderSaving}>
                {folderSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除目录确认 */}
      <AlertDialog open={!!folderToDelete} onOpenChange={open => !open && setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除目录</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除目录「{folderToDelete?.name}」吗？其中的文档将移回未分类，其下子目录也会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteFolder} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 文档版本历史弹窗 */}
      <VersionHistoryDialog
        open={!!historyDoc}
        onOpenChange={open => !open && setHistoryDoc(null)}
        workspaceId={workspaceId}
        doc={historyDoc}
      />
    </ResizablePanelGroup>
  );
};
