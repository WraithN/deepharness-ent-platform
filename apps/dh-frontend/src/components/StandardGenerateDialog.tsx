import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { workspaceApi } from '@/lib/workspace-api';

/** 用户描述的最大长度，与后端 standardGenerateMaxPromptLen 保持一致。 */
const STANDARD_PROMPT_MAX_LEN = 2000;

/** 规范类型对应的中文名称，用于按钮/弹窗标题与提示语。 */
const STANDARD_KIND_LABELS: Record<StandardGenerateDialogProps['kind'], string> = {
  coding: '编码规范',
  design: '设计规范',
};

interface StandardGenerateDialogProps {
  /** 规范类型：coding（编码规范）或 design（设计规范）。 */
  kind: 'coding' | 'design';
  /** 当前空间 ID，用于调用智能生成接口。 */
  workspaceId: string;
  /** 生成成功回调，将 Markdown 内容填充到编辑器（不落库，需用户确认保存）。 */
  onGenerated: (content: string) => void;
}

/**
 * 规范智能生成弹窗：输入文字描述 → 调用默认 agent 生成 Markdown 规范 → 回填编辑器。
 * 编码规范与设计规范共用同一交互，按 kind 区分系统提示词与标题。
 */
export function StandardGenerateDialog({ kind, workspaceId, onGenerated }: StandardGenerateDialogProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const label = STANDARD_KIND_LABELS[kind];

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error('请输入规范描述');
      return;
    }
    setGenerating(true);
    try {
      const res = await workspaceApi.generateStandard(workspaceId, { kind, prompt: trimmed });
      if (!res.content?.trim()) {
        toast.error('生成结果为空，请补充描述后重试');
        return;
      }
      onGenerated(res.content);
      setOpen(false);
      setPrompt('');
    } catch (err) {
      // 503 表示 agent 运行时（gatewayd）未部署或不可用，给用户更友好的提示。
      if (err instanceof ApiError && err.status === 503) {
        toast.error('智能生成服务暂不可用，请稍后重试');
      } else {
        toast.error(err instanceof Error ? err.message : '智能生成失败，请稍后重试');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles className="mr-1.5 h-4 w-4" /> 智能生成
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>智能生成{label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`描述你想要的${label}，例如：技术栈、团队约定、重点关注的问题域等，AI 将据此生成一份可直接编辑的规范文档。`}
            maxLength={STANDARD_PROMPT_MAX_LEN}
            rows={6}
            disabled={generating}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {prompt.length}/{STANDARD_PROMPT_MAX_LEN}
            </span>
            <Button onClick={handleGenerate} disabled={generating || !prompt.trim()}>
              {generating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              {generating ? '生成中...' : '生成'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
