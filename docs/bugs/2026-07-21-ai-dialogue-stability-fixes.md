# 2026-07-21 AI 对话稳定性修复

## 现象

AI 对话在多场景下出现不稳定或数据丢失：

1. **SSE 事件丢失 / 解析异常**：gatewayd 返回的 SSE 事件在下游消费慢时被静默丢弃；单条事件跨多行 `data:` 时被拆成多个事件；扫描器遇到超大 token 或错误时直接结束，不通知下游。
2. **流挂死 / goroutine 泄露**：`inactivityReadCloser` 的 monitor goroutine 在连接关闭后不会退出，且 `Read` 返回任何错误都会错误地标记为超时。
3. **前端断连后 run 状态丢失或重复**：`AGUIHandler.AgentRun` 主循环与断连恢复路径各自维护一套事件处理逻辑，共享状态未加锁保护；`writeAndBuffer` 忽略写错误；事件被重复追加到 buffer。
4. **WebSocket 客户端永久放弃重连**：旧版 GatewaydClient 在连接失败 5 次后永久停止后台重连，导致 gatewayd 短暂恢复后事件通道无法恢复。
5. **命令/意图层错误被吞没**：`interceptCommands`、`applyIntentCommand` 无 error 返回，模板解析失败或 workspace 路径缺失时仍继续执行；`ruleBasedClassify` 使用 map 导致规则匹配顺序不确定。
6. **Session/Message Store 语义问题**：重复 message ID 直接忽略旧内容；`GetHistory` 返回内部切片引用；Postgres `GetHistory` 使用正序 LIMIT 导致只取到最旧消息；`MigrateMessages` 非事务且无目标 session 预检；JSON 反序列化失败被静默忽略。
7. **内存资源无上限**：内存 session 和 SSE buffer 无数量/容量限制，长期运行可能 OOM。
8. **Redis buffer 非原子**：SSE 事件写入与 TTL 刷新分两次请求，存在竞态窗口。
9. **gatewayd 不可达 fallback 产生假 session**：`CreateSession` 在 gatewayd 不可达时生成本地 UUID session，后续 `/api/v1/agent` 仍可能向该 session 发送 run，导致持续失败。
10. **projects/ 目录可能被误提交**：AI 生成文件按模板写入 `{WORKSPACE_PATH}/projects/`，但 `.gitignore` 仅忽略根目录 `/projects/`，对嵌套 projects 目录无兜底。

## 根因

- **SSE 读取层**：`readSSE` 把每条 `data:` 行当作独立事件，未按 SSE 规范合并多行；`bufio.Scanner` 未设置足够大的 token size，也未在 `scanner.Err()` 时向下游发送错误事件；`inactivityReadCloser` 缺少 goroutine 生命周期管理。
- **AGUI Handler 层**：主循环与断连恢复路径代码重复，状态机未抽象；`writeAndBuffer` 只记录 marshal 错误，忽略 HTTP 写入和 flush 错误；`finishTimer`/`maxTimer` 在部分返回路径未停止；`h.buffer.Append` 在主循环中被重复调用。
- **客户端层**：`GatewaydClient.run` 把失败计数上限当作永久退出条件，未在成功连接后重置。
- **命令/意图层**：函数签名未返回 error，错误只能打印日志而无法阻断；`commandKeywordMap` 是 map，Go 迭代顺序随机。
- **存储层**：内存 store 为性能直接返回内部切片；Postgres `GetHistory` 排序方向错误；多处 JSON 反序列化使用 `_ = json.Unmarshal(...)` 忽略错误。
- **资源与兜底**：内存 session 和 buffer 缺少上限和 TTL；Redis 事件追加与 TTL 刷新未使用 pipeline；gatewayd 不可达 fallback 未在 session 上下文中标记，导致后续 run 无法识别。

## 解决方案

### 1. SSE 读取与超时（`apps/dh-backend/agent/client/agui_client.go`）

- 新增常量：`runRequestTimeout`、`sseEventBufferSize`、`sseScannerMaxTokenSize`。
- `Run` 的 POST 请求使用带 `runRequestTimeout` 的 `http.Client`。
- 重写 `readSSE`：按空行合并多行 `data:`；使用 `sseScannerMaxTokenSize`；`scanner.Err()` 时发送 `RUN_ERROR`；事件通道阻塞 5s 后丢弃并记录 warning。
- 重写 `inactivityReadCloser`：增加 `done` 通道和 `closeOnce`，保证 monitor goroutine 退出并避免重复关闭；仅在真正超时时设置 `timedOut`。

### 2. WebSocket 客户端重连（`apps/dh-backend/agent/client/http.go`）

