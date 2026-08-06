# directhost 模式 gatewayd 启动架构重构

## 现象

原 directhost 模式存在架构缺陷：
1. dh-backend 通过 `exec.Command` 直接启动 gatewayd 进程，仅支持本地执行，无法部署到远程 VM。
2. dh-backend 通过 `os.MkdirAll` 直接创建 gatewayd 数据目录和工作空间目录，违反"dh-backend 不直接操作共享目录"的架构约束。
3. gatewayd 配置中包含 `DH_PLATFORM_WORKSPACE_ID` 环境变量，将 workspace 维度耦合到 gatewayd 实例，而 gatewayd 应为 per-user 而非 per-workspace。
4. `hosts` 配置支持多主机列表，但所有进程实际在本地启动，远程主机场景下进程不可达。

## 根因

directhost Manager 的 `startProcessesLocked` 方法同时承担了 gatewayd 和 personal-stub 两个进程的启动职责，且使用本地 `exec.Command` 和 `os.MkdirAll`，没有利用 personal-stub 作为同机代理的能力。同时，workspaceId 被注入到 gatewayd 环境变量中，导致 gatewayd 与 workspace 维度耦合。

## 解决方案

### 1. gatewayd 进程管理下沉到 personal-stub

新增 `apps/personal-stub/gateway/handler/gatewayd_manager.go`，由 personal-stub 直接通过 `exec.Command` 启动和管理 gatewayd 进程：

- **1:1 模式（single）**：personal-stub 启动时创建一个 gatewayd 实例，所有请求共用。
- **1:N 模式（multi）**：personal-stub 按需为每个 userID 创建独立的 gatewayd 实例，端口从池中分配。懒启动由 `/api/v1/container/health?user_id=xxx` 触发，无需专门的"启动"HTTP 端点。

dh-backend 的 directhost Manager 不再启动 gatewayd，仅启动 personal-stub，并通过环境变量将 gatewayd 二进制路径和端口配置传递给 personal-stub。

### 2. 移除 workspaceId 从 gatewayd 配置

- 从 `startProcessesLocked` 中移除 `DH_PLATFORM_WORKSPACE_ID` 环境变量。
- gatewayd 仅感知 `DH_PLATFORM_USER_ID`，workspace 路径由 dh-backend 在创建会话时通过 `SetContext` / `AttachAgent` 按会话传递。
- 上报链路中 `workspace_id` 字段变为可选（gatewayd 不再上报），`agentruntime` service 已有空值兼容处理。

### 3. 移除 dh-backend 直接文件系统操作

- 移除 `startProcessesLocked` 中的 `os.MkdirAll` 调用（gatewayd 数据目录由 personal-stub 的 GatewaydManager 创建）。
- 工作空间目录仍由 dh-backend 通过 stubclient 调用 personal-stub 的 `POST /api/v1/files/mkdir` 创建（路径 A/B 不变）。

### 4. 1:N 模式端口发现

1:N 模式下，personal-stub 自行管理 gatewayd 端口池。dh-backend 的 `containerMW` 在 Acquire 后调用 personal-stub 的 health 端点发现实际端口并更新 ContainerInfo（`apps/dh-backend/gateway/server/container_discovery.go`）。

### 变更文件清单

| 文件 | 变更 |
|------|------|
| `apps/personal-stub/gateway/handler/gatewayd_manager.go` | 新增：gatewayd 进程管理器，支持 1:1 和 1:N |
| `apps/personal-stub/config/config.go` | 新增 `GatewaydBin/Mode/AgentPort/AdminPort/PlatformUserID` 配置 |
| `apps/personal-stub/main.go` | 启动时创建 GatewaydManager，1:1 模式启动 gatewayd |
| `apps/personal-stub/gateway/handler/container.go` | 适配 GatewaydManager：proxy 路由 + health 返回端口 + 懒启动 |
| `apps/personal-stub/config.yaml` | 新增 gatewayd 进程管理配置项 |
| `apps/dh-backend/agent/provisioner/directhost/manager.go` | 移除 gatewayd exec.Command + os.MkdirAll，改为只启动 personal-stub；移除 DH_PLATFORM_WORKSPACE_ID |
| `apps/dh-backend/config/config.go` | DirectHostConfig 新增 `GatewaydMode` 字段 |
| `apps/dh-backend/config.yaml` | 新增 `gatewayd_mode` 配置项 |
| `apps/dh-backend/gateway/server/server.go` | containerMW 新增 `discoverGatewaydPorts` 调用 |
| `apps/dh-backend/gateway/server/container_discovery.go` | 新增：1:N 模式端口发现 |
| `scripts/start-dev.sh` | 更新注释（gatewayd 由 personal-stub 启动） |

### 验证结果

- `pnpm build`：全部 7 个包构建成功。
- `go vet ./...`（personal-stub + dh-backend）：0 warnings。
- 开发环境重启成功，dh-backend (:8080) + frontend (:8888) + crawler (:8091) 正常运行。
- personal-stub 和 gatewayd 由 directhost Manager 按需启动（用户首次访问 containerMW 路由时触发）。
