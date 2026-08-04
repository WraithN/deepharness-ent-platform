# Per-User 容器池与 stubclient 上下文感知重构

## 现象

原架构中 `stubclient.Default()` 是全局单例，所有用户请求共享同一个 personal-stub 连接（固定指向 `cfg.PersonalStubURL`）。在多用户场景下，不同用户的文件操作、git 操作、dev server 管理都会路由到同一个 personal-stub 实例，无法实现 per-user 容器隔离。同时 gatewayd 代理也使用固定地址，无法支持每用户独立 agent 容器。

## 根因

1. **全局单例耦合**：`stubclient.Default()` 在 19 个文件中的 48 个调用点被使用，所有 service 层直接依赖全局单例，无法按用户路由。
2. **缺少容器池抽象**：没有容器生命周期管理机制，无法按需为用户分配/回收 agent 容器。
3. **中间件层缺少容器注入**：HTTP 请求处理链中没有在认证后注入用户容器信息的环节。

## 解决方案

### 1. 容器池抽象层（`agent/provisioner/`）

- **`container.go`**：定义 `ContainerInfo`（Host + AgentPort + AdminPort + StubPort + UserID）、`ContainerPool` 接口（`Acquire` / `GetByUser` / `Release` / `Status`）、`ContainerMiddleware`、context 辅助函数（`WithContainer` / `ContainerFromContext`）、`SetMiddlewareUserIDFunc` 桥接函数。
- **`mock_pool.go`**：`MockContainerPool`，使用配置的固定 IP 列表模拟容器分配，适用于本地开发。
- **`k8s_pool.go`**：`K8sContainerPool`，将 `AgentProvisioner` 接口适配为 `ContainerPool` 接口，用于 K8s 环境下的真实容器管理。
- **`k8s/`**：K8s 原生 provisioner 实现（`provider.go` / `pod_template.go` / `labels.go`），使用 `client-go` 管理 gatewayd Pod 的创建、绑定、休眠/唤醒/销毁生命周期。

### 2. stubclient 上下文感知（`gateway/stubclient/client.go`）

- 新增 `FromContext(ctx)` 和 `WithClient(ctx, c)` 函数。
- `FromContext` 从 context 中取出 per-user stubclient，不存在时回退到 `Default()` 全局单例。
- 全部 48 个 `stubclient.Default()` 调用点替换为 `stubclient.FromContext(ctx)`（或 `context.Background()` 当 ctx 不可用时）。

### 3. 路由中间件注入（`gateway/server/server.go`）

- 新增 `containerMW` 中间件：Auth（注入 userID）→ Container（分配容器 + 注入 `ContainerInfo` 和 per-user `stubclient` 到 context）→ Handler。
- 对需要容器解析的路由（agent run、files、projects、preview、product-space、repository、session chat/ws）应用 `containerMW`。
- 容器池耗尽时返回 503 `{"code":503,"message":"当前服务器资源紧缺，请联系管理员"}`。

### 4. 配置扩展（`config/config.go` + `config.yaml`）

- `ProvisionerConfig` 新增 `StubPort`（personal-stub 端口，默认 8090）、`MockHosts`（mock 模式固定 IP 列表）、`KubeconfigPath`（K8s kubeconfig 路径）。
- `config.yaml` 新增 `stub_port: 8090` 和 `mock_hosts: ["127.0.0.1"]`。

## 验证结果

- `go vet ./...`：0 warnings
- `go build ./...`：编译通过
- `tsc --noEmit`：0 errors
- `pnpm build`：7/7 任务成功
- 开发环境启动正常，日志显示 `[container-pool] type=mock, pool=mock`，后端 `/health` 返回 `{"status":"ok"}`，前端 8888 可访问。

## 影响范围

### 新增文件
- `apps/dh-backend/agent/provisioner/container.go`
- `apps/dh-backend/agent/provisioner/mock_pool.go`
- `apps/dh-backend/agent/provisioner/k8s_pool.go`
- `apps/dh-backend/agent/provisioner/k8s/provider.go`
- `apps/dh-backend/agent/provisioner/k8s/pod_template.go`
- `apps/dh-backend/agent/provisioner/k8s/labels.go`

### 修改文件
- `apps/dh-backend/gateway/stubclient/client.go`：新增 `FromContext` / `WithClient`
- `apps/dh-backend/gateway/handler/stub_proxy.go`：per-user URL 解析
- `apps/dh-backend/gateway/handler/agui.go` / `agui_run.go` / `agui_respond.go`：`resolveAGUIClient(ctx)`
- `apps/dh-backend/gateway/server/server.go`：容器池初始化 + `containerMW` 中间件 + 路由注册
- `apps/dh-backend/config/config.go`：`StubPort` / `MockHosts` / `KubeconfigPath` 字段
- `apps/dh-backend/config.yaml`：`stub_port` / `mock_hosts` 配置项
- 19 个文件中的 48 个 `stubclient.Default()` → `stubclient.FromContext(ctx)` 替换
