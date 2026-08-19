/**
 * 消息标记渲染组件
 *
 * 将 AssistantMessage 中的标记卡片渲染逻辑提取为独立组件，
 * 每种标记有对应的解析和操作：
 *
 * - FileMarkerCards:     [[FILE:path]]       -> 文件附件卡片（预览/采纳）
 * - ProjectMarkerCards:  [[PROJECT:path]]    -> 工程卡片（预览/Diff/代码）
 * - CardMarkerRenderer:  [[CARD:type]]       -> 用户故事卡片 / 需求拆分卡片
 * - QuestionMarkerCard:  [[QUESTION:...]]    -> 提问卡片（选项点击回答）
 * - ReqNameResolver:     [[REQ_NAME:name]]   -> 解析需求名（非视觉，返回 workitemId）
 */
import React, { useMemo } from 'react';
import { FileAttachmentCard } from './FileAttachmentCard';
import { ProjectCard } from './ProjectCard';
import { PrototypeCard } from './PrototypeCard';
import { UserStoryCard, parseUserStoryFromText } from './UserStoryCard';
import type { UserStoryData } from './UserStoryCard';
import { RequirementBreakdownCard, useRequirementBreakdownData } from './RequirementBreakdownCard';
import type { RequirementBreakdownData, RequirementBreakdownSubmitResult, RequirementItem } from './RequirementBreakdownCard';
import { ReviewReportCard, parseReviewReportFromText } from './ReviewReportCard';
import type { ReviewReportData } from './ReviewReportCard';
import { PrdAnalysisCard } from './PrdAnalysisCard';
import {
  parseFileMarkers,
  parseProjectMarkers,
  parseCardTypes,
  parseReqName,
  parseAllFilePaths,
} from '@/lib/markers';
import { isProductSpaceFile } from '@/lib/utils';
import type { PreviewMode } from './LivePreview';
import type { WorkItemDTO } from '@/lib/api-types';

// ── 常量 ──

const PROTOTYPE_DIR_SEGMENT = '/products/prototypes/';

// ── FileMarkerCards: [[FILE:...]] ──

interface FileMarkerCardsProps {
  textParts: string[];
  onPreview?: (path: string) => void;
  workitemId?: string;
  /** 已有工程卡片时，过滤掉工程目录下的文件 */
  projectPaths?: string[];
  /** 是否有原型卡片（有则不渲染普通文件卡片） */
  hasPrototypeCards?: boolean;
  /** 是否有用户故事卡片（有则不渲染文件卡片） */
  hasUserStory?: boolean;
  /** 评审报告文件路径列表（已在评审卡片中展示，不再重复渲染） */
  reviewFilePaths?: string[];
  isRunning?: boolean;
}

/** 从文本中提取 [[FILE:...]] 标记并渲染文件附件卡片列表 */
export const FileMarkerCards: React.FC<FileMarkerCardsProps> = ({
  textParts, onPreview, workitemId, projectPaths = [], hasPrototypeCards = false,
  hasUserStory = false, reviewFilePaths = [], isRunning = false,
}) => {
  if (hasUserStory || hasPrototypeCards || isRunning) return null;

  const { files } = useMemo(() => parseAllFilePaths(textParts), [textParts]);

  // 过滤：去掉工程目录下的文件、评审报告文件
  const visibleFiles = files.filter(path =>
    !projectPaths.some(proj => path === proj || path.startsWith(`${proj}/`)) &&
    !reviewFilePaths.includes(path),
  );

  if (visibleFiles.length === 0) return null;

  return (
    <div className="px-3 pb-2 flex flex-wrap gap-2">
      {visibleFiles.map(path => (
        <FileAttachmentCard key={path} path={path} onPreview={onPreview} workitemId={workitemId} />
      ))}
    </div>
  );
};

// ── ProjectMarkerCards: [[PROJECT:...]] ──

interface ProjectMarkerCardsProps {
  textParts: string[];
  onProjectPreview?: (path: string, mode: PreviewMode) => void;
  onPrototypePreview?: (path: string) => void;
  requirementTitle?: string;
  workitemId?: string;
  hasUserStory?: boolean;
  isRunning?: boolean;
}

