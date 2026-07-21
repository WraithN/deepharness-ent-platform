# AG-UI SSE 流挂死（agent 进程退出后 gatewayd 不关闭流）

## 现象

用户发送消息后，前端一直显示"思考中"（thinking），持续数分钟不产生任何 AI 响应内容或工具调用事件。

## 根因

1. **agent 进程意外退出**：dh-gatewayd 通过 `--attach opencode` 启动的 `opencode serve` 进程在处理请求过程中 crash/退出（PID 消失，端口 3001 连接变为 TIME_WAIT）
2. **gatewayd 未传播错误**：gatewayd 与 opencode 之间的 TCP 连接虽然已关闭，但 gatewayd 没有向前端/后端发送 `RUN_ERROR` 或关闭 SSE 流（`/sessions/{id}/chat` 的 HTTP 长连接仍保持 ESTABLISHED）
3. **`readSSE` 无超时机制**：`AGUIClient.readSSE` 使用 `bufio.NewScanner(body)` 阻塞读取，网关层 `maxRunDuration` 为 10 分钟且需要收到事件才触发，导致 stream 挂死时前端无限等待

## 解决方案

**缓解措施（dh-backend 侧）**：在 `agui_client.go` 中为 gatewayd SSE 响应体添加 inactivity 超时机制：

- 新增 `inactivityReadCloser` 类型，包装 `io.ReadCloser`
- 每次 `Read` 成功读取到数据后发送 heartbeat 给后台监控 goroutine
- 后台监控 goroutine 使用 `time.NewTimer` 倒计时，超时（默认 2 分钟）无读取则调用底层 `Close()` 断开 SSE 连接
- `Read` 方法返回 `"sse stream idle timeout"` 错误，供 `scanner.Err()` 捕获

常量 `SSE_IDLE_TIMEOUT = 2 * time.Minute` 定义在 `agui_client.go`。

**根本修复**：需在 gatewayd 侧添加 agent 进程退出检测，当 agent 实例进程结束时主动发送 `RUN_ERROR` 事件并关闭 SSE 流。

## 验证结果

- Go build 通过，`go vet` 通过
- 服务重启后 SSE 流超时机制生效
