import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import ReactDiffViewer from 'react-diff-viewer-continued';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Folder,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { downloadTextFile } from '@/lib/file-download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  productDocApi,
  type DocStatus,
  type ProductDoc,
  type ProductDocFolder,
  type ProductDocVersion,
  type WorkspaceVersionItem,
} from '@/lib/productdoc-api';
import { useAuth } from '@/contexts/AuthContext';
import { PLATFORM_ROLE, SPACE_ROLE } from '@/lib/role-constants';
import { STATUS_LABEL, STATUS_VARIANT } from './doc-status';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────────────────────

/** 快捷时间选项：days 表示从今天向前回溯的天数；month 表示本月 */
const QUICK_TIME_OPTIONS: { key: string; label: string; days?: number; month?: boolean }[] = [
  { key: 'today', label: '今天', days: 0 },
  { key: '3d', label: '最近3天', days: 2 },
  { key: '7d', label: '最近7天', days: 6 },
  { key: '15d', label: '最近15天', days: 14 },
  { key: '30d', label: '最近30天', days: 29 },
  { key: 'month', label: '本月', month: true },
];

/** 自定义时间区间的特殊选项 key */
const CUSTOM_TIME_KEY = 'custom';

/** 自定义时间区间最大查询跨度（天），与后端 maxVersionQuerySpanDays 保持一致 */
const MAX_QUERY_SPAN_DAYS = 90;

/** 分页每页条数选项 */
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;

/** 文档状态筛选选项（不含 archived：归档文档版本价值低，设计稿仅区分已发布/草稿） */
const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
];

const ALL_OPERATORS_VALUE = 'all';

/** 关键词输入防抖间隔（毫秒） */
const KEYWORD_DEBOUNCE_MS = 300;

/** 分页器最多展示的页码按钮数 */
const MAX_PAGE_BUTTONS = 5;

/** 版本备注最大长度，与后端 maxChangeSummaryLength 保持一致 */
const MAX_SUMMARY_LENGTH = 500;

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────

/** 格式化为日期输入框需要的 YYYY-MM-DD */
const formatDateInput = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** 根据快捷选项计算起止日期（闭区间，结束日期为今天） */
const computeQuickRange = (key: string): { start: string; end: string } => {
  const end = new Date();
  const opt = QUICK_TIME_OPTIONS.find(o => o.key === key);
  if (opt?.month) {
    return { start: formatDateInput(new Date(end.getFullYear(), end.getMonth(), 1)), end: formatDateInput(end) };
  }
  const days = opt?.days ?? 6;
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: formatDateInput(start), end: formatDateInput(end) };
};

/** 校验自定义区间：结束不早于开始，且跨度不超过 MAX_QUERY_SPAN_DAYS */
const validateCustomRange = (start: string, end: string): string | null => {
  if (!start || !end) return '请选择完整的起止日期';
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (e < s) return '结束日期不能早于开始日期';
  const spanDays = (e - s) / (24 * 60 * 60 * 1000);
  if (spanDays > MAX_QUERY_SPAN_DAYS) return `最大查询跨度为 ${MAX_QUERY_SPAN_DAYS} 天`;
  return null;
};


/** 文件名安全化：替换文件系统非法字符 */
const sanitizeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, '_');

/** 生成版本导出的文件名 */
const buildVersionFileName = (docTitle: string, version: number): string =>
  `${sanitizeFileName(docTitle)}-v${version}.md`;

/** 操作人展示：优先后端解析的姓名，其次当前用户姓名，最后截断用户 ID */
const formatOperator = (
  createdBy: string,
  createdByName?: string,
  currentUser?: { id: string; name?: string; email?: string } | null
): string => {
  if (!createdBy) return '-';
  if (createdByName) return createdByName;
  if (currentUser && createdBy === currentUser.id) return currentUser.name || currentUser.email || createdBy;
  return createdBy.length > 12 ? `${createdBy.slice(0, 8)}…` : createdBy;
};

