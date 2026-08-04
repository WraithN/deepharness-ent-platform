# Goroutine panic 导致整个进程崩溃

## 现象

全代码库 `recover()` 调用数为 0，18 处通过 `go func()` 启动的 goroutine 均无 panic 保护。任何一处 goroutine 内发生 panic 都会直接传播到主 goroutine，导致整个 dh-backend 进程崩溃。

关键位置包括：
- `orchestrator/orchestrator.go` 编排流程 goroutine
- `domain/repository/service/db_service.go` 仓库同步 goroutine（6 处）
- `gateway/handler/gatewayd_proxy.go` WebSocket 代理 goroutine
- `domain/feishu/handler.go` 飞书事件处理 goroutine
- `domain/agentconfig/handler.go` agent 配置同步 goroutine
- `domain/notification/handler.go` 通知回调 goroutine
- `domain/workitem/handler.go` 工作项回调 goroutine
- `agent/chat/session/session.go` session reaper goroutine
- `agent/client/http.go` GatewaydClient goroutine
- `agent/client/agui_client.go` SSE 读取 goroutine（2 处）
- `main.go` 优雅关闭 goroutine
- `packages/go-sdk/infrastructure/repository/git.go` stderr 扫描 goroutine

## 根因

Go 语言中，goroutine 内的 panic 默认不会跨 goroutine 被 recover。如果业务代码在异步 goroutine 中触发 panic（例如空指针、数组越界、channel 操作异常），而没有任何 `defer recover()` 保护，就会直接终止整个进程。

代码里大量使用裸 `go func(){...}()` 启动后台任务，未统一做 panic 防护。

## 解决方案

1. 新增共享包 `apps/dh-backend/pkg/safego` 与 `packages/go-sdk/common/safego`，提供 `Go(name string, fn func())` 工具函数，内部包装 `defer recover()` + 日志记录，并截断超长 panic 信息。
2. 将 `apps/dh-backend/pkg/safego` 实现为 `packages/go-sdk/common/safego` 的薄封装，避免 `packages/go-sdk` 反向依赖 `apps/dh-backend`，同时保持单一实现来源。
3. 用 `safego.Go(...)` 替换所有裸 goroutine 启动点，确保后台任务 panic 不会导致进程崩溃。
4. `main.go` 的优雅关闭 goroutine、`packages/go-sdk/infrastructure/repository/git.go` 的 stderr 扫描 goroutine 也统一使用 `safego.Go`。

## 验证

- `cd apps/dh-backend && go build ./... && go vet ./...` 通过
- `cd packages/go-sdk && go build ./... && go vet ./...` 通过
- `cd apps/personal-stub && go build ./... && go vet ./...` 通过
- `pnpm build` 通过
- `pnpm --filter @repo/dh-frontend check-types` 通过
- `bash scripts/restart-dev.sh` 重启后，`curl localhost:8080/health`、`curl localhost:8090/health`、`curl localhost:8888` 均正常响应
