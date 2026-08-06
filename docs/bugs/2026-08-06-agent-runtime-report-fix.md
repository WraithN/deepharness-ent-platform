# Agent 运行时状态上报问题修复

> 日期：2026-08-06

## 1. 现象

管理后台「Agent 运行时」页面（`/admin/agent-runtimes`）存在三个问题：

1. **状态不一致**：部分运行时显示 `online`，部分显示 `running`。`online` 不是平台定义的 `RuntimeStatus` 枚举值，前端无法正确映射标签和颜色。
2. **下线状态不更新**：15 天前上报的运行时仍显示 `running`，容器停止上报后状态永久残留。
3. **运行时 ID 不一致**：runtime ID 来源混乱，包括 hostname、UUID、手动测试值等，无系统化生成机制。
4. **CPU/内存数据来源不准确**：由 gatewayd 上报容器内部视角的指标，非容器/主机层面准确值。
5. **缺少 IP 信息**：运行时记录无 IP 字段，无法定位容器网络位置。

## 2. 根因

### 2.1 状态不一致

gatewayd 发送 `"status": "online"`，但 dh-backend 的 `RuntimeStatus` 枚举只定义了 `running`/`error`/`stopped`/`resource_warning`。后端 `ReportStatus` service 层直接 `string(req.Status)` 原样写入 DB，无任何状态归一化逻辑。前端 `RUNTIME_STATUS_LABELS["online"]` 找不到映射，显示原始字符串，状态点颜色为 `undefined`。

### 2.2 下线状态不更新

`ReportStatus` 仅做 upsert，容器停止上报后最后一条状态永久留在 DB。无后台 goroutine 扫描 `reported_at` 检测心跳超时，`Controller.startIdleSleepLoop` 是空实现 stub。

### 2.3 运行时 ID 不一致

runtime ID 为纯手动配置：`config.yaml` 中 `runtime_id: ""`（空），dev 脚本未设置 `DH_BACKEND_RUNTIME_ID`，K8s pod template 未注入该环境变量。provisioner 生成的实例 ID（`gw-<uuid8>`）与 `agent_runtimes.runtime_id` 完全无关联。

### 2.4 上报链路断裂

gatewayd 的 `~/.config/dh/config.toml` 配置 `url = "http://localhost:8080"`，直接上报到 dh-backend，未经过 personal-stub 中继。personal-stub 的 `ContainerReport` handler 虽然实现了转发逻辑，但 gatewayd 实际调用路径为 `/api/v1/agent-runtimes/{id}/status`，与 personal-stub 的 `/api/v1/container/report` 端点不匹配。

### 2.5 缺少 CPU/内存/IP

`ReportStatusRequest` 无 `ip` 字段；personal-stub 未采集系统指标，仅原样透传 gatewayd body；DB schema 无 `ip` 列。

## 3. 解决方案

### 3.1 状态归一化

- 在 `service.go` 新增 `normalizeStatus()` 函数和 `statusAliasMap`，将 `online`->`running`、`offline`->`stopped`、`ok`->`running`、`down`->`stopped`、`healthy`->`running`、`unhealthy`->`error`、`idle`->`running`
- `ReportStatus` 在 upsert 前调用 `normalizeStatus()` 归一化状态值

### 3.2 过期检测

- 在 `AgentRuntimeService` 接口新增 `MarkStaleRuntimes()` 方法
- `DBAgentRuntimeService` 实现：`UPDATE agent_runtimes SET status='stopped' WHERE reported_at < NOW()-2min AND status NOT IN ('stopped','error')`
- 新增 `StartStaleChecker()` 后台 goroutine，每 30 秒扫描一次
- 在 `initAgentRuntimeService()` 中启动

### 3.3 runtimeID 系统化

- personal-stub `config.go`：`runtime_id` 为空时自动使用 `os.Hostname()`
- dev 脚本：设置 `DH_BACKEND_URL` 和 `DH_BACKEND_RUNTIME_TOKEN` 环境变量
- K8s `pod_template.go`：通过 Downward API 注入 `metadata.name`（Pod 名称）作为 `DH_BACKEND_RUNTIME_ID`，同时注入 `DH_BACKEND_URL` 和 `DH_BACKEND_RUNTIME_TOKEN`
- `K8sConfig` 新增 `DHBackendURL` 和 `DHBackendRuntimeToken` 字段

### 3.4 上报链路修复

- personal-stub 新增 `AgentRuntimeStatusReport` handler，处理 `POST /api/v1/agent-runtimes/{id}/status`（gatewayd 实际调用的路径）
- 该 handler 从 URL 路径提取 runtime ID，注入 CPU/内存/IP 后转发到 dh-backend 同名端点
- 将 gatewayd 的 `~/.config/dh/config.toml` 中 `url` 改为 `http://localhost:8090`（personal-stub）

### 3.5 CPU/内存/IP 上报

- **personal-stub 新增 `sysinfo.go`**：
  - 后台 goroutine 每 5 秒采集一次 CPU/内存，缓存到 `sysInfoCache`
  - CPU：两次采样 `/proc/stat` 计算 delta（200ms 间隔）
  - 内存：读取 `/proc/meminfo` 的 `MemTotal` 和 `MemAvailable`
  - IP：通过 UDP dial 获取出口 IP，兜底遍历网卡接口
