# 2026-07-31 WebSocket 双向代理与个人助手连接缺乏心跳/读超时

## 现象

两处 WebSocket 连接未设置读超时与 ping/pong 心跳，当连接因网络中断、对端崩溃、NAT 超时等原因变为「半开」状态时，`ReadMessage()` 会永久阻塞，无法感知连接已失效：

1. `gateway/handler/gatewayd_proxy.go` 的 `serveWS()`：客户端与 gatewayd 之间的双向代理，两个连接（`clientConn`、`gatewaydConn`）均无 `SetReadDeadline`、无 ping/pong。一旦任一侧变为半开，对应的转发 goroutine 将永久阻塞在 `ReadMessage()`，连接资源与 goroutine 无法回收，前端会话表现为「卡住无响应」。
2. `domain/personalassistant/websocket.go`：个人助手会话连接的 `conn.ReadMessage()` 无读超时（仅 `writeMessage` 有 10s 写超时）。半开连接同样会导致会话 goroutine 永久挂起。

## 根因

gorilla/websocket 默认不启用应用层心跳。若不主动设置读超时与 pong handler，读操作没有上限等待时长：

- 未调用 `conn.SetReadDeadline(...)`：`ReadMessage()` 无超时，半开连接下永久阻塞。
- 未设置 `conn.SetPongHandler(...)`：即使发送 ping，也无法在收到 pong 时重置读超时。
- 未启动定期 ping goroutine：对端不会被动回复 pong，无法双向探活。

标准做法（gorilla/websocket 官方示例）是：设置 `pongWait` 读超时 → 设置 pong handler 在收到 pong 时重置读超时 → 启动 ticker 按 `pingInterval`（< `pongWait`）定期发送 ping。三要素缺一不可。

## 解决方案

按规则 6（重复逻辑封装），将心跳逻辑抽取为共享包 `apps/dh-backend/pkg/wsutil/heartbeat.go`，供两处复用：

```go
// pkg/wsutil/heartbeat.go
const (
    PingInterval = 30 * time.Second // 发送 ping 间隔，须 < PongWait
    PongWait     = 60 * time.Second // 读超时，须 > PingInterval
    WriteWait    = 10 * time.Second // 控制消息写入超时
)

type Heartbeat struct { ... }

func NewHeartbeat(conn *websocket.Conn, name string) *Heartbeat {
    // 1. 初始读超时
    conn.SetReadDeadline(time.Now().Add(PongWait))
    // 2. pong handler 重置读超时（与 ReadMessage 同 goroutine，安全）
    conn.SetPongHandler(func(string) error {
        conn.SetReadDeadline(time.Now().Add(PongWait)); return nil
    })
    // 3. ticker goroutine 周期发 ping
    safego.Go("ws-ping-"+name, func() {
        ticker := time.NewTicker(PingInterval); defer ticker.Stop()
        for {
            select {
            case <-hb.done: return
            case <-ticker.C:
                conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(WriteWait))
            }
        }
    })
}
func (hb *Heartbeat) Stop() { hb.once.Do(func() { close(hb.done) }) }
```

并发安全说明（关键）：gorilla/websocket 文档明确「`Close` 和 `WriteControl` 方法可与所有其他方法并发安全调用」。因此 ping 通过 `WriteControl` 发送，可与既有的 `WriteMessage`/`WriteJSON` 数据写入并发共存，**无需加锁、不改变现有消息转发逻辑**。pong handler 在 `ReadMessage` 内部执行（读 goroutine），其内调用 `SetReadDeadline` 与读操作同 goroutine，亦安全。

接入点：

1. `gatewayd_proxy.go` `serveWS()`：在 `clientConn` 与 `gatewaydConn` 各创建一个 `Heartbeat`，`defer hb.Stop()`。
2. `personalassistant/websocket.go` `WebSocket()`：在 `conn` 升级后创建 `Heartbeat`，`defer hb.Stop()`。

停止机制：`Stop` 用 `sync.Once` 保证幂等（可多次调用）；即使调用方忘记 `Stop`，ping goroutine 也会在连接关闭后 `WriteControl` 失败时自行退出，不会永久泄漏。

## 验证

- `go build ./pkg/wsutil/... ./domain/personalassistant/... ./gateway/handler/...` 通过。
- `go vet ./pkg/wsutil/... ./domain/personalassistant/... ./gateway/handler/...` 通过，0 warnings。
- 注：`go build ./...` 全模块存在与本次无关的预存编译错误（`domain/feishu/service/group_history.go` 缺字段/缺 `bytes` 导入，属仓库既有未完成改动），非本次引入。
