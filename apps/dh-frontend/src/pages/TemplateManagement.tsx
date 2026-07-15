import { ChevronDown, ChevronUp, Eye, EyeOff, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MarkdownEditor } from '@/components/MarkdownEditor';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { templateApi, TEMPLATE_CATEGORY_LABELS, MAX_TEMPLATES_PER_CATEGORY } from '@/lib/template-api';
import type { DocTemplate, TemplateCategory } from '@/types';

/** 分类展示顺序。 */
const CATEGORY_ORDER: TemplateCategory[] = ['product', 'design', 'development'];

/** 内容自动保存防抖间隔（毫秒）。 */
const SAVE_DEBOUNCE_MS = 800;

/** 新建模板的默认内容占位符。 */
const NEW_TEMPLATE_PLACEHOLDER = '请在此编辑模板内容...';

/** 生成模板 key：小写、中划线、去重。 */
const slugifyKey = (label: string, existingKeys: string[]): string => {
  let base = label
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = 'template';
  let key = base;
  let idx = 1;
  while (existingKeys.includes(key)) {
    key = `${base}-${idx}`;
    idx += 1;
  }
  return key;
};

/** 判断当前分类下是否已存在相同名称的模板。 */
const isDuplicateLabel = (
  templates: DocTemplate[],
  label: string,
  excludeKey?: string,
): boolean => {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  return templates.some(
    (t) => t.label.trim().toLowerCase() === normalized && t.key !== excludeKey,
  );
};

/** 将错误对象转换为可展示的消息文本。 */
const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
};

/**
 * 超管模板管理页：统一管理产品规范、设计规范、研发规范三大模板池。
 *
 * 模板数据通过后端 API 持久化，管理员增删改后会立即生效，
 * 空间设置、仓库规范弹窗、MarkdownEditor 默认模板均从同一数据源读取。
 */
