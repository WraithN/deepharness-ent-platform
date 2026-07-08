import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { FileText, LayoutGrid, Eye, History, Plus, Search, Trash2, Save, Loader2, Send, Clock, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { KanbanWorkspace } from './KanbanWorkspace';
import { PrototypeWorkspace } from './PrototypeWorkspace';
import { productDocApi, type ProductDoc, type ProductDocVersion } from '@/lib/productdoc-api';
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
import { cn } from '@/lib/utils';
import ReactDiffViewer from 'react-diff-viewer-continued';

const DEFAULT_DOC_CONTENT = `# 新文档

请在此处编写产品文档内容。

## 概述

## 目标

## 详细说明
`;

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

const STATUS_VARIANT: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
  published: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
  archived: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
};

type ProductTab = 'doc' | 'kanban' | 'prototype' | 'history';

/**
 * 产品空间工作台（PM 专属）。
 *
 * 顶部 Tab 切换：文档 / 看板 / 原型 / 版本历史。
 * 所有文案与图标均采用产品化语义，隐藏 Git/研发术语。
 */
export const ProductWorkspace: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ProductTab>('doc');

  const tabs = [
    { key: 'doc' as const, label: '文档', icon: FileText },
    { key: 'kanban' as const, label: '看板', icon: LayoutGrid },
    { key: 'prototype' as const, label: '原型', icon: Eye },
    { key: 'history' as const, label: '版本历史', icon: History },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] md:h-[calc(100vh-8rem)] min-h-[500px] gap-4 w-full pb-8">
      <div className="flex items-center w-full justify-between gap-2 self-start flex-wrap">
        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  activeTab === tab.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Card className="flex-1 overflow-hidden border-none claude-card flex flex-col relative">
        {activeTab === 'doc' && <DocMode />}
        {activeTab === 'kanban' && <KanbanWorkspace />}
        {activeTab === 'prototype' && <PrototypeWorkspace />}
        {activeTab === 'history' && <HistoryMode />}
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
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const loadDocs = async () => {
    if (!workspaceId) return;
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

  useEffect(() => {
    loadDocs();
  }, [workspaceId]);

  const selectedDoc = useMemo(
    () => docs.find(d => d.id === selectedDocId) ?? null,
    [docs, selectedDocId]
  );

  useEffect(() => {
    if (selectedDoc) {
      setTitle(selectedDoc.title);
      setContent(selectedDoc.content);
    } else if (!isCreating) {
      setTitle('');
      setContent('');
    }
  }, [selectedDoc, isCreating]);

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return docs;
    const q = searchQuery.toLowerCase();
    return docs.filter(d => d.title.toLowerCase().includes(q) || d.category?.toLowerCase().includes(q));
  }, [docs, searchQuery]);

  const handleCreate = () => {
    setIsCreating(true);
    setSelectedDocId(null);
    setTitle('未命名文档');
    setContent(DEFAULT_DOC_CONTENT);
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
        });
        setDocs(prev => [doc, ...prev]);
        setSelectedDocId(doc.id);
        setIsCreating(false);
        toast.success('文档已创建');
      } else if (selectedDocId) {
        const doc = await productDocApi.update(workspaceId, selectedDocId, {
          title: title.trim(),
          content,
        });
        setDocs(prev => prev.map(d => (d.id === doc.id ? doc : d)));
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
      toast.success('版本已发布');
    } catch {
      toast.error('发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = () => {
    if (!workspaceId || !selectedDocId) return;
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!workspaceId || !selectedDocId) return;
    try {
      await productDocApi.delete(workspaceId, selectedDocId);
      setDocs(prev => prev.filter(d => d.id !== selectedDocId));
      setSelectedDocId(null);
      toast.success('文档已删除');
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleteDialogOpen(false);
    }
  };

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full rounded-xl border border-border/50">
      <ResizablePanel defaultSize={22} minSize={18} maxSize={35} className="bg-muted/10 border-r border-border/50">
        <div className="h-full flex flex-col">
          <div className="p-3 border-b border-border/50 bg-muted/20 shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">文档目录</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCreate} title="新建文档">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索文档..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-7 pl-7 text-xs bg-background/50 border-border/50"
              />
            </div>
          </div>
          <ScrollArea className="flex-1 p-2">
            {loadingDocs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">
                {searchQuery ? '未找到匹配的文档' : '暂无文档，点击右上角新建'}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredDocs.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => {
                      setSelectedDocId(doc.id);
                      setIsCreating(false);
                    }}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg transition-colors group',
                      selectedDocId === doc.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="text-sm font-medium truncate flex-1">{doc.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className={cn('text-[10px] px-1.5 py-0', STATUS_VARIANT[doc.status])}>
                        {STATUS_LABEL[doc.status] ?? doc.status}
                      </Badge>
                      {doc.category && <span className="text-[10px] text-muted-foreground truncate">{doc.category}</span>}
                    </div>
                  </button>
                ))}
              </div>
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
                {!isCreating && (
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
            <div className="flex-1 overflow-hidden">
              <MarkdownEditor value={content} onChange={setContent} />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <FileText className="h-12 w-12 opacity-20" />
            <p>在左侧选择一个文档，或新建文档开始编辑</p>
            <Button variant="outline" size="sm" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              新建文档
            </Button>
          </div>
        )}
      </ResizablePanel>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除文档</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除该文档吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResizablePanelGroup>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 版本历史模式
