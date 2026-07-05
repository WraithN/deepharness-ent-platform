# 提示词市场状态审核与空间提示词管理设计

## 背景与目标

当前提示词市场（`/market/prompts`）的提示词没有状态，新建即全员可见；也没有区分「复制」与「添加到工作空间」的权限。本设计引入提示词审核流与空间级提示词管理，实现：

1. 提示词状态：`pending_review`（审核中）、`on_shelf`（已上架）、`off_shelf`（已下架）、`rejected`（已拒绝）。
2. 新建提示词默认进入 `pending_review`，仅创建人与超级管理员可见。
3. 超级管理员审核后可变为 `on_shelf`/`rejected`/`off_shelf`。
4. `on_shelf` 的提示词全平台所有租户可见。
5. 仅租户管理员（`tenant_admin`）可将已上架提示词「添加」到工作空间；其他用户只能复制内容到剪贴板。
6. 工作空间拥有独立的 `workspace_prompts` 列表，在空间设置「提示词配置」标签页管理。
7. 智能会话（`Chat`）根据当前工作空间加载该空间的提示词列表。

## 方案概述（方案 A）

- **提示词库**：复用并扩展现有 `team_prompts` 表作为全平台提示词库（跨租户共享）。
- **空间提示词**：启用 `workspace_prompts` 表，记录每个工作空间引用的提示词（`library_prompt_id` 关联 `team_prompts`）。
- **后端**：
  - 扩展 `team` 域的 Prompt 模型、Service、Handler，支持状态、创建人、审核人字段与审核接口。
  - 新增 `workspace` 域的 Prompt 子服务/Handler，处理添加到空间、移除、按空间列出。
  - 新增 `tenant_admin` 校验中间件辅助函数。
- **前端**：
  - `PromptMarket`：创建后进入审核中；租户管理员显示「添加到空间」，普通用户显示「复制」；超管在市场中也可快捷审核。
  - `AdminPage` 提示词管理：真实数据，支持按状态筛选与审核操作。
  - `Settings` 提示词配置标签页：改为加载 `workspace_prompts`，租户管理员可打开市场弹窗添加，成员可复制，管理员可移除。
  - `Chat`：加载当前工作空间的提示词，而非全量市场提示词。

## 数据模型

### team_prompts（扩展）

```sql
ALTER TABLE team_prompts
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(36),
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(36),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD CONSTRAINT chk_team_prompts_status CHECK (status IN ('pending_review', 'on_shelf', 'off_shelf', 'rejected'));

-- 存量数据兼容：全部视为已上架
UPDATE team_prompts SET status = 'on_shelf' WHERE status = 'pending_review';
```

字段说明：

| 字段 | 说明 |
|---|---|
| `status` | 审核中 / 已上架 / 已下架 / 已拒绝 |
| `created_by` | 创建人 user id，用于审核中/被拒绝时让创建人可见 |
| `reviewed_by` | 审核人 user id |
| `reviewed_at` | 审核时间 |

`added_to_space` 字段在本次改造后逐步弃用，改由 `workspace_prompts` 维护空间关联。

### workspace_prompts（启用已有表）