/** 从文本中提取 [[PROJECT:...]] 标记，区分原型工程和普通工程，渲染对应卡片 */
export const ProjectMarkerCards: React.FC<ProjectMarkerCardsProps> = ({
  textParts, onProjectPreview, onPrototypePreview, requirementTitle, workitemId,
  hasUserStory = false, isRunning = false,
}) => {
  if (hasUserStory || isRunning) return null;

  const projectPaths = useMemo(() => {
    const allText = textParts.join('\n');
    return parseProjectMarkers(allText);
  }, [textParts]);

  // 原型工程路径：路径中包含 /products/prototypes/
  const prototypePaths = projectPaths.filter(p => p.includes(PROTOTYPE_DIR_SEGMENT));
  const prototypeRootPaths = useMemo(() => {
    const roots = new Set<string>();
    for (const p of prototypePaths) {
      const idx = p.indexOf(PROTOTYPE_DIR_SEGMENT);
      if (idx >= 0) {
        // 定位原型目录名之后第一个 '/'，截取到该处作为原型工程根路径。
        const slashIdx = p.indexOf('/', idx + PROTOTYPE_DIR_SEGMENT.length);
        const root = slashIdx > -1 ? p.substring(0, slashIdx) : p;
        roots.add(root);
      } else {
        roots.add(p);
      }
    }
    return [...roots];
  }, [prototypePaths]);

  const hasPrototypeCards = prototypeRootPaths.length > 0;
  const normalProjectPaths = hasPrototypeCards ? [] : projectPaths;

  return (
    <>
      {/* 原型工程卡片 */}
      {prototypeRootPaths.length > 0 && (
        <div className="px-3 pb-2 flex flex-col gap-2">
          {prototypeRootPaths.map(rootPath => (
            <PrototypeCard
              key={rootPath}
              path={rootPath}
              requirementTitle={requirementTitle}
              workitemId={workitemId}
              onPreview={onPrototypePreview}
            />
          ))}
        </div>
      )}

      {/* 普通工程卡片 */}
      {normalProjectPaths.length > 0 && (
        <div className="px-3 pb-2 flex flex-col gap-2">
          {normalProjectPaths.map(path => (
            <ProjectCard key={path} path={path} onPreview={onProjectPreview} />
          ))}
        </div>
      )}
    </>
  );
};

// ── CardMarkerRenderer: [[CARD:...]] ──

interface CardMarkerRendererProps {
  textParts: string[];
  fileAttachments: string[];
  isRunning?: boolean;
  // 用户故事
  onUserStoryPreview?: (data: UserStoryData) => void;
  activeUserStoryData?: UserStoryData | null;
  // 需求拆分
  onReqBreakdownPreview?: (data: RequirementBreakdownData) => void;
  activeReqBreakdownData?: RequirementBreakdownData | null;
  onReqBreakdownSubmit?: (items: RequirementItem[], options?: { jsonFilePath?: string }) => Promise<RequirementBreakdownSubmitResult>;
}

/** 从文本中提取 [[CARD:...]] 标记，根据类型渲染用户故事卡片或需求拆分卡片 */
export const CardMarkerRenderer: React.FC<CardMarkerRendererProps> = ({
  textParts, fileAttachments, isRunning = false,
  onUserStoryPreview, activeUserStoryData,
  onReqBreakdownPreview, activeReqBreakdownData, onReqBreakdownSubmit,
}) => {
  const allText = useMemo(() => textParts.join('\n'), [textParts]);
  const cardTypes = useMemo(() => parseCardTypes(allText), [allText]);

  const hasUserStoryFromMarker = cardTypes.includes('user_story');
  const hasReqBreakdownFromMarker = cardTypes.includes('req_breakdown');

  const textContent = allText;
  const userStoryData = useMemo(
    () => hasUserStoryFromMarker ? parseUserStoryFromText(textContent, fileAttachments[0] ?? '') : null,
    [hasUserStoryFromMarker, textContent, fileAttachments],
  );

  const { data: reqBreakdownData, loading: reqBreakdownLoading, error: reqBreakdownError } =
    useRequirementBreakdownData(allText, fileAttachments);

  const isUserStoryActive = (data: UserStoryData) =>
    activeUserStoryData != null &&
    activeUserStoryData.title === data.title &&
    activeUserStoryData.total === data.total;

  const isReqBreakdownActive = (data: RequirementBreakdownData | null) =>
    activeReqBreakdownData != null && data != null &&
    activeReqBreakdownData.title === data.title &&
    activeReqBreakdownData.total === data.total;

  if (isRunning) return null;

  return (
    <>
      {/* 需求拆分卡片 */}
      {hasReqBreakdownFromMarker && (
        <div className="px-3 py-2">
          <RequirementBreakdownCard
            data={reqBreakdownData}
            loading={reqBreakdownLoading}
            error={reqBreakdownError}
            isPreviewActive={isReqBreakdownActive(reqBreakdownData)}
            onPreview={onReqBreakdownPreview}
            onSubmit={onReqBreakdownSubmit}
            fileAttachments={fileAttachments}
          />
        </div>
      )}

      {/* 用户故事卡片 */}
      {hasUserStoryFromMarker && userStoryData && (
        <div className="px-3 py-2">
          <UserStoryCard
            data={userStoryData}
            isPreviewActive={isUserStoryActive(userStoryData)}
            onPreview={onUserStoryPreview}
          />
        </div>
      )}
    </>
  );
};