// ─────────────────────────────────────────────────────────────────────────────

const HistoryMode: React.FC = () => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';

  const [docs, setDocs] = useState<ProductDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ProductDocVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<ProductDocVersion | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    productDocApi.list(workspaceId).then(setDocs).catch(() => toast.error('加载文档列表失败'));
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !selectedDocId) {
      setVersions([]);
      setSelectedVersion(null);
      return;
    }
    setLoading(true);
    productDocApi
      .versions(workspaceId, selectedDocId)
      .then(data => {
        setVersions(data);
        setSelectedVersion(data[0] ?? null);
      })
      .catch(() => toast.error('加载版本历史失败'))
      .finally(() => setLoading(false));
  }, [workspaceId, selectedDocId]);

  const selectedDoc = useMemo(() => docs.find(d => d.id === selectedDocId) ?? null, [docs, selectedDocId]);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full rounded-xl border border-border/50">
      <ResizablePanel defaultSize={22} minSize={18} maxSize={35} className="bg-muted/10 border-r border-border/50">
        <div className="h-full flex flex-col">
          <div className="p-3 border-b border-border/50 bg-muted/20 shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">选择文档</span>
          </div>
          <ScrollArea className="flex-1 p-2">
            {docs.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>
            ) : (
              <div className="flex flex-col gap-1">
                {docs.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg transition-colors',
                      selectedDocId === doc.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 opacity-70" />
                      <span className="text-sm font-medium truncate">{doc.title}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={78}>
        {!selectedDoc ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">请先选择左侧文档</div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0 bg-background/90">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">{selectedDoc.title} 的版本历史</span>
              </div>
            </div>
            <div className="flex-1 overflow-hidden flex">
              <div className="w-72 border-r border-border/50 bg-muted/10 flex flex-col">
                <div className="p-3 border-b border-border/50 bg-muted/20 shrink-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">版本列表</span>
                </div>
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
                            'text-left p-3 rounded-lg border transition-all',
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
              <div className="flex-1 overflow-auto p-4">
                {selectedVersion ? (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-medium">与当前版本对比：版本 {selectedVersion.version}</span>
                        <span className="text-xs text-muted-foreground">{new Date(selectedVersion.createdAt).toLocaleString()}</span>
                      </div>
                      <ReactDiffViewer
                        oldValue={selectedVersion.content}
                        newValue={selectedDoc.content}
                        splitView
                        showDiffOnly={false}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    选择一个版本查看差异
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
