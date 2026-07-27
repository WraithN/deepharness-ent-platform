# AGUIClient.CreateThread 空 body 导致 gatewayd 400 错误

## 现象

飞书机器人通过 `AGUIClient.QuickComplete` / `AGUIClient.Run` 分发消息时，
gatewayd 返回 `400 Bad Request`：

```
create session status 400: Failed to parse the request body as JSON:
EOF while parsing a value at line 1 column 0
```

导致 agent 会话创建失败，飞书用户收不到回复。

## 根因

`AGUIClient.CreateThread`（`agent/client/agui_client.go:57`）在 `preferredID` 为空时
发送 `nil` body，但**始终设置** `Content-Type: application/json` header。

gatewayd（Rust 实现）在检测到 `Content-Type: application/json` 后尝试用 serde 解析请求体，
空 body 导致 `EOF while parsing` 错误。

对比旧版 `GatewaydClient.CreateThread`（`agent/client/http.go:304`）：
仅在 `preferredID != ""` 时才设置 `Content-Type` header，因此空 body 不会被当作 JSON 解析，
gatewayd 能正常接受。

前端流程因 `SessionHandler.CreateSession` 有 fallback（gatewayd 失败时回退到本地 UUID，
后续 `AGUIClient.Run` 内部的 session-not-found 重试机制会重建 thread），
所以此问题在前端路径下被掩盖，但在飞书机器人直接调用 `AGUIClient.Run`/`QuickComplete` 时暴露。

## 解决方案

修改 `AGUIClient.CreateThread`：`preferredID` 为空时发送空 JSON 对象 `{}` 作为 body，
而非 `nil`。这样 gatewayd 的 JSON 解析器能正确处理。

```go
// 修改前
var bodyReader io.Reader
if preferredID != "" {
    b, _ := json.Marshal(map[string]string{"id": preferredID})
    bodyReader = bytes.NewReader(b)
}
req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.adminURL+"/sessions", bodyReader)

// 修改后
var bodyBytes []byte
if preferredID != "" {
    bodyBytes, _ = json.Marshal(map[string]string{"id": preferredID})
} else {
    bodyBytes = []byte("{}")
}
req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.adminURL+"/sessions", bytes.NewReader(bodyBytes))
```

### 验证结果

1. `go build ./apps/dh-backend/...` 编译通过
2. `go vet ./apps/dh-backend/...` 0 warnings
3. 重启开发环境后，飞书机器人 mock 测试全链路通过：
   - URL 验证（challenge 回传）✓
   - 用户绑定/查询 ✓
   - 一次性问答（QuickComplete）成功到达 gatewayd 并创建 session ✓
   - 持久化会话（Run）成功创建 thread、消费事件、持久化映射 ✓
   - 同一飞书会话二次消息复用相同 threadId（上下文延续）✓
