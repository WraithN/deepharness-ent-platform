import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileCode2, Loader2, AlertCircle, ArrowLeft, Download, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { fileApi, type FileContent } from '@/lib/file-api';
import { toast } from 'sonner';

/**
 * 文件查看页面。
 *
 * 通过查询参数 path 定位文件，调用 /api/v1/files/content 读取本地文件内容，
 * 在新页面中完整展示文件内容（不收缩）；支持下载和保存到飞书知识库。
 */
export const FileView: React.FC = () => {
  const [searchParams] = useSearchParams();
  const path = searchParams.get('path') || '';

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
    if (!path) {
      setError('缺少文件路径参数');
      setLoading(false);
      return;
    }

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
        console.error('[FileView] load failed:', err);
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

  const handleSaveToFeishu = async () => {
    if (!path) return;
    try {
      const res = await fileApi.saveToFeishu(path);
      toast.success(res.message || '已保存到飞书知识库');
    } catch (err) {
      console.error('[FileView] save to feishu failed:', err);
      toast.error('保存到飞书知识库失败');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border/50 bg-card px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={() => window.close()} title="关闭">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileCode2 className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-medium truncate">{fileContent?.name || path || '文件查看'}</h1>
        </div>
        {fileContent && (
          <>
            <a
              href={fileApi.downloadUrl(fileContent.path)}
              download={fileContent.name}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
              title="下载文件"
            >
              <Download className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={handleSaveToFeishu}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted/50 transition-colors"
              title="保存到飞书知识库"
            >
              <Library className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="max-w-5xl mx-auto p-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>正在加载文件内容...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-destructive">
            <AlertCircle className="h-8 w-8" />
            <p>{error}</p>
          </div>
        )}

        {!loading && fileContent && (
          <div className="rounded-xl border border-border/50 bg-card p-4 shadow-sm">
            <MarkdownView content={displayContent} collapsible={false} />
          </div>
        )}
      </div>
    </div>
  );
};
