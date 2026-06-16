# Workitem Project 与 Repository 领域重构设计

## 目标

1. 统一术语：`demand_project` → `workitem_project`，删除旧 `domain/project.Project`（meego 项目）概念。
2. 将 Git 仓库（`Repository`）提升为独立领域，支持 SSH key 配置，创建/修改时自动 `git clone` / `git pull` 到 `/var/deepharness/workspace/{workspaceID}/{repoName}`。
3. 下线旧的 `/api/v1/projects` 与 `/api/v1/repositories` mock 接口。

## 术语与模型映射

| 旧概念 | 新概念 | 说明 |
|---|---|---|
| `demand_project` / `DemandProject` | `workitem_project` / `WorkitemProject` | workspace 1:1 外部工作项项目（Meego/PingCode） |
| `domain/project.Project`（meego 项目） | 删除 | 功能由 `WorkitemProject` 覆盖 |
| `domain/project.Repository` | `domain/repository.Repository` | workspace 1:N Git 仓库 |
| 旧 `/api/v1/projects` | 下线 | 不再提供 |
| 旧 `/api/v1/repositories`（project 域 mock） | 下线 | 由 `/api/v1/workspaces/{id}/repositories` 替代 |

## 架构调整

### go-sdk

- `packages/go-sdk/domain/workspace/demand_project.go` → `workitem_project.go`，结构体改名为 `WorkitemProject`。
- 新建 `packages/go-sdk/domain/repository/repository.go`：定义 `Repository`、`RepoType`、`Branch`、`FileNode`、`FileContent`。
- 新建 `packages/go-sdk/infrastructure/repository/git.go`：提供 `Clone(url, dest, sshKey, branch string) error` / `Pull(dest, sshKey string) error`，使用 `go-git` + SSH key 字符串实现。

### dh-backend

- 删除 `apps/dh-backend/domain/project/` 整个包（含 mock service、handler）。
- 新建 `apps/dh-backend/domain/repository/`：
  - `service/service.go`：定义 `RepositoryService` 接口。
  - `service/db_service.go`：PostgreSQL 实现 + clone/pull 触发。
  - `handler.go`：HTTP handler。
- `apps/dh-backend/domain/workspace/service/service.go`：
  - `SetDemandProject` / `GetDemandProject` → `SetWorkitemProject` / `GetWorkitemProject`。
  - 移除 `ListRepositories` / `CreateRepository` / `DeleteRepository`（移到 repository 域）。
- `apps/dh-backend/gateway/server/server.go`：
  - 移除 `domain/project` 路由。
  - 注册 repository 路由。
  - 初始化 repository service（DB 或内存 mock）。

## 数据模型

### workitem_projects 表（原 demand_projects）

