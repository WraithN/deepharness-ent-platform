# Chat UI ThreadPrimitive.Messages 不渲染缺陷修复

## 现象
Chat 页面发送消息后，WebSocket 正常连接、消息流正常到达、`displayMessages` 状态正确更新（0→1→2），但 `ThreadPrimitive.Messages` 组件始终不显示任何内容，用户看不到消息对话。

## 根因
`ExternalStoreRuntimeCore.setAdapter()` 调用链中存在**订阅通知遗漏**，导致 assistant-ui 内部 Zustand store 无法感知到消息更新：

1. **调用链**：`setAdapter(store)` → `this.threads.__internal_setAdapter(getThreadListAdapter(adapter))` → `this.threads.getMainThreadRuntimeCore().__internal_setAdapter(adapter)`
2. **Thread core 处理消息**：`ExternalStoreThreadRuntimeCore.__internal_setAdapter()` 正确处理新消息并调用 `this._notifySubscribers()` —— 但通知的是 **ThreadRuntimeCore 自身的订阅者**
3. **订阅错位**：`ThreadRuntimeImpl` 通过 `NestedSubscriptionSubject` 订阅的是 **thread list core**（见 `thread-list-runtime.js:56-60`），而非 thread core 本身
4. **Thread list core 提前返回**：由于 adapter 为 `{}`（无 `threadList`），`ExternalStoreThreadListRuntimeCore.__internal_setAdapter()` 在第 62 行因 `threadId/threads/archivedThreads` 未变化而 early return，**从未调用 `_notifySubscribers()`**
5. **结果**：thread list 订阅者（即桥接到 Zustand store 的逻辑）从未收到通知 → `useAuiState` 中的 `s.thread.messages.length` 始终为 0 → `ThreadPrimitive.Messages` 不渲染

## 解决方案
### 修复措施
在 `apps/web/src/lib/patch-assistant-ui.ts` 中通过 monkey-patch 修复 `ExternalStoreRuntimeCore.prototype.setAdapter`：

1. 在原始 `setAdapter` 执行完毕后，显式调用 `this.threads._notifySubscribers()`，确保 thread list 订阅者感知到 thread core 状态变化
2. 在 `apps/web/src/pages/Chat.tsx` 顶部导入 patch 模块，确保在所有 runtime hooks 之前执行
3. 将 `@assistant-ui/core` 添加为 web 应用的直接依赖（原为 `@assistant-ui/react` 的 transitive dependency），使 `@assistant-ui/core/internal` 可被 import

### 验证结果
- `pnpm --filter @repo/web build` 编译成功
- `pnpm --filter @repo/web check-types` 类型检查通过
- 前端 dev server（`:8888`）和后端（`:8080`）均正常启动
- 无新增 warnings/errors
