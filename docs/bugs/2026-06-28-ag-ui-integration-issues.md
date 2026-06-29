# AG-UI 集成端到端验证问题

## 现象

在完成 AG-UI 集成改造后，启动 `dh-backend` 与 `apps/web` 并进行端到端验证时发现：

1. `dh-backend` 日志持续打印 `[GatewaydClient] ws connect failed: websocket: bad handshake, retrying...`，即使已经不再使用旧版 WebSocket 会话路径。
2. 调用 `POST /api/v1/agent` 后，`/sessions/{id}/agents` 请求长时间无响应，最终超时。
3. 超时后 `dh-backend` 返回 `RUN_ERROR`，消息为 `run status 422: Failed to deserialize the JSON body into the target type: tools: invalid type: null, expected a sequence`。
4. 即便成功收到 `TEXT_MESSAGE_END`，`gatewayd` 也不会发送 `RUN_FINISHED`，导致 SSE 连接一直挂起直到客户端超时。
5. 前端通过 `@assistant-ui/react-ag-ui` 发送消息时，`POST /api/v1/agent` 返回 `invalid json: json: cannot unmarshal array into Go struct field Message.messages.content of type string`。
6. 修复反序列化后，curl 可收到 `TEXT_MESSAGE_START/END`，但 `TEXT_MESSAGE_CONTENT`（AI 回复正文）经常丢失，前端只能看到空消息。
7. 前端控制台报错：`Cannot send 'THINKING_TEXT_MESSAGE_START' event: A thinking step is not in progress. Create one with 'THINKING_START' first.`
8. `gatewayd` 重启或 session 失效后，前端使用旧 `threadId` 请求会返回 `RUN_ERROR`（`Plugin not found: session <id>`）。

## 根因

1. **旧 GatewaydClient 自动启动后台重连**
   - `apps/dh-backend/agent/client/http.go` 的 `NewGatewaydClient` 在构造时立即 `go c.run()`，无限重连旧的 `/agents/events` WebSocket。
   - AG-UI 改造后该客户端已不在主聊天路径使用，但仍然产生噪音日志并消耗资源。

2. **ent-desktop `dh-gatewayd` 的 `create_instance` 死锁**
   - `crates/agent-core/src/service.rs` 中 `create_instance` 先获取 `instances` 锁计算唯一 ID，随后再次调用 `self.instances.lock().await.insert(...)`。
   - 由于第一次获取的 `MutexGuard` 仍在作用域内，第二次加锁导致同一线程死锁，因此 `POST /sessions/{id}/agents` 永远阻塞。

3. **AG-UI RunAgentInput 数组字段为 `null`**
   - `apps/dh-backend/agent/client/agui_client.go` 转发给 `gatewayd` 的 JSON 中，`tools`、`context`、`messages` 为 `null`。
   - `gatewayd` 使用强类型反序列化，要求这些字段为数组，因此返回 422。

4. **`gatewayd` 不发送 `RUN_FINISHED`**
   - `claude-plugin` 在完成 `TEXT_MESSAGE_END` 后没有向事件总线发送 `RunFinished` 事件。
   - 前端/代理无法判断流是否结束，连接只能等到客户端超时。

5. **`dh-backend` 的 `Message.Content` 类型与 AG-UI 标准不符**
   - AG-UI 规范中消息 `content` 是 content-block 数组，例如 `[{"type":"text","text":"hi"}]`。
   - `apps/dh-backend/agent/agui/types.go` 中 `Message.Content` 使用 `string`，导致前端发送数组时反序列化失败。

6. **`gatewayd` SSE `/sessions/{id}/runs` 丢失事件**
   - `apps/gatewayd/src/handlers/sse.rs` 的 `AguiEventStream` 在每次 `poll_next` 都调用 `self.rx.resubscribe()` 创建新的 broadcast 接收者。
   - 事件在两次 poll 之间快速发送时，新接收者会错过 `TEXT_MESSAGE_CONTENT` 等事件，因此 curl 只能看到 `START/END` 而看不到正文。

7. **`gatewayd` thinking 事件序列不完整**
   - `gatewayd` 的 `map_thinking` 只发送 `THINKING_TEXT_MESSAGE_START/CONTENT/END`。
   - `@ag-ui/client` 内部状态机要求 thinking 消息必须包裹在 `THINKING_START` / `THINKING_END` 之间，否则抛出 `AGUIError`。

8. **`gatewayd` session 易失，前端旧 `threadId` 导致失败**
   - `gatewayd` 的 session 保存在内存中，重启后丢失。
   - 前端 `HttpAgent` 会复用上一次成功运行返回的 `threadId`，再次请求时 `dh-backend` 直接转发给 `gatewayd`，导致 `Plugin not found: session <id>`。

## 解决方案

1. **延迟启动旧 GatewaydClient 并限制重试**
   - 移除构造函数中的 `go c.run()`，改为在 `SendMessage` 首次被调用时才 `ensureRunning()`。
   - 重连循环使用指数退避并设置最大重试次数（5 次），超过后停止后台重连，避免无限噪音。
   - 涉及文件：`apps/dh-backend/agent/client/http.go`

