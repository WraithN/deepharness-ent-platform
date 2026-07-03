import { useAuth } from '@/contexts/AuthContext';
import { PLATFORM_ROLE, SPACE_ROLE, RESTRICTED_SUB_ROLES } from '@/lib/role-constants';

/**
 * 权限判定 Hook
 *
 * 规则（详见 docs/user-role-system-design.md §2/§3）：
 * - super_admin：进入超管后台，不进工作空间
 * - space_admin：覆盖职能限制，看全部功能；可编辑空间设置
 * - member：按 subRole 收敛——pm/designer 隐藏 设置/数据大盘/工程代码；developer/tester 看全部
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

  // 功能收敛仅对 member 生效；pm/designer 为受限职能
  const restricted =
    !isSpaceAdmin &&
    !!membership?.subRole &&
    RESTRICTED_SUB_ROLES.has(membership.subRole);

  return {
    isSuperAdmin,
    isAuthenticated: !!user,
    canViewCode: !restricted,
    canViewDashboard: !restricted,
    canViewSettings: !restricted,
    canEditSettings: isSpaceAdmin,
  };
}
