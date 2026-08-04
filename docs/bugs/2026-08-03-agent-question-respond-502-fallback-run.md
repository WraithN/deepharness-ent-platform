# agent.question 回复 502 错误 — 回退 Run 方案

## 现象
用户在对话框中输入 `/brainstorm` 后，agent 发送 `agent.question` 卡片询问用户填写补充信息。约 1 分钟后用户点击回答按钮，后端返回 502，提示 "respond to agent status 500: Interaction cancelled"。前端仅显示错误 toast，对话无法继续。

## 根因
opencode 插件发出 `agent.question` 后立即取消 interaction 并发出 `agent.done`（→ `RUN_FINISHED`），gatewayd relay-loop 退出，实例死亡。用户点击回答时 gatewayd 实例已不可用，`aguiClient.Respond()` 调用失败。

## 解决方案
### 后端（dh-backend）
1. **新增 `agui_respond.go`**：`RespondToAgent` 中 `aguiClient.Respond()` 失败时调用 `fallbackRunForRespond` 回退
2. **回退流程**：
   - 从 session store 获取 workspaceID，解析 workspace 路径
   - 获取会话历史消息（最近 100 条），构造新的 RunAgentInput
   - 保存用户回答到 message store
   - 调用 `aguiClient.ForgetThread()` 清除线程缓存
   - 通过 `aguiClient.Run()` 重新启动 agent run
   - 将所有事件缓冲到 SSE buffer（原始 threadID），追加 RUN_FINISHED
   - 持久化 assistant 消息供 `restoreSessionMessages` 检索
3. 响应中返回 `{ status: "ok", runId, threadId, fallback: true }`

### 前端（dh-frontend）
1. 修正 `respondToQuestion` 响应类型为 `RespondResponse`（移除无效的 `code` 字段检查）
2. 收到 `fallback: true` 响应后：保存 activeRun 状态 + 启动 SSE 重放轮询
3. catch 分支统一调用 `cancelRun()` 清理运行状态

### 关键设计决策
- 所有事件缓冲到**原始 threadID**（非 actualThreadID），确保前端轮询旧 threadID 可匹配
- 回退 goroutine 使用 `context.Background()` 独立于 HTTP 请求生命周期
- 先 `ForgetThread` 清除缓存，确保 `Run()` 走完整 `attachWithReuse` → `CreateThread` 重建流程