export const TemplateManagement: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('product');
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [reorderLoading, setReorderLoading] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ category: TemplateCategory; key: string; content: string } | null>(null);
  const listRequestIdRef = useRef(0);

  const clearTimeoutRef = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const clearPendingSave = () => {
    clearTimeoutRef();
    pendingSaveRef.current = null;
  };

  const saveContent = async (category: TemplateCategory, key: string, content: string) => {
    setSaving(true);
    try {
      await templateApi.update(category, key, { content });
    } catch (err) {
      toast.error(getErrorMessage(err, '保存模板失败'));
      // 本地内容已先行更新，失败时不回退，保留用户编辑
    } finally {
      setSaving(false);
    }
  };

  const flushPendingSave = useCallback(async () => {
    if (!pendingSaveRef.current) return;
    const { category, key, content } = pendingSaveRef.current;
    pendingSaveRef.current = null;
    clearTimeoutRef();
    await saveContent(category, key, content);
  }, []);

  const loadList = useCallback(async (category: TemplateCategory, requestId: number) => {
    setListLoading(true);
    try {
      const list = await templateApi.list(category);
      // 忽略已过期请求的结果，避免快速切换分类时旧数据覆盖新分类
      if (requestId !== listRequestIdRef.current) return;
      setTemplates(list);
      setSelectedKey(list.length > 0 ? list[0].key : null);
    } catch (err) {
      if (requestId !== listRequestIdRef.current) return;
      toast.error(getErrorMessage(err, '加载模板列表失败'));
      setTemplates([]);
      setSelectedKey(null);
    } finally {
      if (requestId === listRequestIdRef.current) {
        setListLoading(false);
      }
    }
  }, []);

  // 切换分类时重新加载对应模板池，并默认选中第一项
  useEffect(() => {
    listRequestIdRef.current += 1;
    loadList(activeCategory, listRequestIdRef.current);
  }, [activeCategory, loadList]);

  // 切换分类时取消未执行的保存，避免内容被写入错误分类
  useEffect(() => {
    clearPendingSave();
  }, [activeCategory]);

  // 切换选中模板时，先把上一个模板的未保存内容落库，避免丢失
  useEffect(() => {
    flushPendingSave();
  }, [selectedKey, flushPendingSave]);

  // 组件卸载时清理未执行的保存定时器
  useEffect(() => {
    return () => {
      clearTimeoutRef();
    };
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.key === selectedKey) ?? null,
    [templates, selectedKey],
  );

  const handleContentChange = (content: string) => {
    if (!selectedTemplate) return;

    const category = activeCategory;
    const key = selectedTemplate.key;
    const next = templates.map((t) => (t.key === key ? { ...t, content } : t));
    setTemplates(next);

    pendingSaveRef.current = { category, key, content };
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      pendingSaveRef.current = null;
      saveContent(category, key, content);
    }, SAVE_DEBOUNCE_MS);
  };

  const handleCreate = async () => {
    const label = newLabel.trim();
    if (!label) return;

    if (templates.length >= MAX_TEMPLATES_PER_CATEGORY) {
      toast.error(`每个分类最多创建 ${MAX_TEMPLATES_PER_CATEGORY} 个模板`);
      return;
    }

    if (isDuplicateLabel(templates, label)) {
      toast.error('该分类下已存在相同名称的模板');
      return;
    }

    const existingKeys = templates.map((t) => t.key);
    const key = slugifyKey(label, existingKeys);

    try {
      await templateApi.create(activeCategory, {
        key,
        label,
        content: `# ${label}\n\n${NEW_TEMPLATE_PLACEHOLDER}`,
      });
      toast.success('模板已创建');
      setNewLabel('');
      setCreateOpen(false);
      await loadList(activeCategory, listRequestIdRef.current);
      setSelectedKey(key);
    } catch (err) {
      toast.error(getErrorMessage(err, '创建模板失败'));
    }
  };

  const handleDelete = async (key: string) => {
    clearPendingSave();
    try {
      await templateApi.delete(activeCategory, key);
      toast.success('模板已删除');
      await loadList(activeCategory, listRequestIdRef.current);
    } catch (err) {
      toast.error(getErrorMessage(err, '删除模板失败'));
    } finally {
      setDeleteKey(null);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= templates.length) return;

    const next = [...templates];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const previous = templates;
    setTemplates(next);
    setReorderLoading(true);

    try {
      await templateApi.reorder(
        activeCategory,
        next.map((t) => t.key),
      );
    } catch (err) {
      toast.error(getErrorMessage(err, '排序保存失败'));
      setTemplates(previous);
    } finally {
      setReorderLoading(false);
    }
  };

  const handlePublish = async (key: string, published: boolean) => {
    try {
      await templateApi.publish(activeCategory, key, published);
      setTemplates((prev) =>
        prev.map((t) => (t.key === key ? { ...t, published } : t)),
      );
      toast.success(published ? '模板已发布' : '模板已下架');
    } catch (err) {
      toast.error(getErrorMessage(err, published ? '发布失败' : '下架失败'));
    }
  };

  const isMaxReached = templates.length >= MAX_TEMPLATES_PER_CATEGORY;

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h4 className="text-xl font-semibold text-foreground">模板管理</h4>
          <p className="text-muted-foreground mt-1 text-sm">管理平台级产品、设计、研发规范模板</p>
        </div>
      </div>

      {/* 使用自定义按钮替代 Radix Tabs，避免弹窗关闭时的焦点/事件冲突导致分类意外切换 */}
      <div className="aurora-tab-bar level-2 mb-4">
        {CATEGORY_ORDER.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={cn('aurora-tab-item level-2', activeCategory === cat && 'active')}
          >
            {TEMPLATE_CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 flex-1 min-h-0">
        {/* 左侧模板列表 */}
        <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card flex flex-col">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-base flex items-center justify-between">
              <span>
                模板列表 ({templates.length}/{MAX_TEMPLATES_PER_CATEGORY})
              </span>
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                disabled={isMaxReached}
                title={isMaxReached ? `每个分类最多 ${MAX_TEMPLATES_PER_CATEGORY} 个模板` : ''}
              >
                <Plus className="h-4 w-4 mr-1" />
                新增
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 overflow-y-auto flex-1">
            {listLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中...
              </div>
            ) : (
              <div className="space-y-1">
                {templates.map((tpl, index) => (
                  <div
                    key={tpl.key}
                    onClick={() => setSelectedKey(tpl.key)}
                    className={cn(
                      'group flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
                      selectedKey === tpl.key
                        ? 'bg-primary/10 text-primary'
                        : 'text-secondary-foreground hover:bg-muted',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate flex-1">{tpl.label}</span>
                      {tpl.published ? (
                        <Badge variant="default" className="text-[10px] px-1 py-0 h-4 shrink-0 whitespace-nowrap">
                          已发布
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0 whitespace-nowrap">
                          未发布
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        disabled={reorderLoading || index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMove(index, 'up');
                        }}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        disabled={reorderLoading || index === templates.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMove(index, 'down');
                        }}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteKey(tpl.key);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {templates.length === 0 && (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    暂无模板，点击右上角新增
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 右侧编辑器 */}
        <Card className="soft-shadow border border-border/50 rounded-xl overflow-hidden bg-card flex flex-col min-h-[400px]">
          {selectedTemplate ? (
            <>
              <CardHeader className="pb-3 border-b border-border/50 shrink-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="flex items-center gap-2">
                    {selectedTemplate.label}
                    {saving && (
                      <span className="text-xs text-muted-foreground flex items-center">
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        保存中...
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant={selectedTemplate.published ? 'outline' : 'default'}
                    className="ml-auto"
                    onClick={() => handlePublish(selectedTemplate.key, !selectedTemplate.published)}
                  >
                    {selectedTemplate.published ? (
                      <EyeOff className="h-4 w-4 mr-1" />
                    ) : (
                      <Eye className="h-4 w-4 mr-1" />
                    )}
                    {selectedTemplate.published ? '下架' : '发布'}
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                <MarkdownEditor
                  value={selectedTemplate.content}
                  onChange={handleContentChange}
                  placeholder="在此编辑模板内容..."
                  templates={templates}
                  showTemplatePicker={false}
                />
              </CardContent>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              请选择或新增一个模板
            </div>
          )}
        </Card>
      </div>

      {/* 新增模板弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增{TEMPLATE_CATEGORY_LABELS[activeCategory]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">模板名称</label>
              <Input
                placeholder="例如：功能需求规格说明书"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCreate();
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setNewLabel('');
                  setCreateOpen(false);
                }}
              >
                取消
              </Button>
              <Button onClick={handleCreate} disabled={!newLabel.trim()}>
                确认
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={Boolean(deleteKey)} onOpenChange={(open) => !open && setDeleteKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除模板？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后不可恢复，使用该模板的编辑器将不再展示此模板。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteKey(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => deleteKey && handleDelete(deleteKey)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
