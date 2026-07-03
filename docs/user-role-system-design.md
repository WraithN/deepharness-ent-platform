# 用户体系与角色权限重构 — 设计方案

> 创建日期：2026-07-01
> 状态：设计评审中
> 关联：`review.md` P0-2/P0-3、`AGENTS.md` 规则 4/5/7、`apps/web/docs/prd.md` §3.2/§3.3/§4.1

---

## 1. 背景与目标

### 1.1 现状问题

当前用户体系处于 mock 阶段，存在以下问题（详见 `review.md`）：

1. **数据库已具备基础但未用足**：
   - `infra/database/identity/schema.sql:23` 的 `users` 表仅有 `role` 单列（默认 `'user'`），混装了平台角色与职能角色。
   - `infra/database/workspace/schema.sql:40` 的 `workspace_members` 已设计 `role` + `sub_role` 双列，但取值未规范化、无注释约束。
   - 缺少 `super_admin`（超级管理员）概念，无法支撑 PRD §3.3 的超管后台。

2. **前端 mock 泛滥，角色判定混乱**：
   - `apps/web/src/contexts/AuthContext.tsx:40` 为占位实现，`AuthUser` 无角色字段。
   - `apps/web/src/pages/Login.tsx:32-43` 靠用户名字符串判定角色，写入 `localStorage.userRole`。
   - `apps/web/src/components/layout.tsx:46` 硬编码 `DEFAULT_USER`，7 项导航对所有角色全展示。
   - `apps/web/src/types/index.ts:5` 的 `User.role: 'admin'|'developer'|'designer'|'pm'|'tester'` 把"管理维度"与"职能维度"混在一个枚举。
   - `apps/web/src/pages/Settings.tsx:289` 把 `admin` 映射成 `subRole='pm'`，逻辑已错乱。

### 1.2 目标

- 删除所有用户/角色相关 mock，接入真实 identity 接口（接口未就绪前以 service 层封装 mock，便于无缝切换）。
- 建立三维正交角色模型，消除"空间管理员 vs PM/设计师/开发者"的维度混淆。
- 实现按角色过滤导航与路由守卫：超管进超管后台；PM/设计师隐藏 设置/数据大盘/工程代码；空间管理员与开发者/测试保留全部。
- 全程遵循 `AGENTS.md` 规则 7（禁止魔法值，角色字符串全部常量化）。

---

## 2. 三维角色模型

将"角色"拆成三个正交维度，分别承载于不同表/字段：

| 维度 | 字段 | 取值 | 决定 |
|------|------|------|------|
| **平台角色** | `users.platform_role` | `super_admin` / `tenant_admin` / `user` | 登录入口、能否进超管后台 |
| **空间权限** | `workspace_members.role` | `space_admin` / `member` | 空间内管理权限（编辑设置/管成员） |
| **职能子角色** | `workspace_members.sub_role` | `pm` / `designer` / `developer` / `tester` | 功能可见性（仅对 member 生效） |

### 2.1 维度正交性说明

- **空间管理员与职能角色不在同一维度**：`space_admin` 是"管理权限轴"，`pm/designer/developer/tester` 是"职能轴"。一个空间管理员本身也可能是开发者（`role=space_admin, sub_role=developer`）。
- **覆盖规则**（已与用户确认）：`space_admin` 拥有全部功能，`sub_role` 仅作身份展示（如"空间管理员·开发者"）。功能收敛只对 `member` 生效。
- **super_admin 不绑定租户/空间**（已与用户确认）：通过系统租户 `__system__` 承载，`users.tenant_id` 指向 `__system__` 的租户行，保持 NOT NULL 与 FK 完整性。

### 2.2 平台角色职责

| 平台角色 | 绑定 | 登录后入口 | 权限 |
|----------|------|-----------|------|
| `super_admin` | 系统租户 `__system__` | `/admin/dashboard`（超管后台） | 全局配置、空间管理、技能/提示词审核 |
| `tenant_admin` | 业务租户 | `/chat`（工作空间） | 租户内全部工作空间的管理 |
| `user` | 业务租户 | `/chat`（工作空间） | 按 `workspace_members` 收敛 |

