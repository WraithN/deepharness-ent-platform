import React, { useState } from 'react';
import { ShieldCheck, Eye, FolderInput, Wrench, GitBranch, FileCode2, AlertTriangle, AlertCircle, Info, CheckCircle2, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** 单个评审问题，从 [[REVIEW_REPORT_START]]...[[REVIEW_REPORT_END]] 标记中解析。 */
export interface ReviewIssueData {
  id: string;
  filePath: string;
  line: number;
  severity: string;
  title: string;
  description: string;
  suggestion: string;
}

/** 评审报告元数据，从 [[REVIEW_REPORT_START]]...[[REVIEW_REPORT_END]] 标记中解析。 */
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
  summary?: string;
  issues?: ReviewIssueData[];
}

interface ReviewReportCardProps {
  data: ReviewReportData;
  /** 当前正在预览的文件路径，用于判断预览按钮是否处于激活状态。 */
  activePreviewPath?: string;
  /** 预览按钮回调：父组件用于在左侧分栏打开评审报告预览。 */
  onPreview?: (reportPath: string) => void;
  /** 采纳按钮回调：返回 true 表示采纳成功，卡片切换为"已采纳"状态。 */
  onAdopt?: (data: ReviewReportData) => Promise<boolean>;
  /** 修复按钮回调：父组件用于设置 /code 指令并发送。 */
  onFix?: (reportPath: string, projectName: string) => void;
}

const COMMIT_DISPLAY_LENGTH = 8;

const SEGMENT_PROJECTS = 'projects';
const REVIEW_DIR = '.review';
const PROJECTS_PREFIX = '/' + SEGMENT_PROJECTS + '/';

/**
 * 将绝对路径截取为工程相对路径，屏蔽平台目录前缀（{userId}/{workspaceId}/projects/）。
 * 例如：/home/nan/test/xxx/ws-default/projects/my-app/lib/file.ts -> my-app/lib/file.ts
 */
export function displayFilePath(filePath: string, projectPath?: string): string {
  // 优先用 projectPath 截取
  if (projectPath && filePath.startsWith(projectPath + '/')) {
    return filePath.slice(projectPath.length + 1);
  }
  // 尝试找到 /projects/ 并截取其后的部分
  const idx = filePath.indexOf(PROJECTS_PREFIX);
  if (idx >= 0) {
    return filePath.slice(idx + PROJECTS_PREFIX.length);
  }
  return filePath;
}

/**
 * 将 agent 输出的 reportPath 解析为基于 projectPath 的绝对路径。
 *
 * 处理 agent 可能输出的多种路径格式：
 * - 绝对路径（以 / 开头）→ 原样返回
 * - projects/{repoName}/... → 提取仓库名之后的部分拼接到 projectPath
 * - {repoName}/... → 提取仓库名之后的部分拼接到 projectPath
 * - 纯文件名（无 /）→ 拼接 projectPath/.review/文件名
 * - 其他相对路径 → 拼接 projectPath/原始路径
 */
function resolveReportPath(projectPath: string, reportPath: string): string {
  if (reportPath.startsWith('/')) return reportPath;
  const parts = reportPath.split('/');
  if (parts.length === 1 && parts[0]) {
    return projectPath + '/' + REVIEW_DIR + '/' + parts[0];
  }
  const projectsIdx = parts.indexOf(SEGMENT_PROJECTS);
  if (projectsIdx >= 0 && projectsIdx + 1 < parts.length) {
    const suffix = parts.slice(projectsIdx + 2).join('/');
    if (suffix) return projectPath + '/' + suffix;
  }
  const repoName = projectPath.split('/').pop() || '';
  if (repoName && parts[0] === repoName) {
    const suffix = parts.slice(1).join('/');
    if (suffix) return projectPath + '/' + suffix;
  }
  return projectPath + '/' + reportPath;
}

/**
 * 从评审报告 Markdown 文件内容中解析 issues 列表。
 * 评审报告格式：### N. Title 后跟 **文件:** **严重程度:** **问题描述:** **修改建议:**
 * 当 agent 未输出结构化 JSON（使用旧格式 marker）时，作为兜底方案从报告文件提取 issues。
 */