// ── ReviewReportMarkerRenderer: [[REVIEW_REPORT_...]] ──

interface ReviewReportMarkerRendererProps {
  textParts: string[];
  isRunning?: boolean;
  onReviewReportPreview?: (reportPath: string) => void;
  onReviewAdopt?: (data: ReviewReportData) => Promise<boolean>;
  onReviewFix?: (reportPath: string, projectName: string) => void;
  activePreviewPath?: string;
}

/** 从文本中解析评审报告标记并渲染评审报告卡片 */
export const ReviewReportMarkerRenderer: React.FC<ReviewReportMarkerRendererProps> = ({
  textParts, isRunning = false, onReviewReportPreview, onReviewAdopt, onReviewFix, activePreviewPath,
}) => {
  const allText = useMemo(() => textParts.join('\n'), [textParts]);
  const reviewReportData = useMemo(
    () => parseReviewReportFromText(allText),
    [allText],
  );

  if (!reviewReportData || isRunning) return null;

  return (
    <div className="px-3 py-2">
      <ReviewReportCard
        data={reviewReportData}
        onPreview={onReviewReportPreview}
        onAdopt={onReviewAdopt}
        onFix={onReviewFix}
        activePreviewPath={activePreviewPath}
      />
    </div>
  );
};

// ── PrdAnalysisMarkerRenderer: [[CARD:prd_analysis]] ──

interface PrdAnalysisMarkerRendererProps {
  allText: string;
  filePaths: string[];
}

/** 从文本解析 prd_analysis 标记，定位 analysis.json 并渲染竞品信息分析表格卡片 */
export const PrdAnalysisMarkerRenderer: React.FC<PrdAnalysisMarkerRendererProps> = ({
  allText, filePaths,
}) => {
  const hasPrdAnalysis = parseCardTypes(allText).includes('prd_analysis');
  if (!hasPrdAnalysis) return null;
  const jsonPath = filePaths.find((p) => p.endsWith('analysis.json'));
  if (!jsonPath) return null;
  return <PrdAnalysisCard jsonPath={jsonPath} />;
};

// ── ReqNameResolver: [[REQ_NAME:...]] ──

/**
 * 从文本中解析 [[REQ_NAME:...]] 标记，匹配需求列表返回 workitemId。
 * 非视觉组件，仅提供数据解析。
 */
export function resolveWorkitemIdFromText(
  textParts: string[],
  requirements: Array<{ id: string; title: string }> | undefined,
  fallbackTitle?: string,
  fallbackWorkitemId?: string,
): { requirementTitle: string; workitemId: string | undefined } {
  const allText = textParts.join('\n');
  const parsedName = parseReqName(allText);
  const requirementTitle = fallbackTitle || parsedName || '';

  let workitemId = fallbackWorkitemId;
  if (!workitemId && requirements && requirementTitle) {
    const normalized = requirementTitle.trim().toLowerCase();
    const matched = requirements.find(r => r.title.trim().toLowerCase() === normalized);
    if (matched) workitemId = matched.id;
  }

  return { requirementTitle, workitemId };
}

