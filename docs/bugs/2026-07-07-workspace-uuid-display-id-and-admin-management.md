# 空间 ID 改为 UUID4 去横线 + 空间管理支持设置空间管理员

## 现象

1. 空间 ID 使用带横线的 UUID（36 字符），与用户 ID（去横线 32 字符）格式不一致。
2. 超管在空间管理页面无法直接管理空间成员和设置空间管理员，需要切换到空间设置页操作。

## 根因

1. `CreateWorkspace` 使用 `uuid.New().String()` 生成带横线的 UUID，且空间没有独立的展示 ID（自增序号）。
2. `AdminPage.tsx` 的空间管理区域仅有 CRUD（创建/编辑/删除）和智能体策略配置，缺少成员管理 UI。虽然 `workspace-api.ts` 已暴露成员管理 API，但 AdminPage 未对接。

## 解决方案

### 1. 空间 ID 改为 UUID4 去横线 + 新增 display_id

#### Go SDK 领域模型
- `packages/go-sdk/domain/workspace/workspace.go`：Workspace 结构体新增 `DisplayID string` 字段

#### 后端服务层
- `apps/dh-backend/domain/workspace/service/db_service.go`：
  - `CreateWorkspace`：ID 改为 `strings.ReplaceAll(uuid.New().String(), "-", "")`（32 字符无横线）
  - 新增 `nextWorkspaceDisplayIDTx` 方法：在事务中按租户分组取最大序号，生成 `w1, w2...` 格式的展示 ID
  - INSERT 语句新增 `display_id` 列
  - `scanWorkspace` / `scanWorkspaceRows`：新增 `DisplayID` 字段扫描
  - `GetWorkspace` / `ListWorkspaces` / `ListMine` 的 SELECT 语句新增 `display_id` 列

#### 数据库 Schema
- `infra/database/workspace/schema.sql`：`workspaces` 表新增 `display_id VARCHAR(20)` 列 + 租户内唯一索引
- `infra/database/workspace/migration-20260707-workspace-display-id.sql`：
  - 新增 `display_id` 列
  - 按租户分组、按创建时间排序回填 `w1, w2...`
  - 将已有空间 ID 去横线（同时更新所有子表的外键引用）

#### 前端
- `apps/dh-frontend/src/types/index.ts`：`Workspace` 接口新增 `displayId: string`
- `apps/dh-frontend/src/lib/api-types.ts`：`MineWorkspaceDTO` 接口新增 `displayId: string`
- `apps/dh-frontend/src/pages/AdminPage.tsx`：空间列表表格新增"空间ID"列，展示 `displayId`

### 2. 空间管理支持设置空间管理员（成员管理与编辑空间合并）

- `apps/dh-frontend/src/pages/AdminPage.tsx`：
  - 移除独立的"成员"按钮和成员管理弹窗
  - 将成员管理区域直接嵌入**编辑空间弹窗**（AgentPolicyForm 下方），包括：
    - **添加成员区域**：邮箱输入 + 空间角色选择（空间管理员/普通成员）+ 职能子角色选择（开发/测试/产品/设计）
    - **成员列表表格**：展示成员 ID、信息、空间角色徽章、职能标签
    - **操作按钮**：每行可"设为管理员"/"取消管理员"切换空间角色，可删除成员（带 AlertDialog 确认）
  - 新建空间后自动打开编辑弹窗，便于立即管理成员
  - 对接已有 API：`workspaceApi.members` / `addMember` / `updateMemberRole` / `removeMember`

### 验证

- `go vet ./...`：0 warnings
- `npx tsc --noEmit -p tsconfig.check.json`：0 errors
- `npx biome lint`：无 lint 错误
- `pnpm build`：全部 6 个包构建成功
- 前端 dev server（port 8890）和后端（port 8080）均正常响应 HTTP 200