```sql
CREATE TABLE IF NOT EXISTS workspace_prompts (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    library_prompt_id VARCHAR(36),          -- 关联 team_prompts.id
    name VARCHAR(255) NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    use_case VARCHAR(100) NOT NULL DEFAULT '通用',
    usage_count INT NOT NULL DEFAULT 0,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    added_to_space BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

空间提示词来源：
- 从市场添加：复制 `team_prompts` 的 name/description/content/use_case，`library_prompt_id` 指向原提示词。
- 后续可扩展「空间自定义提示词」：`is_custom = TRUE`，`library_prompt_id = NULL`。

## 后端 API 设计

### 提示词库接口（team 域）

路由已存在：`/api/v1/team/prompts`、`/api/v1/team/prompts/{id}`。

#### GET /api/v1/team/prompts

返回当前用户可见的提示词列表。过滤规则：
- `on_shelf`：所有登录用户可见。
- `pending_review` / `rejected`：仅创建人、超级管理员可见。
- `off_shelf`：仅超级管理员可见。

查询时从 context 取 `userID`，必要时 JOIN `users` 判断角色与创建人。

#### POST /api/v1/team/prompts

新建提示词。请求体不变，后端自动设置：
- `status = 'pending_review'`
- `created_by = 当前 userID`
- `usage_count = 0`

仅登录用户可创建。

#### PATCH /api/v1/team/prompts/{id}

修改提示词基本信息（name/description/content/use_case）。限制：
- 创建人仅能在 `pending_review` / `rejected` 状态下修改。
- 超级管理员可修改任意状态。

#### DELETE /api/v1/team/prompts/{id}

删除提示词。限制同 PATCH（创建人只能删 pending/rejected；超管可删任意）。

#### POST /api/v1/team/prompts/{id}/review

超级管理员专用审核接口。

请求体：
```json
{
  "action": "approve" | "reject" | "unshelf"
}
```

行为：
- `approve`：`status = 'on_shelf'`，设置 `reviewed_by`、`reviewed_at`。
- `reject`：`status = 'rejected'`，设置 `reviewed_by`、`reviewed_at`。
- `unshelf`：仅当 `status = 'on_shelf'` 时，`status = 'off_shelf'`，设置 `reviewed_by`、`reviewed_at`。

超级管理员也可以重新上架已下架/已拒绝提示词，通过再次 `approve`。

### 空间提示词接口（workspace 域）

新增路由：

```go
mux.HandleFunc("/api/v1/workspaces/{id}/prompts", workspace.Prompts)
mux.HandleFunc("/api/v1/workspaces/{id}/prompts/{promptId}", workspace.PromptByID)
```

#### GET /api/v1/workspaces/{id}/prompts

列出该工作空间的 `workspace_prompts`。

权限：该工作空间成员可查看；非成员 403。

#### POST /api/v1/workspaces/{id}/prompts

从提示词库添加一个提示词到当前空间。

请求体：
```json
{
  "libraryPromptId": "uuid"
}
```

权限：仅租户管理员（`tenant_admin`）或超级管理员可操作；否则 403。
校验：被引用的 `team_prompts` 必须为 `on_shelf` 状态。
去重：同一 `library_prompt_id` 在同一 `workspace_id` 下只能存在一条记录；重复添加返回 409。

#### DELETE /api/v1/workspaces/{id}/prompts/{promptId}

从当前空间移除该提示词（仅删除 `workspace_prompts` 记录，不删库）。

权限：仅租户管理员或超级管理员；否则 403。

## 权限模型

新增 `middleware.RequireTenantAdmin(w, r)` 辅助函数：
- 未认证 401。
- 从 `UserService` 查询用户，`platform_role` 为 `tenant_admin` 或 `super_admin` 通过。
- 否则 403。

空间成员判定复用现有 workspace membership 查询。

## 前端改造

### 类型扩展

`apps/dh-frontend/src/types/index.ts` 中 `Prompt` 扩展：

```ts
export type PromptStatus = 'pending_review' | 'on_shelf' | 'off_shelf' | 'rejected';

