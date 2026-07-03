# patch-assistant-ui 无限循环导致控制台刷屏与侧边栏导航失效

## 现象

1. 进入智能会话页面后，浏览器控制台持续刷出 `[Patch] setAdapter called` 和 `[Patch] calling threads._notifySubscribers()` 日志，形成无限循环。
2. 由于主线程被无限循环阻塞，点击侧边栏菜单（租户管理员工作区）无法进行页面切换。

## 根因

`apps/web/src/lib/patch-assistant-ui.ts` 为修复 assistant-ui 消息不渲染的问题，在 `ExternalStoreRuntimeCore.prototype.setAdapter` 中额外调用了 `this.threads._notifySubscribers()`。

但 `_notifySubscribers()` 会触发订阅者重渲染，而 `useAgUiChat` 中的 `adapter` 通过 `useMemo` 依赖 `messages` / `isRunning` 等状态。重渲染后 `useExternalStoreRuntime` 会再次调用 `setAdapter`，patch 又调用 `_notifySubscribers()`，形成无限循环：

```
setAdapter → _notifySubscribers → 重渲染 → adapter 引用变化 → setAdapter → ...
```

此外，patch 中还有 3 处 `console.log` 调试日志，在每次循环中都输出，导致控制台被刷屏。

## 解决方案

在 `apps/web/src/lib/patch-assistant-ui.ts` 中添加 re-entrancy 守卫，并用 `try/finally` 保证标志位复位：

```ts
let isInsideSetAdapter = false;

ExternalStoreRuntimeCore.prototype.setAdapter = function (this: any, adapter: any) {
  originalSetAdapter.call(this, adapter);
  if (isInsideSetAdapter) return;  // 防止重入
  isInsideSetAdapter = true;
  try {
    this.threads._notifySubscribers();
  } finally {
    isInsideSetAdapter = false;
  }
};
```

同时移除了全部 `console.log` 调试日志。

### 验证结果

- `tsc --noEmit` 类型检查通过
- `vite build` 构建成功
- 前端 dev server 正常启动（HTTP 200）
- 控制台不再刷屏日志，侧边栏菜单可正常切换