```sql
CREATE TABLE IF NOT EXISTS workitem_projects (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL UNIQUE,
    platform VARCHAR(50) NOT NULL DEFAULT 'meego',
    external_key VARCHAR(200) NOT NULL,
    name VARCHAR(200),
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### repositories 表（在现有 workspace schema 的 repositories 上扩展）

```sql
CREATE TABLE IF NOT EXISTS repositories (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    url VARCHAR(500) NOT NULL,
    type VARCHAR(50) NOT NULL,
    default_branch VARCHAR(100),
    ssh_key TEXT,
    local_path VARCHAR(500),
    clone_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    last_sync_at TIMESTAMPTZ,
    error_message TEXT,
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, name)
);
```

- `local_path` 默认生成：`/var/deepharness/workspace/{workspace_id}/{name}`
- `clone_status` 枚举：`pending` / `cloning` / `cloned` / `failed`

## Git 克隆行为

- 创建 repository 时，先写 DB（`clone_status='pending'`），再异步执行 `git clone`。
- clone 完成后更新 `clone_status='cloned'`、`last_sync_at=now()`。
- 失败时更新 `clone_status='failed'`、`error_message`。
- 修改 repository（URL 或 ssh_key 变化）时：
  - 若 `local_path` 已存在对应目录 → `git pull`
  - 否则 → `git clone`
- 默认分支：若用户未指定，clone 时尝试 `main`，失败再回退 `master`。

SSH key 使用方式：
- DB 中存私钥文本。
- clone 时把私钥写入临时文件，通过 `go-git` 的 SSH auth 使用，完成后删除临时文件。

## API 变更

### WorkitemProject

| 旧路径 | 新路径 |
|---|---|
| `GET /api/v1/workspaces/{id}/demand-project` | `GET /api/v1/workspaces/{id}/workitem-project` |
| `POST /api/v1/workspaces/{id}/demand-project` | `POST /api/v1/workspaces/{id}/workitem-project` |

### Repository（移到 repository 域，路径仍挂在 workspace 下以兼容前端）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/workspaces/{id}/repositories` | 列出仓库及 clone 状态 |
| POST | `/api/v1/workspaces/{id}/repositories` | 创建仓库并触发 clone |
| GET | `/api/v1/workspaces/{id}/repositories/{repoId}` | 获取仓库详情 |
| PUT/PATCH | `/api/v1/workspaces/{id}/repositories/{repoId}` | 更新仓库，触发 pull/clone |
| DELETE | `/api/v1/workspaces/{id}/repositories/{repoId}` | 删除仓库记录并清理本地目录 |
| POST | `/api/v1/workspaces/{id}/repositories/{repoId}/sync` | 手动触发同步 |

请求体：

```json
{
  "name": "backend-api",
  "url": "git@github.com:company/backend-api.git",
  "type": "dev",
  "defaultBranch": "main",
  "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

### 下线路径

- `GET/POST /api/v1/projects`
- `GET /api/v1/projects/{id}`
- `GET /api/v1/repositories`
- `GET /api/v1/repositories/{id}`
- `GET /api/v1/repositories/{id}/branches`
- `GET /api/v1/repositories/{id}/tree`
- `GET /api/v1/repositories/{id}/content`

## 前端改动

- `types/index.ts`：`DemandProject` → `WorkitemProject`
- `lib/workspace-api.ts`：
  - `getDemandProject` / `setDemandProject` → `getWorkitemProject` / `setWorkitemProject`
  - 移除仓库相关方法，新建 `lib/repository-api.ts`
- `Settings.tsx`：基础配置里的“项目 ID”对应 `workitem-project`；仓库管理调用 repository API 并显示 clone 状态。
- `Chat.tsx`：加载当前 workspace 的 repositories 时改调 `/v1/workspaces/{id}/repositories`。

## 迁移与数据

- 重命名表：`demand_projects` → `workitem_projects`。
- 迁移脚本把旧 `demand_projects` 数据迁到 `workitem_projects`（目前基本为空）。
- 删除旧 `projects` 表（如果存在）。
- 4 个种子用户不受影响。

## 风险与范围

- **SSH 私钥落库**：MVP 阶段以文本存 DB，生产环境需改为加密或接入 vault。
- **本地目录权限**：后端进程需要对 `/var/deepharness/workspace` 有读写权限。
- **并发 clone**：多个仓库同时创建时会起多个 goroutine，需通过 DB 状态避免重复操作。
- **go-git 能力边界**：部分私有仓库认证场景可能需要 fallback 到系统 `git` CLI，本次先按 go-git 实现。

## 验证标准

- `go vet ./...` / `go build ./...` 通过。
- `tsc --noEmit` / `pnpm build` 通过。
- `pnpm dev` 启动后：
  - `/api/v1/workspaces/{id}/workitem-project` 正常读写。
  - `/api/v1/workspaces/{id}/repositories` 创建仓库后能在 `/var/deepharness/workspace/{workspaceID}/{repoName}` 看到克隆下来的代码。
  - 旧的 `/api/v1/projects` 与 `/api/v1/repositories` 返回 404。
