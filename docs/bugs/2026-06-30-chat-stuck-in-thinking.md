# 2026-06-30 聊天页一直显示“思考中”

## 现象

前端聊天页发送消息后，助手区域长时间显示“思考中…”，无模型响应返回。浏览器控制台可见 PATCH 请求中 `isRunning=true`，且偶发 `POST /api/v1/sessions 409 (Conflict)`（max active sessions reached）。

## 根因

1. **后端会话数量上限**：`apps/dh-backend/gateway/handler/session.go` 中 `MaxActiveSessions = 5`，本地反复测试后后端会话累积到上限，导致新会话创建失败，前端无法开始新的 agent run。
2. **前端运行状态未兜底重置**：`useAgUiChat.ts` 的 SSE 事件循环仅在收到 `RUN_FINISHED` / `RUN_ERROR` 或用户手动取消时才重置 `isRunning`。当 SSE 连接异常关闭、或后端 90s finish timer 未正常下发结束事件时，`isRunning` 保持为 `true`，前端持续显示“思考中”。
3. **缺少运行中切换确认**：用户在建新/切换会话时没有二次确认，若当前会话正在输出内容，旧 run 的事件可能污染新会话状态。

## 解决方案

1. **移除后端会话上限**：删除 `MaxActiveSessions` 常量及 `CreateSession` 中的数量检查，允许创建任意数量的会话。
2. **移除前端 tab 上限**：删除 `MAX_AGENT_TABS = 5` 及所有相关判断，不再限制同时打开的智能体 tab 数量。
3. **运行中切换/新建会话二次确认**：
   - 在 `Chat.tsx` 中新增 `runIfIdleOrConfirm` 包装函数。
   - 切换 tab、新建会话、新增智能体 tab、关闭 tab、打开历史会话时，若 `isRunning === true`，弹出 `AlertDialog` 提示“当前会话正在输出内容，切换会话会取消当前会话。是否继续？”。
   - 点击确认后先调用 `cancelRun()`，再执行目标操作。
4. **SSE 流结束兜底**：在 `useAgUiChat.ts` 的 `while` 循环结束后，若当前 run 仍未收到结束事件，强制重置 `isRunning`，并将未完成的 assistant 消息标记为 `incomplete`（或插入超时提示消息）。
5. **长时间无事件超时**：新增 60s 无事件超时定时器，若运行过程中超过 60s 未收到任何 SSE 事件，自动 abort 并提示“模型响应超时，未收到任何输出”。

## 验证结果

- `go build ./...` / `go vet ./...`：通过。
- `pnpm --filter @repo/web check-types`：通过。
- `pnpm --filter @repo/web lint`：通过。
- `pnpm build`：通过。
- 连续创建 7 个会话不再返回 409。
- 服务已启动：gatewayd (`:2346`)、dh-backend (`:8080`)、web dev (`:8888`)。
