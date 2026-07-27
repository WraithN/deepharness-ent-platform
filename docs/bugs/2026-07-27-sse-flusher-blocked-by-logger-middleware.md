# 2026-07-27 SSE 流被 Logger 中间件阻塞导致“连接已中断”

## 现象

在前端聊天窗口执行 `/proto-make` 等需要流式返回的指令时，模型没有任何输出，短暂等待后显示：

> 连接已中断，未收到模型响应，请重试。

后端日志出现：

```
[AGUIHandler] run=... streaming unsupported
```

随后 `AgentRun` handler 直接返回，前端 SSE 连接被关闭。

## 根因

`gateway/middleware/logger.go` 中的 `Logger` 中间件用 `statusRecorder` 包装了 `http.ResponseWriter`，但 `statusRecorder` 只实现了 `WriteHeader`，**没有实现 `http.Flusher` 接口**。

`AGUIHandler.AgentRun` 依赖类型断言 `flusher, ok := w.(http.Flusher)` 来获取 flush 能力。由于被 `statusRecorder` 包装后丢失了 `Flusher`，断言失败，handler 记录 `streaming unsupported` 后直接退出，导致 SSE 流无法下发给前端。

## 解决方案

为 `statusRecorder` 补充 `http.Flusher` 透传实现，并同时透传 `http.Hijacker` 和 `http.Pusher` 以保持原有扩展能力：

```go
func (r *statusRecorder) Flush() {
    if f, ok := r.ResponseWriter.(http.Flusher); ok {
        f.Flush()
    }
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) { ... }
func (r *statusRecorder) Push(target string, opts *http.PushOptions) error { ... }
```

修改后重新构建 `dh-backend` 并重启全部服务（`bash scripts/restart-dev.sh`），`/api/v1/agent` SSE 端点恢复 flush 能力，前端可正常接收流式事件。

## 验证

- `go build ./...` 与 `go vet ./...` 通过。
- `bash scripts/restart-dev.sh` 成功启动全部服务。
- 后端日志不再出现 `streaming unsupported`。
- 前端 `/proto-make` 等流式指令可正常接收事件（需在真实模型环境中进一步确认）。
