import React, { useEffect, useState } from 'react';
import { FileText, Eye, Download, Loader2 } from 'lucide-react';
import { fileApi } from '@/lib/file-api';

interface FileAttachmentCardProps {
  path: string;
  onPreview?: (path: string) => void;
}

/**
 * 文件附件卡片。
 *
 * 展示文件图标、文件名、大小以及内容缩略预览，
 * 并提供「预览」和「下载」操作。
 */
export const FileAttachmentCard: React.FC<FileAttachmentCardProps> = ({ path, onPreview }) => {
  const fileName = path.split('/').pop() || path;
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fileApi
      .content(path)
      .then((data) => {
        if (cancelled) return;
        const snippet = data.content.split('\n').slice(0, 4).join('\n');
        setPreview(snippet);
      })
      .catch(() => {
        if (!cancelled) setPreview('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const handlePreview = () => {
    if (onPreview) {
      onPreview(path);
      return;
    }
    const params = new URLSearchParams();
    params.set('path', path);
    window.open(`/file-view?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex items-stretch gap-4 w-full p-4 rounded-2xl border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all">
      {/* 左侧文件图标 */}
      <div className="flex flex-col items-center justify-center gap-2 w-14 shrink-0">
        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <FileText className="h-6 w-6 text-primary" />
        </div>
      </div>

      {/* 中间文件信息 */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <p className="text-sm font-semibold text-foreground truncate" title={fileName}>
          {fileName}
        </p>
        <p className="text-xs text-muted-foreground">本地文件</p>
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            onClick={handlePreview}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <a
            href={fileApi.downloadUrl(path)}
            download={fileName}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
        </div>
      </div>

      {/* 右侧内容缩略图 */}
      <div className="hidden sm:flex w-24 shrink-0 rounded-lg border border-border/40 bg-muted/40 p-3 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center w-full h-full text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <pre className="text-[10px] leading-4 text-muted-foreground line-clamp-4 whitespace-pre-wrap font-mono w-full">
            {preview || '暂无预览'}
          </pre>
        )}
      </div>
    </div>
  );
};