> 说明：本次暂不实现 `tenant_admin` 的差异化 UI（PRD §4.1 中"租户管理员可编辑空间设置"由 `space_admin` 承载）。`tenant_admin` 保留枚举位，后续迭代。

---

## 3. 权限矩阵

功能可见性规则（仅对平台角色 `user` 且空间权限 `member` 生效收敛；`super_admin`/`space_admin`/`tenant_admin` 看全部）：

| 功能 | super_admin | space_admin | member·developer | member·tester | member·pm | member·designer |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| 超管后台 `/admin/*` | ✅ | — | — | — | — | — |
| 智能会话 `/chat` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 技能市场 `/market/skills` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 提示词市场 `/market/prompts` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 需求 `/requirements` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 智能评审 `/review` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 智能测试 `/testing` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 虾班智守 `/personal-assistant` | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| **工程代码 `/code`** | — | ✅ | ✅ | ✅ | ❌ | ❌ |
| **数据大盘 `/dashboard`** | — | ✅ | ✅ | ✅ | ❌ | ❌ |
| **空间设置 `/settings`** | — | ✅(可编辑) | ✅(只读) | ✅(只读) | ❌ | ❌ |

> "—":该角色不进入该视图（super_admin 不进工作空间；工作空间角色不进超管后台）。
> 设置页"可编辑 vs 只读"由 `space_admin` 决定（替代旧 `Settings.tsx:28` 的 `localStorage.userRole==='user'` 判定）。

---

## 4. 数据库 Schema 变更

### 4.1 identity schema

```sql
-- 1) 新增系统租户 __system__，承载 super_admin
INSERT INTO tenants (id, name) VALUES ('__system__', '系统租户（超级管理员承载）')
ON CONFLICT (id) DO NOTHING;

-- 2) users 表：role → platform_role 语义化重命名 + CHECK 约束
ALTER TABLE users RENAME COLUMN role TO platform_role;
ALTER TABLE users ADD CONSTRAINT chk_users_platform_role
  CHECK (platform_role IN ('super_admin', 'tenant_admin', 'user'));

-- 3) super_admin 必须归属系统租户
ALTER TABLE users ADD CONSTRAINT chk_users_super_admin_tenant
  CHECK (platform_role <> 'super_admin' OR tenant_id = '__system__');

-- 4) 种子用户调整：u1 改为 super_admin（归属 __system__），其余按职能设定
UPDATE users SET platform_role = 'super_admin', tenant_id = '__system__'
  WHERE id = 'u1';
```

> 说明：`tenant_id` 保持 NOT NULL，super_admin 指向 `__system__`，FK 完整。原 `role='admin'` 语义迁移到 `platform_role`。

### 4.2 workspace schema

`workspace_members` 表结构无需变更，仅明确取值集并补注释：

```sql
COMMENT ON COLUMN workspace_members.role IS
  '空间权限角色：space_admin（空间管理员，可编辑设置/管成员）| member（普通成员）';
COMMENT ON COLUMN workspace_members.sub_role IS
  '职能子角色（仅 member 生效收敛）：pm | designer | developer | tester。space_admin 此字段仅作身份展示。';

ALTER TABLE workspace_members ADD CONSTRAINT chk_wm_role
  CHECK (role IN ('space_admin', 'member'));
ALTER TABLE workspace_members ADD CONSTRAINT chk_wm_sub_role
  CHECK (sub_role IS NULL OR sub_role IN ('pm', 'designer', 'developer', 'tester'));
```

### 4.3 迁移文件

新增 `infra/database/identity/migration-20260701-platform-role.sql` 与 `infra/database/workspace/migration-20260701-member-role.sql`，内容即上述 DDL。按现有 `workspace/migration-20260616.sql` 的命名约定。

---

## 5. 前端类型定义

### 5.1 新增角色常量（规则 7：禁止魔法值）

新建 `apps/web/src/lib/role-constants.ts`：

