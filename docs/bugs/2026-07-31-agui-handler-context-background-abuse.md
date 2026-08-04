# agui handler context.Background() 滥用修复

## 现象

`agui_run.go` 和 `agui_helpers.go` 中约 14 处使用 `context.Background()` 而非请求 context `r.Context()`，导致客户端断开连接后，session 校验、消息保存、thread 迁移、闲聊回复等操作仍会继续执行，无法随请求取消而终止。这会造成：

- 已断开的请求仍占用数据库连接执行 session 查询/创建。
- 用户取消的闲聊/问候回复仍会写入消息库。
- thread 迁移在请求已废弃后仍执行，可能与后续请求产生竞争。

## 根因

HTTP handler 链路中，多个方法直接使用 `context.Background()` 而非请求级 context，原因是：

1. **Handler 内部调用**（`AgentRun` 中的 `ensureSession`/`saveUserMessages`）：直接写了 `context.Background()`，未使用已有的 `r`。
2. **辅助方法无 ctx 参数**（`abortIfGatewaydUnreachable`/`migrateThreadIfNeeded`/`scanRecentPrototypeProjects`）：方法签名未暴露 context，内部被迫使用 `context.Background()`。
3. **意图/闲聊路径**（`applyCommandsAndIntent`）：方法持有 `r *http.Request` 却未调用 `r.Context()`。

注意：`agentRunStream.bgCtx` 和 `executeAgentRun` 中的 `aguiClient.Run` 是**有意**使用 `context.Background()` 的——前端断连后仍需继续从 gatewayd 读取事件并缓冲/持久化，这是断连恢复设计的核心。这两处保留不动，仅补充注释说明。

## 解决方案

### 已替换为请求 context 的调用点

| 文件 | 位置 | 原调用 | 修改后 |
|------|------|--------|--------|
| `agui_run.go` | `AgentRun` 中 `ensureSession` | `context.Background()` | `r.Context()` |
| `agui_run.go` | `AgentRun` 中 `saveUserMessages` | `context.Background()` | `r.Context()` |
| `agui_run.go` | `AgentRun` 中 `migrateThreadIfNeeded` 调用 | 无 ctx | 传入 `r.Context()` |
| `agui_run.go` | `AgentRun` 中 `abortIfGatewaydUnreachable` 调用 | 无 ctx | 传入 `r.Context()` |
| `agui_run.go` | `applyCommandsAndIntent` 中 `streamChatResponse`（闲聊/问候） | `context.Background()` ×2 | `r.Context()` |
| `agui_run.go` | `applyCommandsAndIntent` 中 `finalizeSession`（闲聊/问候） | `context.Background()` ×2 | `r.Context()` |
| `agui_run.go` | `abortIfGatewaydUnreachable` 方法体 | `context.Background()` | 新增 `ctx` 参数，使用 `ctx` |
| `agui_run.go` | `migrateThreadIfNeeded` 方法体 | `context.Background()` ×3 | 新增 `ctx` 参数，使用 `ctx` |
| `agui_helpers.go` | `scanRecentPrototypeProjects` 方法体 | `context.Background()` | 新增 `ctx` 参数，使用 `ctx`（调用方传 `s.bgCtx`） |

### 保留 `context.Background()` 并补充注释的调用点

| 文件 | 位置 | 原因 |
|------|------|------|
| `agui_run.go` | `agentRunStream.bgCtx` 字段初始化 | 前端断连后仍需缓冲事件并持久化助手消息，必须独立于请求 context |
| `agui_run.go` | `executeAgentRun` 中 `aguiClient.Run` | 前端断连后 gatewayd 仍需继续执行 agent 任务，已有注释说明 |

### 验证

- `go build ./gateway/handler/...` 编译通过，0 errors。
- `go vet ./gateway/handler/...` 0 warnings。
- HTTP handler 签名保持不变（`AgentRun`/`RespondToAgent` 等）。
- `QuickComplete` 已使用传入的 `ctx`，无需修改。
