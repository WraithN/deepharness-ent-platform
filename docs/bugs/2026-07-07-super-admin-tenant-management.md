# 超管空间管理改为租户管理 + 智能体策略从空间迁移到租户

## 现象

1. 超管的"空间管理"页面直接管理工作空间和智能体策略，缺少租户层管理。
2. 智能体策略存储在工作空间维度，同一租户下不同空间需要分别配置，无法统一管理。
3. 缺少租户管理员角色，无法将空间创建权限下放给租户级别。

## 根因

1. `tenants` 表仅有 `id`、`name`、`created_at` 字段，缺少智能体策略列。
2. 智能体策略（`agent_config_locked`、`locked_agent_keys`、`allowed_agent_keys`、`default_agent_configs`）存储在 `workspaces` 表，按空间维度管理。
3. `Workspaces` POST 处理器使用 `requireSuperAdmin` 校验，仅超管可创建空间。
4. `agentconfig` 服务的 `getWorkspaceAgentPolicy` 直接从 `workspaces` 表读取策略。
5. AdminPage 前端页面路由为 `/admin/spaces`，展示空间列表而非租户列表。
6. `identity` 模块缺少租户 CRUD API 和租户管理员分配 API。

## 解决方案

### 1. 数据库 Schema

- `infra/database/identity/schema.sql`：`tenants` 表新增 `agent_config_locked`、`locked_agent_keys`、`allowed_agent_keys`、`default_agent_configs` 列
- `infra/database/identity/migration-20260707-tenant-agent-policy.sql`：迁移脚本，添加列并将 ws-default 的智能体策略复制到租户 t1

### 2. 后端 Go SDK

- `packages/go-sdk/domain/identity/user.go`：`Tenant` 结构体新增 `AgentConfigLocked`、`LockedAgentKeys`、`AllowedAgentKeys`、`DefaultAgentConfigs` 字段

### 3. 后端 Identity 服务 — 租户 CRUD + 管理员分配

- `apps/dh-backend/domain/identity/service/service.go`：
  - 新增 `TenantPolicy`、`AgentConfigSnapshot`、`TenantMember` 类型
  - `UserService` 接口新增 `ListTenants`、`GetTenant`、`CreateTenant`、`UpdateTenant`、`DeleteTenant`、`ListTenantMembers`、`SetTenantAdmin` 方法
  - `DBUserService` 实现上述方法，租户 ID 使用 uuid4 去横线格式
  - `scanTenant` 辅助函数解析租户行（含智能体策略列）
  - `SetTenantAdmin` 通过更新 `users.platform_role` 实现租户管理员分配/取消
  - `ListTenants` 排除系统租户 `__system__`
  - `DeleteTenant` / `UpdateTenant` / `SetTenantAdmin` 拒绝操作系统租户

### 4. 后端 Identity Handler — 租户 API

- `apps/dh-backend/domain/identity/handler.go`：
  - 新增 `requireSuperAdmin` 权限校验
  - `Tenants`：GET 列表 + POST 创建
  - `TenantByID`：GET / PUT / DELETE
  - `TenantMembers`：GET 租户成员列表
  - `TenantMemberByID`：PUT 设置/取消租户管理员

### 5. 后端路由注册

- `apps/dh-backend/gateway/server/server.go`：新增 `/api/v1/tenants`、`/api/v1/tenants/{id}`、`/api/v1/tenants/{id}/members`、`/api/v1/tenants/{id}/members/{userId}` 路由，全部需要 Auth 中间件

### 6. 后端 Workspace — 创建权限改为租户管理员 + 移除空间级智能体策略

- `apps/dh-backend/domain/workspace/handler.go`：
  - 新增 `requireTenantAdmin`：校验用户为 `tenant_admin` 或 `super_admin`，返回租户 ID
  - `Workspaces` POST：从 `requireSuperAdmin` 改为 `requireTenantAdmin`，`tenantID` 从用户信息获取而非请求体
  - 创建空间时传空 `AgentPolicy{}`（策略从租户继承）
  - `WorkspaceByID` PUT：从 `requireSuperAdmin` 改为 `requireWorkspaceAdmin`，移除智能体策略更新（仅更新名称和描述），读取现有策略保持不变

### 7. 后端 Workspace DB — 智能体策略从租户 JOIN 继承

- `apps/dh-backend/domain/workspace/service/db_service.go`：
  - `CreateWorkspace`：初始化 nil slice 为空数组，避免 `pq.Array(nil)` 插入 NULL
  - `GetWorkspace` / `ListWorkspaces` / `ListMine` 的 SELECT 语句改为 `JOIN tenants t ON t.id = w.tenant_id`，智能体策略字段从 `t.agent_config_locked`、`t.locked_agent_keys`、`t.allowed_agent_keys`、`t.default_agent_configs` 读取

### 8. 后端 AgentConfig — 策略从租户读取

- `apps/dh-backend/domain/agentconfig/service/db_service.go`：`getWorkspaceAgentPolicy` 的 SQL 从 `SELECT ... FROM workspaces WHERE id = $1` 改为 `SELECT t.* FROM workspaces w JOIN tenants t ON t.id = w.tenant_id WHERE w.id = $1`

### 9. 前端类型 + API

- `apps/dh-frontend/src/types/index.ts`：`Tenant` 接口新增智能体策略字段 + `createdAt`，新增 `TenantMember` 接口
- `apps/dh-frontend/src/lib/tenant-api.ts`：新增 `tenantApi`（list / get / create / update / delete / members / setAdmin）

### 10. 前端 AdminPage — 空间管理改为租户管理

- `apps/dh-frontend/src/pages/AdminPage.tsx`：
  - 导入改为 `tenantApi`、`Tenant`、`TenantMember`、`PLATFORM_ROLE`
  - 状态变量从 workspace 改为 tenant（`tenants`、`editingTenant`、`newTenantName` 等）
  - API 调用从 `workspaceApi` 改为 `tenantApi`
  - 表格列：租户ID、租户名称、允许的智能体、锁定状态、创建时间、操作
  - 编辑弹窗：租户名称 + `AgentPolicyForm`（智能体策略） + 租户成员管理（展示成员列表，设为/取消租户管理员）
  - 移除空间成员的添加/移除/职能子角色功能（租户成员由超管在用户管理中维护）
  - `getTitle()` 路由从 `/admin/spaces` 改为 `/admin/tenants`

### 11. 前端 AdminLayout + Routes

- `apps/dh-frontend/src/components/AdminLayout.tsx`：侧边栏"空间管理"改为"租户管理"，路由 `/admin/spaces` 改为 `/admin/tenants`
- `apps/dh-frontend/src/Routes.tsx`：路由 `spaces` 改为 `tenants`

### 12. 前端 Settings

- `apps/dh-frontend/src/pages/Settings.tsx`：锁提示文案从"当前空间"改为"当前租户"

### 验证

- `go vet ./...`：0 warnings
- `npx tsc --noEmit -p tsconfig.check.json`：0 errors
- `npx biome lint`：无 lint 错误
- `pnpm build`：全部 6 个包构建成功
- API 端到端测试：
  - GET `/api/v1/tenants` → 返回 t1（含智能体策略）
  - POST `/api/v1/tenants` → 创建新租户（含锁定策略）
  - PUT `/api/v1/tenants/t1/members/{userId}` → 设置/取消租户管理员
  - POST `/api/v1/workspaces`（tenant_admin 身份）→ 成功创建空间
  - GET `/api/v1/workspaces/{id}` → 工作空间返回租户的智能体策略（通过 JOIN）
