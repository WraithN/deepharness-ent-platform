# 2026-07-27 每次 send 强制重建 agent instance 导致子进程反复重启

## 现象

同一 session 连续对话时：

1. **前端 tab 标题里的 instanceId 永远不变**（永远是 CreateSession 第一次拿到的），但后端真正的 instance ID 在 `claude-code` ↔ `claude-code-1` 之间反复跳。
2. **claude/opencode 子进程每次 send 都被杀+重启**，stdin 长连接被打断，进程内的 `active_session_id`（来自 init 事件）全部丢失。
3. **每次新进程启动时没有传 `--resume <session_id>`**，新 claude 进程不知道上一次的 session_id，导致上下文断裂。
4. **reaper 10 分钟 idle 之前，全局 instances registry 里残留多个 instance**（kill 成功的也会短暂残留直到被 remove）。

## 根因

`apps/dh-backend/agent/client/agui_client.go` 的 `Run()` 方法在每次用户发消息时都硬编码 `force=true` 调用 gatewayd 的 `attachAgent`：

```go
// 修改前（L217）
if err := c.attachAgentWithKey(attachCtx, input.ThreadID, true, pluginKey, workspace); err != nil {
```

gatewayd 收到 `force=true` 后跳过复用分支，走"建新+杀旧"路径，导致：

- claude/opencode 子进程 stdin 长连接被中断
- 进程内 `session_id`（来自 init 事件）丢失，新进程未收到 `--resume <session_id>`
- 每次消息都付出进程启动 + 模型冷启动代价

### force=true 的引入背景

`force=true` 最初在 2026-06-28 AG-UI 集成时引入（见 `docs/bugs/2026-06-28-ag-ui-integration-issues.md` 第 63 行），作为防御性措施："避免 gatewayd 复用可能已失效的旧 instance"。代码注释写的是"避免复用导致的'思考中'卡死问题"。

但排查所有已记录的"思考中卡死" bug 文档，根因均与 instance 复用无关：

| Bug 文档 | 真实根因 |
|---------|---------|
| `2026-06-30-chat-stuck-in-thinking.md` | 后端会话数量上限 + 前端 isRunning 未兜底重置 |
| `2026-07-20-agui-sse-stuck-when-agent-exits.md` | agent 进程 crash + gatewayd 不传播 RUN_ERROR |
| `2026-07-23-chat-stuck-thinking-sse-timeout.md` | opencode 冷启动慢 + SSE 无 keepalive + 多处超时叠加 |
| `2026-06-28-ag-ui-integration-issues.md` | gatewayd `create_instance` Rust Mutex 死锁 |

`force=true` 是对"可能已失效的 instance"的预防性措施，并非针对真实复现的复用卡死 bug。同时项目内已存在 `isInstanceAlreadyExists()` 辅助函数（L329-335），说明早期曾规划过 force=false 复用路径，但后续被废弃未启用。

## 解决方案

采用**方案 A：恢复 force=false 优先 + 失败回退 force=true**，最小改动修复核心问题。

### 改动内容

**文件**：`apps/dh-backend/agent/client/agui_client.go`

1. **新增 `attachWithReuse` 方法**（L338-360）：优先以 `force=false` 复用已有 instance，按错误类型分别处理：
   - `isInstanceAlreadyExists`：gatewayd 某些版本对 force=false 返回"已有 instance"错误，视为复用成功。
   - `isSessionNotFound`：向上传播，由调用方重建 thread 后重试。
   - 其他错误（如 instance 卡死）：回退 `force=true` 强制重建，作为自愈手段。

2. **修改 `Run()` 方法**（L218/230）：将两处 `attachAgentWithKey(..., true, ...)` 调用替换为 `attachWithReuse(...)`。

3. **更新注释和日志**：移除"每个 session 使用独立 instance，避免复用导致的'思考中'卡死问题"的误导性注释，改为描述 reuse-first 策略。

### 效果

- 同一 session 连续对话时复用已有 instance，claude/opencode 子进程不再每次重启。
- stdin 长连接保持，进程内 `session_id` 不丢失。
- 前端 tab.instanceId 与后端真实 instance ID 一致（不再因 force=true 产生新 ID）。
- 复用失败时自动回退 force=true，覆盖 instance 卡死场景，保留原有自愈能力。

### 未解决的问题

- 如果复用的 instance 确实处于卡死状态，回退 force=true 仍会重建进程，新进程仍不知道上一次的 `session_id`（需要方案 B：传 `--resume session_id`）。
- 当前前端 tab.instanceId 仍来自 CreateSession 的返回值，如果 instance 因回退 force=true 被替换，前端展示会与后端不一致（但这是异常路径，正常路径下 instance 不变）。

## 验证结果

- `go vet ./...`（dh-backend）：0 warnings。
- `go build ./...`（dh-backend）：通过。
- `pnpm build`（全部 6 个包）：通过。
- `tsc --noEmit`（dh-frontend）：0 errors。
