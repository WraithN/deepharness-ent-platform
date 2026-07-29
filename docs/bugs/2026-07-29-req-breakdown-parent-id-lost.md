# 需求拆分提交报错"未找到被拆分的父需求"

## 现象

用户在聊天页面执行 `/req-breakdown` 指令并获得 AI 拆分结果后，点击"提交"按钮时弹出错误提示：
`未找到被拆分的父需求，请先引用需求卡片再执行拆分`，导致子需求无法创建。

该问题在以下场景复现：
1. 页面刷新后点击提交（最常见）
2. 从其他页面导航回聊天页后点击提交
3. 发送 `/req-breakdown` 时未引用需求卡片

## 根因

`handleReqBreakdownSubmit` 函数通过两个来源获取父需求 ID：
1. `lastReqBreakdownRootId.current`（`useRef`）—— 在发送 `/req-breakdown` 时缓存
2. `quotedCard`（`useState`）—— 发送后立即被 `setQuotedCard(null)` 清除

问题在于：
- `useRef` 在组件卸载/重新挂载（页面刷新、路由切换）时会重置为初始值 `''`
- `quotedCard` 在发送消息后已被清除
- 消息历史中实际保存了 `quotedCard` 元数据（`message.metadata.custom.quotedCard`），但提交时未从消息历史中回溯查找

因此，当组件 remount 后，两个来源均为空，导致报错。

## 解决方案

在 `handleReqBreakdownSubmit` 中增加第三层兜底：从 `messages` 数组中倒序查找最近一条包含 `/req-breakdown` 指令且 `metadata.custom.quotedCard.type === 'req'` 的用户消息，提取其 `quotedCard.id` 作为父需求 ID。

新增 `findReqBreakdownParentId` 辅助函数（`apps/dh-frontend/src/pages/Chat.tsx`），倒序遍历消息历史，匹配条件后返回父需求 ID。

修改后的 `rootParentId` 解析优先级：
1. `lastReqBreakdownRootId.current`（useRef，组件存活期间有效）
2. `quotedCard?.id`（当前仍引用的需求卡片）
3. `findReqBreakdownParentId(messages)`（从消息历史回溯，兜底）

验证结果：TypeScript 编译通过，开发环境重启正常。
