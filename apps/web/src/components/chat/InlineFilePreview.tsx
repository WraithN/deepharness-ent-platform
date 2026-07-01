import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { fileApi, type FileContent } from '@/lib/file-api';
import { toast } from 'sonner';

interface InlineFilePreviewProps {
  path: string;
  onClose: () => void;
}

/**
 * 内联文件预览组件。
 *
 * 在 Chat 页的分栏区域内渲染文件内容，不跳转新页面。
 */
export const InlineFilePreview: React.FC<InlineFilePreviewProps> = ({ path, onClose }) => {
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const displayContent = useMemo(() => {
    if (!fileContent) return '';
    const isMarkdown = /\.(md|markdown)$/i.test(fileContent.path);
    if (isMarkdown) {
      return fileContent.content;
    }
    const lang = fileContent.language || '';
    return `\`\`\`${lang}\n${fileContent.content}\n\`\`\``;
  }, [fileContent]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFileContent(null);

    const load = async () => {
      try {
        const content = await fileApi.content(path);
        if (!cancelled) {
          setFileContent(content);
        }
      } catch (err) {
        console.error('[InlineFilePreview] load failed:', err);
        if (!cancelled) {
          setError('加载文件失败或文件不存在');
          toast.error('加载文件失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [path]);

  const fileName = fileContent?.name || path.split('/').pop() || path;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card shrink-0">
        <h3 className="text-sm font-medium truncate" title={path}>
          {fileName}
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose} title="关闭预览">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {loading && (
          <p className="text-sm text-muted-foreground">正在加载文件内容...</p>
        )}
        {!loading && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {!loading && !error && fileContent && (
          <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
            <MarkdownView content={displayContent} collapsible={false} />
          </div>
        )}
      </div>
    </div>
  );
};
