import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonitorPlay, Eye, FileText, Loader2, Check, FolderInput } from 'lucide-react';
import { projectApi, type ProjectCheckResponse } from '@/lib/project-api';
import { productSpaceApi } from '@/lib/productspace-api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface PrototypeCardProps {
  /** 原型工程根目录的绝对路径（例如 .../products/prototypes/campaign-manager） */
  path: string;
  /** 关联的需求标题 */
  requirementTitle?: string;
  /** 工程内的文件数量 */
  fileCount?: number;
  /** 关联的需求 ID；提供后点击采纳会自动关联需求并生成设计版本 */
  workitemId?: string;
  /** 点击卡片后的预览回调；若未提供则跳转到产品空间 */
  onPreview?: (path: string) => void;
}

/**
 * 原型工程卡片。
 *
 * 展示需求原型摘要：产品名、文件数量、关联需求。
 * 点击后在聊天预览面板打开原型预览（若提供 onPreview），否则跳转到产品空间。
 */
export const PrototypeCard: React.FC<PrototypeCardProps> = ({ path, requirementTitle, fileCount: fileCountProp, workitemId, onPreview }) => {
  const navigate = useNavigate();
  const { membership } = useAuth();
  const workspaceId = membership?.workspaceId ?? '';
  const productName = path.split('/').filter(Boolean).pop() || path;
  const [checkResult, setCheckResult] = useState<ProjectCheckResponse | null>(null);
  const [loadingCount, setLoadingCount] = useState(fileCountProp === undefined);
  const [importing, setImporting] = useState(false);
  const [adopted, setAdopted] = useState(false);

  useEffect(() => {
    if (fileCountProp !== undefined) return;
    let cancelled = false;
    setLoadingCount(true);
    projectApi
      .check(path)
      .then((res) => {
        if (!cancelled) setCheckResult(res);
      })
      .catch((err) => {
        if (!cancelled) console.error('[PrototypeCard] check failed:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingCount(false);
      });
    return () => { cancelled = true; };
  }, [path, fileCountProp]);

  const displayCount = fileCountProp ?? checkResult?.htmlCount ?? checkResult?.fileCount;

  const handleClick = () => {
    if (onPreview) {
      onPreview(path);
      return;
    }
    navigate(`/personal-space?tab=prototype&product=${encodeURIComponent(productName)}`);
  };

  const handleAdopt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspaceId) {
      toast.error('未选择工作空间');
      return;
    }
    setImporting(true);
    try {
      await productSpaceApi.importPrototype(workspaceId, productName, workitemId);
      setAdopted(true);
    } catch (err) {
      console.error('[PrototypeCard] adopt failed:', err);
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg || '采纳失败，请确认是否已加入该工作空间');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="w-full p-4 rounded-2xl border border-blue-500/30 bg-blue-50/50 dark:bg-blue-900/10 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-500 cursor-pointer"
    >
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
          <MonitorPlay className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground truncate">{productName}</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-300 font-medium">
              原型
            </span>
          </div>
          <p className="text-xs text-foreground/80 mt-1 line-clamp-1">
            {requirementTitle ? `需求：${requirementTitle}` : '需求：未命名需求'}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
              {loadingCount ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {typeof displayCount === 'number' ? `${displayCount} 个页面` : '查看文件'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-500/10"
              onClick={(e) => { e.stopPropagation(); handleClick(); }}
            >
              <Eye className="h-3.5 w-3.5" />
              预览原型
            </Button>
            {workspaceId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-500/10"
                onClick={handleAdopt}
                disabled={importing || adopted}
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : adopted ? <Check className="h-3.5 w-3.5" /> : <FolderInput className="h-3.5 w-3.5" />}
                {adopted ? '已采纳到产品空间' : '采纳到产品空间'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