```ts
// 平台角色
export const PLATFORM_ROLE = {
  SUPER_ADMIN: 'super_admin',
  TENANT_ADMIN: 'tenant_admin',
  USER: 'user',
} as const;
export type PlatformRole = typeof PLATFORM_ROLE[keyof typeof PLATFORM_ROLE];

// 空间权限角色
export const SPACE_ROLE = {
  SPACE_ADMIN: 'space_admin',
  MEMBER: 'member',
} as const;
export type SpaceRole = typeof SPACE_ROLE[keyof typeof SPACE_ROLE];

// 职能子角色
export const SUB_ROLE = {
  PM: 'pm',
  DESIGNER: 'designer',
  DEVELOPER: 'developer',
  TESTER: 'tester',
} as const;
export type SubRole = typeof SUB_ROLE[keyof typeof SUB_ROLE];

// 隐藏"设置/数据大盘/工程代码"的职能集合
export const RESTRICTED_SUB_ROLES: ReadonlySet<SubRole> = new Set([
  SUB_ROLE.PM,
  SUB_ROLE.DESIGNER,
]);

// 系统租户 ID
export const SYSTEM_TENANT_ID = '__system__';
```

### 5.2 修改 `apps/web/src/types/index.ts`

```ts
// 旧（删除）：role: 'admin' | 'developer' | 'designer' | 'pm' | 'tester';
// 新：拆为平台角色 + 职能
export interface User {
  id: string;
  name: string;
  avatar?: string;
  platformRole: PlatformRole;   // 替代旧 role
  subRole?: SubRole;            // 仅展示用
  joinedAt: string;
}

// workspace_members 类型对齐 DB 取值集
export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: SpaceRole;              // 旧 'admin'|'user' → 'space_admin'|'member'
  subRole?: SubRole;
  joinedAt: string;
}
```

---

## 6. AuthContext 改造

`apps/web/src/contexts/AuthContext.tsx` 由占位实现改为 service 层调用，context 暴露三维角色：

```ts
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  tenantId: string;
}
export interface WorkspaceMembership {
  workspaceId: string;
  spaceRole: SpaceRole;
  subRole?: SubRole;
}
interface AuthContextType {
  user: AuthUser | null;
  membership: WorkspaceMembership | null; // 当前工作空间成员关系
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}
```

登录成功后：
1. 后端返回 `platformRole`。
2. 若 `platformRole === PLATFORM_ROLE.SUPER_ADMIN` → `navigate('/admin/dashboard')`。
3. 否则拉取用户的工作空间成员关系（`GET /api/v1/workspaces/mine`），取默认空间写入 `membership` → `navigate('/chat')`。

> 接口未就绪前，service 层（`src/services/auth.ts`、`src/services/workspace.ts`）返回 mock Promise，但**类型与字段必须与真实接口一致**，便于后续替换（对应 `review.md` P1-6 的 Service/API 层建议）。

---

## 7. 权限判定 Hook

新建 `apps/web/src/hooks/usePermissions.ts`（规则 4：嵌套≤3，规则 6：封装重复逻辑）：

```ts
export interface Permissions {
  isSuperAdmin: boolean;
  canViewCode: boolean;
  canViewDashboard: boolean;
  canViewSettings: boolean;
  canEditSettings: boolean;
}
export function usePermissions(): Permissions {
  const { user, membership } = useAuth();
  const isSuperAdmin = user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
  const isSpaceAdmin = membership?.spaceRole === SPACE_ROLE.SPACE_ADMIN;
  // space_admin 与 developer/tester 看全部；pm/designer 收敛
  const restricted =
    !isSpaceAdmin &&
    !!membership?.subRole &&
    RESTRICTED_SUB_ROLES.has(membership.subRole);
  return {
    isSuperAdmin,
    canViewCode: !restricted,
    canViewDashboard: !restricted,
    canViewSettings: !restricted,
    canEditSettings: isSpaceAdmin,
  };
}
```

---

## 8. 导航过滤与路由守卫

### 8.1 导航过滤（`apps/web/src/components/layout.tsx`）

每个 `navItems` 项增加 `requiredPermission` 字段，渲染前用 `usePermissions()` 过滤：

```ts
const NAV_ITEMS = [
  { path: '/market/skills', label: '技能市场', icon: Store },
  { path: '/market/prompts', label: '提示词市场', icon: MessageSquare },
  { path: '/chat', label: '智能会话', icon: MessageCircle },
  { path: '/code', label: '工程代码', icon: Code2, perm: 'canViewCode' },
  { path: '/dashboard', label: '数据大盘', icon: LayoutDashboard, perm: 'canViewDashboard' },
  { path: '/personal-assistant', label: '虾班智守', icon: Bot },
  { path: '/settings', label: '空间设置', icon: Settings, perm: 'canViewSettings' },
] as const;
```

