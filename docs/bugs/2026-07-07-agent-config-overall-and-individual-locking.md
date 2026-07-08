# 智能体配置支持整体锁定与单独锁定

## 现象

1. 超管只能通过 `agentConfigLocked` 布尔值整体锁定空间的智能体配置，无法对单个智能体进行独立锁定。
2. 空间设置页的智能体配置卡片未区分"整体锁定"和"单独锁定"两种状态，锁提示信息不够精确。

## 根因

1. `AgentPolicy` 结构体仅有 `AgentConfigLocked bool` 字段，缺少 `LockedAgentKeys []string` 字段来记录被单独锁定的智能体 key 列表。
2. 数据库 `workspaces` 表缺少 `locked_agent_keys` 列，无法持久化单独锁定的智能体列表。
3. `agentconfig` 服务的 `CanModifyWorkspaceConfig` 仅检查整体锁定标志，未检查单独锁定列表。
4. 前端 `Settings.tsx` 的智能体配置渲染区域未根据 `lockedAgentKeys` 计算每个卡片的锁定状态，锁提示横幅也未区分整体锁定与单独锁定。

## 解决方案

### 1. 后端数据模型与持久化

#### Go SDK 领域模型
- `packages/go-sdk/domain/workspace/workspace.go`：Workspace 结构体新增 `LockedAgentKeys []string` 字段

#### 后端服务层
- `apps/dh-backend/domain/workspace/service/service.go`：`AgentPolicy` 结构体新增 `LockedAgentKeys []string` 字段
- `apps/dh-backend/domain/workspace/service/db_service.go`：
  - `CreateWorkspace` / `UpdateWorkspace`：INSERT/UPDATE 语句新增 `locked_agent_keys` 列，使用 `pq.Array()` 序列化
  - `scanWorkspace` / `scanWorkspaceRows`：新增 `LockedAgentKeys` 字段扫描，使用 `pq.Array()` 反序列化
  - `GetWorkspace` / `ListWorkspaces` / `ListMine` 的 SELECT 语句新增 `locked_agent_keys` 列

#### 智能体配置服务
- `apps/dh-backend/domain/agentconfig/service/db_service.go`：
  - `workspaceAgentPolicy` 结构体新增 `lockedKeys map[string]bool` 字段
  - 新增 `isAgentLocked(key string) bool` 方法：`agentConfigLocked || lockedKeys[key]`，整体锁定优先
  - `CanModifyWorkspaceConfig` 改用 `isAgentLocked` 替代仅检查 `agentConfigLocked`

#### 请求校验
- `apps/dh-backend/domain/workspace/handler.go`：`validateAgentPolicy` 新增对 `LockedAgentKeys` 的校验，确保每个 locked key 都在全局允许的 agent key 范围内

#### 数据库 Schema
- `infra/database/workspace/schema.sql`：`workspaces` 表新增 `locked_agent_keys TEXT[]` 列（默认空数组）
- `infra/database/workspace/migration-20260707-workspace-locked-agent-keys.sql`：迁移脚本，添加列并设置默认值和注释

### 2. 前端

#### 类型定义
- `apps/dh-frontend/src/types/index.ts`：`Workspace` 接口新增 `lockedAgentKeys: string[]`，`AgentPolicy` 接口新增 `lockedAgentKeys: string[]`
- `apps/dh-frontend/src/lib/api-types.ts`：`MineWorkspaceDTO` 接口新增 `lockedAgentKeys: string[]`

#### 超管空间管理（AdminPage）
- `apps/dh-frontend/src/pages/AdminPage.tsx`：
  - `AgentPolicyForm` 新增 `lockedAgentKeys` 状态和 `toggleAgentLock` 函数
  - 每个智能体旁边新增锁定/解锁按钮（Lock / LockOpen 图标切换）
  - 整体锁定（`agentConfigLocked`）开启时，所有单独锁定按钮禁用

#### 空间设置（Settings）
- `apps/dh-frontend/src/pages/Settings.tsx`：
  - `AgentConfigCard` 新增 `locked` prop，显示"已锁定"徽章
  - 所有 `disabled={readOnly}` 替换为 `disabled={disabled}`，其中 `disabled = readOnly || locked`
  - 智能体配置渲染区域：根据 `workspace.agentConfigLocked` 和 `workspace.lockedAgentKeys` 计算每个卡片的 `locked` 状态
  - 锁提示横幅区分两种状态：
    - 整体锁定：显示"当前空间的智能体配置已被超级管理员整体锁定"
    - 单独锁定：显示被锁定的智能体 key 列表
  - `handleSaveAgentConfigs`：过滤掉被单独锁定的智能体，仅保存未锁定的配置

### 验证

- `go vet ./...`：0 warnings
- `npx tsc --noEmit -p tsconfig.check.json`：0 errors
- `npx biome lint`：无 lint 错误
- `pnpm build`：全部 6 个包构建成功
- API 端到端测试：
  - PUT `/api/v1/workspaces/ws-default` 设置 `lockedAgentKeys: ["requirement-agent", "review-agent"]` → 持久化成功
  - PUT `/api/v1/workspaces/ws-default/agent-configs/requirement-agent`（已锁定）→ 返回 403 "agent config is locked for this workspace"
  - PUT `/api/v1/workspaces/ws-default/agent-configs/opencode`（未锁定）→ 保存成功
  - 设置 `agentConfigLocked: true` 后，所有 agent 配置保存均被阻止
