import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Eye, ExternalLink, Monitor, Tablet, Smartphone, X } from 'lucide-react';
import { projectApi } from '@/lib/project-api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export type PreviewMode = 'diff' | 'code' | 'preview';

interface LivePreviewProps {
  projectPath: string;
  mode: PreviewMode;
  onClose?: () => void;
  onModeChange?: (mode: PreviewMode) => void;
}

type DeviceSize = 'desktop' | 'tablet' | 'mobile';

const DEVICE_WIDTHS: Record<DeviceSize, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

/**
 * 项目实时预览组件。
 *
 * 仅展示前端页面预览效果：通过 iframe 加载项目 dev server。
 * 不再提供代码查看与 Diff 对比功能。
 */
export const LivePreview: React.FC<LivePreviewProps> = ({ projectPath, onClose }) => {
  const [device, setDevice] = useState<DeviceSize>('desktop');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [starting, setStarting] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // 组件挂载时启动 dev server 并生成预览 URL；卸载时停止预览。
  useEffect(() => {
    setStarting(true);
    projectApi
      .startPreview(projectPath)
      .then((res) => {
        if (res.isFrontend && res.port > 0) {
          const host = window.location.hostname;
          setPreviewUrl(`http://${host}:${res.port}/`);
        }
      })
      .catch((e) => {
        console.error('[LivePreview] start failed:', e);
        toast.error('启动预览失败');
      })
      .finally(() => {
        setStarting(false);
      });

    return () => {
      projectApi.stopPreview(projectPath).catch(() => {});
    };
  }, [projectPath]);

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleOpenInNewTab = () => {
    if (previewUrl) window.open(previewUrl, '_blank');
  };

  return (
    <div className="flex flex-col h-full bg-background animate-in fade-in duration-300">
      {/* 标题栏 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50 bg-card shrink-0 animate-in fade-in slide-in-from-top-2 duration-300">
        <Button variant="default" size="sm" className="h-7 text-xs">
          <Eye className="h-3.5 w-3.5 mr-1" />
          页面预览
        </Button>
        <div className="flex-1" />
        {previewUrl && (
          <>
            <div className="flex items-center gap-0.5 mr-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 transition-colors', device === 'desktop' && 'text-primary bg-primary/10')}
                onClick={() => setDevice('desktop')}
                title="桌面"
              >
                <Monitor className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 transition-colors', device === 'tablet' && 'text-primary bg-primary/10')}
                onClick={() => setDevice('tablet')}
                title="平板"
              >
                <Tablet className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 transition-colors', device === 'mobile' && 'text-primary bg-primary/10')}
                onClick={() => setDevice('mobile')}
                title="手机"
              >
                <Smartphone className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 transition-transform duration-200 hover:rotate-90" onClick={handleRefresh} title="刷新">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenInNewTab} title="新标签页打开">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <PreviewView starting={starting} previewUrl={previewUrl} iframeRef={iframeRef} device={device} />
      </div>
    </div>
  );
};

// ──────────────── 预览视图 ────────────────

const PreviewView: React.FC<{
  starting: boolean;
  previewUrl: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  device: DeviceSize;
}> = ({ starting, previewUrl, iframeRef, device }) => {
  const [iframeLoading, setIframeLoading] = useState(true);

  // 预览 URL 变化时重置加载状态。
  useEffect(() => {
    setIframeLoading(true);
  }, [previewUrl]);

  if (starting) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground animate-in fade-in">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
        <span className="text-sm">正在启动 dev server...</span>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 animate-in fade-in">
        <Monitor className="h-10 w-10 opacity-30" />
        <p>该项目暂不支持页面预览</p>
        <p className="text-xs">仅前端工程可启动 dev server 预览</p>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-muted/20 relative">
      {iframeLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/30 z-10 animate-in fade-in">
          <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
          <span className="text-sm text-muted-foreground">正在加载预览页面...</span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={previewUrl}
        className="bg-white border-0 transition-all duration-500 shadow-sm"
        style={{ width: DEVICE_WIDTHS[device], height: '100%' }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title="项目预览"
        onLoad={() => setIframeLoading(false)}
      />
    </div>
  );
};
