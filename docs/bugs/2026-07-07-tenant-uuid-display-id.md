# 租户 ID 改为 UUID + 新增 display_id 展示 ID

## 现象

租户 ID 使用 `t1` 这样的短标识符作为主键，与用户 ID 和工作空间 ID（UUID4 去横线）格式不一致，且缺少独立的展示 ID。

## 根因

`tenants` 表 `id` 列既作为业务关联主键又作为展示标识，种子数据使用 `t1`、`__system__` 等硬编码值。

## 解决方案

### 数据库

- `tenants` 表新增 `display_id VARCHAR(20)` 列（展示用，如 `t1, t2...`）
- 原 `t1` 的 `id` 改为 UUID4 去横线格式（`d2e39f60241e48049c51155a124e83ba`），`display_id` 保留为 `t1`
- `__system__` 保持不变（系统租户，类似 `ws-default`）
- 级联更新 `users.tenant_id` 和 `workspaces.tenant_id` 从 `t1` 到新 UUID
- 创建 `tenant_display_id_seq` 序列，新租户自动生成 `t2, t3...`
- `display_id` 唯一索引（排除 `__system__`）

### 后端

- `packages/go-sdk/domain/identity/user.go`：`Tenant` 结构体新增 `DisplayID` 字段
- `apps/dh-backend/domain/identity/service/service.go`：
  - `scanTenant`：新增 `display_id` 列扫描
  - `ListTenants` / `GetTenant`：SELECT 新增 `display_id`
  - `CreateTenant`：从 `tenant_display_id_seq` 序列生成 `display_id`（`t1, t2...`），`id` 使用 UUID4 去横线

### 前端

- `apps/dh-frontend/src/types/index.ts`：`Tenant` 接口新增 `displayId: string`
- `apps/dh-frontend/src/pages/AdminPage.tsx`：租户列表展示 `displayId`，编辑弹窗标题显示 `displayId`，API 调用（update/delete/members/setAdmin）使用 `id`（UUID）

### 迁移脚本

- `infra/database/identity/migration-20260707-tenant-uuid-display-id.sql`：
  1. 新增 `display_id` 列，从 `id` 复制
  2. 生成 UUID 替换 `t1`（`__system__` 保持不变）
  3. 级联更新 `users.tenant_id` 和 `workspaces.tenant_id`
  4. 重建外键约束
  5. 创建 `tenant_display_id_seq` 序列（START 2）
  6. 创建 `display_id` 唯一索引

## 验证

- `go vet ./...`：0 warnings
- `npx tsc --noEmit`：0 errors
- `pnpm build`：全部通过
- API 测试：
  - `GET /api/v1/tenants` → `id=d2e39f60241e48049c51155a124e83ba`, `displayId=t1`
  - `POST /api/v1/tenants` → 新租户 `id=097ce313...`(UUID), `displayId=t2`（自动生成）
  - `GET /api/v1/workspaces/ws-default` → `tenantId=d2e39f60241e48049c51155a124e83ba`（UUID），正确继承租户策略