// ── MessageMarkers: 统一容器 ──

export interface MessageMarkersProps {
  textParts: string[];
  isRunning?: boolean;
  // 文件/工程
  onFilePreview?: (path: string) => void;
  onProjectPreview?: (path: string, mode: PreviewMode) => void;
  onPrototypePreview?: (path: string) => void;
  // 卡片
  onUserStoryPreview?: (data: UserStoryData) => void;
  activeUserStoryData?: UserStoryData | null;
  onReqBreakdownPreview?: (data: RequirementBreakdownData) => void;
  activeReqBreakdownData?: RequirementBreakdownData | null;
  onReqBreakdownSubmit?: (items: RequirementItem[], options?: { jsonFilePath?: string }) => Promise<RequirementBreakdownSubmitResult>;
  // 评审报告
  onReviewReportPreview?: (reportPath: string) => void;
  onReviewAdopt?: (data: ReviewReportData) => Promise<boolean>;
  onReviewFix?: (reportPath: string, projectName: string) => void;
  activePreviewPath?: string;
  // 需求
  requirementTitle?: string;
  workitemId?: string;
  requirements?: Array<{ id: string; title: string }>;
}

/**
 * 消息标记统一渲染容器。
 * 解析所有标记类型，按优先级渲染对应卡片组件。
 */
export const MessageMarkers: React.FC<MessageMarkersProps> = (props) => {
  const { textParts, isRunning, requirementTitle, workitemId, requirements } = props;

  // 解析需求名 -> workitemId
  const { requirementTitle: resolvedTitle, workitemId: resolvedWorkitemId } = useMemo(
    () => resolveWorkitemIdFromText(textParts, requirements, requirementTitle, workitemId),
    [textParts, requirements, requirementTitle, workitemId],
  );

  // 解析所有文件和工程路径
  const { files, projects } = useMemo(() => parseAllFilePaths(textParts), [textParts]);

  // 判断原型工程
  const prototypePaths = projects.filter(p => p.includes(PROTOTYPE_DIR_SEGMENT));
  const hasPrototypeCards = prototypePaths.length > 0;

  // 判断用户故事（需要 CARD:user_story 标记）
  const cardTypes = useMemo(() => parseCardTypes(textParts.join('\n')), [textParts]);
  const hasUserStory = cardTypes.includes('user_story');

  // 评审报告文件路径（已在评审卡片中展示，不再作为普通文件附件）
  const reviewReportData = useMemo(() => parseReviewReportFromText(textParts.join('\n')), [textParts]);
  const reviewFilePaths = reviewReportData ? [reviewReportData.reportPath] : [];

  return (
    <>
      <ProjectMarkerCards
        textParts={textParts}
        onProjectPreview={props.onProjectPreview}
        onPrototypePreview={props.onPrototypePreview}
        requirementTitle={resolvedTitle}
        workitemId={resolvedWorkitemId}
        hasUserStory={hasUserStory}
        isRunning={isRunning}
      />

      <FileMarkerCards
        textParts={textParts}
        onPreview={props.onFilePreview}
        workitemId={resolvedWorkitemId}
        projectPaths={projects}
        hasPrototypeCards={hasPrototypeCards}
        hasUserStory={hasUserStory}
        reviewFilePaths={reviewFilePaths}
        isRunning={isRunning}
      />

      <CardMarkerRenderer
        textParts={textParts}
        fileAttachments={files}
        isRunning={isRunning}
        onUserStoryPreview={props.onUserStoryPreview}
        activeUserStoryData={props.activeUserStoryData}
        onReqBreakdownPreview={props.onReqBreakdownPreview}
        activeReqBreakdownData={props.activeReqBreakdownData}
        onReqBreakdownSubmit={props.onReqBreakdownSubmit}
      />

      <ReviewReportMarkerRenderer
        textParts={textParts}
        isRunning={isRunning}
        onReviewReportPreview={props.onReviewReportPreview}
        onReviewAdopt={props.onReviewAdopt}
        onReviewFix={props.onReviewFix}
        activePreviewPath={props.activePreviewPath}
      />

      <PrdAnalysisMarkerRenderer
        allText={textParts.join('\n')}
        filePaths={files}
      />
    </>
  );
};
