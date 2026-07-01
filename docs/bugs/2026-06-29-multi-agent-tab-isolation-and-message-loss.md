# 2026-06-29 多智能体 tab 会话隔离与用户消息消失修复

## 现象

1. **多智能体 tab 会话未隔离**：聊天页的智能体 tab 早期以 `pluginKey` 作为唯一标识，导致同一智能体插件（如 Claude Code）只能打开一个 tab；即使打开了多个 tab，它们共享同一个 `pluginKey`，会话历史和消息状态会互相覆盖，后端也只会复用同一个 gatewayd thread。

2. **用户输入后消息消失**：在 `useAgUiChat` 中发送用户消息后，界面上经常看不到用户消息，或者一闪而过就被旧状态覆盖；console 中偶发 `status is only supported for assistant messages` 的报错。

## 根因

### 1. tab 标识错误

`AgentTab` 之前使用 `pluginKey` 作为 key 和 active id。`pluginKey` 代表 agent 插件类型，而不是一次会话。同一插件的所有实例都命中同一份状态，造成：

- `activeAgentTabId === pluginKey`，切换 tab 时无法区分不同实例。
- `createSession` 和 `switchSession` 只按 `pluginKey` 传递，后端复用同一 thread。
- 历史会话下拉没有按实例过滤，导致不同实例共享历史记录。

### 2. 消息状态被覆盖

`@assistant-ui/react-ag-ui` 的 `HttpAgent` 和 `useAgUiRuntime` 在 SSE 流更新时会重新初始化 thread 状态。由于 `ExternalStoreRuntimeCore` 在 `setAdapter` 和 `reset` 后不会主动通知 `threads` 的订阅者，`ThreadPrimitive.Messages` 不能及时重新渲染；同时运行时内部会把用户刚 append 的消息覆盖成旧消息。

另外，`thread.append` 给用户消息设置了 `status: 'in_progress'`，而 @assistant-ui 的 status 字段仅支持 assistant messages，触发报错。

## 解决方案

1. **tab 唯一标识改为 `sessionId`**：
   - `AgentTab` 增加 `sessionId`、`instanceId` 字段，`sessionId` 作为 tab key 和 active id。
   - 创建会话时后端返回 `sessionId`（gatewayd thread id）和 `instanceId`（挂载 agent 后的实例 id），写入 `session.Context`。
   - 切换 tab 时调用 `switchSession(tab.sessionId)`，从后端 `/v1/sessions/:id/messages` 加载该会话独立历史。
   - 历史会话下拉按 `pluginKey + instanceId` 过滤，避免跨实例共享。

2. **修复消息覆盖**：
   - 在 `apps/web/src/lib/patch-assistant-ui.ts` 中覆盖 `ExternalStoreRuntimeCore.setAdapter` 和 `ExternalStoreThreadRuntimeCore.reset`，在 adapter 更新/reset 后手动调用 `_notifySubscribers()`，触发消息列表重新渲染。
   - 在 `useAgUiChat` 中订阅 `runtime.thread` 状态变化，并通过 `setMessages` 主动同步给外部 store runtime，避免运行时被旧状态覆盖。
   - 发送消息时不再给用户消息设置 `status`。

3. **排队发送条件修正**：
   - 只有 `isRunning && lastMessage?.role === 'user'` 时才把后续输入加入队列，避免空队列误判。

## 验证结果

- 前端 `pnpm --filter @repo/web check-types` 通过，无类型错误。
- 前端 `pnpm --filter @repo/web lint` 通过（ast-grep 未安装告警不影响）。
- 后端 `pnpm --filter @repo/dh-backend lint`（go vet）通过。
- `pnpm build` 构建全部成功。
- 使用 Puppeteer 打开两个 Claude Code tab，分别发送不同内容，切换到第一个 tab 后消息仍然独立存在；后端 `/api/v1/sessions` 返回两条独立 session 记录，确认后端隔离生效。截图保存于 `apps/web/test-iso2.png`。