同时删除 `layout.tsx:46` 的硬编码 `DEFAULT_USER`，改用 `useAuth().user`。

### 8.2 路由守卫（`apps/web/src/routes.tsx`）

新增两个守卫组件：
- `<RequireSuperAdmin>`：包裹 `/admin/*`，非 super_admin 重定向到 `/chat`。
- `<RequireWorkspace>`：包裹工作空间路由，未登录或无 membership 重定向到 `/login`；内部用 `<PermissionRoute perm="canViewCode">` 等守卫受限页面。

```tsx
<Route path="/admin" element={<RequireSuperAdmin><AdminLayout /></RequireSuperAdmin>}>
  ...
</Route>
<Route path="/" element={<RequireWorkspace><Layout /></RequireWorkspace>}>
  <Route path="code" element={<PermissionRoute perm="canViewCode"><ProjectCode /></PermissionRoute>} />
  ...
</Route>
```

---

## 9. Mock 清理清单

| 位置 | 操作 |
|------|------|
| `pages/Login.tsx:32-43` | 删除字符串判定与 `localStorage.userRole`，改调 `signIn()` |
| `components/layout.tsx:46` | 删除 `DEFAULT_USER` 硬编码 |
| `pages/Dashboard.tsx:55` | 删除 `userRole === 'superadmin'` 分支，改用 `usePermissions().isSuperAdmin` |
| `pages/Settings.tsx:28` | 删除 `localStorage.getItem('userRole')`，改用 `canEditSettings` |
| `pages/Settings.tsx:289` | 修正 admin→subRole=pm 的错误映射，按新模型 `role=space_admin/member`、`subRole` 独立 |
| `pages/Settings.tsx:857` | 邀请角色下拉改为"空间管理员/产品经理/设计师/开发者/测试"，写库时映射到 `role`+`subRole` |
| `pages/Profile.tsx:83` | role 标签改用常量映射表 |
| `mock/data.ts` `n` | 删除或迁移到 service 层 mock |

---

## 10. 实施步骤

1. **DB 迁移**：新增两个 migration 文件，本地执行验证种子用户（u1 超管、u2/u3/u4 各职能）。
2. **后端 identity 接口**（如本次范围含后端）：`POST /api/v1/auth/signin` 返回 `platformRole`；`GET /api/v1/workspaces/mine` 返回成员关系。本次可先以前端 service mock 推进。
3. **前端类型与常量**：新建 `role-constants.ts`，改 `types/index.ts`。
4. **AuthContext + service 层**：实现 `signIn`/`signOut`，暴露 `membership`。
5. **usePermissions Hook**。
6. **导航过滤 + 路由守卫**。
7. **Settings/Profile/Dashboard 角色逻辑替换**。
8. **编译验证**（规则 1/8）：`pnpm build` + `pnpm check-types` + `go vet ./...` 0 warnings。
9. **启动验证**（规则 1）：`pnpm dev`，分别用 super_admin / pm / developer 账号登录验证跳转与导航。

---

## 11. 遵循的 AGENTS.md 规则

| 规则 | 落实点 |
|------|--------|
| 规则 4 嵌套≤3 | `usePermissions` 用 Guard Clause；导航过滤用 `filter` |
| 规则 5 复杂逻辑注释 | 三维模型判定、覆盖规则处补注释 |
| 规则 6 重复逻辑封装 | 角色标签映射、权限判定收口到 Hook |
| 规则 7 禁止魔法值 | 全部角色字符串进 `role-constants.ts` |
| 规则 8 warnings 清零 | 改完跑 `tsc --noEmit` 与 `go vet` |
| 规则 9 DESIGN.md | 若涉及导航/角色徽章样式变更，同步更新 `DESIGN.md` |

---

## 12. 待确认 / 后续

- `tenant_admin` 的差异化 UI 本次不做，保留枚举位。
- 后端 `/api/v1/auth/*` 与 `/api/v1/workspaces/mine` 是否本次一并实现，还是前端 service mock 先行？（默认后者）
- 多工作空间切换（一个用户属于多个空间）本次默认取第一个，切换器后续迭代。
