# 多轮对话失忆：agent instance 重建后上下文丢失

## 现象

用户在智能会话中进行多轮对话时，第二轮及之后的消息"忘记"了之前的对话内容。
agent 表现为不知道用户之前问过什么、做过什么，无法基于上下文继续讨论。

## 根因

全链路排查发现，多轮对话上下文 **100% 依赖 gatewayd 进程内存中的 session_id**，
没有兜底机制。具体链路：

### 1. 前端只发当前单条消息

`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts:1323-1338`：`runInput.messages` 数组
硬编码只包含当前这一条用户消息，不携带任何历史。

### 2. dh-backend 透传不补历史

`apps/dh-backend/gateway/handler/agui.go`：`h.aguiClient.Run(input)`
直接转发前端传来的 `input`（含 1 条消息），不读取 DB 历史回填。

### 3. gatewayd 进程内存是唯一上下文载体

`apps/dh-backend/agent/client/agui_client.go`：`POST /sessions/{threadId}/chat`
靠 `threadId` 让 gatewayd 恢复 coding agent 子进程的 session 上下文。

### 4. force=true 回退导致 agent 进程被杀重启

`attachWithReuse` 函数在 `force=false` 失败时，回退到 `force=true`：
- `force=true` **杀掉正在运行的 agent 子进程**并启动新进程
- 新进程不传 `--resume session_id`，因此不知道之前的对话
- 每条消息都触发 attach 调用，如果 `force=false` 因任何原因失败，就会触发 `force=true` 重建

这是多轮对话失忆的**直接原因**：第二条消息触发 `force=true` 重建，
新 agent 进程没有上一轮的 session 上下文。

## 解决方案

三层修复，确保 agent 进程不被误杀、session 上下文不中断：

### 1. 已 attach 的 thread 跳过 attach 调用

`apps/dh-backend/agent/client/agui_client.go`：

- 在 `AGUIClient` 结构体中新增 `attachedThreads sync.Map` 字段，记录已成功 attach 的 threadId
- `Run` 方法中，如果 thread 已在 `attachedThreads` 中，**跳过整个 attach 阶段**，直接进入 chat
- 这避免了后续消息触发不必要的 attach 调用，从源头杜绝 `force=true` 误杀

### 2. force=false 失败时不再回退 force=true

`attachWithReuse` 函数修改：
- `force=false` 返回未知错误时，**不再回退 `force=true`**
- 直接放行到 chat（实例可能仍在运行）
- 如果实例确实不存在，chat 端点会返回明确错误

### 3. chat 失败时自动重试 attach

`Run` 方法中，如果跳过了 attach 但 chat 请求失败：
- 清除 `attachedThreads` 缓存
- 重新执行 `attachWithReuse`（创建新实例）
- 重试 chat 请求
- 这覆盖了 gatewayd 重启后实例丢失的场景

### 数据流（修复后）

```
第一条消息:
  前端 -> dh-backend -> attachWithReuse(force=false) -> 创建 agent 实例
       -> chat -> agent 响应 -> 标记 thread 为已 attach

第二条消息:
  前端 -> dh-backend -> 检查 attachedThreads -> 跳过 attach (实例已在运行)
       -> chat -> agent 响应（保持 session 上下文） ✓

异常场景 (gatewayd 重启):
  前端 -> dh-backend -> 跳过 attach -> chat 失败
       -> 清除缓存 -> 重新 attach -> 重试 chat -> agent 响应 ✓
```

### 涉及文件

- `apps/dh-backend/agent/client/agui_client.go`：
  - `AGUIClient` 结构体新增 `attachedThreads sync.Map`
  - `Run` 方法：已 attach 的 thread 跳过 attach，chat 失败时重试
  - `attachWithReuse` 方法：移除 `force=true` 回退
  - 新增 `doChatRequest` 辅助函数

### 验证

- `go vet ./...`：0 warnings
- 前端 HTTP 200，后端服务正常启动
- 待用户在真实环境中测试多轮对话验证
