import JSZip from 'jszip';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText, LayoutGrid, LayoutTemplate, Eye, History, Trash2, Save, Loader2, Send, Clock, ChevronLeft, ChevronRight,
  ChevronDown, Folder, FolderPlus, Pin, MoreVertical, FolderInput, Pencil, Share2, MessageSquare,
  Layers, Download, Copy, Gavel, CheckCircle2, XCircle, UserCheck, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { KanbanWorkspace } from './KanbanWorkspace';
import { PrototypeWorkspace } from './PrototypeWorkspace';
import { VersionHistoryMode } from './VersionHistoryMode';
import { STATUS_LABEL, STATUS_VARIANT } from './doc-status';
import { productDocApi, type ProductDoc, type ProductDocFolder, type ProductDocVersion, type ShareComment } from '@/lib/productdoc-api';
import { downloadBlob } from '@/lib/file-download';
import { decodeBase64Utf8, findPrototypeProductName, productSpaceApi, requirementShareApi, type ProductSpaceTreeNode, type RequirementShare } from '@/lib/productspace-api';
import { workspaceApi } from '@/lib/workspace-api';
import { workItemApi } from '@/lib/workitem-api';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { workItemDocApi, type WorkItemDocLink } from '@/lib/workitem-doc-api';
import type { WorkItemDTO } from '@/lib/api-types';
import type { WorkspaceMember } from '@/types';

/** 需求状态映射为中文标签（与 KanbanWorkspace 保持一致） */
const API_STATUS_TO_UI: Record<string, string> = {
  backlog: '待处理',
  todo: '待处理',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
  on_hold: '已挂起',
  passed: '已通过',
  failed: '评审不通过',
};

/** 侧边栏需求状态圆点配色（与看板状态色系一致：蓝/琥珀/绿/锌灰/橙/紫/红） */
const SIDEBAR_STATUS_DOT: Record<string, string> = {
  '待处理': 'bg-blue-500',
  '进行中': 'bg-amber-500',
  '已完成': 'bg-green-500',
  '已取消': 'bg-zinc-500',
  '已挂起': 'bg-orange-500',
  '已通过': 'bg-purple-500',
  '评审不通过': 'bg-red-500',
};



type ProductTopTab = string;
type ProductSubTab = 'doc' | 'prototype' | 'history';

/** 额外 Tab 配置：由父组件根据用户角色注入（工程代码 / 用例设计 / UI设计 等）。 */
export interface ExtraTab {
  key: string;
  label: string;
  icon: LucideIcon;
  render: () => React.ReactNode;
}

/** ProductWorkspace 组件 Props */
export interface ProductWorkspaceProps {
  /** 是否显示"需求设计"Tab（PM 角色显示）。默认 true。 */
  showDesignTab?: boolean;
  /** 额外角色 Tab（工程代码 / 用例设计 / UI设计 等）。 */
  extraTabs?: ExtraTab[];
}

/** 目录最多支持的层级数（与后端 MaxFolderDepth 保持一致） */
const MAX_FOLDER_DEPTH = 6;

/** 目录行的事件回调集合 */
interface FolderRowHandlers {
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
  onCreateSub, onRename, onTogglePin, onDelete,
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
      {/* 默认"未分类"目录不可创建子目录；超过最大层级也不可再建 */}
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
  onDelete: () => void;
}