export interface Prompt {
  id: string;
  name: string;
  description: string;
  useCase: string;
  usageCount: number;
  addedToSpace?: boolean;   // 兼容旧字段，逐步移除
  content?: string;
  status?: PromptStatus;
  createdBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspacePrompt {
  id: string;
  workspaceId: string;
  libraryPromptId?: string;
  name: string;
  description: string;
  content: string;
  useCase: string;
  usageCount: number;
  isCustom: boolean;
  addedToSpace: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### PromptMarket 页面

- 创建提示词成功后显示「已提交审核，仅你和超管可见」。
- 列表项展示状态徽标（`审核中`、`已上架`、`已下架`、`已拒绝`）。
- 操作按钮：
  - 当前用户为 `tenant_admin` 或 `super_admin`：显示「添加到空间」。
  - 其他用户：显示「复制」（复制 `content` 到剪贴板）。
  - 创建人且状态为 `pending_review` / `rejected`：可编辑/删除。
  - 超级管理员：快捷审核按钮（通过/拒绝/下架）。
- 筛选器保留场景分类；为超管增加状态筛选。

### AdminPage 提示词管理

- 将现有 mock 提示词表格替换为 `teamApi.listPrompts()` 真实数据。
- 支持按状态筛选（全部 / 审核中 / 已上架 / 已下架 / 已拒绝）。
- 操作列：通过 / 拒绝 / 下架（根据当前状态显示可用操作）。
- 展示创建人、创建时间、审核人、审核时间。

### Settings 提示词配置

- 将当前从 `teamApi.listPrompts()` 加载改为 `workspaceApi.listPrompts(workspaceId)`。
- 列表显示空间内提示词，按 `useCase` 分组。
- 「添加提示词」按钮打开市场弹窗，仅展示 `on_shelf` 且未添加的提示词；租户管理员点击添加。
- 操作：复制、删除（仅管理员可见）。
- 创建提示词按钮保留，但改为创建空间自定义提示词（二期）或先跳转市场创建（本期建议跳市场）。

### Chat 智能会话

- 当前 `availablePrompts` 来自 `teamApi.listPrompts()`。
- 改为读取 `localStorage.getItem('currentWorkspaceId')`，调用 `workspaceApi.listPrompts(workspaceId)`。
- 若用户不在任何工作空间（membership 为空），则回退到空列表或提示词市场（根据产品决策，本期回退到空列表）。

## API 客户端扩展

`team-api.ts`：

```ts
reviewPrompt: (id: string, action: 'approve' | 'reject' | 'unshelf') =>
  api.post<Prompt>(`/v1/team/prompts/${id}/review`, { action }),
updatePrompt: (id: string, req: Partial<CreatePromptRequest>) =>
  api.patch<Prompt>(`/v1/team/prompts/${id}`, req),
```

`workspace-api.ts`：

```ts
listPrompts: (workspaceId: string) => api.get<WorkspacePrompt[]>(`/v1/workspaces/${workspaceId}/prompts`),
addPrompt: (workspaceId: string, libraryPromptId: string) =>
  api.post<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts`, { libraryPromptId }),
removePrompt: (workspaceId: string, promptId: string) =>
  api.delete<void>(`/v1/workspaces/${workspaceId}/prompts/${promptId}`),
```

## 数据迁移

1. 执行 SQL 添加 `status`、`created_by`、`reviewed_by`、`reviewed_at`。
2. 存量 `team_prompts` 全部 `UPDATE status = 'on_shelf'`。
3. 存量 `team_prompts` 的 `created_by` 如未知，可设置为系统超管 `u1` 或保持 NULL（NULL 时仅超管可见）。
4. 可选：根据现有 `added_to_space = TRUE` 的提示词，在 `workspace_prompts` 中为默认工作空间生成引用记录（若需要保留旧行为）。

## 边界与限制

- 本期不实现空间自定义提示词创建（`is_custom = FALSE` 占主导）。
- 提示词「复制」仅复制到剪贴板，不创建任何记录。
- 添加到空间是去重引用；修改库中提示词不会同步到空间副本（空间内保留添加时的快照）。
- 审核中提示词对普通用户完全不可见，后端在 SQL 中过滤，不依赖前端隐藏。
- 当前后端 `Auth` 中间件只注入 `userID`，角色校验在 handler 中进行。

## 验收标准

- [ ] 新建提示词后状态为 `pending_review`，普通用户在市场列表中看不到。
- [ ] 创建人和超管可以在市场中看到审核中提示词。
- [ ] 超管审核通过后提示词状态变为 `on_shelf`，所有登录用户可见。
- [ ] 租户管理员在市场中可对 `on_shelf` 提示词点击「添加到空间」。
- [ ] 普通用户在市场只能「复制」提示词内容。
- [ ] 空间设置「提示词配置」显示当前空间的 `workspace_prompts`。
- [ ] 智能会话下拉加载当前工作空间的提示词。
- [ ] `pnpm check-types`、`pnpm lint`、`pnpm build`、`go build` 全部通过。
