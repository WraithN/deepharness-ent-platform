import React, { useState, useEffect } from 'react';
import { ShieldCheck, Eye, FolderInput, Wrench, Loader2, GitBranch, FileCode2, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fileApi } from '@/lib/file-api';
import { MarkdownView } from './MarkdownView';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/** 评审报告元数据，从 [[REVIEW_REPORT:json]] 标记中解析。 */
export interface ReviewReportData {
  projectPath: string;
  projectName: string;
  branch: string;
  commit: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  reportPath: string;
}

interface ReviewReportCardProps {
  data: ReviewReportData;
  /** 修复按钮回调：父组件用于设置 /code 指令并发送。 */
  onFix?: (reportPath: string, projectName: string) => void;
}

const COMMIT_DISPLAY_LENGTH = 8;

/** 从 [[REVIEW_REPORT:{json}]] 标记中解析评审报告数据。 */
export function parseReviewReportFromText(text: string): ReviewReportData | null {
  const regex = /\[\[REVIEW_REPORT:(\{[^}]+\})\]\]/;
  const match = text.match(regex);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as ReviewReportData;
  } catch {
    return null;
  }
}

/** 评审报告卡片：展示工程/分支/commit 信息和问题统计，提供预览、采纳、修复三个操作。 */
export const ReviewReportCard: React.FC<ReviewReportCardProps> = ({ data, onFix }) => {
  const navigate = useNavigate();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [loadingReport, setLoadingReport] = useState(false);

  const totalIssues = data.critical + data.high + data.medium + data.low;
  const criticalHigh = data.critical + data.high;

  useEffect(() => {
    if (!previewOpen || !data.reportPath) return;
    setLoadingReport(true);
    fileApi
      .content(data.reportPath)
      .then((res) => setReportContent(res.content))
      .catch(() => {
        toast.error('加载评审报告失败');
        setReportContent('');
      })
      .finally(() => setLoadingReport(false));
  }, [previewOpen, data.reportPath]);

  const handlePreview = () => {
    setPreviewOpen(true);
  };

  const handleAdopt = () => {
    navigate(`/personal-space`, {
      state: { viewMode: 'review', repoPath: data.projectPath, repoName: data.projectName },
    });
    toast.success(`已进入 ${data.projectName} 的评审模式`);
  };

  const handleFix = () => {
    if (onFix) {
      onFix(data.reportPath, data.projectName);
    } else {
      toast.info('请在输入框中使用 /code 指令并引用评审报告进行修复');
    }
  };

  return (
    <>
      <div className="relative w-full p-4 rounded-2xl border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all">
        {/* 左上角标识 */}
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary leading-none">
          REVIEW
        </span>

        {/* 主体内容 */}
        <div className="flex items-stretch gap-4 mt-2">
          {/* 左侧图标 */}
          <div className="flex flex-col items-center justify-center gap-2 w-14 shrink-0">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
          </div>

          {/* 中间信息 */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground truncate">{data.projectName}</p>
              <span className="text-[10px] text-muted-foreground">代码评审报告</span>
            </div>

            {/* 工程信息行 */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {data.branch}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileCode2 className="h-3 w-3" />
                {data.commit.slice(0, COMMIT_DISPLAY_LENGTH)}
              </span>
            </div>

            {/* 问题统计 */}
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {criticalHigh > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  <AlertTriangle className="h-3 w-3" />
                  致命/严重 {criticalHigh}
                </span>
              )}
              {data.medium > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  <AlertCircle className="h-3 w-3" />
                  一般 {data.medium}
                </span>
              )}
              {data.low > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  <Info className="h-3 w-3" />
                  轻微 {data.low}
                </span>
              )}
              {totalIssues === 0 && (
                <span className="text-[11px] font-semibold text-emerald-600">未发现问题</span>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <button
                type="button"
                onClick={handlePreview}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Eye className="h-3.5 w-3.5" />
                预览
              </button>
              <button
                type="button"
                onClick={handleAdopt}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <FolderInput className="h-3.5 w-3.5" />
                采纳
              </button>
              <button
                type="button"
                onClick={handleFix}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Wrench className="h-3.5 w-3.5" />
                修复
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 预览弹窗 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {data.projectName} - 代码评审报告
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-1">
            {loadingReport ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <MarkdownView content={reportContent} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