/** 文档行 hover 菜单：版本历史、移动目录、发布（仅草稿）、删除。 */
const DocMoveMenu: React.FC<DocMoveMenuProps> = ({ doc, folders, onMove, onShowHistory, onPublish, onDelete }) => (
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
      {/* 发布仅草稿可见 */}
      {doc.status === 'draft' && (
        <DropdownMenuItem onClick={onPublish}>
          <Send className="h-4 w-4 mr-2" />发布
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
 * 个人工作台 - 统一工作台视图。
 *
 * 顶部 Tab：需求追踪（始终） + 需求设计（PM） + 角色专属 Tab（工程代码 / 用例设计 / UI设计）。
 * 需求设计下二级 Tab：文档 / 原型 / 版本历史。
 * Tab 列表根据用户职能子角色动态构建，支持多角色同时展示多个 Tab。
 */
export const ProductWorkspace: React.FC<ProductWorkspaceProps> = ({ showDesignTab = true, extraTabs = [] }) => {
  // 支持深链直达指定 Tab（如分享原型链接 ?tab=prototype&prototype=<itemId>）。
  const [{ topTab, subTab }, setTabs] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') ?? '';
    const validSubTabs: ProductSubTab[] = ['doc', 'prototype', 'history'];
    if (validSubTabs.includes(tab as ProductSubTab)) {
      return { topTab: 'design' as ProductTopTab, subTab: tab as ProductSubTab };
    }
    const extraKeys = extraTabs.map(t => t.key);
    if (tab === 'kanban' || tab === 'design' || extraKeys.includes(tab)) {
      return { topTab: tab as ProductTopTab, subTab: (params.get('subtab') as ProductSubTab) ?? 'doc' };
    }
    return { topTab: 'kanban' as ProductTopTab, subTab: 'doc' as ProductSubTab };
  });

  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const navigate = useNavigate();

  // 需求关联：选中需求后加载其关联的文档/原型，在看板和设计视图间共享
  const [selectedWorkitemId, setSelectedWorkitemId] = useState<string>('');
  const [requirements, setRequirements] = useState<WorkItemDTO[]>([]);
  const [docLinks, setDocLinks] = useState<WorkItemDocLink[]>([]);
  const [requirementLinksMap, setRequirementLinksMap] = useState<Record<string, WorkItemDocLink[]>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** 关联链接是否已加载完成（用于区分"加载中"和"确实无设计"） */
  const [linksLoaded, setLinksLoaded] = useState(false);
  /** 当前正在执行分享/导出的需求 ID，用于菜单 loading 态 */
  const [sharingRequirementId, setSharingRequirementId] = useState<string>('');
  const [exportingRequirementId, setExportingRequirementId] = useState<string>('');
  /** 分享成功后弹出的权限配置对话框 */
  const [shareDialog, setShareDialog] = useState<{ open: boolean; share: RequirementShare | null; allowComments: boolean }>({
    open: false,
    share: null,
    allowComments: true,
  });

  /** 需求无设计时，引导使用 AI 写 PRD 的确认弹窗 */
  const [aiDesignDialog, setAiDesignDialog] = useState<{ open: boolean; req: WorkItemDTO | null; type?: 'doc' | 'prototype' }>({ open: false, req: null });

  /** 工作空间成员列表（用于评审通过/分配时选择受理人） */
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  /** 评审对话框：review 阶段展示分享链接与通过/不通过；assign 阶段选择受理人 */
  const [reviewDialog, setReviewDialog] = useState<{
    open: boolean;
    step: 'review' | 'assign';
    req: WorkItemDTO | null;
    share: RequirementShare | null;
    selectedAssigneeId: string;
    processing: boolean;
  }>({
    open: false,
    step: 'review',
    req: null,
    share: null,
    selectedAssigneeId: '',
    processing: false,
  });

  /** 分配对话框：直接选择受理人 */
  const [assignDialog, setAssignDialog] = useState<{
    open: boolean;
    req: WorkItemDTO | null;
    selectedAssigneeId: string;
    processing: boolean;
  }>({
    open: false,
    req: null,
    selectedAssigneeId: '',
    processing: false,
  });

  // 顶部 Tab 列表：需求追踪（始终） + 需求设计（PM） + 角色专属 Tab
  const topTabs = useMemo(() => {
    const tabs: { key: string; label: string; icon: LucideIcon }[] = [
      { key: 'kanban', label: '需求追踪', icon: LayoutGrid },
    ];
    if (showDesignTab) {
      tabs.push({ key: 'design', label: '需求设计', icon: Layers });
    }
    for (const extra of extraTabs) {
      tabs.push({ key: extra.key, label: extra.label, icon: extra.icon });
    }
    return tabs;
  }, [showDesignTab, extraTabs]);

  const subTabs = [
    { key: 'doc' as const, label: '文档', icon: FileText },
    { key: 'prototype' as const, label: '原型', icon: Eye },
    { key: 'history' as const, label: '版本', icon: History },
  ];

  const handleTopChange = (value: ProductTopTab) => {
    setTabs(prev => ({ topTab: value, subTab: prev.subTab }));
  };

  // 从看板进入需求设计视图：若已有关联设计则直接切换；否则弹出 AI 设计引导。
  const handleNavigateToDesign = async (id: string, tab?: 'doc' | 'prototype') => {
    let req = requirements.find(r => r.id === id);
    if (!req) {
      try {
        req = await api.get<WorkItemDTO>(`/v1/workitems/${id}`);
      } catch {
        toast.error('加载需求信息失败');
        return;
      }
    }
    try {
      const links = await workItemDocApi.list(id);
      if (links.length > 0) {
        setSelectedWorkitemId(id);
        setTabs(prev => ({ ...prev, topTab: 'design', subTab: tab ?? prev.subTab }));
        return;
      }
      setAiDesignDialog({ open: true, req });
    } catch {
      toast.error('检查设计关联失败');
    }
  };

  // 看板卡片无设计时点击文档/原型按钮，弹出 AI 设计引导
  const handleAiDesignPrompt = async (id: string, type: 'doc' | 'prototype') => {
    let req = requirements.find(r => r.id === id);
    if (!req) {
      try {
        req = await api.get<WorkItemDTO>(`/v1/workitems/${id}`);
      } catch {
        toast.error('加载需求信息失败');
        return;
      }
    }
    setAiDesignDialog({ open: true, req, type });
  };

  // 确认使用 AI 写 PRD：跳转到智能会话并自动携带 /prd-write 指令与需求卡片。
  const confirmAiDesign = () => {
    const { req, type } = aiDesignDialog;
    if (!req) return;
    const command = type === 'prototype' ? 'proto-make' : 'prd-write';
    navigate('/chat', {
      state: {
        initialInput: `/${command} ${req.title}`,
        quotedCard: { type: 'req' as const, id: req.id, title: req.title, reporter: req.reporter || '' },
      },
    });
    setAiDesignDialog({ open: false, req: null });
  };

  const handleAIDesignFromKanban = (req: WorkItemDTO) => {
    navigate('/chat', {
      state: {
        initialInput: `/prd-write ${req.title}`,
        quotedCard: { type: 'req' as const, id: req.id, title: req.title, reporter: req.reporter || '' },
      },
    });
  };

  // 为需求创建统一的文档+原型分享链接，成功后弹出权限配置对话框。
  const handleShareRequirement = async (req: WorkItemDTO) => {
    if (!workspaceId) return;
    setSharingRequirementId(req.id);
    try {
      const links = await workItemDocApi.list(req.id);
      const docLink = links.find(l => l.itemType === 'doc');
      const protoLink = links.find(l => l.itemType === 'prototype');
      const docId = docLink?.productSpaceItemId ?? '';
      let productFolder = '';
      if (protoLink?.productSpaceItemId) {
        const tree = await productSpaceApi.tree(workspaceId);
        productFolder = findPrototypeProductName(tree, protoLink.productSpaceItemId) ?? '';
      }
      if (!docId && !productFolder) {
        toast.error('该需求没有可分享的文档或原型');
        return;
      }
      const share = await requirementShareApi.create(workspaceId, {
        title: req.title,
        docId: docId || undefined,
        productFolder: productFolder || undefined,
        allowComments: true,
      });
      setShareDialog({ open: true, share, allowComments: share.allowComments ?? true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '分享失败');
    } finally {
      setSharingRequirementId('');
    }
  };

  // 切换需求分享的批注权限，通过幂等创建接口同步 allowComments。
  const handleAllowCommentsChange = async (checked: boolean) => {
    const { share } = shareDialog;
    if (!share || !workspaceId) return;
    setShareDialog(prev => ({ ...prev, allowComments: checked }));
    try {
      const updated = await requirementShareApi.create(workspaceId, {
        title: share.title,
        docId: share.docId || undefined,
        productFolder: share.productFolder || undefined,
        allowComments: checked,
      });
      setShareDialog(prev => ({ ...prev, share: updated, allowComments: updated.allowComments ?? checked }));
    } catch {
      setShareDialog(prev => ({ ...prev, allowComments: !checked }));
      toast.error('更新批注权限失败');
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareDialog.share) return;
    const url = `${window.location.origin}/share/requirement/${shareDialog.share.token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast.error('复制失败');
    }
  };

  // 导出需求关联的文档（Markdown）与原型页面（HTML）为 zip 包。
  const handleExportRequirement = async (req: WorkItemDTO) => {
    if (!workspaceId) return;
    setExportingRequirementId(req.id);
    try {
      const links = await workItemDocApi.list(req.id);
      const docLink = links.find(l => l.itemType === 'doc');
      const protoLink = links.find(l => l.itemType === 'prototype');
      const zip = new JSZip();
      let hasContent = false;
      if (docLink?.productSpaceItemId) {
        const doc = await productDocApi.get(workspaceId, docLink.productSpaceItemId);
        zip.file(`文档/${doc.title}.md`, doc.content);
        hasContent = true;
      }
      if (protoLink?.productSpaceItemId) {
        const detail = await productSpaceApi.getItem(workspaceId, protoLink.productSpaceItemId);
        const fileName = detail.title.toLowerCase().endsWith('.html') ? detail.title : `${detail.title}.html`;
        zip.file(`原型/${fileName}`, decodeBase64Utf8(detail.content));
        hasContent = true;
      }
      if (!hasContent) {
        toast.error('该需求没有可导出的文档或原型');
        return;
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${req.title}-文档与原型.zip`);
    } catch {
      toast.error('导出失败');
    } finally {
      setExportingRequirementId('');
    }
  };

  // 打开评审对话框：先创建/获取需求统一分享链接，再展示通过/不通过操作。
  const handleReviewRequirement = async (req: WorkItemDTO) => {
    if (!workspaceId) return;
    setReviewDialog(prev => ({ ...prev, open: true, processing: true, req }));
    try {
      const links = await workItemDocApi.list(req.id);
      const docLink = links.find(l => l.itemType === 'doc');
      const protoLink = links.find(l => l.itemType === 'prototype');
      const docId = docLink?.productSpaceItemId ?? '';
      let productFolder = '';
      if (protoLink?.productSpaceItemId) {
        const tree = await productSpaceApi.tree(workspaceId);
        productFolder = findPrototypeProductName(tree, protoLink.productSpaceItemId) ?? '';
      }
      if (!docId && !productFolder) {
        toast.error('该需求没有可评审的文档或原型');
        setReviewDialog(prev => ({ ...prev, open: false, processing: false, req: null }));
        return;
      }
      const share = await requirementShareApi.create(workspaceId, {
        title: req.title,
        docId: docId || undefined,
        productFolder: productFolder || undefined,
        allowComments: true,
      });
      setReviewDialog({
        open: true,
        step: 'review',
        req,
        share,
        selectedAssigneeId: req.assigneeId || '',
        processing: false,
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '打开评审失败');
      setReviewDialog(prev => ({ ...prev, open: false, processing: false, req: null }));
    }
  };

  // 评审不通过：需求状态更新为 failed。
  const handleReviewReject = async () => {
    const { req } = reviewDialog;
    if (!req) return;
    setReviewDialog(prev => ({ ...prev, processing: true }));
    try {
      await workItemApi.updateStatus(req.id, 'failed');
      setReviewDialog(prev => ({ ...prev, open: false, processing: false }));
      await loadRequirements();
    } catch {
      toast.error('评审操作失败');
      setReviewDialog(prev => ({ ...prev, processing: false }));
    }
  };

  // 评审通过并指定受理人：先标记 passed，设置受理人，再流转到 in_progress。
  const handleReviewPass = async () => {
    const { req, selectedAssigneeId } = reviewDialog;
    if (!req) return;
    if (!selectedAssigneeId) {
      toast.error('请选择受理人');
      return;
    }
    setReviewDialog(prev => ({ ...prev, processing: true }));
    try {
      await workItemApi.updateStatus(req.id, 'passed');
      await workItemApi.updateAssignee(req.id, selectedAssigneeId);
      await workItemApi.updateStatus(req.id, 'in_progress');
      setReviewDialog({ open: false, step: 'review', req: null, share: null, selectedAssigneeId: '', processing: false });
      await loadRequirements();
    } catch {
      toast.error('受理操作失败');
      setReviewDialog(prev => ({ ...prev, processing: false }));
    }
  };

  // 打开分配对话框。
  const openAssignDialog = (req: WorkItemDTO) => {
    setAssignDialog({
      open: true,
      req,
      selectedAssigneeId: req.assigneeId || '',
      processing: false,
    });
  };

  // 确认分配受理人。
  const handleAssignConfirm = async () => {
    const { req, selectedAssigneeId } = assignDialog;
    if (!req) return;
    if (!selectedAssigneeId) {
      toast.error('请选择受理人');
      return;
    }
    setAssignDialog(prev => ({ ...prev, processing: true }));
    try {
      await workItemApi.updateAssignee(req.id, selectedAssigneeId);
      setAssignDialog({ open: false, req: null, selectedAssigneeId: '', processing: false });
      await loadRequirements();
    } catch {
      toast.error('分配失败');
      setAssignDialog(prev => ({ ...prev, processing: false }));
    }
  };

  /** 加载需求列表及每个需求关联的文档/原型链接 */
  const loadRequirements = async () => {
    try {
      const reqs = await api.get<WorkItemDTO[]>(`/v1/workitems?type=requirement&workspaceId=${encodeURIComponent(workspaceId)}`);
      setRequirements(reqs);
      const linkResults = await Promise.all(
        reqs.map(req => workItemDocApi.list(req.id).catch(() => [] as WorkItemDocLink[]))
      );
      const map: Record<string, WorkItemDocLink[]> = {};
      reqs.forEach((req, i) => { map[req.id] = linkResults[i]; });
      setRequirementLinksMap(map);
    } catch {
      toast.error('加载需求列表失败');
    }
  };

  // 进入需求设计视图时加载需求列表
  useEffect(() => {
    if (topTab !== 'design') return;
    loadRequirements();
  }, [topTab]);

  // 加载当前工作空间成员（用于评审通过/分配选择受理人）
  useEffect(() => {
    if (!workspaceId) return;
    workspaceApi.members(workspaceId)
      .then(list => setMembers(list))
      .catch(() => toast.error('加载工作空间成员失败'));
  }, [workspaceId]);

  // 选中需求变更时加载关联的文档/原型链接
  useEffect(() => {
    if (!selectedWorkitemId) {
      setDocLinks([]);
      setLinksLoaded(false);
      return;
    }
    setLinksLoaded(false);
    workItemDocApi.list(selectedWorkitemId)
      .then(links => {
        setDocLinks(links);
        setLinksLoaded(true);
      })
      .catch(() => {
        setDocLinks([]);
        setLinksLoaded(true);
      });
  }, [selectedWorkitemId]);

  // 根据关联类型自动切换子 Tab：有文档关联跳文档，否则有原型关联跳原型
  const docLink = docLinks.find(l => l.itemType === 'doc');
  const prototypeLink = docLinks.find(l => l.itemType === 'prototype');
  const focusDocId = docLink?.productSpaceItemId ?? null;
  const focusItemId = prototypeLink?.productSpaceItemId ?? null;
  /** 当前选中需求是否无任何设计关联（文档和原型都没有） */
  const hasNoDesign = !!selectedWorkitemId && linksLoaded && docLinks.length === 0;
  /** 当前选中的需求对象（用于空设计提示页展示标题） */
  const selectedRequirement = requirements.find(r => r.id === selectedWorkitemId);

  useEffect(() => {
    if (!selectedWorkitemId) return;
    if (docLink) {
      setTabs(prev => ({ ...prev, subTab: 'doc' }));
    } else if (prototypeLink) {
      setTabs(prev => ({ ...prev, subTab: 'prototype' }));
    }
  }, [selectedWorkitemId, docLink, prototypeLink]);

  return (
    <div className="flex flex-col h-[calc((100vh-6rem)*2)] md:h-[calc((100vh-8rem)*2)] min-h-[1000px] gap-4 w-full pb-8">
      <Tabs value={topTab} onValueChange={value => handleTopChange(value as ProductTopTab)} className="w-full">
        <TabsList className="aurora-tab-bar level-1 mb-0">
          {topTabs.map(tab => {
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

      <div className="flex flex-1 gap-2 min-h-0">
        {/* 需求侧边栏：仅设计视图可见，可收缩 */}
        {topTab === 'design' && (
          <>
            {sidebarCollapsed ? (
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 h-full w-9 rounded-xl border-border/50 glass-panel"
                onClick={() => setSidebarCollapsed(false)}
                title="展开需求列表"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <aside className="w-[260px] shrink-0 flex flex-col rounded-xl glass-panel overflow-hidden">
                {/* 头部：标题 + 收起按钮 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">需求列表</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/60" onClick={() => setSidebarCollapsed(true)} title="收起">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
                <ScrollArea className="flex-1 p-2">
                  {/* 全部需求按钮 */}
                  <button
                    className={cn(
                      'w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg mb-1.5 transition-all',
                      !selectedWorkitemId
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted/50 text-muted-foreground'
                    )}
                    onClick={() => setSelectedWorkitemId('')}
                  >
                    <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-sm">全部需求</span>
                  </button>
                  {/* 需求列表 */}
                  {requirements.map(req => {
                    const links = requirementLinksMap[req.id] ?? [];
                    const hasDoc = links.some(l => l.itemType === 'doc');
                    const hasProto = links.some(l => l.itemType === 'prototype');
                    const statusKey = API_STATUS_TO_UI[req.status] ?? '待处理';
                    const isActive = selectedWorkitemId === req.id;
                    const sharing = sharingRequirementId === req.id;
                    const exporting = exportingRequirementId === req.id;
                    return (
                      <div
                        key={req.id}
                        className={cn(
                          'relative group text-left px-3 py-2.5 rounded-lg mb-1 transition-all cursor-pointer',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted/50 text-foreground'
                        )}
                        onClick={() => setSelectedWorkitemId(req.id)}
                      >
                        {/* 标题行：状态圆点 + 标题 */}
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full shrink-0', SIDEBAR_STATUS_DOT[statusKey] ?? 'bg-blue-500')} />
                          <span className={cn('text-sm truncate flex-1 pr-6', isActive ? 'font-medium' : 'font-normal')}>{req.title}</span>
                        </div>
                        {/* 元信息行：文档/原型关联指示 + 状态标签 */}
                        <div className="flex items-center gap-2 mt-1.5 ml-4">
                          <span className={cn(
                            'flex items-center gap-0.5 text-[11px]',
                            hasDoc ? 'text-blue-500' : 'text-muted-foreground/30'
                          )}>
                            <FileText className="h-3 w-3" />
                          </span>
                          <span className={cn(
                            'flex items-center gap-0.5 text-[11px]',
                            hasProto ? 'text-green-500' : 'text-muted-foreground/30'
                          )}>
                            <Eye className="h-3 w-3" />
                          </span>
                          <span className="text-[11px] text-muted-foreground/70 ml-auto">{statusKey}</span>
                        </div>
                        {/* 需求操作：分享 / 导出 / 评审 / 分配 */}
                        <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={sharing || exporting || reviewDialog.processing || assignDialog.processing}
                              >
                                {sharing || exporting || reviewDialog.processing || assignDialog.processing ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <MoreVertical className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleShareRequirement(req)} disabled={sharing}>
                                <Share2 className="h-4 w-4 mr-2" />分享
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleExportRequirement(req)} disabled={exporting}>
                                <Download className="h-4 w-4 mr-2" />导出
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => handleReviewRequirement(req)} disabled={reviewDialog.processing}>
                                <Gavel className="h-4 w-4 mr-2" />评审
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openAssignDialog(req)} disabled={assignDialog.processing}>
                                <UserCheck className="h-4 w-4 mr-2" />分配
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </ScrollArea>
              </aside>
            )}
          </>
        )}

        {/* 主区域：上方子 Tab + 下方内容 */}
        <div className="flex-1 flex flex-col gap-4 min-h-0 min-w-0">
          {topTab === 'design' && !hasNoDesign && !!selectedWorkitemId && (
            <Tabs value={subTab} onValueChange={value => setTabs(prev => ({ ...prev, subTab: value as ProductSubTab }))} className="w-full">
              <TabsList className="aurora-tab-bar level-2 mb-0">
                {subTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger key={tab.key} value={tab.key} className="aurora-tab-item level-2">
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          )}

          <Card className="flex-1 min-w-0 overflow-hidden border-none claude-card flex flex-col relative">
            {topTab === 'kanban' && (
              <KanbanWorkspace
                onNavigateToDesign={handleNavigateToDesign}
                onAssign={openAssignDialog}
                onReview={handleReviewRequirement}
                onAiDesign={handleAIDesignFromKanban}
                onAiDesignPrompt={handleAiDesignPrompt}
              />
            )}
            {/* 设计视图 - 无选中需求：引导选择 */}
            {topTab === 'design' && !selectedWorkitemId && (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 grid place-items-center">
                  <Layers className="h-8 w-8 text-primary/60" />
                </div>
                <div className="text-center">
                  <p className="text-base font-medium text-foreground">请从左侧选择需求</p>
                  <p className="text-sm mt-1">选择需求后可查看关联的设计文档与原型</p>
                </div>
              </div>
            )}
            {/* 设计视图 - 需求无设计关联：空设计提示页 */}
            {topTab === 'design' && hasNoDesign && (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground">
                <div className="w-16 h-16 rounded-2xl bg-muted/30 grid place-items-center">
                  <FileText className="h-8 w-8 text-muted-foreground/40" />
                </div>
                <div className="text-center max-w-sm">
                  <p className="text-base font-medium text-foreground">该需求暂无设计</p>
                  <p className="text-sm mt-1">需求「{selectedRequirement?.title}」尚未关联设计文档或原型</p>
                </div>
              </div>
            )}
            {/* 设计视图 - 有关联设计：正常展示 */}
            {topTab === 'design' && !hasNoDesign && !!selectedWorkitemId && subTab === 'doc' && <DocMode focusDocId={focusDocId} />}
            {topTab === 'design' && !hasNoDesign && !!selectedWorkitemId && subTab === 'prototype' && <PrototypeWorkspace focusItemId={focusItemId} />}
            {topTab === 'design' && !hasNoDesign && !!selectedWorkitemId && subTab === 'history' && <VersionHistoryMode workitemId={selectedWorkitemId} />}
            {/* 额外角色 Tab 内容（工程代码 / 用例设计 / UI设计 等） */}
            {extraTabs.find(t => t.key === topTab)?.render()}
          </Card>
        </div>
      </div>

      {/* 需求无设计关联时，引导使用 AI 写 PRD */}
      <Dialog open={aiDesignDialog.open} onOpenChange={open => setAiDesignDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-[440px] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                {aiDesignDialog.type === 'prototype' ? (
                  <LayoutTemplate className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                )}
              </div>
              <div className="text-left">
                <DialogTitle className="text-base font-semibold">
                  {aiDesignDialog.type === 'prototype' ? '当前需求尚无原型' : aiDesignDialog.type === 'doc' ? '当前需求尚无文档' : '当前需求尚未设计'}
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                  需求「{aiDesignDialog.req?.title}」还没有关联{aiDesignDialog.type === 'prototype' ? '原型' : aiDesignDialog.type === 'doc' ? '产品文档' : '设计文档或原型'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-6 py-4">
            <p className="text-sm text-muted-foreground">
              {aiDesignDialog.type === 'prototype'
                ? '是否让 AI 生成产品原型？AI 将根据需求描述自动生成交互原型页面。'
                : '是否让 AI 先生成产品文档？AI 将根据需求标题、描述以及空间上下文自动生成产品设计文档。'}
            </p>
          </div>

          <DialogFooter className="px-6 py-3.5 border-t border-border/50 bg-muted/30 flex justify-between">
            <Button
              variant="outline"
              onClick={() => setAiDesignDialog({ open: false, req: null })}
            >
              稍后再说
            </Button>
            <Button onClick={confirmAiDesign}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {aiDesignDialog.type === 'prototype' ? 'AI 生成原型' : 'AI 生成文档'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 分享成功后的权限配置对话框 */}
      <Dialog open={shareDialog.open} onOpenChange={open => setShareDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" />
              需求分享
            </DialogTitle>
            <DialogDescription>配置访客是否可以添加批注</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="allow-comments" className="text-sm">允许访客添加批注</Label>
                <p className="text-xs text-muted-foreground">关闭后访客仅可查看已有批注</p>
              </div>
              <Switch
                id="allow-comments"
                checked={shareDialog.allowComments}
                onCheckedChange={handleAllowCommentsChange}
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={shareDialog.share ? `${window.location.origin}/share/requirement/${shareDialog.share.token}` : ''}
                readOnly
                className="flex-1 text-xs"
              />
              <Button size="sm" className="h-9 gap-1 shrink-0" onClick={handleCopyShareLink}>
                <Copy className="h-3.5 w-3.5" />
                复制
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareDialog({ open: false, share: null, allowComments: true })}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 需求评审对话框 */}
      <Dialog
        open={reviewDialog.open}
        onOpenChange={open => {
          if (!open) {
            setReviewDialog({ open: false, step: 'review', req: null, share: null, selectedAssigneeId: '', processing: false });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-primary" />
              需求评审
            </DialogTitle>
            <DialogDescription>
              {reviewDialog.step === 'review'
                ? '确认需求文档与原型后进行评审'
                : '评审通过，请指定受理人'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {reviewDialog.processing && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!reviewDialog.processing && reviewDialog.step === 'review' && (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    value={reviewDialog.share ? `${window.location.origin}/share/requirement/${reviewDialog.share.token}` : ''}
                    readOnly
                    className="flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1 shrink-0"
                    onClick={() => {
                      if (!reviewDialog.share) return;
                      const url = `${window.location.origin}/share/requirement/${reviewDialog.share.token}`;
                      navigator.clipboard.writeText(url);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    复制
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => {
                    if (!reviewDialog.share) return;
                    window.open(`/share/requirement/${reviewDialog.share.token}`, '_blank');
                  }}
                >
                  <Eye className="h-4 w-4" />
                  打开分享页
                </Button>
              </>
            )}
            {!reviewDialog.processing && reviewDialog.step === 'assign' && (
              <div className="space-y-2">
                <Label htmlFor="review-assignee">选择受理人</Label>
                <Select
                  value={reviewDialog.selectedAssigneeId}
                  onValueChange={value => setReviewDialog(prev => ({ ...prev, selectedAssigneeId: value }))}
                >
                  <SelectTrigger id="review-assignee">
                    <SelectValue placeholder="请选择工作空间成员" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map(m => (
                      <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {reviewDialog.step === 'review' ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setReviewDialog({ open: false, step: 'review', req: null, share: null, selectedAssigneeId: '', processing: false })}
                >
                  取消
                </Button>
                <Button variant="destructive" className="gap-1" onClick={handleReviewReject} disabled={reviewDialog.processing}>
                  <XCircle className="h-4 w-4" />
                  评审不通过
                </Button>
                <Button className="gap-1" onClick={() => setReviewDialog(prev => ({ ...prev, step: 'assign' }))} disabled={reviewDialog.processing}>
                  <CheckCircle2 className="h-4 w-4" />
                  通过
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setReviewDialog(prev => ({ ...prev, step: 'review' }))}
                  disabled={reviewDialog.processing}
                >
                  返回
                </Button>
                <Button onClick={handleReviewPass} disabled={reviewDialog.processing || !reviewDialog.selectedAssigneeId}>
                  {reviewDialog.processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  确认受理
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 需求分配对话框 */}
      <Dialog
        open={assignDialog.open}
        onOpenChange={open => {
          if (!open) {
            setAssignDialog({ open: false, req: null, selectedAssigneeId: '', processing: false });
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              分配受理人
            </DialogTitle>
            <DialogDescription>为需求「{assignDialog.req?.title}」指定受理人</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="assign-assignee">选择受理人</Label>
              <Select
                value={assignDialog.selectedAssigneeId}
                onValueChange={value => setAssignDialog(prev => ({ ...prev, selectedAssigneeId: value }))}
              >
                <SelectTrigger id="assign-assignee">
                  <SelectValue placeholder="请选择工作空间成员" />
                </SelectTrigger>
                <SelectContent>
                  {members.map(m => (
                    <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignDialog({ open: false, req: null, selectedAssigneeId: '', processing: false })}
              disabled={assignDialog.processing}
            >
              取消
            </Button>
            <Button onClick={handleAssignConfirm} disabled={assignDialog.processing || !assignDialog.selectedAssigneeId}>
              {assignDialog.processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              确认分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 文档模式
// ─────────────────────────────────────────────────────────────────────────────

const DocMode: React.FC<{ focusDocId?: string | null }> = ({ focusDocId }) => {
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
  // 分享批注：仅已定稿文档加载，面板可展开/收起
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

  // 需求关联跳转：focusDocId 变化时加载对应文档并选中
  useEffect(() => {
    if (!focusDocId || !workspaceId) return;
    const existing = docs.find(d => d.id === focusDocId);
    if (existing) {
      setSelectedDocId(focusDocId);
      setIsCreating(false);
      return;
    }
    // 文档不在列表中时单独拉取后插入列表并选中
    productDocApi.get(workspaceId, focusDocId)
      .then(doc => {
        setDocs(prev => prev.some(d => d.id === doc.id) ? prev : [doc, ...prev]);
        setSelectedDocId(doc.id);
        setIsCreating(false);
      })
      .catch(() => toast.error('加载关联文档失败'));
  }, [focusDocId, workspaceId]);

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

  // 加载分享批注：仅已定稿文档有分享入口，切换文档时重置面板
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

  // 移动文档到指定目录；folderId 为空字符串表示移回根目录
  const handleMoveDoc = async (docId: string, folderId: string) => {
    if (!workspaceId) return;
    try {
      const updated = await productDocApi.update(workspaceId, docId, { folderId });
      setDocs(prev => prev.map(d => (d.id === docId ? updated : d)));
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
    } catch {
      toast.error('操作失败');
    }
  };

  const confirmDeleteFolder = async () => {
    if (!workspaceId || !folderToDelete) return;
    try {
      await productDocApi.deleteFolder(workspaceId, folderToDelete.id);
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
      } else if (selectedDocId) {
        const doc = await productDocApi.update(workspaceId, selectedDocId, {
          title: title.trim(),
          content,
        });
        setDocs(prev => prev.map(d => (d.id === doc.id ? doc : d)));
        setLastSavedAt(new Date());
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
    } catch {
      toast.error('发布失败');
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
          onDelete={() => setDocToDelete(doc)}
        />
      </div>
    </div>
  );

  const folderRowHandlers: FolderRowHandlers = {
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
    <div className="h-full flex flex-col rounded-xl border border-border/50 overflow-hidden">
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
                {/* 分享批注面板开关：仅已定稿文档可见，角标显示未解决数 */}
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
                <MarkdownEditor
                  value={content}
                  onChange={setContent}
                  lastSavedAt={lastSavedAt}
                  allowComments={!isCreating && selectedDoc?.status === 'published'}
                  onAddComment={async ({ quote, content: commentContent }) => {
                    if (!workspaceId || !selectedDocId) return;
                    await productDocApi.addDocShareComment(workspaceId, selectedDocId, {
                      authorName: '',
                      quoteText: quote,
                      content: commentContent,
                    });

                    const list = await productDocApi.listDocShareComments(workspaceId, selectedDocId);
                    setShareComments(list ?? []);
                  }}
                />
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
            <p>请在左侧选择需求查看关联文档</p>
          </div>
        )}

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
    </div>
  );
};