- **`ContainerReport` / `AgentRuntimeStatusReport`**：解析 JSON body，注入 `cpu_percent`/`mem_percent`/`ip`，覆盖 gatewayd 上报值
- **dh-backend**：`ReportStatusRequest` 和 `AgentRuntime` 新增 `IP` 字段；DB schema 新增 `ip` 列（`ALTER TABLE IF NOT EXISTS` 兼容旧表）；upsert/list/get SQL 全部增加 `ip`
- **前端**：`AgentRuntime` 类型新增 `ip` 字段；表格新增 IP 列；详情弹窗显示 IP 和上报时间

### 3.6 历史数据清理

执行 SQL 归一化存量数据：
- `UPDATE agent_runtimes SET status='running' WHERE status='online'`
- `UPDATE agent_runtimes SET status='stopped' WHERE reported_at < NOW()-2min AND status NOT IN ('stopped','error')`

## 4. 验证结果

```
runtime_id        | status  | cpu_percent | mem_percent | ip            | since_reported
LAPTOP-4RSAH7M9   | running | 7.5471697   | 65.18591    | 192.168.43.4  | 00:00:01
e51943ca-...      | stopped | ...         | ...         |               | 1 day 23:24
test              | stopped | ...         | ...         |               | 15 days
test-runtime-002  | stopped | ...         | ...         |               | 15 days
local-gatewayd-01 | stopped | ...         | ...         |               | 15 days
test-runtime-001  | stopped | ...         | ...         |               | 15 days
```

- 活跃运行时正确显示 `running`，CPU/内存/IP 由 personal-stub 采集
- 过期运行时自动标记为 `stopped`
- 上报链路：gatewayd -> personal-stub（:8090，enrich CPU/mem/IP）-> dh-backend（:8080，store）
- 前端页面正常加载（HTTP 200）

## 5. 已安装/活跃智能体上报（追加）

### 5.1 问题

gatewayd 仅上报当前运行的智能体实例（`list_instances()`），不上报已安装但未运行的智能体（`list_plugins()` + `is_installed()`）。管理后台无法知道容器中安装了哪些智能体 CLI。

### 5.2 根因

`runtime_reporter.rs` 的 `build_report()` 仅调用 `AgentService::list_instances()`，从不调用 `list_plugins()`。`is_installed()` 方法已存在（通过 `<program> --version` 检测），但未接入上报链路。

### 5.3 解决方案

**gatewayd（Rust）**：
- `RuntimeStatusReport` 新增 `installed_agents: Vec<String>` 字段
- `build_report()` 同时调用 `list_plugins()` 过滤 `installed=true` 的插件 key

**dh-backend**：
- `ReportStatusRequest` 和 `AgentRuntime` 新增 `InstalledAgents` 字段
- DB schema 新增 `installed_agents JSONB` 列
- upsert/list/get SQL 全部增加 `installed_agents`

**前端**：
- `AgentRuntime` 类型新增 `installedAgents` 字段
- 表格"智能体"列：已安装的显示为 badge，运行中的高亮、未运行的灰色
- 详情弹窗新增"已安装智能体"和"活跃实例数"字段

### 5.4 验证结果

```
runtime_id        | installed_agents              | agents
LAPTOP-4RSAH7M9   | ["opencode", "claude-code"]  | []
```

- `installed_agents` 正确反映已安装的 CLI（opencode + claude-code，codex 未安装）
- `agents` 为空表示当前无活跃实例（会话创建后才会出现）

## 6. 会话统计与最近活跃时间（追加）

### 6.1 问题

管理后台无法看到每个运行时的会话活跃度，缺少近 7 日/1 日会话数和最近活跃时间。

### 6.2 解决方案

**gatewayd（Rust）**：
- `runtime_reporter.rs` 新增 `collect_session_counts()` 函数，查询本地 SQLite 统计 `sessions_7d`/`sessions_1d`/`last_active_at`
- `RuntimeStatusReport` 新增对应字段

**dh-backend**：
- `ReportStatusRequest` 和 `AgentRuntime` 新增 `Sessions7d`/`Sessions1d`/`LastActiveAt` 字段
- DB schema 新增 `sessions_7d INT`/`sessions_1d INT`/`last_active_at TIMESTAMPTZ` 列
- upsert/list/get SQL 全部增加这些字段

**前端**：
- `AgentRuntime` 类型新增对应字段
- 详情弹窗显示会话统计和最近活跃时间

## 7. Per-User 进程隔离与直接宿主管理（追加）

### 7.1 问题

原架构中 gatewayd 和 personal-stub 由 `start-dev.sh` 手动启动全局单实例，所有用户共享同一进程：
- runtime ID 为纯 hostname（`LAPTOP-4RSAH7M9`），无法区分用户
- 所有用户共享同一 SQLite DB，会话数据互相干扰
- 无法实现 per-user 资源隔离

### 7.2 解决方案

