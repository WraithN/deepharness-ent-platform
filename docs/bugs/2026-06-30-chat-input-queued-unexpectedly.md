# 2026-06-30 Chat 没有待回复消息时输入仍被排队

## 现象

在智能会话页面，当 AI 已经回复完成（最后一条消息为 assistant）后，用户再次发送消息时，输入被错误地加入“排队输入”队列，而不是立即发送。状态栏仍显示智能体“进行中”，排队 badge 出现 1 条待发送输入。

## 根因

`handleSend` 仅依据 `isRunning` 判断是否排队。由于后端 SSE / assistant-ui runtime 在某些情况下 `isRunning` 状态没有在下一条 AI 输出结束后及时复位，导致后续输入被误判为“AI 正在回复中”而进入排队队列。

## 解决方案

在 `apps/web/src/pages/Chat.tsx` 中，把排队条件从单纯的 `isRunning` 改为：

```ts
const isAwaitingAssistant = isRunning && lastMessage?.role === 'user';
```

- 只有在“最后一条消息是用户消息”且 `isRunning` 为 true 时，才认为 AI 正在处理上一条输入，需要排队。
- 当 AI 已经回复（最后一条为 assistant）时，即使 `isRunning` 未复位，也直接发送。

同时，自动发送排队输入的 effect 也同步改为使用相同的 `isAwaitingAssistant` 判断，避免排队消息因 `isRunning` 残留而卡死。

## 验证结果

- `pnpm --filter @repo/web check-types` ✅
- `pnpm --filter @repo/web lint` ✅
- `pnpm build` ✅
- Chromium 截图验证页面正常加载，无编译错误。
