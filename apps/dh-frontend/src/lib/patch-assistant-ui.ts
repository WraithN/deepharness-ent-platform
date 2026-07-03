// 此文件曾通过 monkey-patch 修改 ExternalStoreRuntimeCore.prototype.setAdapter
// 来强制通知 thread list core 订阅者。但全局 prototype patch 会导致：
// 1. 即使 Chat 组件卸载，patch 仍存在于全局原型上
// 2. setAdapter → _notifySubscribers → 重渲染 → setAdapter 的循环阻塞主线程
// 3. 用户进入智能会话后无法点击侧边栏切换到其他页面
//
// 经分析，assistant-ui 内部 __internal_setAdapter 已自行调用 _notifySubscribers()，
// 无需额外补丁。此文件保留为空模块以兼容 Chat.tsx 中的 import。
export {};
