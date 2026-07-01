# Bug: 同一轮 assistant 回复出现多个 AI 头像

## 现象

一次用户提问后，前端会渲染出多个带有 AI 头像的 assistant 消息气泡：
- 一个气泡包含思考过程（thinking 文本 + 工具调用）
- 另一个气泡包含正式回复文本

用户期望一轮会话只出现一个 AI 头像。

## 根因

`apps/web/src/hooks/useAgUiChat.ts` 中每次收到 `TEXT_MESSAGE_START` 都会创建一条新的 assistant 消息。而 Claude Code 在一次 run 中会多次输出文本片段（thinking 文本、中间整理语、正式回复等），gatewayd 的 `AguiMapper` 会为每个文本片段发出 `TEXT_MESSAGE_START/CONTENT/END`，导致前端生成多个 assistant 消息。

同时 `TEXT_MESSAGE_END` 会把消息状态改为 `complete`，后续文本又触发新的 `TEXT_MESSAGE_START`，进一步拆分了同一轮回复。

## 解决方案

在 `useAgUiChat.ts` 中：
1. 单次 run 内只创建一条 assistant 消息：`TEXT_MESSAGE_START` 仅在 `assistantMessageId` 为空时才创建消息。
2. `TEXT_MESSAGE_CONTENT` 和 `THINKING_TEXT_MESSAGE_CONTENT` 都追加到同一条 assistant 消息。
3. 忽略中途的 `TEXT_MESSAGE_END`，统一在 `RUN_FINISHED` 时把消息标记为完成。
4. 增加对 `THINKING_TEXT_MESSAGE_CONTENT` 的处理，把 thinking 文本也合并到同一消息，由 `AssistantMessage` 自动把 tool-call 之前的 text 归为思考过程。

## 验证

- `pnpm check-types` ✅
- `pnpm lint` ✅
- `pnpm build` ✅
- 等待用户刷新后重新测试，确认同一轮回复只有一个 AI 头像
