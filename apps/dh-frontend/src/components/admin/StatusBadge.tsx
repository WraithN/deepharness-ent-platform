import { Badge } from '@/components/ui/badge';
import type { PromptStatus } from '@/types';

const BADGE_BASE_CLASS = 'rounded-lg px-3 py-1.5 font-medium';

interface StatusBadgeConfig {
  label: string;
  variant: 'default' | 'outline';
  className: string;
}

// 审核生命周期状态徽章配色：上架=绿，审核中=琥珀，下架=灰（outline），拒绝=红（含 dark 适配）。
// 技能管理与提示词管理共用（规则6）。
const STATUS_BADGE_CONFIG: Record<PromptStatus, StatusBadgeConfig> = {
  on_shelf: {
    label: '已上架',
    variant: 'default',
    className: 'bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400',
  },
  pending_review: {
    label: '审核中',
    variant: 'default',
    className: 'bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  },
  off_shelf: {
    label: '已下架',
    variant: 'outline',
    className: '',
  },
  rejected: {
    label: '已拒绝',
    variant: 'default',
    className: 'bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  },
};

interface StatusBadgeProps {
  status?: PromptStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_BADGE_CONFIG[status ?? 'on_shelf'];
  return (
    <Badge variant={config.variant} className={`${BADGE_BASE_CLASS} ${config.className}`}>
      {config.label}
    </Badge>
  );
}
