import React, { useEffect, useState } from 'react';
import { User, ListTodo, Bug, FlaskConical, GitBranch, Pencil, Copy, BookmarkPlus } from 'lucide-react';
import type { MessageState, TextMessagePart } from '@assistant-ui/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { extractUserPrompt } from '@/hooks/use-ag-ui-chat';
import { formatTime } from '@/lib/utils';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import { workspaceApi } from '@/lib/workspace-api';
import { sortPromptCategoriesByBuiltin } from '@/lib/prompt-categories';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import MultiSelect from '@/components/ui/multi-select';
import type { SendContext } from '@/hooks/use-ag-ui-chat';
import type { PromptCategory, WorkspacePrompt } from '@/types';

interface UserMessageProps {
  message: MessageState;
  openDetail?: (type: 'req' | 'defect' | 'case', id: string) => void;
  onRepoClick?: () => void;
  onEdit?: (text: string, context?: SendContext) => void;
  onPromptSaved?: (prompt: WorkspacePrompt) => void;
}

const COPY_DATA_ATTR = 'data-dh-chat-copy';

function buildCopyText(text: string, quotedCard?: SendContext['quotedCard'], selectedRepos?: SendContext['selectedRepos']): string {
  const lines: string[] = [];
  if (quotedCard) {
    const typeLabel = quotedCard.type === 'req' ? '需求' : quotedCard.type === 'defect' ? '缺陷' : '用例';
    lines.push(`[引用${typeLabel}: ${quotedCard.title} · ${quotedCard.id}]`);
  }
  if (selectedRepos && selectedRepos.length > 0) {
    lines.push(`[代码库: ${selectedRepos.map(r => r.name).join(', ')}]`);
  }
  if (lines.length > 0) {
    lines.push('');
  }
  lines.push(text);
  return lines.join('\n');
}

