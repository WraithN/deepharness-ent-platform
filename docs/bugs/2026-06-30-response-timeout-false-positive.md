# Bug: 复杂任务运行中误报"模型响应超时"

## 现象

当 Claude 调用 Write 等工具后整理长报告时，前端在约 60 秒后自动插入一条"模型响应超时，未收到任何输出"的提示，但实际 run 仍在进行（dh-backend 日志显示后续仍有事件到达）。

## 根因

`apps/web/src/hooks/useAgUiChat.ts` 中设置了 60 秒无 SSE 事件即触发 abort 并显示超时提示。工具调用后模型可能需要较长时间整理结果、生成文件，60 秒阈值过短，导致误触发。

## 解决方案

将 `NO_EVENT_TIMEOUT_MS` 从 60 秒调整为 180 秒，为工具调用后的长文本生成和报告整理留出足够时间。同时修复了超时相关变量作用域导致的 TypeScript 编译错误（`noEventTimer` / `noEventTimeoutFired` 必须定义在 `try` 外才能在 `catch/finally` 中访问）。

## 验证

- `pnpm check-types` ✅
- `pnpm lint` ✅
- `pnpm build` ✅
