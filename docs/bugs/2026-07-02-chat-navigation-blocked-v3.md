# 切换到智能会话后无法切换其他侧边栏菜单（根因：全局 prototype patch 未移除）

## 现象

进入智能会话页面后，点击侧边栏其他菜单（工程代码、数据大盘等）无法跳转，必须刷新网页才能恢复。此前多次尝试修复（WeakMap 守卫、requestAnimationFrame 批处理、卸载清理 effect）均未解决。

## 根因

`patch-assistant-ui.ts` 通过 `ExternalStoreRuntimeCore.prototype.setAdapter` 修改了全局原型。**此前尝试将其改为空模块，但文件写入后被恢复为带 prototype patch 的版本**（可能因 vite HMR 或其他原因），导致 patch 始终存在。

Prototype patch 的根本问题：
1. **全局永久修改**：`ExternalStoreRuntimeCore.prototype.setAdapter` 被永久替换，即使 Chat 组件卸载，patch 仍存在于全局原型
2. **阻塞主线程**：`setAdapter` → `_notifySubscribers()` → 重渲染 → `setAdapter` 的循环在每次 messages 变化时触发，高频同步执行阻塞了 React 事件处理
3. **不必要**：经分析 assistant-ui 源码，`ExternalStoreThreadRuntimeCore.__internal_setAdapter` 内部已自行调用 `this._notifySubscribers()`，外部补丁是多余的

## 解决方案

将 `patch-assistant-ui.ts` 彻底清空为 `export {}`，移除所有 prototype patch 代码。Chat.tsx 中的 `import '@/lib/patch-assistant-ui'` 保留（import 空模块无副作用）。

同时移除了 `useAgUiChat.ts` 中基于 `requestAnimationFrame` 的 `_notifySubscribers` 补偿调用——assistant-ui 内部已自行通知，无需外部干预。

### 验证结果

- `tsc --noEmit` 通过
- `vite build` 成功
- 前端正常运行
