# 2026-07-31 GatewaydClient 后台 goroutine 泄漏（c.done 永不关闭）

## 现象

`GatewaydClient.run()` goroutine 依赖 `c.done` channel 退出，但 `c.done` 在全代码库中从未被 `close`，且 `GatewaydClient` 没有 `Close()` / `Shutdown()` 方法。

- 当 `SendMessage` 触发 `ensureRunning()` 后，`run()` goroutine 会持续运行（按 capped backoff 反复重连 gatewayd WebSocket）。
- 进程生命周期内没有任何路径会关闭 `c.done`，导致该 goroutine 永远无法优雅停止，形成 goroutine 泄漏。
- struct 中已声明 `done chan struct{}` 与 `once sync.Once` 字段，但 `once` 完全未被使用。

## 根因

`agent/client/http.go` 中只设计了退出信号（`c.done`）却缺少触发退出的入口（`Close` 方法）：

```go
func (c *GatewaydClient) run() {
    for {
        select {
        case <-c.done:   // 永远不会被 close → 永远阻塞/循环
            return
        default:
        }
        ...
    }
}
```

`c.done` 仅在 `run()` 内被读取，没有任何代码调用 `close(c.done)`，因此后台重连 goroutine 一旦启动即无法终止。

## 解决方案

为 `GatewaydClient` 新增幂等的 `Close()` 方法，复用 struct 中已声明但未使用的 `once sync.Once` 字段，仅新增方法、不改动现有逻辑：

```go
func (c *GatewaydClient) Close() {
    c.once.Do(func() {
        close(c.done)
        c.runMu.Lock()
        c.running = false
        c.runMu.Unlock()
        c.connMu.Lock()
        if c.conn != nil {
            c.conn.Close()
            c.conn = nil
        }
        c.connMu.Unlock()
    })
}
```

关闭顺序说明：
1. 先 `close(c.done)`：通知 `run()` goroutine 退出重连循环；
2. 再置 `running=false`：避免 `Close` 之后 `ensureRunning` 误判为已在运行；
3. 最后关闭 WebSocket 连接：打断 `connect()` 中阻塞的 `ReadMessage`，使其尽快返回，随后 `run()` 循环回到顶部 `select` 检测到 `c.done` 已关闭而退出。

幂等性：`sync.Once` 保证 `close(c.done)` 只执行一次，多次调用 `Close()` 不会 panic。`c.done` 只关闭一次，即使 `Close` 之后再次调用 `ensureRunning` 启动新 goroutine，新 goroutine 首个 `select` 也会立即检测到 `c.done` 已关闭而返回，不会造成新的泄漏。

## 待办（超出本次修复范围）

`gateway/server/server.go` 中 `agentClient` 为 `New()` 内局部变量，`New()` 仅返回 `http.Handler`；`main.go` 使用裸 `http.ListenAndServe`，无优雅关闭路径。当前尚无调用 `Close()` 的入口。本次按“不改变现有逻辑，只添加 Close 方法”的约束未改动 server / main，后续接入优雅关闭时（例如在 `main.go` 增加 signal 处理与 `server.Shutdown`）应调用 `agentClient.Close()`。

## 验证

- `go build ./agent/client/...` 通过。
- `go vet ./agent/client/...` 通过，0 warnings。
- `go build ./...`（dh-backend 全模块）通过。
- `go test ./agent/...` 全部通过。
