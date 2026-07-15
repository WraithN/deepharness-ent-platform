import { AlertCircle, Loader2, Save, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { RepoStandardFiles } from '@/lib/repository-api';
import { repositoryApi } from '@/lib/repository-api';
import { useTemplates } from '@/hooks/use-templates';
import type { WorkspaceRepository } from '@/types';

/** 规范文件在仓库根目录的路径。 */
const AGENTS_MD_PATH = 'AGENTS.md';
const DESIGN_MD_PATH = 'DESIGN.md';
/** 保存规范时的 git commit message（与后端 GitCommit 的 add . 行为对应）。 */
const STANDARD_COMMIT_MESSAGE = 'docs: 更新 AGENTS.md / DESIGN.md 规范文件';
/** 未入库的临时仓库行 ID 前缀（与 Settings.tsx 的 LOCAL_REPO_ID_PREFIX 保持一致）。 */
const LOCAL_REPO_ID_PREFIX = 'local-';

interface RepoStandardsDialogProps {
  workspaceId: string;
  repo: WorkspaceRepository;
  isReadOnly: boolean;
}

/**
 * 仓库规范配置弹窗：工程规范（AGENTS.md）与设计规范（DESIGN.md）的查看/编辑/智能生成/提交。
 * 状态机：loading → not-cloned（灰化，仅可智能检测）→ ready（可编辑、保存提交）。
 * 规范文件以仓库内文件为准，保存即 git commit 回项目。
 */
export function RepoStandardsDialog({ workspaceId, repo, isReadOnly }: RepoStandardsDialogProps) {
  const codingStandardTemplates = useTemplates('development', true);
  const designStandardTemplates = useTemplates('design', true);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<RepoStandardFiles | null>(null);
  const [loadError, setLoadError] = useState('');
  const [agentsMd, setAgentsMd] = useState('');
  const [designMd, setDesignMd] = useState('');
  const [dirtyAgents, setDirtyAgents] = useState(false);
  const [dirtyDesign, setDirtyDesign] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  // 仓库未配置（未填写地址或尚未保存入库）时不请求后端，直接展示引导提示。
  const unconfigured = !repo.url || repo.id.startsWith(LOCAL_REPO_ID_PREFIX);

  const cloned = status?.cloned ?? false;
  const hasFrontend = status?.hasFrontend ?? false;
  // 已有任一规范文件时按钮语义为「重新生成」，否则为「检测」。
  const actionLabel = status?.hasAgentsMd || status?.hasDesignMd ? '智能生成' : '智能检测';

  /** 打开弹窗时拉取规范文件状态与内容。 */
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen || unconfigured) return;
    setLoading(true);
    repositoryApi
      .standardFiles(workspaceId, repo.id)
      .then(res => {
        setLoadError('');
        setStatus(res);
        setAgentsMd(res.agentsMd ?? '');
        setDesignMd(res.designMd ?? '');
        setDirtyAgents(false);
        setDirtyDesign(false);
      })
      // 加载失败不弹 toast，在弹窗内联展示原因（如仓库已被删除）。
      .catch(err => {
        setStatus(null);
        setLoadError(err instanceof Error ? err.message : '加载仓库规范失败');
      })
      .finally(() => setLoading(false));
  };

  /** 智能检测/生成：后端确保克隆后调用 agent init 生成规范文件，用返回内容刷新编辑器。 */
  const handleDetect = async () => {
    setDetecting(true);
    try {
      const res = await repositoryApi.initStandardFiles(workspaceId, repo.id);
      setStatus(res);
      if (res.hasAgentsMd) setAgentsMd(res.agentsMd ?? '');
      if (res.hasDesignMd) setDesignMd(res.designMd ?? '');
      setDirtyAgents(false);
      setDirtyDesign(false);
      if (res.warnings && res.warnings.length > 0) {
        for (const w of res.warnings) toast.warning(w);
      } else {
        toast.success('规范文件已生成');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '智能检测失败，请稍后重试');
    } finally {
      setDetecting(false);
    }
  };

  /** 保存：逐个落盘变更的规范文件后统一 git commit 提交回项目。 */
  const handleSave = async () => {
    setSaving(true);
    try {
      if (dirtyAgents) await repositoryApi.saveFileContent(workspaceId, repo.id, AGENTS_MD_PATH, agentsMd);
      if (dirtyDesign) await repositoryApi.saveFileContent(workspaceId, repo.id, DESIGN_MD_PATH, designMd);
      await repositoryApi.commit(workspaceId, repo.id, STANDARD_COMMIT_MESSAGE);
      setDirtyAgents(false);
      setDirtyDesign(false);
      toast.success('规范已保存并提交到仓库');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存规范失败');
    } finally {
      setSaving(false);
    }
  };

  const editorsDisabled = isReadOnly || !cloned;
  const saveDisabled = editorsDisabled || saving || detecting || (!dirtyAgents && !dirtyDesign);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" disabled={isReadOnly} title="设置规范">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>仓库规范配置 ({repo.name || '未命名'})</DialogTitle>
        </DialogHeader>
        {unconfigured ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
            <p>需要先配置 Git 仓库</p>
            <p className="text-xs">请填写仓库地址并保存仓库配置后，再设置仓库规范。</p>
          </div>
        ) : loadError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
            <p>加载仓库规范失败</p>
            <p className="text-xs">{loadError}</p>
          </div>
        ) : loading || !status ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载仓库规范...
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mt-2">
              <span className="text-xs text-muted-foreground">
                {cloned
                  ? '规范文件保存在仓库根目录，保存后将提交到当前分支。'
                  : '仓库尚未克隆到本地，请先点击智能检测完成克隆与分析。'}
              </span>
              <Button variant="outline" size="sm" onClick={handleDetect} disabled={detecting || isReadOnly}>
                {detecting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                {detecting ? '检测中...' : actionLabel}
              </Button>
            </div>
            {!cloned && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                仓库未克隆，编辑与保存已禁用。智能检测会自动克隆仓库并生成规范文件。
              </div>
            )}
            {/* 未克隆时整体灰化禁用（需求：未 clone 界面灰化） */}
            <div className={`flex-1 flex flex-col min-h-0 mt-2 ${cloned ? '' : 'opacity-50 pointer-events-none'}`}>
              <Tabs defaultValue="engineering" className="flex-1 flex flex-col min-h-0">
                <TabsList className="aurora-tab-bar level-2 w-full">
                  <TabsTrigger value="engineering" className="aurora-tab-item level-2 flex-1">工程规范</TabsTrigger>
                  <TabsTrigger value="design" className="aurora-tab-item level-2 flex-1" disabled={!cloned || !hasFrontend} title={cloned && !hasFrontend ? '未检测到前端代码，设计规范不可用' : undefined}>
                    设计规范
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="engineering" className="flex-1 min-h-0 mt-4">
                  {codingStandardTemplates.loading && (
                    <div className="mb-2 flex items-center justify-end text-xs text-muted-foreground">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      加载模板中...
                    </div>
                  )}
                  <MarkdownEditor
                    value={agentsMd}
                    onChange={v => {
                      setAgentsMd(v);
                      setDirtyAgents(true);
                    }}
                    placeholder="输入工程规范，或点击智能检测由 AI 生成（AGENTS.md）..."
                    readOnly={editorsDisabled}
                    templates={codingStandardTemplates.templates}
                  />
                </TabsContent>
                <TabsContent value="design" className="flex-1 min-h-0 mt-4">
                  {designStandardTemplates.loading && (
                    <div className="mb-2 flex items-center justify-end text-xs text-muted-foreground">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      加载模板中...
                    </div>
                  )}
                  <MarkdownEditor
                    value={designMd}
                    onChange={v => {
                      setDesignMd(v);
                      setDirtyDesign(true);
                    }}
                    placeholder="输入设计规范，或点击智能检测由 AI 生成（DESIGN.md）..."
                    readOnly={editorsDisabled}
                    templates={designStandardTemplates.templates}
                  />
                </TabsContent>
              </Tabs>
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-border/50">
              <Button disabled={saveDisabled} onClick={handleSave}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {saving ? '提交中...' : '保存并提交'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
