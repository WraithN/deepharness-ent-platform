# 2026-08-11 personal-stub 意外死亡后请求持续 502（Manager 无存活探测）

## 现象

personal-stub 进程意外退出（kill/崩溃）后，dh-backend 的 direct-host Manager 仍按"运行中"路由请求，所有 `/api/v1/projects/*`、`/api/v1/files/*`、`/api/v1/preview/*` 代理请求持续返回 502，直到 dh-backend 整体重启才恢复。被杀的进程还会以 `<defunct>` 僵尸状态残留。

影响范围：direct-host 模式下所有 per-user personal-stub 代理请求（工程卡片、文件树、预览等全部功能）。

## 根因

两层叠加（`apps/dh-backend/agent/provisioner/directhost/manager.go`）：

1. **进程死亡不可见**：`startProcessesLocked` 启动 personal-stub 后没有任何协程调用 `cmd.Wait()`。进程退出后 `ProcessState` 永远为 nil（且无人收割→僵尸进程），`slotProcessesRunning` 恒为 true——`Acquire`/`Provision` 里既有的"死了就重启"逻辑（`!slotProcessesRunning → startProcessesLocked`）永远触发不到。
2. **无主动巡检**：Manager 没有任何 reconcile/健康检查机制，"进程在但服务僵死"的场景也完全无法发现。

## 解决方案

1. **收割协程**：`startProcessesLocked` 启动成功后追加 `go func() { _ = stubCmd.Wait() }()`——进程退出即设置 `ProcessState`、收割僵尸。仅这一处改动就能让既有的惰性重启路径（下次请求时 `Acquire` 自动重启）恢复工作。
2. **reconcile 巡检循环**：`Manager.StartReconcileLoop(stop)`（在 `gateway/server/server.go` 的 direct-host 初始化块中以 `nil` stop 启动，随进程生命周期运行）：
   - 每 30s（`reconcileInterval`）巡检已分配槽位；
   - 进程已退出 → 立即重启；
   - 进程在但 `/health` 连续 2 个周期（`unhealthyThreshold`）探测失败（2s 超时 `stubHealthProbeTimeout`）→ 判定僵死，杀死后重启；探测成功则失败计数清零；
   - 同一槽位重启冷却 60s（`restartCooldown`），防止持续崩溃时崩溃循环；
   - 健康探测在全局锁外执行，避免阻塞请求路由；重启前重新持锁校验槽位状态，避免与并发 Release 竞争。

## 验证结果

- `apps/dh-backend`：`go build ./... && go vet ./...` 0 warning。
- 全链路重启后 kill 实测：
  1. `projects/check` 触发 stub 启动（pid 2433086），返回 200；
  2. `kill -9 2433086`；
  3. 43s 后 dh-backend 日志出现 `personal-stub process dead ... restarting`，新进程（pid 2436730）在 8090 就绪，无僵尸残留；
  4. 再次 `projects/check` → 200，不再 502。

## 相关代码

- `apps/dh-backend/agent/provisioner/directhost/manager.go` — 收割协程、`StartReconcileLoop`/`reconcileSlot`、`stubHealthy`。
- `apps/dh-backend/gateway/server/server.go` — reconcile 循环挂载点。
