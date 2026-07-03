# 切换到智能会话后无法切换其他侧边栏菜单

## 现象

进入智能会话页面后，点击侧边栏其他菜单（如工程代码、数据大盘等）无法跳转，必须刷新网页才能恢复。

## 根因

两处问题共同导致：

1. **patch-assistant-ui.ts 过度通知**：`setAdapter` 补丁在每次调用时都执行 `this.threads._notifySubscribers()`，即使 messages 引用未变。assistant-ui 内部状态更新触发 Chat 组件重渲染，重渲染又可能触发 `setAdapter`，形成高频重渲染循环（虽非无限循环，但频率足以阻塞主线程使导航点击无法响应）。

2. **useAgUiChat 缺少卸载清理**：组件卸载（导航离开 Chat）时未中止进行中的 SSE fetch 连接。SSE 事件持续到达后调用 `setMessages` 更新已卸载组件的状态，产生错误并阻塞 React 的事件处理。

## 解决方案

### 1. patch-assistant-ui.ts：仅在 messages 引用变化时通知

使用 `WeakMap` 记录每个 runtime 实例上一次的 messages 引用，只在引用实际变化时才调用 `_notifySubscribers()`：

```ts
const prevMessagesMap = new WeakMap<object, unknown>();

ExternalStoreRuntimeCore.prototype.setAdapter = function (this: any, adapter: any) {
  const prevMessages = prevMessagesMap.get(this);
  const messagesChanged = adapter.messages !== prevMessages;
  prevMessagesMap.set(this, adapter.messages);

  originalSetAdapter.call(this, adapter);
  if (!messagesChanged) return;
  if (this.threads && typeof this.threads._notifySubscribers === 'function') {
    this.threads._notifySubscribers();
  }
};
```

同时增加 `this.threads` 的空值检查，防止卸载后访问报错。

### 2. useAgUiChat.ts：添加卸载清理 effect

```ts
useEffect(() => {
  return () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeRunSessionIdRef.current = null;
  };
}, []);
```

### 验证结果

- `tsc --noEmit` 通过
- `pnpm build` 成功
- 前端正常运行
