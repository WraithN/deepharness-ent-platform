# personal-stub 启动时同步安装 comet skill 并上报初始化状态

## 现象

personal-stub 启动时 `initCometGlobal()` 异步安装 comet skill，不阻塞启动。
gatewayd 在 comet 安装完成前就启动了 opencode，导致 opencode 找不到 comet skill。
前端无法感知安装进度，用户看到 agent 卡死或误用 openspec-* skill。

## 根因

1. `initCometGlobal()` 使用 `go func()` 异步执行安装，与 gatewayd 启动并行
2. 安装期间无状态上报机制，dh-backend 和前端无法感知初始化进度
3. `agent_runtimes` 表缺少 `init_status` 字段，无法存储和展示初始化状态

## 解决方案

### 1. personal-stub：同步安装 + 状态上报

`apps/personal-stub/main.go`：

- `initCometGlobal()` 改为**同步阻塞**执行（移除 goroutine），确保 gatewayd 启动前 comet skill 已就绪
- 新增 `reportInitStatus()` 函数，通过 HTTP POST 向 dh-backend 上报初始化状态
- 安装流程上报状态：
  - 已安装：`status=running`, `init_status="SDD 支持已就绪"`
  - 安装中：`status=initializing`, `init_status="正在安装 SDD 支持"`
  - 安装完成：`status=running`, `init_status="SDD 支持安装完成"`
  - 安装失败：`status=error`, `init_status="SDD 支持安装失败: ..."`

### 2. dh-backend：支持 init_status 字段

- `object/types.go`：新增 `RuntimeStatusInitializing = "initializing"`，`AgentRuntime` 和 `ReportStatusRequest` 新增 `InitStatus` 字段
- `service/service.go`：`ReportStatus` 的 INSERT/UPDATE/RETURNING 均增加 `init_status` 列；`List`、`Get`、`scanRuntimes` 的 SELECT 和 Scan 同步更新；`InitDB` 的 CREATE TABLE 和 ALTER TABLE 兼容旧表

### 3. 数据库：新增 init_status 列

- `infra/database/agentruntime/schema.sql`：CREATE TABLE 增加 `init_status VARCHAR(256) NOT NULL DEFAULT ''`
- `infra/database/agentruntime/migration-20260812-add-init-status.sql`：新增迁移脚本

### 效果

- personal-stub 启动时同步检查并安装 comet skill，gatewayd 在安装完成后才启动
- 安装期间向 dh-backend 上报 `initializing` 状态和进度消息（如"正在安装 SDD 支持"）
- 前端可通过 `agent_runtimes.init_status` 字段实时展示初始化进度

### 验证

- `go vet` (dh-backend + personal-stub) 通过，0 warnings
- `go build` (dh-backend + personal-stub) 通过
- `pnpm build` + `pnpm check-types` 通过