2. **修复 `gatewayd` 死锁**
   - 在 `deepharness-ent-desktop/crates/agent-core/src/service.rs` 中，将唯一 ID 计算放到独立的代码块内，确保第一次锁在 `insert` 前释放。
   - 重新编译并重启 `dh-gatewayd` 后，`POST /sessions/{id}/agents` 可立即返回 201。

3. **保证数组字段非 `null`**
   - 在 `apps/dh-backend/agent/client/agui_client.go` 的 `Run` 方法中，对 `Tools`、`Context`、`Messages` 为 `nil` 时初始化为空数组。
   - attach 请求增加 `"force": true`，避免 `gatewayd` 复用可能已失效的旧 instance。

4. **代理层兜底 `RUN_FINISHED`**
   - 在 `apps/dh-backend/gateway/handler/agui.go` 中，使用 `select` 同时监听事件流和定时器。
   - 收到 `TEXT_MESSAGE_END` 后启动 5 秒等待，若期间无新事件则主动写入 `RUN_FINISHED` 并结束响应。

5. **`Message.Content` 支持字符串与 content-block 数组**
   - 将 `apps/dh-backend/agent/agui/types.go` 中 `Message.Content` 改为 `json.RawMessage`。
   - 新增 `ContentText()` 方法，统一解析字符串或 `[{"type":"text","text":"..."}]` 数组。
   - 新增 `ToGatewaydMessage()` 方法，转发给 `gatewayd` 前将数组内容提取为字符串（gatewayd 当前只接受字符串 content）。
   - 涉及文件：`apps/dh-backend/agent/agui/types.go`、`apps/dh-backend/agent/client/agui_client.go`

6. **修复 `gatewayd` SSE 事件丢失**
   - 重写 `apps/gatewayd/src/handlers/sse.rs`，使用 `futures_util::stream::unfold` 包装单个 `broadcast::Receiver`，避免每次 poll 重新 subscribe。
   - 重新编译并重启 `dh-gatewayd` 后，curl 可稳定收到 `TEXT_MESSAGE_CONTENT`。

7. **避免重复 `RUN_STARTED`**
   - `gatewayd` 的 `/sessions/{id}/runs` 已经会发送 `RUN_STARTED`，`dh-backend` 不再提前写入该事件，避免前端收到重复的 run 开始事件。
   - 涉及文件：`apps/dh-backend/gateway/handler/agui.go`

8. **补齐 thinking 事件序列**
   - 在 `apps/gatewayd/src/agui/types.rs` 增加 `ThinkingStart` / `ThinkingEnd` 事件类型。
   - 修改 `apps/gatewayd/src/agui/mapper.rs` 的 `map_thinking`，输出完整序列：`THINKING_START` → `THINKING_TEXT_MESSAGE_START` → `THINKING_TEXT_MESSAGE_CONTENT` → `THINKING_TEXT_MESSAGE_END` → `THINKING_END`。
   - `apps/dh-backend/agent/agui/types.go` 同步添加 `EventThinkingStart` / `EventThinkingEnd` 以便解析。

9. **session 失效时自动重建**
   - `apps/dh-backend/agent/client/agui_client.go` 的 `Run` 方法在 attach 返回 `session not found` 时，自动 `CreateThread` 并使用新 `threadId` 重试。
   - `Run` 返回实际使用的 `threadId`，`apps/dh-backend/gateway/handler/agui.go` 用它生成 `RUN_FINISHED`，避免返回已失效的旧 `threadId`。
   - 运行失败时只发送 `RUN_ERROR`，不再追加 `RUN_FINISHED`，避免触发前端状态机错误。

## 验证结果

```bash
# 前端代理路径验证（content 使用 AG-UI 数组格式）
curl -N -X POST http://localhost:8080/api/v1/agent \
  -H "Content-Type: application/json" \
  -d '{
    "threadId": "",
    "runId": "",
    "agentId": "claude-code",
    "messages": [{"role":"user","content":[{"type":"text","text":"hi"}]}],
    "tools": [],
    "context": []
  }'

# 返回事件流（约 6-10 秒内完成）
data: {"type":"RUN_STARTED",...}
data: {"type":"STATE_SNAPSHOT",...}
data: {"type":"THINKING_START",...}
data: {"type":"THINKING_TEXT_MESSAGE_START",...}
data: {"type":"THINKING_TEXT_MESSAGE_CONTENT",...}
data: {"type":"THINKING_TEXT_MESSAGE_END",...}
data: {"type":"THINKING_END",...}
data: {"type":"CUSTOM","name":"status_changed",...}
data: {"type":"THINKING_TEXT_MESSAGE_START",...}
data: {"type":"THINKING_TEXT_MESSAGE_CONTENT",...}
data: {"type":"THINKING_TEXT_MESSAGE_END",...}
data: {"type":"TEXT_MESSAGE_START",...}
data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hi! How can I help you today?",...}
data: {"type":"TEXT_MESSAGE_END",...}
data: {"type":"RUN_FINISHED",...}
```

- `go vet ./...` 在 `apps/dh-backend` 通过。
- `pnpm lint` 全部通过。
- `pnpm build` 全部通过。
- `dh-backend` 与 `apps/web` dev 服务器均正常启动。
- 通过 `curl` 验证了从 `dh-backend` 到 `gatewayd` 的完整 AG-UI SSE 消息流，AI 回复正文已正常返回。
