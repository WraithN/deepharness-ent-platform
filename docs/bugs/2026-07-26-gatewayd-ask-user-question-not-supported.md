# 2026-07-26-gatewayd-ask-user-question-not-supported.md

## 现象

尝试通过 gatewayd 的 AG-UI 接口让 opencode 调用 `question` / `ask_user_question` 工具进行用户确认，结果无法完成交互：

- 直接向 `/sessions/{id}/chat` 发送消息并要求 agent 使用 `question` 工具时，gatewayd 会正确转发 `TOOL_CALL_START` + `TOOL_CALL_ARGS` 事件。
- 但随后同一 run 会报错 `RUN_ERROR`，无法挂起等待用户响应；无法捕获到 `TOOL_CALL_END`，更无法测试「发送 tool result 继续 run」的流程。
- 同一 session 无法并发启动第二个 run：gatewayd `session.rs` 的 `begin_run` 会返回 `RunAlreadyActive` 错误。

影响范围：
- 技术文档确认、代码编写前确认等需要「agent 主动提问 → 用户回答 → agent 继续」的交互流程。

## 根因

1. **gatewayd 没有暴露 `respond` 入口**：
   - `opencode-plugin` 内部支持 `agent.question`/`agent.permission` 等交互的 `respond` 方法（`crates/opencode-plugin/src/instance.rs:459`），底层使用 opencode 的 `/session/{id}/message` 回复。
   - `agent-core` 也提供了 `AgentService::respond_to_instance`（`crates/agent-core/src/service.rs:219`）。
   - 但 `apps/gatewayd/src/handlers/` 下只有 `/sessions`、`/sessions/{id}/agents`、`/sessions/{id}/chat`、`/sessions/{id}/events` WebSocket，没有 `/respond` 或类似 Admin 端点。

2. **gatewayd 的 WebSocket `/events` 与 `/chat` 等价**：
   - `handlers/websocket.rs` 收到 `RunAgentInput` 后同样调用 `session_manager.start_run`，因此它只能启动新 run，不能向已挂起的 run 回写 tool result；且同一 session 同一时间只能有一个 run 在途（`session.rs:103`）。

3. **opencode 的 `question` 工具不是普通 AG-UI 工具**：
   - 它被 opencode 内部识别为 `agent.question` 交互，执行时会期待调用方 `respond`；在无人响应的情况下会失败，导致 `RUN_ERROR`。
   - 自定义工具虽然能通过 `tools` 数组注册，但当前 `opencode-plugin` 只把工具事件透传给客户端，客户端无法把 tool result 回写给 opencode（没有对应端点），因此不能用来做「暂停等用户确认」的交互。

## 解决方案

在 dh-backend/dh-frontend 应用层实现确认流程，不依赖 gatewayd 的交互式工具：

1. 修改 `/code` 指令模板：在生成技术文档后，让 agent 输出一段固定格式的「确认请求」文本（如 `[[CONFIRM_TECH_DOC:...]]`）。
2. 前端 `useAgUiChat` 或聊天组件识别该标记，暂停渲染并弹出「确认技术文档」弹窗；用户可选择「确认 / 取消」。
3. 若确认，前端发送新的用户消息（如「我已确认，请继续编写代码」），后端继续走 `/code` 的下一步。
4. 若取消，终止当前流程并给出提示。
5. 若需要项目选择/生成，在确认弹窗中要求用户指定工程；未指定则让 agent 新建工程。

替代方案（需要修改 ent-desktop）：
- 在 gatewayd 的 Admin HTTP 或 WebSocket 上增加 `respond` 端点，把 `agent-core` 的 `respond_to_instance` 暴露出来；但当前在 ent-platform 仓库内无法直接完成，需要同时改动并重启 gatewayd。

## 验证

- 使用 `curl` 直接调用 `POST /sessions/{id}/chat` 复现了 `RUN_ERROR`。
- 阅读 `apps/gatewayd/src/handlers/websocket.rs`、`apps/gatewayd/src/session.rs`、`crates/opencode-plugin/src/instance.rs` 和 `crates/agent-core/src/service.rs` 确认 `respond` 未暴露。

## 服务状态

- `bash scripts/restart-dev.sh` 后 gatewayd（2345/2346）、dh-backend（8080）均运行正常。
- 测试 session id: `b3d798c3-870f-430e-ae2e-49517e48bc60`。

## 补充测试（2026-07-27）

在 gatewayd 上新增 `POST /sessions/{session_id}/agents/{agent_id}/respond` 端点，
并在 opencode-plugin 中实现 `respond_by_conversation`（通过 conversation_id 反查内部 opencode session_id 后发送响应）。

测试结果：
- 端点可正常注册，对不存在的 session/agent 返回 404，说明路由和鉴权无问题。
- 当 agent 在 run 中调用 `question` 工具时，从 SSE 能立即看到 `TOOL_CALL_START question`。
- 但向同一 session 发送 `respond` 时，请求会挂起 6 秒左右，然后连接被关闭（Empty reply from server）。
- 同时原 SSE 流也中断，说明 opencode 的 `/session/{id}/message` 不能并发处理两条消息：第一条消息（触发 question 工具）还在等待响应时，第二条消息（respond）会阻塞或中断第一条。

根本原因：
- opencode 的 `question` 工具是**执行型工具**（agent 调用后等待工具结果），不是"立即返回交互对象并结束 run"的模型。
- gatewayd/opencode-plugin 只有在 `POST /message` 返回后才会从 `parts` 中检测 interaction，而 question 工具会让 `POST /message` 阻塞在工具执行阶段。
- 要让 gatewayd 方案真正可用，需要改动 opencode-plugin：在 SSE 中检测到 `question` tool_use 时立即结束当前 run 并发出 `agent.question` 事件，而不是等 `POST /message` 返回。这是较大的改动，且会影响现有对话流。

结论：
- 纯 gatewayd 端点改动不足以让 `ask_user_question` 可用；还需深入修改 opencode-plugin 的 run 生命周期与交互检测时机。
- 建议改用应用层方案：让 agent 在 `/code` 模板里生成技术文档后输出固定确认标记，前端识别标记弹窗确认，确认后再发下一条消息继续。该方案不依赖 gatewayd 的交互式工具，实施风险更低。
