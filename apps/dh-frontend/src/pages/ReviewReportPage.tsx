import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { processApi, STAGE_NAMES, type Process } from '@/lib/process-api';
import { getCurrentWorkspaceId } from '@/lib/workspace-utils';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { parseReviewReportFromText } from '@/components/chat/ReviewReportCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileCode2, GitBranch } from 'lucide-react';
import { maskWorkspacePath } from '@/lib/utils';

const SEVERITY_ITEMS: Array<{ key: 'critical' | 'high' | 'medium' | 'low'; label: string; color: string; bg: string }> = [
  { key: 'critical', label: '致命', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' },
  { key: 'high', label: '严重', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/30' },
  { key: 'medium', label: '一般', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  { key: 'low', label: '轻微', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30' },
];

export const ReviewReportPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const workspaceId = getCurrentWorkspaceId();

  const [process, setProcess] = useState<Process | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    processApi
      .getById(id)
      .then((proc) => {
        setProcess(proc);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '获取流程数据失败');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const humanReviewStage = process?.stages?.find((s) => s.name === STAGE_NAMES.HUMAN_REVIEW);
  const reviewReportText = humanReviewStage?.prompt || '';
  const reportData = reviewReportText ? parseReviewReportFromText(reviewReportText) : null;
  const totalIssues = reportData
    ? (reportData.critical ?? 0) + (reportData.high ?? 0) + (reportData.medium ?? 0) + (reportData.low ?? 0)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <div className="border-b border-border/50 sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate(`/personal/flow/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
            返回流程详情
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h1 className="text-lg font-semibold">评审报告</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center py-20">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* 概要卡片 */}
            {reportData && (
              <div className="bg-muted/40 rounded-lg p-4 space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm">
                  <FileCode2 className="h-4 w-4 text-muted-foreground" />
                  {reportData.projectName && (
                    <span className="font-medium text-foreground">{reportData.projectName}</span>
                  )}
                  {reportData.branch && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <GitBranch className="h-2.5 w-2.5" />
                      {reportData.branch}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">问题总数</span>
                  <Badge className="text-[10px] bg-foreground/10 text-foreground">{totalIssues}</Badge>
                  {SEVERITY_ITEMS.map(({ key, label, color, bg }) => {
                    const count = reportData[key] ?? 0;
                    if (count === 0) return null;
                    return (
                      <span key={key} className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${bg} ${color}`}>
                        {label} {count}
                      </span>
                    );
                  })}
                  {totalIssues === 0 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">无问题</span>
                  )}
                </div>
                {reportData.summary && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{reportData.summary}</p>
                )}
              </div>
            )}

            {/* 完整评审报告 */}
            {reviewReportText ? (
              <div className="bg-background rounded-lg border border-border/50 p-6">
                <MarkdownView content={maskWorkspacePath(reviewReportText)} collapsible={false} />
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="text-sm text-muted-foreground">暂无评审报告内容</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
