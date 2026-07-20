import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { fileApi } from '@/lib/file-api';
import { workspaceApi } from '@/lib/workspace-api';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import type { WorkItemDTO } from '@/lib/api-types';
import { toast } from 'sonner';
import { Save, Send, FileText, Eye, Edit3, Loader2 } from 'lucide-react';

const PRD_DEFAULT_CONTENT = `# 产品需求文档

## 概述
请在此处描述需求背景和业务价值。

## 目标
- 目标 1
- 目标 2

## 详细功能
请在此处描述具体功能点和技术要求。

## 验收标准
- [ ] 标准 1
- [ ] 标准 2
`;

const PRD_FILE_DIR = 'projects/prds';
const PRD_FILE_SUFFIX = '-prd.md';

export const PrdView: React.FC = () => {
  const { wsId } = useParams<{ wsId: string }>();
  const { user } = useAuth();

  const [title, setTitle] = useState('新需求');
  const [content, setContent] = useState(PRD_DEFAULT_CONTENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filePath = useMemo(() => {
    const safe = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_') || 'prd';
    return `${PRD_FILE_DIR}/${safe}${PRD_FILE_SUFFIX}`;
  }, [title]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await fileApi.content(filePath);
        if (!cancelled) {
          if (result.content) {
            setContent(result.content);
          }
        }
      } catch {
        if (!cancelled) {
          setError(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [filePath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fileApi.save(filePath, content);
      toast.success('保存成功');
    } catch (e) {
      console.error('[PrdView] save failed:', e);
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncToFeishu = async () => {
    setSyncing(true);
    try {
      await fileApi.saveToFeishu(filePath);
      toast.success('已同步到飞书知识库');
    } catch (e) {
      console.error('[PrdView] feishu sync failed:', e);
      toast.error('同步到飞书失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateRequirement = async () => {
    if (!wsId) return;
    setCreating(true);
    try {
      await api.post<WorkItemDTO>('/v1/workitems', {
        tenantId: user?.tenantId || '',
        projectId: 'p1',
        type: 'requirement',
        title,
        description: content,
        status: 'backlog',
        priority: 'medium',
        source: 'internal',
      });

      let projectName = '未关联';
      try {
        const proj = await workspaceApi.getWorkitemProject(wsId);
        if (proj?.name) {
          projectName = proj.name;
        }
      } catch {
        // 无配置则使用默认名称
      }

      toast.success(`已经同步到Meego的${projectName}项目`);
    } catch (e) {
      console.error('[PrdView] create requirement failed:', e);
      toast.error('创建需求失败');
    } finally {
      setCreating(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <div className="flex items-center gap-2 p-4 border-b shrink-0">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <Input
          className="max-w-sm font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="文档标题"
        />
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setPreview(!preview)}>
          {preview ? <><Edit3 className="h-4 w-4 mr-1" />编辑</> : <><Eye className="h-4 w-4 mr-1" />预览</>}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || loading}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          保存
        </Button>
        <Button size="sm" variant="secondary" onClick={handleSyncToFeishu} disabled={syncing || loading}>
          <Send className="h-4 w-4 mr-1" />
          同步到飞书
        </Button>
        <Button size="sm" variant="default" onClick={handleCreateRequirement} disabled={creating || loading}>
          <FileText className="h-4 w-4 mr-1" />
          创建需求
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {preview ? null : (
            <div className="w-1/2 p-4 border-r overflow-auto">
              <Textarea
                className="w-full h-full min-h-[500px] font-mono resize-none border-none focus-visible:ring-0"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="在此编辑 PRD 文档…"
              />
            </div>
          )}
          <div className={`${preview ? 'w-full' : 'w-1/2'} p-4 overflow-auto`}>
            <MarkdownView content={content} collapsible={false} />
          </div>
        </div>
      )}
    </div>
  );
};
