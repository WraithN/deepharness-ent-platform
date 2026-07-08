import { useAuth } from '@/contexts/AuthContext';
import { PLATFORM_ROLE, SPACE_ROLE, RESTRICTED_SUB_ROLES } from '@/lib/role-constants';

/**
 * 权限判定 Hook
 *
 * 规则（详见 docs/user-role-system-design.md §2/§3）：
 * - super_admin：进入超管后台，不进工作空间
 * - space_admin：覆盖职能限制，看全部功能；可编辑空间设置
 * - member：按 subRole 收敛——pm/designer 隐藏 设置/数据大盘；developer/tester 看全部
 *   代码空间（研发/产品/设计空间）对所有成员可见，仅展示名称随角色变化。
 */
export interface Permissions {
  isSuperAdmin: boolean;
  isAuthenticated: boolean;
  canViewCode: boolean;
  canViewDashboard: boolean;
  canViewSettings: boolean;
  canEditSettings: boolean;
}

export function usePermissions(): Permissions {
  const { user, membership } = useAuth();

  const isSuperAdmin = user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
  const isSpaceAdmin = membership?.spaceRole === SPACE_ROLE.SPACE_ADMIN;

  // 功能收敛仅对 member 生效；pm/designer 隐藏数据大盘与设置，但仍可查看代码空间。
  const restrictedForDashboardAndSettings =
    !isSpaceAdmin &&
    !!membership?.subRole &&
    RESTRICTED_SUB_ROLES.has(membership.subRole);

  return {
    isSuperAdmin,
    isAuthenticated: !!user,
    canViewCode: true,
    canViewDashboard: !restrictedForDashboardAndSettings,
    canViewSettings: !restrictedForDashboardAndSettings,
    canEditSettings: isSpaceAdmin,
  };
}
