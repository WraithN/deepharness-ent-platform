/**
 * 角色常量与类型 — 三维角色模型的单一事实来源
 *
 * 维度说明（详见 docs/user-role-system-design.md）：
 * - 平台角色 PlatformRole：决定登录入口（super_admin 进超管后台），存于 users.platform_role
 * - 空间权限 SpaceRole：决定空间内管理权限，存于 workspace_members.role
 * - 职能子角色 SubRole：决定功能可见性（仅对 member 生效收敛），存于 workspace_members.sub_role
 *
 * 覆盖规则：space_admin 看全部功能，sub_role 仅作身份展示；功能收敛只对 member 生效。
 */

// ── 平台角色 ──
export const PLATFORM_ROLE = {
  SUPER_ADMIN: 'super_admin',
  TENANT_ADMIN: 'tenant_admin',
  USER: 'user',
} as const;

export type PlatformRole = (typeof PLATFORM_ROLE)[keyof typeof PLATFORM_ROLE];

// ── 空间权限角色 ──
export const SPACE_ROLE = {
  SPACE_ADMIN: 'space_admin',
  MEMBER: 'member',
} as const;

export type SpaceRole = (typeof SPACE_ROLE)[keyof typeof SPACE_ROLE];

// ── 职能子角色 ──
export const SUB_ROLE = {
  PM: 'pm',
  DESIGNER: 'designer',
  DEVELOPER: 'developer',
  TESTER: 'tester',
} as const;

export type SubRole = (typeof SUB_ROLE)[keyof typeof SUB_ROLE];

// 隐藏"设置/数据大盘/工程代码"的职能集合（仅对 member 生效）
export const RESTRICTED_SUB_ROLES: ReadonlySet<SubRole> = new Set<SubRole>([
  SUB_ROLE.PM,
  SUB_ROLE.DESIGNER,
]);

// 系统租户 ID，承载不绑定业务租户的超级管理员
export const SYSTEM_TENANT_ID = '__system__';

// ── 角色标签映射（规则 6：统一封装，避免各页面 if/else 重复）──

const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  [PLATFORM_ROLE.SUPER_ADMIN]: '超级管理员',
  [PLATFORM_ROLE.TENANT_ADMIN]: '租户管理员',
  [PLATFORM_ROLE.USER]: '普通用户',
};

const SPACE_ROLE_LABELS: Record<SpaceRole, string> = {
  [SPACE_ROLE.SPACE_ADMIN]: '空间管理员',
  [SPACE_ROLE.MEMBER]: '成员',
};

const SUB_ROLE_LABELS: Record<SubRole, string> = {
  [SUB_ROLE.PM]: '产品经理',
  [SUB_ROLE.DESIGNER]: 'UI设计师',
  [SUB_ROLE.DEVELOPER]: '开发人员',
  [SUB_ROLE.TESTER]: '测试人员',
};

export function getPlatformRoleLabel(role: PlatformRole): string {
  return PLATFORM_ROLE_LABELS[role] ?? role;
}

export function getSpaceRoleLabel(role: SpaceRole): string {
  return SPACE_ROLE_LABELS[role] ?? role;
}

export function getSubRoleLabel(role: SubRole | string | undefined): string {
  if (!role) return '';
  return SUB_ROLE_LABELS[role as SubRole] ?? role;
}
