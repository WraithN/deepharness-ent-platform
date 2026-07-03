# Chat 页面无限重渲染导致侧边栏导航阻塞

## 现象

1. 进入智能会话页面并发送/加载一轮对话（messages ≥ 1 条 assistant 消息）后，浏览器控制台持续刷出 `[useAgUiChat] render N msgs= 3 running= false` 日志，render 计数不断增长（>2000）。
2. 由于主线程被无限重渲染循环占满，点击侧边栏菜单无法切换页面，导航完全阻塞。
3. 全新进入 Chat 页面（messages 为空）时不会出现该问题，render 计数停在 2。

## 根因

`apps/web/src/pages/Chat.tsx` 中同步智能体 tab 状态的 `useEffect`（原 825-848 行）存在无限循环：

```ts
useEffect(() => {
  if (!activeAgentTabId) return;
  const activeTab = agentTabs.find(t => t.sessionId === activeAgentTabId);
  if (!activeTab) return;

  const lastAssistant = getLastAssistantTimestamp(messages);
  if (lastAssistant) {
    updateAgentTab(activeAgentTabId, { lastAssistantAt: lastAssistant });  // ← 无条件调用
  }
  ...
}, [isRunning, messages, activeAgentTabId, agentTabs, updateAgentTab]);
```

`updateAgentTab` 内部通过 `setAgentTabs(prev => prev.map(...))` 产生**新的数组引用**，即使字段值完全相同。而该 effect 的依赖数组中包含 `agentTabs`，于是：

```
effect 执行 → updateAgentTab → setAgentTabs 产生新引用
→ agentTabs 依赖变化 → effect 再次执行 → getLastAssistantTimestamp 返回相同值
→ updateAgentTab 再次调用 → 新引用 → 无限循环
```

为何只有 messages ≥ 1（含 assistant 消息）才触发：`getLastAssistantTimestamp` 在没有 assistant 消息时返回 `undefined`，`if (lastAssistant)` 守卫会跳过 `updateAgentTab` 调用，因此空会话不会循环。

对比同一 effect 中的状态更新部分已有 `if (nextStatus !== activeTab.status)` 守卫，不会循环；唯独 `lastAssistantAt` 的更新缺少相等性判断。

## 解决方案

在调用 `updateAgentTab` 更新 `lastAssistantAt` 前增加相等性判断，仅当时间戳真正变化时才触发 setState，避免产生新数组引用：

```ts
const lastAssistant = getLastAssistantTimestamp(messages);
// 仅当时间戳真正变化时才更新，避免 updateAgentTab 产生新数组引用
// 触发本 effect 依赖（agentTabs）变化，导致无限重渲染循环。
if (lastAssistant && lastAssistant !== activeTab.lastAssistantAt) {
  updateAgentTab(activeAgentTabId, { lastAssistantAt: lastAssistant });
}
```

同时移除了排查阶段临时加入的调试日志：
- `useAgUiChat.ts` 中每次 render 输出的 `[useAgUiChat] render N` 日志
- `Chat.tsx` 中 `[Chat] mounted` / `[Chat] MOUNT` 挂载日志
- `layout.tsx` 中 `[Layout][NavLink] click` 点击日志

### 验证结果

- `tsc --noEmit` 类型检查通过
- `vite build` 构建成功
- 进入 Chat 页面并加载历史会话（msgs=3）后，render 计数稳定不再增长
- 侧边栏菜单可正常切换，导航阻塞问题解除