/** 计算分页器页码窗口（以当前页为中心，最多 MAX_PAGE_BUTTONS 个） */
const computePageWindow = (page: number, totalPages: number): number[] => {
  const half = Math.floor(MAX_PAGE_BUTTONS / 2);
  const start = Math.max(1, Math.min(page - half, totalPages - MAX_PAGE_BUTTONS + 1));
  const end = Math.min(totalPages, start + MAX_PAGE_BUTTONS - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
};

// ─────────────────────────────────────────────────────────────────────────────
// 文档筛选弹窗（Popover 内嵌目录树多选）
// ─────────────────────────────────────────────────────────────────────────────

interface DocFilterPopoverProps {
  docs: ProductDoc[];
  folders: ProductDocFolder[];
  selectedIds: string[];
  onApply: (ids: string[]) => void;
}

const DocFilterPopover: React.FC<DocFilterPopoverProps> = ({ docs, folders, selectedIds, onApply }) => {
  const [open, setOpen] = useState(false);
  // 弹窗内的待确认选择，点击「确定」后才同步到外部（取消可丢弃）
  const [pendingIds, setPendingIds] = useState<string[]>(selectedIds);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setPendingIds(selectedIds);
  }, [open, selectedIds]);

  const keyword = search.trim().toLowerCase();
  const visibleDocs = useMemo(
    () => (keyword ? docs.filter(d => d.title.toLowerCase().includes(keyword)) : docs),
    [docs, keyword]
  );

  const togglePending = (docId: string, checked: boolean) => {
    setPendingIds(prev => (checked ? [...prev, docId] : prev.filter(id => id !== docId)));
  };

  const triggerLabel =
    selectedIds.length === 0
      ? '全部文档'
      : selectedIds.length === 1
        ? docs.find(d => d.id === selectedIds[0])?.title ?? '已选1个文档'
        : `已选${selectedIds.length}个文档`;

  const renderDocCheckItem = (doc: ProductDoc) => (
    <label
      key={doc.id}
      className="flex items-center gap-2 py-1.5 px-1 rounded-md hover:bg-muted/50 cursor-pointer"
    >
      <Checkbox
        checked={pendingIds.includes(doc.id)}
        onCheckedChange={checked => togglePending(doc.id, !!checked)}
      />
      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0', STATUS_VARIANT[doc.status])}>
        {STATUS_LABEL[doc.status]}
      </Badge>
      <span className="text-sm truncate">{doc.title}</span>
    </label>
  );

  const renderFolderGroup = (folder: ProductDocFolder) => {
    const folderDocs = visibleDocs.filter(d => d.folderId === folder.id);
    if (keyword && folderDocs.length === 0) return null;
    const isCollapsed = collapsed.has(folder.id);
    return (
      <div key={folder.id} className="mb-1">
        <button
          className="flex items-center gap-1.5 py-1.5 w-full text-left hover:bg-muted/50 rounded-md px-1"
          onClick={() =>
            setCollapsed(prev => {
              const next = new Set(prev);
              if (next.has(folder.id)) next.delete(folder.id);
              else next.add(folder.id);
              return next;
            })
          }
        >
          <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isCollapsed && '-rotate-90')} />
          <Folder className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-sm">{folder.name}</span>
        </button>
        {!isCollapsed && <div className="pl-5">{folderDocs.map(renderDocCheckItem)}</div>}
      </div>
    );
  };

  // 根目录文档（folderId 为空或指向已删除目录）
  const folderIds = new Set(folders.map(f => f.id));
  const rootDocs = visibleDocs.filter(d => !d.folderId || !folderIds.has(d.folderId));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="min-w-[180px] justify-between font-normal">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-0">
        <div className="p-3 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索文档..."
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
        <div className="px-3 pt-2 flex justify-between text-xs text-muted-foreground">
          <button className="hover:text-primary" onClick={() => setPendingIds(visibleDocs.map(d => d.id))}>
            全选
          </button>
          <button className="hover:text-primary" onClick={() => setPendingIds([])}>
            清空
          </button>
        </div>
        <ScrollArea className="max-h-[320px] px-2 py-1">
          {folders.map(renderFolderGroup)}
          {rootDocs.length > 0 && (
            <div className="pl-1">
              {folders.length > 0 && <p className="text-xs text-muted-foreground px-1 py-1">未分组</p>}
              {rootDocs.map(renderDocCheckItem)}
            </div>
          )}
          {visibleDocs.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">无匹配文档</p>
          )}
        </ScrollArea>
        <div className="p-3 border-t border-border/50 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onApply(pendingIds);
              setOpen(false);
            }}
          >
            确定
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 自定义时间区间弹窗
// ─────────────────────────────────────────────────────────────────────────────

interface CustomTimeDialogProps {
  open: boolean;
  initialRange: { start: string; end: string };
  onOpenChange: (open: boolean) => void;
  onApply: (range: { start: string; end: string }) => void;
}

