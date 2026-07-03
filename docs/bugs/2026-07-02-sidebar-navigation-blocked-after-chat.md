# 切换到智能会话后无法切换其他侧边栏菜单

## 现象

进入智能会话页面后，点击侧边栏其他菜单（如工程代码、数据大盘等）无响应，必须刷新网页才能切换。

## 根因

两个问题叠加导致：

### 1. patch-assistant-ui.ts 高频重渲染

`setAdapter` 补丁在每次调用时都执行 `this.threads._notifySubscribers()`，即使 messages 引用未变化。assistant-ui 内部 `useExternalStoreRuntime` 在每次 render 时都会调用 `setAdapter`，形成：

```
render → setAdapter → _notifySubscribers → 内部状态更新 → render → setAdapter → ...
```

虽非同步无限循环（有 re-entrancy 守卫），但高频异步重渲染仍会阻塞主线程，导致点击事件无法及时响应。

### 2. SSE 连接未在卸载时清理

`useAgUiChat` 缺少 unmount cleanup，Chat 组件卸载后 SSE fetch 仍在运行，持续调用 `setMessages` 更新已卸载组件的状态，进一步阻塞 React 调度。

## 解决方案

### patch-assistant-ui.ts

使用 `WeakMap` 记录每个 runtime 实例上一次的 messages 引用，只在 **messages 引用实际变化时**才调用 `_notifySubscribers()`：

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

同时增加 `this.threads` 空值检查，防止卸载后调用报错。

### useAgUiChat.ts

添加 unmount cleanup effect，中止进行中的 SSE 连接：

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
- 前端 dev server 正常运行
- 进入智能会话后可正常切换到其他侧边栏菜单
