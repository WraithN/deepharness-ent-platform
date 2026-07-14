import type { PromptStatus } from '@/types';

export type ReviewAction = 'approve' | 'reject' | 'unshelf';

export interface ReviewActionItem {
  label: string;
  action: ReviewAction;
}

export const ALL_FILTER_VALUE = 'all';

// 各审核状态下可用的操作（技能管理/提示词管理的 MoreHorizontal 菜单共用，规则6）：
// 审核中可 approve/reject；已上架仅可下架；已下架/已拒绝可重新上架（approve）。
export const REVIEW_ACTIONS_BY_STATUS: Record<PromptStatus, ReviewActionItem[]> = {
  pending_review: [
    { label: '审核通过', action: 'approve' },
    { label: '拒绝', action: 'reject' },
  ],
  on_shelf: [{ label: '下架', action: 'unshelf' }],
  off_shelf: [{ label: '上架', action: 'approve' }],
  rejected: [{ label: '上架', action: 'approve' }],
};

interface CategoryRef {
  id: string;
  name: string;
}

/**
 * 多分类筛选匹配：'all' 命中全部；旧单分类文本命中，或链接分类（categoryIds）中任意一个名称命中。
 * 兼容 links 为空的存量数据（category/use_case 兜底）。
 */
export function matchCategoryFilter(
  filter: string,
  singleCategory: string,
  categoryIds: string[] | undefined,
  categories: CategoryRef[]
): boolean {
  if (filter === ALL_FILTER_VALUE) {
    return true;
  }
  if (singleCategory === filter) {
    return true;
  }
  return (categoryIds ?? []).some((id) => categories.find((c) => c.id === id)?.name === filter);
}
