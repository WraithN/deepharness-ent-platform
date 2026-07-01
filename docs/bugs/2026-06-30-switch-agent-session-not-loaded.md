# 2026-06-30 切换智能体 tab 时未加载对应会话历史

## 现象

打开多个智能体 tab（如 Claude Code 与 OpenCode）并分别发送消息后，点击 Claude Code tab 切回时，聊天区域没有显示该智能体下的历史消息，而是回到了空会话的欢迎界面。标题栏显示已切换到 Claude Code，但内容仍为空。

## 根因

1. `useAgUiChat` 中只有一个全局 `HttpAgent` 与 `runtime`。切换会话时虽然调用了 `runtime.thread.reset(initialMessages)`，但旧 session 的 SSE 流仍在继续推送事件。
2. 旧 SSE 流会在切换后推送一条空消息列表的 `setAdapter` 更新，覆盖掉刚加载的历史消息，导致 UI 被清空。
3. `ExternalStoreThreadRuntimeCore.reset()` 加载历史后没有主动通知 thread state 订阅者，进一步导致 `ThreadPrimitive.Messages` 不会立即渲染加载出来的消息。

## 解决方案

1. **每个 session 独立 HttpAgent / runtime**：在 `useAgUiChat` 中让 `HttpAgent` 与 `useAgUiRuntime` 依赖 `sessionId`。切换会话时 `sessionId` 变化，旧的 SSE agent 被丢弃，新的 agent 只接收当前 session 的事件，避免旧流污染。
2. **同步 threadId**：新增 `useEffect`，在 `sessionId` / `agent` 变化时自动把当前 `HttpAgent.threadId` 设为当前 `sessionId`。
3. **移除切换时的 `cancelRun()`**：由于 agent 已整体替换，旧 run 随旧 agent 一起丢弃，不再需要在 `createSession` / `switchSession` 中手动 `cancelRun()`，避免触发额外的空状态覆盖。
4. **补丁通知 `reset()` 订阅者**：在 `apps/web/src/lib/patch-assistant-ui.ts` 中为 `ExternalStoreThreadRuntimeCore.reset` 增加 `_notifySubscribers()`，确保加载历史后 `ThreadPrimitive.Messages` 立即重绘。

## 验证结果

- `pnpm --filter @repo/web check-types` ✅
- `pnpm --filter @repo/web lint` ✅
- `pnpm --filter @repo/dh-backend lint`（含 `go vet`）✅
- `pnpm build` ✅
- Puppeteer 自动化验证：Claude Code 发送消息后切换到 OpenCode，再切回 Claude Code，历史消息正确渲染。
- 截图验证：`apps/web/test-chat-header.png`
