import React, { useEffect, useState } from 'react';
import { FileText, Eye, Download, Loader2, FolderInput, Check } from 'lucide-react';
import { fileApi } from '@/lib/file-api';
import { productSpaceApi } from '@/lib/productspace-api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn, isProductSpaceFile } from '@/lib/utils';

interface FileAttachmentCardProps {
  path: string;
  onPreview?: (path: string) => void;
  /** 关联的需求 ID；提供后点击采纳会自动关联需求并生成设计版本 */
  workitemId?: string;
}

/**
 * 从文件名中提取展示标题，去掉 -prd.md / -research.md / .md 等后缀。
 */
function buildDisplayTitle(fileName: string): string {
  return fileName.replace(/-(?:prd|research)\.(?:md|markdown)$/i, '').replace(/\.(?:md|markdown)$/i, '');
}

/**
 * 从文件名中提取类型标识（大写扩展名）。
 */
function getFileType(fileName: string): string {
  const ext = fileName.match(/\.([^.]+)$/)?.[1];
  return ext ? ext.toUpperCase() : 'FILE';
}

/**
 * 文件附件卡片。
 *
 * 展示文件图标、文件名、大小以及内容缩略预览，
 * 并提供「预览」和「下载」操作。
 * 左上角显示文件类型标识徽章。
 */
export const FileAttachmentCard: React.FC<FileAttachmentCardProps> = ({ path, onPreview, workitemId }) => {
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const fileName = path.split('/').pop() || path;
  const displayTitle = buildDisplayTitle(fileName);
  const fileType = getFileType(fileName);
  const isMarkdown = /\.(?:md|markdown)$/i.test(fileName);
  const canAdoptToProductSpace = isMarkdown && isProductSpaceFile(path);
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

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

  // 查询采纳状态：刷新页面后仍能正确显示"已采纳"。仅产品空间文件需要查询。
  useEffect(() => {
    if (!workspaceId || !canAdoptToProductSpace) return;
    let cancelled = false;
    setCheckingStatus(true);
    productSpaceApi
      .importDocStatus(workspaceId, path)
      .then((res) => {
        if (!cancelled) setAdopted(res.adopted);
      })
      .catch(() => {
        if (!cancelled) setAdopted(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, path, canAdoptToProductSpace]);

  const handlePreview = () => {
    if (onPreview) {
      onPreview(path);
      return;
    }
    const params = new URLSearchParams();
    params.set('path', path);
    window.open(`/file-view?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const handleAdopt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspaceId) {
      toast.error('未选择工作空间');
      return;
    }
    if (!isMarkdown) {
      toast.error('仅支持采纳 Markdown 文档');
      return;
    }
    if (!isProductSpaceFile(path)) {
      return;
    }
    setImporting(true);
    try {
      await productSpaceApi.importDoc(workspaceId, path, workitemId);
            setAdopted(true);
    } catch (err) {
      console.error('[FileAttachmentCard] adopt failed:', err);
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || '采纳失败，请确认是否已加入该工作空间');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="relative flex items-stretch gap-4 w-full p-4 rounded-2xl border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all">
      {/* 左上角文件类型标识 */}
      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary leading-none">
        {fileType}
      </span>

      {/* 左侧文件图标 */}
      <div className="flex flex-col items-center justify-center gap-2 w-14 shrink-0 mt-2">
        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <FileText className="h-6 w-6 text-primary" />
        </div>
      </div>

      {/* 中间文件信息 */}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 mt-2">
        <p className="text-sm font-semibold text-foreground truncate" title={fileName}>
          {displayTitle}
        </p>
        <p className="text-xs text-muted-foreground">本地文件</p>
        <div className="flex flex-wrap items-center gap-3 mt-2">
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
          {workspaceId && canAdoptToProductSpace && (
            <button
              type="button"
              onClick={handleAdopt}
              disabled={importing || adopted || checkingStatus}
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium hover:underline disabled:opacity-60 disabled:cursor-not-allowed',
                adopted ? 'text-emerald-600' : 'text-primary'
              )}
            >
              {importing || checkingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : adopted ? <Check className="h-3.5 w-3.5" /> : <FolderInput className="h-3.5 w-3.5" />}
              {adopted ? '已采纳到产品空间' : '采纳到产品空间'}
            </button>
          )}
        </div>
      </div>

      {/* 右侧内容缩略图 */}
      <div className="hidden sm:flex w-24 shrink-0 rounded-lg border border-border/40 bg-muted/40 p-3 overflow-hidden mt-2">
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