**DirectHostConfig 扩展**：
- `config.go` 新增 `GatewaydBin`/`StubBin`/`BearerToken`/`DHBackendURL` 字段
- `config.yaml` 对应 `gatewayd_bin`/`stub_bin`/`bearer_token`/`dh_backend_url`
- 环境变量覆盖：`AGENT_PROVISIONER_DIRECT_HOST_GATEWAYD_BIN` 等

**Manager 进程管理**：
- `slotState` 新增 `gatewaydCmd`/`stubCmd`/`dataDir`/`runtimeID` 字段
- `startProcessesLocked()`：为每个用户启动独立 gatewayd + personal-stub 进程，注入 per-user 环境变量
  - `DH_PLATFORM_USER_ID`：用户 ID
  - `DH_PLATFORM_WORKSPACE_ID`：通过 WorkspaceResolver 查询 `workspace_members` 表获得
  - `DH_PLATFORM_RUNTIME_ID`：`{hostname}:{userID}` 格式，跨重启稳定
  - `DH_DATA_DIR`：per-user 数据目录，实现 SQLite DB 隔离
  - `DH_BACKEND_RUNTIME_ID`：personal-stub 使用同一 runtimeID
  - `DH_BACKEND_URL`：指向 dh-backend 上报端点
  - `DH_BACKEND_RUNTIME_TOKEN`：Bearer Token 认证
- `stopProcessesLocked()`：停止用户的所有进程
- `resetSlot()`：slot 回收时自动停止进程

**WorkspaceResolver 注入**：
- `server.go` 创建 provisioner 后注入 workspace resolver
- resolver 通过 `SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1` 查询用户所属工作空间

**gatewayd DH_DATA_DIR 支持**：
- `dh-platform/src/fs.rs` 的 `data_dir()` 优先检查 `DH_DATA_DIR` 环境变量
- 每个用户有独立的 SQLite DB，会话数据完全隔离

**start-dev.sh 改造**：
- 移除手动 `start_gatewayd`/`start_personal_stub` 调用
- dh-backend 启动时注入 `AGENT_PROVISIONER_DIRECT_HOST_GATEWAYD_BIN`/`STUB_BIN`/`BEARER_TOKEN`/`DH_BACKEND_URL` 环境变量
- gatewayd 和 personal-stub 改为 dh-backend 按需启动（用户首次请求时 `containerMW` -> `Acquire` 触发）

### 7.3 验证结果

用户 `2e77dc0176474a6a9e1f87d27bc2c741` 首次请求 `/api/v1/files/` 时：

```
[DirectHost] gatewayd started for user=2e77dc0176474a6a9e1f87d27bc2c741
  runtimeID=LAPTOP-4RSAH7M9:2e77dc0176474a6a9e1f87d27bc2c741
  pid=752379 ports=2345/2346
  log=/tmp/gatewayd-2e77dc0176474a6a9e1f87d27bc2c741.log

[DirectHost] personal-stub started for user=2e77dc0176474a6a9e1f87d27bc2c741
  runtimeID=LAPTOP-4RSAH7M9:2e77dc0176474a6a9e1f87d27bc2c741
  pid=752380 port=8090
  log=/tmp/personal-stub-2e77dc0176474a6a9e1f87d27bc2c741.log
```

DB 记录：
```
runtime_id: LAPTOP-4RSAH7M9:2e77dc0176474a6a9e1f87d27bc2c741
user_id:    2e77dc0176474a6a9e1f87d27bc2c741
status:     running
ip:         192.168.43.4
installed_agents: ["opencode", "claude-code"]
sessions_7d: 0  (独立 SQLite DB，新启动无历史会话)
sessions_1d: 0
```

旧的 hostname-only runtime（`LAPTOP-4RSAH7M9`）已被 stale checker 自动标记为 `stopped`。

## 8. 非平台用户上报拒绝（追加）

### 8.1 问题

`ReportStatus` 接口接受任意 `user_id`，外部系统可伪造非平台用户身份上报状态。

### 8.2 解决方案

- `identity/handler.go` 新增 `UserExists(userID string) bool` 函数，查询 `users` 表
- `agentruntime/handler.go` 的 `ReportStatus` 在处理上报前校验 `req.UserID`
- 非平台用户返回 `403 Forbidden`，错误消息包含被拒绝的 user_id

### 8.3 验证结果

```
# 非平台用户 -> 403
POST /api/v1/agent-runtimes/fake-runtime/status
{"user_id":"nonexistent-user-12345",...}
-> {"code":3,"message":"user not registered on platform: nonexistent-user-12345"}

# 平台用户 -> 200
POST /api/v1/agent-runtimes/test-valid-user/status
{"user_id":"2e77dc0176474a6a9e1f87d27bc2c741",...}
-> 200 OK，返回完整 runtime 对象
```

## 9. 编译验证

- `go vet ./...`：dh-backend / personal-stub / go-sdk 全部 0 warnings
- `tsc --noEmit`：前端 0 errors
- 前端 API 返回 per-user runtime，所有字段（ip/installedAgents/sessions7d/sessions1d/lastActiveAt）完整
