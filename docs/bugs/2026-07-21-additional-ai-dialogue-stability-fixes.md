# 2026-07-21 追加 AI 对话稳定性修复

## 现象

在对 `apps/dh-backend` 进行新一轮稳定性审查后，发现以下仍会影响 AI 对话稳定性的设计问题：

1. **新会话的首条用户消息可能丢失**：`AGUIHandler.AgentRun` 在 `sessionID` 尚未确定时提前调用 `saveUserMessages`，当直接调用 `/api/v1/agent` 或 gatewayd 创建了新 thread 时，消息被记录到空 session 中，导致历史记录缺失。
2. **RUN_FINISHED 事件重复下发**：当 gatewayd 在 SSE 流中显式发送 `RUN_FINISHED` 后关闭流时，`AGUIHandler` 会先处理该事件再因通道关闭进入 `completeRun`，后者又发送一次 `RUN_FINISHED`，前端可能重复结束本轮对话。
3. **inactivityReadCloser 可能重复关闭底层连接**：超时时 `monitor` 直接调用 `r.rc.Close()`，而 `readSSE` 的 `defer body.Close()` 会再次关闭同一个 `rc`，若底层 `io.ReadCloser` 不保证幂等，可能引发未定义行为或异常。
4. **SSE 最后一个事件无 trailing 空行时丢失**：`readSSE` 仅在遇到空行时解析事件，如果 gatewayd 发送的最后一个事件没有以空行结尾，`pendingData` 会被丢弃。
5. **SSE 解析失败被静默忽略**：`json.Unmarshal` 失败时只记录日志并继续，下游无法感知gatewayd 返回了异常数据。
6. **gatewayd 不可达 fallback 仍调用 gatewayd API**：`CreateSession` 在 `gatewaydUnreachable` 时仍调用 `SetContext`、`AttachAgent`、`UpdateAgentConfig`，产生无意义失败日志并可能阻塞。

## 根因

- **消息落库时机**：`saveUserMessages` 被放在 `aguiClient.Run` 之前，且使用尚未确定的 `sessionID`；对于没有预先创建后端 session 的新 thread，此时 `sessionID` 为空，消息被静默跳过。
- **RUN_FINISHED 处理缺失**：主事件循环中 `EventRunFinished` 仅打印日志，未将其作为 run 终止信号处理，导致通道关闭后的兜底路径再次补发结束事件。
- **超时关闭缺少一次性保护**：`monitor` 和 `Close` 各自直接操作 `r.rc`，未通过同一个 `sync.Once` 协调，存在竞态窗口。
- **SSE 解析逻辑不完整**：未处理流结束时的残留数据，也未将解析失败事件化。
- **fallback 路径未短路 gatewayd 调用**：`gatewaydUnreachable` 标记仅用于设置上下文，未阻止后续 gatewayd 调用。

## 解决方案

### 1. 分阶段保存用户消息（`apps/dh-backend/gateway/handler/agui.go`）

- 在解析工作区路径后，对**已知存在**的后端 session 仍提前保存用户消息。
- 对 gatewayd 尚未返回的新 session，先记录 `originalMessages` 快照（在 `interceptCommands` 修改内容之前，使用深拷贝避免字节切片共享），待 `actualThreadID` 确定并通过 `ensureSession` 后再执行落库。
- 这样既能保留旧会话提前落库的行为，又能保证新会话不会因为 `sessionID` 为空而丢失消息。

### 2. 处理 RUN_FINISHED 并提前结束（`apps/dh-backend/gateway/handler/agui.go`）

- 在主事件循环的 `case agui.EventRunFinished:` 中，停止 `finishTimer`/`maxTimer`，刷新待闭合状态，将事件写入前端，持久化助手消息，更新会话活动时间，然后直接 `return`。
- 避免通道关闭时的 `completeRun` 再次发送 `RUN_FINISHED`。

### 3. inactivityReadCloser 单次关闭（`apps/dh-backend/agent/client/agui_client.go`）

- 超时分支改为调用 `r.Close()`，让 `closeOnce` 保证 `r.rc` 只关闭一次。
- `Close` 在 `closeOnce` 内部完成 `closed`/`timedOut` 标记、关闭 `done` 通道和 `r.rc.Close()`，并返回 `nil`。

### 4. SSE 残留事件与解析错误处理（`apps/dh-backend/agent/client/agui_client.go`）

- 在 `scanner.Err()` 之后检查 `pendingData`，若不为空则尝试解析并发送最后一个事件。
- 事件解析失败时向下游发送 `RUN_ERROR`（`SSE_PARSE_ERROR`），避免静默丢弃。
- 提取 `emitPendingEvent` / `logEvent` 辅助函数，减少重复逻辑。

### 5. CreateSession fallback 跳过 gatewayd 调用（`apps/dh-backend/gateway/handler/session.go`）

- 当 `gatewaydUnreachable` 为 true 时，不再调用 `SetContext`、`AttachAgent`、`UpdateAgentConfig`，直接生成本地 session 记录。

### 6. Postgres 消息 upsert 语义一致（`apps/dh-backend/agent/chat/session/postgres.go`）

- 将 `agent_messages` 的 `ON CONFLICT (id) DO NOTHING` 改为 `ON CONFLICT (id) DO UPDATE SET ...`，与内存实现一致：当同一消息 ID 携带新内容时更新字段，保证重试或消息内容变更后历史记录一致。

## 验证结果

- `cd apps/dh-backend && go build ./... && go vet ./...` 通过，无 warning。
- `cd apps/agent-stub && go build ./... && go vet ./...` 通过，无 warning。
- 相关代码路径的语法与并发控制经人工复核，未发现新的竞态或资源泄漏。

## 相关文件

- `apps/dh-backend/gateway/handler/agui.go`
- `apps/dh-backend/agent/client/agui_client.go`
- `apps/dh-backend/gateway/handler/session.go`
- `apps/dh-backend/agent/chat/session/postgres.go`
- `docs/bugs/2026-07-21-additional-ai-dialogue-stability-fixes.md`