- `run()` 改为连接成功后重置失败计数，连续失败时使用 capped backoff，但永不永久放弃。
- `connect()` 返回 bool 表示是否成功建立过连接。

### 3. 命令与意图层（`apps/dh-backend/gateway/handler/command.go`、`intent.go`）

- `extractQuotedCard` / `extractSelectedRepos` 返回 error。
- `fetchWorkItem` 返回 error，`interceptCommands` 改为 `(bool, error)`。
- `renderTemplate` 检查 `{WORKSPACE_PATH}` 残留，为空时返回 error。
- 提取 `applyCommandConfig` 统一处理模板渲染、任务卡片与代码库注入；`applyIntentCommand` 复用该逻辑并返回 error。
- `CommandsHandler` 捕获 encode 错误。
- `ruleBasedClassify` 使用有序 slice 代替 map。
- `parseIntentResponse` 兼容大小写、code fence、前缀后带解释文本、无前缀的指令名等 LLM 输出抖动。

### 4. AGUI Handler 事件处理状态机（`apps/dh-backend/gateway/handler/agui.go`）

- 提取 `runState` 结构体统一保存运行状态。
- 拆分 `writeEvent`（写客户端+buffer）和 `bufferEvent`（仅 buffer），并捕获写错误。
- 提取 `processEvent` 统一处理事件状态机，主循环与断连恢复路径共用。
- 移除主循环中重复的 `h.buffer.Append`。
- `RUN_ERROR`、超时、max duration、stream 关闭等路径均停止 timer 并正确 flush/persist。
- `streamChatResponse` 使用 detached context。
- 在 `aguClient.Run` 前检查 session context 中的 `gatewaydUnreachable` 标记，直接返回错误。
- 修复 `flusher` 不支持时的 `http.Error` 在 headers 已发送后调用的问题，改为记录日志并返回。

### 5. Session/Message Store（`apps/dh-backend/agent/chat/session/message.go`、`session.go`、`postgres.go`）

- 内存 `MessageStore.Append`：重复 ID 且内容不同时更新；`GetHistory` 返回深拷贝。
- 内存 `SessionStore`：增加 `maxSessions`/`ttl` 和 `reaper` goroutine，超过上限时淘汰最旧 session。
- 内存 `GetSessionTrails` 使用 `sort.Slice`，并填充 `MessageCount`（内存实现为 0，因消息计数在另一 store）。
- Postgres `GetHistory`：改为 `ORDER BY created_at DESC LIMIT` 再反转，保证拿到最新消息。
- Postgres `MigrateMessages`：使用事务，并预检/创建目标 session 占位记录。
- Postgres 多处 JSON 反序列化失败返回 error。
- Postgres `GetSessionTrails` 使用 `COUNT(DISTINCT m.id)` 避免消息计数膨胀。

### 6. 内存与 Redis Buffer（`apps/dh-backend/agent/agui/buffer/memory/buffer.go`、`redis/buffer.go`）

- 内存 buffer 设置 `maxEventsPerSession = 10000`，超过时淘汰最旧事件。
- Redis buffer `Append` 使用 `Pipelined(RPush + Expire)` 原子化写入并刷新 TTL。

### 7. CreateSession fallback 标记（`apps/dh-backend/gateway/handler/session.go`）

- gatewayd 不可达使用本地 UUID 时，设置 `context["gatewaydUnreachable"] = true`。
- `AGUIHandler.AgentRun` 检测到该标记后直接返回 `GATEWAYD_UNREACHABLE` 错误。

### 8. projects/ 目录保护（`.gitignore`）

- 将 `/projects/` 改为 `projects/` 和 `**/projects/`，确保任意位置的 projects 目录不被提交。

## 验证结果

- `go build ./...` 与 `go vet ./...` 在 `apps/dh-backend` 和 `apps/agent-stub` 均通过。
- `pnpm build` 与 `pnpm check-types` 通过。
- 本地 `pnpm dev` 启动后，通过 curl 测试前后端接口正常。

## 相关文件

- `apps/dh-backend/agent/client/agui_client.go`
- `apps/dh-backend/agent/client/http.go`
- `apps/dh-backend/gateway/handler/agui.go`
- `apps/dh-backend/gateway/handler/command.go`
- `apps/dh-backend/gateway/handler/intent.go`
- `apps/dh-backend/gateway/handler/session.go`
- `apps/dh-backend/agent/chat/session/message.go`
- `apps/dh-backend/agent/chat/session/session.go`
- `apps/dh-backend/agent/chat/session/postgres.go`
- `apps/dh-backend/agent/agui/buffer/memory/buffer.go`
- `apps/dh-backend/agent/agui/buffer/redis/buffer.go`
- `.gitignore`
- `docs/bugs/2026-07-21-ai-dialogue-stability-fixes.md`