async function copyStructuredText(
  text: string,
  quotedCard?: SendContext['quotedCard'],
  selectedRepos?: SendContext['selectedRepos'],
): Promise<void> {
  const plainText = buildCopyText(text, quotedCard, selectedRepos);
  const payload: Record<string, unknown> = { t: text };
  if (quotedCard) payload.q = quotedCard;
  if (selectedRepos && selectedRepos.length > 0) payload.r = selectedRepos;
  const html = `<span ${COPY_DATA_ATTR}='${JSON.stringify(payload).replace(/'/g, "&#39;")}'>${text.replace(/</g, '&lt;')}</span>`;

  console.log('[copyStructuredText] plainText:', plainText);
  console.log('[copyStructuredText] html:', html);

  try {
    const item = new ClipboardItem({
      'text/plain': new Blob([plainText], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    });
    console.log('[copyStructuredText] ClipboardItem created OK');
    await navigator.clipboard.write([item]);
    console.log('[copyStructuredText] write OK');
  } catch (err) {
    console.log('[copyStructuredText] ClipboardItem failed:', err);
    await navigator.clipboard.writeText(plainText);
    console.log('[copyStructuredText] fallback writeText OK');
  }
}

export const UserMessage: React.FC<UserMessageProps> = ({ message, openDetail, onRepoClick, onEdit, onPromptSaved }) => {
  const custom = (message.metadata?.custom || {}) as {
    quotedCard?: SendContext['quotedCard'];
    selectedRepos?: SendContext['selectedRepos'];
    originalText?: string;
  };
  const { quotedCard, selectedRepos } = custom;

  const rawTextPart = Array.isArray(message.content)
    ? (message.content.find(p => p.type === 'text') as TextMessagePart | undefined)
    : undefined;
  const textPart = rawTextPart?.text
    ? { text: custom.originalText ?? extractUserPrompt(rawTextPart.text) }
    : undefined;

  // 保存为提示词弹窗：名称（必填）+ 分类（可选）+ 内容（自动填充、可编辑）。
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [promptName, setPromptName] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [promptCategoryIds, setPromptCategoryIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<PromptCategory[]>([]);

  // 打开弹窗时预填名称与内容，并加载分类列表（每次打开刷新，保证新建分类可见）。
  useEffect(() => {
    if (!saveOpen) return;
    let cancelled = false;
    let wsId: string;
    try {
      wsId = getCurrentWorkspaceId();
    } catch {
      setCategories([]);
      return;
    }
    workspaceApi.listPromptCategories(wsId)
      .then(list => { if (!cancelled) setCategories(list); })
      .catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [saveOpen]);

  // 打开弹窗：名称预填消息首行（截断 20 字），内容预填消息全文，分类清空（默认「未分类」）。
  const openSaveDialog = () => {
    if (!textPart?.text) return;
    const firstLine = textPart.text.replace(/\s+/g, ' ').trim();
    setPromptName(firstLine.length > 20 ? `${firstLine.slice(0, 20)}…` : firstLine);
    setPromptContent(textPart.text);
    setPromptCategoryIds([]);
    setSaveOpen(true);
  };

  // 提交保存：调用后端创建自定义提示词（任意登录用户可操作），成功后通知上层刷新菜单。
  const handleSaveToPrompt = async () => {
    const name = promptName.trim();
    if (!name) {
      toast.error('请输入提示词名称');
      return;
    }
    const content = promptContent.trim();
    if (!content) {
      toast.error('提示词内容不能为空');
      return;
    }
    setSaving(true);
    try {
      const created = await workspaceApi.createCustomPrompt(getCurrentWorkspaceId(), {
        name,
        description: '',
        content,
        useCase: '',
        categoryIds: promptCategoryIds,
      });
      toast.success('已加入提示词库');
      setSaveOpen(false);
      onPromptSaved?.(created);
    } catch (err) {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex gap-3 justify-end">
      <div className="flex flex-col max-w-[calc(100%-2.75rem)] min-w-0 items-end">
        <div className="flex flex-col gap-2 w-fit max-w-full bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm">
          {textPart?.text && (
            <div className="px-3 py-2 text-xs sm:text-sm break-words min-w-0 overflow-hidden">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    const codeString = String(children).replace(/\n$/, '');
                    if (!inline && match) {
                      return <pre className="bg-primary-foreground/10 rounded p-2 text-xs overflow-x-auto"><code>{codeString}</code></pre>;
                    }
                    return <code className="bg-primary-foreground/20 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>;
                  },
                }}
              >
                {textPart.text}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {(quotedCard || (selectedRepos && selectedRepos.length > 0)) && (
          <div className="mt-2 flex flex-wrap gap-2 justify-end">
            {quotedCard && (
              <div
                className="flex items-center gap-2 w-56 px-3 py-2 rounded-xl border border-primary/20 bg-primary/10 cursor-pointer hover:bg-primary/20 transition-colors"
                onClick={() => openDetail?.(quotedCard.type, quotedCard.id)}
              >
                {quotedCard.type === 'req' && <ListTodo className="h-4 w-4 text-primary shrink-0" />}
                {quotedCard.type === 'defect' && <Bug className="h-4 w-4 text-destructive shrink-0" />}
                {quotedCard.type === 'case' && <FlaskConical className="h-4 w-4 text-violet-500 shrink-0" />}
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium text-foreground truncate">{quotedCard.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    引用{quotedCard.type === 'req' ? '需求' : quotedCard.type === 'defect' ? '缺陷' : '用例'} · {quotedCard.id}
                  </p>
                </div>
              </div>
            )}
            {selectedRepos?.map(repo => (
              <div
                key={repo.id}
                className="flex items-center gap-2 w-56 px-3 py-2 rounded-xl border border-primary/20 bg-primary/10 cursor-pointer hover:bg-primary/20 transition-colors"
                onClick={onRepoClick}
              >
                <GitBranch className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium text-foreground truncate">{repo.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">工程仓库</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {textPart?.text && (
          <div className="flex items-center gap-1 mt-1.5">
            <span className="text-[10px] text-muted-foreground/50 px-1">{formatTime(message.createdAt)}</span>
            <button
              onClick={() => onEdit?.(textPart.text, { quotedCard, selectedRepos })}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              title="编辑"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={async () => {
                await copyStructuredText(textPart.text, quotedCard, selectedRepos);

              }}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
              title="复制"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
              <button
                onClick={openSaveDialog}
                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
                title="加入提示词库"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
              </button>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>加入提示词库</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="save-prompt-name">名称 <span className="text-destructive">*</span></Label>
                    <Input
                      id="save-prompt-name"
                      value={promptName}
                      onChange={e => setPromptName(e.target.value)}
                      placeholder="提示词名称"
                      autoFocus
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>分类（可选）</Label>
                    <MultiSelect
                      options={sortPromptCategoriesByBuiltin(categories).map(c => ({ value: c.id, label: c.name }))}
                      value={promptCategoryIds}
                      onChange={setPromptCategoryIds}
                      placeholder="未分类"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="save-prompt-content">内容</Label>
                    <Textarea
                      id="save-prompt-content"
                      value={promptContent}
                      onChange={e => setPromptContent(e.target.value)}
                      placeholder="提示词内容"
                      rows={5}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>取消</Button>
                  <Button onClick={handleSaveToPrompt} disabled={saving}>
                    {saving ? '保存中…' : '保存'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
      <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1 shadow-sm">
        <User className="h-4 w-4 text-primary-foreground" />
      </div>
    </div>
  );
};