const CustomTimeDialog: React.FC<CustomTimeDialogProps> = ({ open, initialRange, onOpenChange, onApply }) => {
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStart(initialRange.start);
      setEnd(initialRange.end);
      setError(null);
    }
  }, [open, initialRange]);

  const handleConfirm = () => {
    const err = validateCustomRange(start, end);
    if (err) {
      setError(err);
      return;
    }
    onApply({ start, end });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>自定义时间区间</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm text-muted-foreground block mb-2">开始日期</label>
            <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-sm text-muted-foreground block mb-2">结束日期</label>
            <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          {QUICK_TIME_OPTIONS.filter(o => ['today', '7d', '30d'].includes(o.key)).map(o => (
            <Button
              key={o.key}
              variant="secondary"
              size="sm"
              onClick={() => {
                const range = computeQuickRange(o.key);
                setStart(range.start);
                setEnd(range.end);
              }}
            >
              {o.key === 'today' ? '今天' : o.key === '7d' ? '近7天' : '近30天'}
            </Button>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm}>确定</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 备注双态编辑器（列表行内 / 详情弹窗共用）：查看态铅笔 → 编辑态对勾+叉号
// 交互：回车保存、ESC 取消并回退原值（规则6：两处复用，统一封装）
// ─────────────────────────────────────────────────────────────────────────────

interface RemarkEditorProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  /** compact 用于表格行内：只读态文本截断展示 */
  compact?: boolean;
}

const RemarkEditor: React.FC<RemarkEditorProps> = ({ value, onSave, compact }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={draft}
          maxLength={MAX_SUMMARY_LENGTH}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          placeholder="填写版本备注，如：里程碑版本"
          className={cn('h-8 text-sm', compact ? 'min-w-[180px]' : 'flex-1')}
        />
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50 transition shrink-0 disabled:opacity-50"
          title="保存"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 transition shrink-0"
          title="取消"
          onClick={handleCancel}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-1 group/remark', compact ? 'max-w-[260px]' : 'justify-between')}>
      <span
        className={cn(
          'text-sm',
          compact ? 'truncate text-muted-foreground' : 'flex-1 px-4 py-2.5 rounded-xl bg-muted/40 text-foreground'
        )}
      >
        {value || '无备注'}
      </span>
      <button
        className={cn(
          'w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition shrink-0',
          compact && 'opacity-0 group-hover/remark:opacity-100'
        )}
        title="编辑备注"
        onClick={() => setEditing(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 回滚确认弹窗：可指定目标版本（默认当前版本的上一个版本）
// 文档仅有一个版本时提示「当前是唯一的版本，不能进行回滚」并禁用确认
// ─────────────────────────────────────────────────────────────────────────────

interface RollbackDialogProps {
  item: WorkspaceVersionItem | null;
  workspaceId: string;
  /** 指定默认回滚目标版本（详情弹窗「回滚到此版本」入口传入） */
  defaultTargetVersion?: number;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

const RollbackDialog: React.FC<RollbackDialogProps> = ({
  item,
  workspaceId,
  defaultTargetVersion,
  onOpenChange,
  onDone,
}) => {
  const [versions, setVersions] = useState<ProductDocVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetVersion, setTargetVersion] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item || !workspaceId) return;
    setLoading(true);
    productDocApi
      .versions(workspaceId, item.docId)
      .then(data => {
        setVersions(data);
        // 默认目标：指定值优先；否则取「当前最新版本的上一个版本」
        // （data 按版本号倒序，data[0] 为最新）
        if (defaultTargetVersion && data.some(v => v.version === defaultTargetVersion)) {
          setTargetVersion(defaultTargetVersion);
        } else {
          setTargetVersion(data[1]?.version ?? data[0]?.version ?? null);
        }
      })
      .catch(() => toast.error('加载版本列表失败'))
      .finally(() => setLoading(false));
  }, [item, workspaceId, defaultTargetVersion]);

  const isUniqueVersion = versions.length <= 1;

  const handleConfirm = async () => {
    if (!item || targetVersion == null) return;
    setSubmitting(true);
    try {
      await productDocApi.restoreVersion(workspaceId, item.docId, targetVersion);
      toast.success(`「${item.docTitle}」已回滚到 V${targetVersion}，并生成新版本`);
      onOpenChange(false);
      onDone();
    } catch {
      toast.error('版本回滚失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>确认回滚版本</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isUniqueVersion ? (
          <div className="flex items-start gap-3 py-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              文档「{item?.docTitle}」当前是唯一的版本，不能进行回滚。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground">
                回滚后将自动生成新的版本，原有历史版本会完整保留，不会被覆盖。回滚操作将被记录审计日志。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                将「{item?.docTitle}」回滚到：
              </span>
              <Select
                value={targetVersion != null ? String(targetVersion) : undefined}
                onValueChange={v => setTargetVersion(Number(v))}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="选择版本" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map(v => (
                    <SelectItem key={v.id} value={String(v.version)}>
                      V{v.version}（{v.changeSummary || '无备注'}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          {!isUniqueVersion && (
            <Button variant="destructive" disabled={submitting || targetVersion == null} onClick={handleConfirm}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              确认回滚
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 版本详情弹窗（基础信息 + 任意两版本 Diff 对比 + 备注编辑 + 导出/回滚）
// ─────────────────────────────────────────────────────────────────────────────

/** Diff 配色：对齐设计稿的红色删除 / 绿色新增规范（浅底深字，不刺眼） */
const DIFF_VIEWER_STYLES = {
  variables: {
    light: {
      diffViewerBackground: '#ffffff',
      addedBackground: '#dcfce7',
      addedColor: '#166534',
      removedBackground: '#fee2e2',
      removedColor: '#991b1b',
      wordAddedBackground: '#bbf7d0',
      wordRemovedBackground: '#fecaca',
      addedGutterBackground: '#dcfce7',
      removedGutterBackground: '#fee2e2',
      gutterBackground: '#f9fafb',
      gutterBackgroundDark: '#f3f4f6',
      gutterColor: '#94a3b8',
      codeFoldBackground: '#f9fafb',
      emptyLineBackground: '#ffffff',
    },
  },
};

interface VersionDetailDialogProps {
  item: WorkspaceVersionItem | null;
  workspaceId: string;
  canRollback: boolean;
  onOpenChange: (open: boolean) => void;
  /** 请求回滚指定版本（由外层弹出二次确认） */
  onRequestRollback: (item: WorkspaceVersionItem) => void;
  /** 备注或版本数据变化后通知外层刷新列表 */
  onChanged: () => void;
}

const VersionDetailDialog: React.FC<VersionDetailDialogProps> = ({
  item,
  workspaceId,
  canRollback,
  onOpenChange,
  onRequestRollback,
  onChanged,
}) => {
  const { user: currentUser } = useAuth();
  const [versions, setVersions] = useState<ProductDocVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [baseVersionNo, setBaseVersionNo] = useState<number | null>(null);
  const [targetVersionNo, setTargetVersionNo] = useState<number | null>(null);

  const docId = item?.docId ?? '';

  useEffect(() => {
    if (!item || !workspaceId) return;
    setLoading(true);
    productDocApi
      .versions(workspaceId, item.docId)
      .then(data => {
        setVersions(data);
        // 默认对比：上一版本 → 当前选中版本（无上一版本时与自身对比）
        setTargetVersionNo(item.version);
        const prev = data.find(v => v.version === item.version - 1);
        setBaseVersionNo(prev ? prev.version : item.version);
      })
      .catch(() => toast.error('加载版本详情失败'))
      .finally(() => setLoading(false));
  }, [item, workspaceId]);

  const baseVersion = versions.find(v => v.version === baseVersionNo) ?? null;
  const targetVersion = versions.find(v => v.version === targetVersionNo) ?? null;
  // 唯一版本：无对比对象，也不允许回滚（回滚即恒等操作）
  const isUniqueVersion = versions.length <= 1;

  const handleSaveSummary = async (newSummary: string) => {
    if (!item) return;
    try {
      await productDocApi.updateVersionSummary(workspaceId, docId, item.version, newSummary);
      setVersions(prev => prev.map(v => (v.version === item.version ? { ...v, changeSummary: newSummary } : v)));
      toast.success('版本备注已更新');
      onChanged();
    } catch {
      toast.error('更新版本备注失败');
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(980px,95vw)] max-h-[88vh] flex flex-col rounded-2xl p-0 gap-0 overflow-hidden">
        {/* 头部：标题 + 元信息 */}
        <DialogHeader className="px-7 py-5 border-b border-border/50">
          <DialogTitle className="text-xl tracking-tight">{item?.docTitle}</DialogTitle>
          {item && (
            <p className="text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
              <span>
                当前版本：<span className="text-foreground font-medium">V{item.version}</span>
              </span>
              <span>
                操作人：<span className="font-mono text-foreground">{formatOperator(item.createdBy, item.createdByName, currentUser)}</span>
              </span>
              <span>
                修改时间：<span className="text-foreground">{new Date(item.createdAt).toLocaleString()}</span>
              </span>
            </p>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="px-7 py-6 space-y-7">
              {/* 版本备注：查看/编辑双态 */}
              <section>
                <label className="text-sm font-medium block mb-2">版本备注</label>
                <RemarkEditor value={item?.changeSummary ?? ''} onSave={handleSaveSummary} />
              </section>

              {/* Diff 对比区块 */}
              <section>
                <div className="flex items-center justify-between mb-3.5 flex-wrap gap-2">
                  <h3 className="text-sm font-medium">内容变更对比</h3>
                  {!isUniqueVersion && (
                    <div className="flex items-center gap-2.5 text-sm">
                      <span className="text-muted-foreground">对比版本：</span>
                      <Select
                        value={baseVersionNo != null ? String(baseVersionNo) : undefined}
                        onValueChange={v => setBaseVersionNo(Number(v))}
                      >
                        <SelectTrigger className="w-[110px] h-9">
                          <SelectValue placeholder="基准版本" />
                        </SelectTrigger>
                        <SelectContent>
                          {versions.map(v => (
                            <SelectItem key={v.id} value={String(v.version)}>
                              V{v.version}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">→</span>
                      <Select
                        value={targetVersionNo != null ? String(targetVersionNo) : undefined}
                        onValueChange={v => setTargetVersionNo(Number(v))}
                      >
                        <SelectTrigger className="w-[110px] h-9">
                          <SelectValue placeholder="目标版本" />
                        </SelectTrigger>
                        <SelectContent>
                          {versions.map(v => (
                            <SelectItem key={v.id} value={String(v.version)}>
                              V{v.version}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {isUniqueVersion ? (
                  <div className="border border-border/50 rounded-xl py-12 flex flex-col items-center text-muted-foreground">
                    <FileText className="h-8 w-8 mb-3 opacity-40" />
                    <p className="text-sm">当前是唯一的版本，暂无内容对比</p>
                  </div>
                ) : baseVersion && targetVersion ? (
                  <div className="border border-border/50 rounded-xl overflow-hidden shadow-sm [&_td]:text-sm [&_pre]:font-mono">
                    <ReactDiffViewer
                      oldValue={baseVersion.content}
                      newValue={targetVersion.content}
                      splitView
                      showDiffOnly={false}
                      leftTitle={`V${baseVersion.version}（旧版本）`}
                      rightTitle={`V${targetVersion.version}（当前版本）`}
                      styles={DIFF_VIEWER_STYLES}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">暂无可对比的版本内容</p>
                )}

                {!isUniqueVersion && (
                  <div className="flex gap-6 mt-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 rounded bg-[#fee2e2] border border-[#fecaca]" />
                      红色 = 删除内容
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 rounded bg-[#dcfce7] border border-[#bbf7d0]" />
                      绿色 = 新增内容
                    </span>
                  </div>
                )}
              </section>
            </div>
          </ScrollArea>
        )}

        {/* 底部操作区 */}
        <div className="px-7 py-4 border-t border-border/50 bg-muted/30 flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {targetVersion && (
            <Button
              variant="outline"
              onClick={() =>
                downloadTextFile(
                  buildVersionFileName(item?.docTitle ?? 'document', targetVersion.version),
                  targetVersion.content
                )
              }
            >
              <Download className="h-4 w-4 mr-1.5" />
              导出该版本
            </Button>
          )}
          {item && canRollback && !isUniqueVersion && (
            <Button variant="destructive" onClick={() => onRequestRollback(item)}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              回滚到此版本
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 版本历史模式（主组件）
// ─────────────────────────────────────────────────────────────────────────────

export const VersionHistoryMode: React.FC = () => {
  const { user, membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  // 权限：管理员（空间管理员/平台超管）可删除；文档所有者或管理员可回滚
  const isAdmin =
    user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN || membership?.spaceRole === SPACE_ROLE.SPACE_ADMIN;

  // ── 筛选条件 ──
  const [timeKey, setTimeKey] = useState('7d');
  const [timeRange, setTimeRange] = useState(() => computeQuickRange('7d'));
  const [customTimeOpen, setCustomTimeOpen] = useState(false);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [operatorFilter, setOperatorFilter] = useState(ALL_OPERATORS_VALUE);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');

  // ── 列表数据 ──
  const [items, setItems] = useState<WorkspaceVersionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(false);

  // ── 文档/目录（用于文档筛选弹窗与文档所有者判定） ──
  const [docs, setDocs] = useState<ProductDoc[]>([]);
  const [folders, setFolders] = useState<ProductDocFolder[]>([]);

  // ── 行选择（批量导出/删除） ──
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // ── 弹窗状态 ──
  const [detailItem, setDetailItem] = useState<WorkspaceVersionItem | null>(null);
  const [rollbackItem, setRollbackItem] = useState<WorkspaceVersionItem | null>(null);
  /** 回滚弹窗的默认目标版本：详情弹窗「回滚到此版本」入口指定，列表入口不指定（默认上一版本） */
  const [rollbackDefaultVersion, setRollbackDefaultVersion] = useState<number | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceVersionItem[] | null>(null);
  const [operating, setOperating] = useState(false);

  // 关键词防抖：输入停止 KEYWORD_DEBOUNCE_MS 后才应用，避免每次按键都请求
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setKeyword(keywordInput.trim());
      setPage(1);
    }, KEYWORD_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [keywordInput]);

  useEffect(() => {
    if (!workspaceId) return;
    productDocApi.list(workspaceId).then(setDocs).catch(() => toast.error('加载文档列表失败'));
    productDocApi.listFolders(workspaceId).then(setFolders).catch(() => {});
  }, [workspaceId]);

  const fetchVersions = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    productDocApi
      .listWorkspaceVersions(workspaceId, {
        start: timeRange.start,
        end: timeRange.end,
        docIds: docIds.length > 0 ? docIds : undefined,
        status: statusFilter === 'all' ? undefined : (statusFilter as DocStatus),
        createdBy: operatorFilter === ALL_OPERATORS_VALUE ? undefined : operatorFilter,
        keyword: keyword || undefined,
        page,
        pageSize,
      })
      .then(data => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => toast.error('加载版本列表失败'))
      .finally(() => setLoading(false));
  }, [workspaceId, timeRange, docIds, statusFilter, operatorFilter, keyword, page, pageSize]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  // 操作人筛选项：从当前结果集去重，展示后端解析的姓名（缺失时回退为 ID）
  const operatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(i => {
      if (i.createdBy) map.set(i.createdBy, i.createdByName || i.createdBy);
    });
    return Array.from(map.entries());
  }, [items]);

  const docOwnerMap = useMemo(() => new Map(docs.map(d => [d.id, d.createdBy])), [docs]);

  /** 回滚权限：管理员或文档所有者 */
  const canRollbackItem = useCallback(
    (item: WorkspaceVersionItem) => isAdmin || (!!user && docOwnerMap.get(item.docId) === user.id),
    [isAdmin, user, docOwnerMap]
  );

  // 排序：服务端默认按修改时间倒序，表头切换时客户端反转即可（当前页内）
  const displayItems = useMemo(() => (sortAsc ? [...items].reverse() : items), [items, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const noFilterActive =
    timeKey === '7d' &&
    docIds.length === 0 &&
    statusFilter === 'all' &&
    operatorFilter === ALL_OPERATORS_VALUE &&
    !keyword;

  /** 切换任意筛选条件时统一重置到第一页 */
  const resetPageAnd = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const handleTimeChange = (value: string) => {
    if (value === CUSTOM_TIME_KEY) {
      setCustomTimeOpen(true);
      return;
    }
    resetPageAnd(() => {
      setTimeKey(value);
      setTimeRange(computeQuickRange(value));
    });
  };

  const handleCustomTimeApply = (range: { start: string; end: string }) => {
    resetPageAnd(() => {
      setTimeKey(CUSTOM_TIME_KEY);
      setTimeRange(range);
    });
  };

  const timeButtonLabel =
    timeKey === CUSTOM_TIME_KEY
      ? `${timeRange.start} ~ ${timeRange.end}`
      : QUICK_TIME_OPTIONS.find(o => o.key === timeKey)?.label ?? '最近7天';

  // ── 行选择 ──
  const toggleCheck = (id: string, checked: boolean) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const allChecked = displayItems.length > 0 && displayItems.every(i => checkedIds.has(i.id));
  const toggleCheckAll = (checked: boolean) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      displayItems.forEach(i => (checked ? next.add(i.id) : next.delete(i.id)));
      return next;
    });
  };

  const checkedItems = items.filter(i => checkedIds.has(i.id));

  // ── 批量导出：将选中版本打包为 zip（文件名：文档名-vN.md） ──
  const handleBatchExport = async () => {
    if (checkedItems.length === 0) return;
    setOperating(true);
    try {
      const zip = new JSZip();
      checkedItems.forEach(i => zip.file(buildVersionFileName(i.docTitle, i.version), i.content));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `版本导出-${formatDateInput(new Date())}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${checkedItems.length} 个版本`);
    } catch {
      toast.error('批量导出失败');
    } finally {
      setOperating(false);
    }
  };

  // ── 行内备注编辑：保存成功后局部更新列表项，避免整表刷新 ──
  const handleSaveRowSummary = async (item: WorkspaceVersionItem, newSummary: string) => {
    try {
      await productDocApi.updateVersionSummary(workspaceId, item.docId, item.version, newSummary);
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, changeSummary: newSummary } : i)));
      toast.success('版本备注已更新');
    } catch {
      toast.error('更新版本备注失败');
    }
  };

  // ── 删除（仅管理员）：单个或批量 ──
  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteTarget.length === 0) return;
    setOperating(true);
    // 逐个调用删除接口，统计成败（后端保证每个文档至少保留一个版本）
    const results = await Promise.allSettled(
      deleteTarget.map(i => productDocApi.deleteVersion(workspaceId, i.docId, i.version))
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed === 0) toast.success(`已删除 ${deleteTarget.length} 个版本`);
    else toast.warning(`删除完成：成功 ${deleteTarget.length - failed} 个，失败 ${failed} 个（仅剩一个版本的文档不可删除）`);
    setDeleteTarget(null);
    setCheckedIds(new Set());
    setOperating(false);
    fetchVersions();
  };

  // ── 渲染：空态 ──
  const renderEmpty = () => (
    <div className="h-full min-h-[360px] flex flex-col justify-center items-center text-muted-foreground">
      <FileText className="h-12 w-12 mb-4 opacity-40" />
      {noFilterActive ? (
        <>
          <p className="text-base">当前工作空间暂无版本记录</p>
          <p className="text-sm mt-2">文档发布后，版本快照将自动记录在这里</p>
        </>
      ) : (
        <>
          <p className="text-base">当前筛选条件下无版本变更记录</p>
          <p className="text-sm mt-2">可调整时间范围，或重新选择需要查看的文档</p>
        </>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-hidden">
      {/* 顶部筛选栏：按使用频率排布 时间 > 文档 > 状态 > 操作人 > 关键词 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 shrink-0 bg-background border border-border/50 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0 inline-block min-w-[2.75rem]">时间：</span>
          <Select value={timeKey} onValueChange={handleTimeChange}>
            <SelectTrigger className="min-w-[170px]">
              <SelectValue>{timeButtonLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {QUICK_TIME_OPTIONS.map(o => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_TIME_KEY}>自定义日期区间</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0 inline-block min-w-[2.75rem]">文档：</span>
          <DocFilterPopover
            docs={docs}
            folders={folders}
            selectedIds={docIds}
            onApply={ids => resetPageAnd(() => setDocIds(ids))}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0 inline-block min-w-[2.75rem]">状态：</span>
          <Select value={statusFilter} onValueChange={v => resetPageAnd(() => setStatusFilter(v))}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0 inline-block min-w-[3.5rem]">操作人：</span>
          <Select value={operatorFilter} onValueChange={v => resetPageAnd(() => setOperatorFilter(v))}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OPERATORS_VALUE}>全部</SelectItem>
              {operatorOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={keywordInput}
            onChange={e => setKeywordInput(e.target.value)}
            placeholder="搜索文档名称/版本备注"
            className="pl-8 w-[240px]"
          />
        </div>
      </div>

      {/* 批量操作条（有勾选时显示） */}
      {checkedIds.size > 0 && (
        <div className="flex items-center gap-3 shrink-0 px-2">
          <span className="text-sm text-muted-foreground">已选 {checkedIds.size} 项</span>
          <Button variant="outline" size="sm" disabled={operating} onClick={handleBatchExport}>
            <Download className="h-4 w-4 mr-1" />
            批量导出
          </Button>
          {isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              disabled={operating}
              onClick={() => setDeleteTarget(checkedItems)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              批量删除
            </Button>
          )}
        </div>
      )}

      {/* 版本列表 */}
      <div className="flex-1 overflow-hidden flex flex-col bg-background border border-border/50 rounded-xl">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : displayItems.length === 0 ? (
          renderEmpty()
        ) : (
          <>
            <ScrollArea className="flex-1">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0 z-10">
                  <tr className="border-b border-border/50">
                    <th className="w-10 p-3 text-left">
                      <Checkbox checked={allChecked} onCheckedChange={checked => toggleCheckAll(!!checked)} />
                    </th>
                    <th className="p-3 text-left font-normal text-muted-foreground">文档名称</th>
                    <th className="p-3 text-left font-normal text-muted-foreground">状态</th>
                    <th className="p-3 text-left font-normal text-muted-foreground">版本号</th>
                    <th
                      className="p-3 text-left font-normal text-muted-foreground cursor-pointer hover:text-primary select-none"
                      onClick={() => setSortAsc(prev => !prev)}
                    >
                      修改时间 {sortAsc ? '↑' : '↓'}
                    </th>
                    <th className="p-3 text-left font-normal text-muted-foreground">操作人</th>
                    <th className="p-3 text-left font-normal text-muted-foreground">版本备注</th>
                    <th className="p-3 text-left font-normal text-muted-foreground">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map(item => (
                    <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <Checkbox
                          checked={checkedIds.has(item.id)}
                          onCheckedChange={checked => toggleCheck(item.id, !!checked)}
                        />
                      </td>
                      <td className="p-3 font-medium">{item.docTitle}</td>
                      <td className="p-3">
                        <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0', STATUS_VARIANT[item.docStatus])}>
                          {STATUS_LABEL[item.docStatus]}
                        </Badge>
                      </td>
                      <td className="p-3">V{item.version}</td>
                      <td className="p-3 text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</td>
                      <td className="p-3" title={item.createdBy}>{formatOperator(item.createdBy, item.createdByName, user)}</td>
                      <td className="p-3">
                        <RemarkEditor
                          compact
                          value={item.changeSummary}
                          onSave={newSummary => handleSaveRowSummary(item, newSummary)}
                        />
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <button className="text-primary hover:underline mr-3" onClick={() => setDetailItem(item)}>
                          查看详情
                        </button>
                        {canRollbackItem(item) && (
                          <button
                            className="text-destructive hover:underline mr-3"
                            onClick={() => {
                              // 列表入口：不指定目标版本，弹窗默认选中当前版本的上一个
                              setRollbackDefaultVersion(undefined);
                              setRollbackItem(item);
                            }}
                          >
                            回滚
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            className="text-muted-foreground hover:text-destructive"
                            title="删除版本"
                            onClick={() => setDeleteTarget([item])}
                          >
                            <Trash2 className="h-4 w-4 inline" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {/* 分页 */}
            <div className="shrink-0 p-3 flex justify-between items-center border-t border-border/50 flex-wrap gap-2">
              <span className="text-sm text-muted-foreground">
                共 {total} 条记录，第 {page}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Select
                  value={String(pageSize)}
                  onValueChange={v => resetPageAnd(() => setPageSize(Number(v)))}
                >
                  <SelectTrigger className="w-[110px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map(s => (
                      <SelectItem key={s} value={String(s)}>
                        {s} 条/页
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {computePageWindow(page, totalPages).map(p => (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 自定义时间区间弹窗 */}
      <CustomTimeDialog
        open={customTimeOpen}
        initialRange={timeRange}
        onOpenChange={setCustomTimeOpen}
        onApply={handleCustomTimeApply}
      />

      {/* 版本详情弹窗 */}
      <VersionDetailDialog
        item={detailItem}
        workspaceId={workspaceId}
        canRollback={detailItem ? canRollbackItem(detailItem) : false}
        onOpenChange={open => !open && setDetailItem(null)}
        onRequestRollback={item => {
          // 详情弹窗入口：默认回滚目标为当前查看的版本
          setRollbackDefaultVersion(item.version);
          setRollbackItem(item);
        }}
        onChanged={fetchVersions}
      />

      {/* 回滚确认弹窗：可指定目标版本，唯一版本时禁止回滚 */}
      <RollbackDialog
        item={rollbackItem}
        workspaceId={workspaceId}
        defaultTargetVersion={rollbackDefaultVersion}
        onOpenChange={open => {
          if (!open) {
            setRollbackItem(null);
            setRollbackDefaultVersion(undefined);
          }
        }}
        onDone={() => {
          setDetailItem(null);
          fetchVersions();
        }}
      />

      {/* 删除二次确认（仅管理员，强二次确认） */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除版本</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && deleteTarget.length === 1
                ? `确定要删除「${deleteTarget[0].docTitle}」的 V${deleteTarget[0].version} 吗？`
                : `确定要删除选中的 ${deleteTarget?.length ?? 0} 个版本吗？`}
              <br />
              删除后不可恢复，操作将被记录审计日志。（每个文档至少保留一个版本）
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={operating}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={operating}
              onClick={handleConfirmDelete}
            >
              {operating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
