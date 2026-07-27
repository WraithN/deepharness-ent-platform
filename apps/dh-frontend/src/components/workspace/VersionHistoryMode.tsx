import React, { useEffect, useMemo, useState } from 'react';
import { Eye, FileText, History, Loader2, MonitorPlay, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  workItemDesignVersionApi,
  type DesignVersion,
  type DesignVersionItem,
} from '@/lib/workitem-design-version-api';

interface VersionHistoryModeProps {
  /** 当前选中的需求 ID */
  workitemId: string;
}

/** 操作人展示：优先后端解析的姓名，其次当前用户姓名，最后截断用户 ID */
const formatOperator = (
  createdBy: string,
  currentUser?: { id: string; name?: string; email?: string } | null
): string => {
  if (!createdBy) return '-';
  if (currentUser && createdBy === currentUser.id) return currentUser.name || currentUser.email || createdBy;
  return createdBy.length > 12 ? `${createdBy.slice(0, 8)}…` : createdBy;
};

/** 按类型统计版本条目数量 */
const countItemsByType = (items: DesignVersionItem[]) =>
  items.reduce(
    (acc, item) => {
      if (item.itemType === 'doc') acc.doc++;
      else if (item.itemType === 'prototype') acc.prototype++;
      return acc;
    },
    { doc: 0, prototype: 0 }
  );

/**
 * 产品设计版本历史。
 *
 * 按需求维度展示每次采纳/发布形成的设计快照，每个版本可包含文档与原型。
 * 设计版本为只读快照，不提供回滚/删除。
 */
export const VersionHistoryMode: React.FC<VersionHistoryModeProps> = ({ workitemId }) => {
  const { user } = useAuth();
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailVersion, setDetailVersion] = useState<DesignVersion | null>(null);

  const loadVersions = async () => {
    if (!workitemId) return;
    setLoading(true);
    try {
      const data = await workItemDesignVersionApi.list(workitemId);
      setVersions(data);
    } catch {
      toast.error('加载设计版本失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVersions();
  }, [workitemId]);

  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => b.versionNumber - a.versionNumber),
    [versions]
  );

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-hidden">
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          产品设计版本
        </h3>
        <span className="text-xs text-muted-foreground">共 {versions.length} 个版本</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          加载中...
        </div>
      ) : sortedVersions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 min-h-[240px]">
          <History className="h-12 w-12 opacity-30" />
          <div className="text-center">
            <p className="text-base">暂无设计版本</p>
            <p className="text-sm mt-1">采纳原型或关联文档后会自动生成版本快照</p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 -mx-4 px-4">
          <div className="space-y-3">
            {sortedVersions.map((version, idx) => {
              const counts = countItemsByType(version.items || []);
              const isLatest = idx === 0;
              return (
                <div
                  key={version.id}
                  className={cn(
                    'rounded-xl border p-4 transition-colors',
                    isLatest
                      ? 'bg-primary/5 border-primary/20'
                      : 'bg-card border-border/50 hover:border-primary/20'
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
                          isLatest ? 'bg-primary/15' : 'bg-muted'
                        )}
                      >
                        <span className={cn('text-sm font-bold', isLatest ? 'text-primary' : 'text-muted-foreground')}>
                          V{version.versionNumber}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {version.changeSummary || (isLatest ? '当前版本' : '历史版本')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(version.createdAt).toLocaleString()} · {formatOperator(version.createdBy, user)}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setDetailVersion(version)}>
                      <Eye className="h-3.5 w-3.5" />
                      查看
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {counts.doc > 0 && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <FileText className="h-3 w-3" />
                        {counts.doc} 个文档
                      </Badge>
                    )}
                    {counts.prototype > 0 && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <MonitorPlay className="h-3 w-3" />
                        {counts.prototype} 个原型
                      </Badge>
                    )}
                    {counts.doc === 0 && counts.prototype === 0 && (
                      <span className="text-xs text-muted-foreground">无关联条目</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* 版本详情弹窗 */}
      <Dialog open={!!detailVersion} onOpenChange={open => !open && setDetailVersion(null)}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              V{detailVersion?.versionNumber} 版本详情
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground">
              <p>创建时间：{detailVersion && new Date(detailVersion.createdAt).toLocaleString()}</p>
              <p>操作人：{detailVersion && formatOperator(detailVersion.createdBy, user)}</p>
              <p>备注：{detailVersion?.changeSummary || '无'}</p>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">包含内容</p>
              {detailVersion?.items && detailVersion.items.length > 0 ? (
                <div className="space-y-1.5">
                  {detailVersion.items.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted/40"
                    >
                      {item.itemType === 'doc' ? (
                        <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                      ) : (
                        <MonitorPlay className="h-4 w-4 text-green-500 shrink-0" />
                      )}
                      <span className="truncate flex-1">
                        {item.itemType === 'doc' ? '文档' : '原型'} · 版本 {item.productDocVersionId}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">该版本未包含任何文档或原型</p>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setDetailVersion(null)}>
              <X className="h-4 w-4 mr-1" />
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
