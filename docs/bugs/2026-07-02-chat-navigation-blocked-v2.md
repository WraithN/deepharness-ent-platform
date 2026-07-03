# 切换到智能会话后无法切换其他侧边栏菜单（根因：全局 prototype patch）

## 现象

进入智能会话页面后，点击侧边栏其他菜单（工程代码、数据大盘等）无法跳转，必须刷新网页才能恢复。此前尝试用 WeakMap 守卫和卸载清理 effect 修复，均未解决。

## 根因

`patch-assistant-ui.ts` 通过 `ExternalStoreRuntimeCore.prototype.setAdapter` 修改了全局原型，在每次 `setAdapter` 调用时同步执行 `this.threads._notifySubscribers()`。虽然添加了 WeakMap 守卫仅在 messages 引用变化时通知，但全局原型修改本身存在根本问题：

1. **全局影响**：prototype 修改影响所有 `ExternalStoreRuntimeCore` 实例，包括 Chat 组件卸载后可能仍存在的实例
2. **同步通知阻塞主线程**：`_notifySubscribers()` 同步执行，触发订阅者回调，可能引起 React 重渲染，即使使用 `requestAnimationFrame` 在 effect 中调用也可能在密集更新时累积
3. **卸载后残留**：Chat 组件卸载后，prototype patch 仍然存在于全局，后续任何 `setAdapter` 调用（即使来自其他组件）都会触发通知逻辑

## 解决方案

### 移除全局 prototype patch

`patch-assistant-ui.ts` 改为空模块（保留 `export {}` 避免 Chat.tsx 的 import 报错）。

### 改为组件级 useEffect 通知

在 `useAgUiChat.ts` 中，`useExternalStoreRuntime` 返回 runtime 后，添加 `useEffect`：

```ts
const runtimeRef = useRef(runtime);
runtimeRef.current = runtime;
useEffect(() => {
  const raf = requestAnimationFrame(() => {
    const rt = runtimeRef.current as any;
    // runtime.threads 是 ThreadListRuntimeImpl，其 _core 是 ExternalStoreThreadListRuntimeCore
    const threadListCore = rt?.threads?._core;
    if (threadListCore && typeof threadListCore._notifySubscribers === 'function') {
      threadListCore._notifySubscribers();
    }
  });
  return () => cancelAnimationFrame(raf);
}, [messages, isRunning]);
```

关键区别：
- **作用域**：effect 只在 `useAgUiChat` 所在组件的生命周期内生效，卸载后自动清理
- **异步**：`requestAnimationFrame` 将通知推迟到下一帧，不阻塞当前帧的点击事件处理
- **精确路径**：直接访问 `runtime.threads._core._notifySubscribers()`，与原 patch 的 `this.threads._notifySubscribers()` 等价

### 验证结果

- `tsc --noEmit` 通过
- `vite build` 成功
- 前端正常运行