export function parseIssuesFromMarkdown(markdown: string, projectPath: string): ReviewIssueData[] {
  const issues: ReviewIssueData[] = [];
  const severityMap: Record<string, string> = {
    '致命': 'critical', '严重': 'high', '一般': 'medium', '轻微': 'low',
  };
  // 匹配 ### N. Title 格式的问题标题
  const issueRegex = /###\s+\d+\.\s+(.+)/g;
  let match: RegExpExecArray | null;
  const positions: Array<{ title: string; start: number }> = [];
  while ((match = issueRegex.exec(markdown)) !== null) {
    positions.push({ title: match[1].trim(), start: match.index });
  }
  for (let i = 0; i < positions.length; i++) {
    const block = markdown.slice(positions[i].start, positions[i + 1]?.start ?? markdown.length);
    const fileMatch = block.match(/\*\*文件[:：]\*\*\s*`?([^`\n]+)`?/);
    const severityMatch = block.match(/\*\*严重程度[:：]\*\*\s*(致命|严重|一般|轻微)/);
    const descMatch = block.match(/\*\*问题描述[:：]\*\*\s*([\s\S]*?)(?=\*\*修改建议|$)/);
    const suggestionMatch = block.match(/\*\*修改建议[:：]\*\*\s*([\s\S]*?)(?=\n---|\n###|\n##|$)/);
    const rawFile = fileMatch?.[1]?.trim() || '';
    // 从原始文件路径中移除行号范围后缀（如 :3-19 或 :3），得到纯文件路径
    const cleanFile = rawFile.replace(/:\d+[-\d]*$/, '');
    // 将相对路径解析为绝对路径
    const filePath = cleanFile.startsWith('/') ? cleanFile : (projectPath + '/' + cleanFile);
    // 从原始文件路径中提取行号
    const lineMatch = rawFile.match(/:(\d+)/);
    issues.push({
      id: `R${i + 1}`,
      filePath,
      line: lineMatch ? parseInt(lineMatch[1], 10) : 0,
      severity: severityMap[severityMatch?.[1]?.trim() || ''] || 'medium',
      title: positions[i].title,
      description: descMatch?.[1]?.trim() || '',
      suggestion: suggestionMatch?.[1]?.trim() || '',
    });
  }
  return issues;
}

/**
 * 从评审报告标记中解析数据，兼容两种格式：
 * - 新格式：[[REVIEW_REPORT_START]] {json} [[REVIEW_REPORT_END]]（允许标记与 JSON 之间有空白/换行）
 * - 旧格式：[[REVIEW_REPORT:{json}]]
 */
export function parseReviewReportFromText(text: string): ReviewReportData | null {
  // 优先尝试新格式（含 issues 数组），允许标记与 JSON 之间有空白/换行
  const newRegex = /\[\[REVIEW_REPORT_START\]\]\s*(\{[\s\S]*?\})\s*\[\[REVIEW_REPORT_END\]\]/;
  const newMatch = text.match(newRegex);
  if (newMatch?.[1]) {
    try {
      const parsed = JSON.parse(newMatch[1]) as ReviewReportData;
      // 确保新格式数据至少有 projectPath 或 projectName，避免误匹配
      if (parsed.projectPath || parsed.projectName) {
        return parsed;
      }
    } catch {
      // JSON 解析失败，回退到旧格式
    }
  }
  // 兼容旧格式（无 issues 数组）
  const oldRegex = /\[\[REVIEW_REPORT:(\{[^}]+\})\]\]/;
  const oldMatch = text.match(oldRegex);
  if (oldMatch?.[1]) {
    try {
      return JSON.parse(oldMatch[1]) as ReviewReportData;
    } catch {
      return null;
    }
  }
  return null;
}

/** 评审报告卡片：展示工程/分支/commit 信息和问题统计，提供预览、采纳、修复三个操作。 */
export const ReviewReportCard: React.FC<ReviewReportCardProps> = ({ data, activePreviewPath, onPreview, onAdopt, onFix }) => {
  const navigate = useNavigate();
  const [isAdopted, setIsAdopted] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);

  const totalIssues = data.critical + data.high + data.medium + data.low;
  const resolvedPath = resolveReportPath(data.projectPath, data.reportPath);
  const isPreviewActive = activePreviewPath === resolvedPath;

  const handlePreview = () => {
    if (onPreview) {
      onPreview(resolvedPath);
    }
  };

  const handleAdopt = async () => {
    if (isAdopted || isAdopting) return;
    if (onAdopt) {
      setIsAdopting(true);
      try {
        const success = await onAdopt(data);
        if (success) setIsAdopted(true);
      } finally {
        setIsAdopting(false);
      }
    } else {
      const params = new URLSearchParams({
        mode: 'review',
        repoName: data.projectName,
        branch: data.branch,
      });
      if (data.projectPath) {
        params.set('repoPath', data.projectPath);
      }
      navigate(`/personal-space?${params.toString()}`, {
        state: {
          viewMode: 'review',
          repoPath: data.projectPath || '',
          repoName: data.projectName,
          branch: data.branch,
        },
      });
    }
  };

  const handleFix = () => {
    if (onFix) {
      onFix(resolvedPath, data.projectName);
    } else {
          }
  };

  return (
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
          <div className="flex flex-col gap-1.5 mt-1">
            {totalIssues > 0 && (
              <p className="text-[11px] text-muted-foreground">
                共发现 <span className="font-bold text-foreground">{totalIssues}</span> 个问题
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {data.critical > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  <AlertTriangle className="h-3 w-3" />
                  致命 {data.critical}
                </span>
              )}
              {data.high > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  <AlertTriangle className="h-3 w-3" />
                  严重 {data.high}
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
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <button
              type="button"
              onClick={handlePreview}
              className={isPreviewActive
                ? 'inline-flex items-center gap-1 text-xs font-bold text-primary'
                : 'inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline'}
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
            {isAdopted ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已采纳
              </span>
            ) : (
              <button
                type="button"
                onClick={handleAdopt}
                disabled={isAdopting}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
              >
                {isAdopting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
                {isAdopting ? '采纳中...' : '采纳'}
              </button>
            )}
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
  );
};
