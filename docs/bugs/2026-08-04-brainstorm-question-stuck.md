# /brainstorm 问题交互两轮后卡住、重复发送用户回答

**日期**：2026-08-04
**影响范围**：智能会话 `/brainstorm` 指令、前端内联问题卡片、gatewayd 问题交互

## 现象

在智能会话中使用 `/brainstorm` 指令时，agent 会按配置逐个提问澄清需求。实际表现如下：

1. 第一轮问题能正常展示，用户选择/输入回答后，agent 也继续输出。
2. 第二轮问题展示内容错乱，且与前一轮问题重复。
3. 用户回答后，界面一直显示“思考中”，不再继续下一轮提问，也不会生成最终的需求设计文档草案。
4. 控制台日志显示 `respondToQuestion` 进入 `fallback` 路径，创建了新 thread 并启动断连重放；随后第二轮问题/答案被重复发送，gatewayd 出现 `already has an active run` 或 `Interaction cancelled` 等错误。

## 根因

`/brainstorm` 原本使用 agent 的 `agent.question` 工具实现多轮澄清：

- agent 输出问题后调用 `agent.question` 工具，gatewayd 向前端发送 `agent.question` 自定义事件。
- 用户回答时，前端调用 `/v1/agent/respond` 让 gatewayd 继续被中断的 run。

gatewayd 对 `respond` 的支持不稳定：

- `respond` 端点在旧 run 未完全结束、或已有 interaction 状态时会报错，导致前端无法继续同一线程。
- 后端 `RespondToAgent` / `RespondAndListen` / `fallbackRunForRespond` 在回答第二个问题时会与前一个 run 的 interaction 状态冲突，最终触发 fallback 创建新 thread。
- 新 thread 的上下文迁移不完整，用户重复看到同样的问题，且回答丢失，于是陷入“一直思考中”。

## 解决方案

不再依赖 gatewayd 的 `respond` / `agent.question` 工具路径，改为应用层文本标记协议：

1. **提示词约定**：`/brainstorm` 模板要求 agent 在每次提问时直接输出确认句 + 问题 + 选项，并在末尾用 `[[QUESTION:问题|A. 选项一|B. 选项二|C. 选项三]]` 标记结束本轮。
2. **前端解析**：`useAgUiChat` 在 `RUN_FINISHED` 时检测 assistant 文本末尾的 `[[QUESTION:...]]` 标记，解析出问题正文与选项，渲染为内联问题卡片。
3. **普通消息回答**：用户点击选项或输入自定义回答后，前端将“问题：XXX\n用户回答：YYY”作为普通 `user` 消息通过 `handleSend` 发送，触发新一轮 agent run，完全绕过 gatewayd 的 `respond` 接口。
4. **防重复点击**：新增 `isRespondingToQuestionRef` 锁，避免用户快速重复点击选项导致重复发送回答。
5. **展示清洗**：`RUN_FINISHED` 时直接修改 assistant 消息源，移除 `[[QUESTION:...]]` 标记；`AssistantMessage` 渲染时再做一遍过滤兜底，避免问题内容重复出现在助手消息中。

## 改动文件

- `apps/dh-backend/config/commands.yaml`： `/brainstorm` 模板已使用 `[[QUESTION:...]]` 标记。
- `apps/dh-backend/gateway/handler/command_config_defaults.go`：内嵌 fallback 模板与 `commands.yaml` 保持一致。
- `apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`：
  - 新增 `parseQuestionMarker()`。
  - `RUN_FINISHED` 检测 marker 并设置 `isMarkerQuestion=true` 的 `pendingQuestion`。
  - 为 marker 问题走 `handleSendRef` 发送普通消息；传统 `agent.question` 工具保留兼容，但统一在 user 消息中包含“问题 + 回答”。
  - 新增 `isRespondingToQuestionRef` 锁、`handleSendRef` 自引用。
- `apps/dh-frontend/src/pages/Chat.tsx`：选项按钮与自定义输入调用 `respondToQuestion` 时不再额外添加“用户回答：”前缀，由 hook 统一格式化。
- `apps/dh-frontend/src/components/chat/AssistantMessage.tsx`：渲染时过滤 `[[QUESTION:...]]` 标记作为兜底。`use-ag-ui-chat.ts` 已先从消息源移除，因此实际通常不会再命中此处。

## 验证

- 执行 `pnpm build`、`pnpm check-types`、`pnpm lint` 均通过。
- 执行 `bash scripts/restart-dev.sh` 重启全部服务，后端 `/api/v1/commands` 返回的 `/brainstorm` 模板包含 `[[QUESTION:...]]` 标记。
- 前端服务正常响应（`http://localhost:8888/` 返回 200）。

> 由于当前环境未配置 LLM API Key，完整的端到端多轮问答流程需要你在实际配置好模型后，在浏览器中打开 `/brainstorm` 并引用需求卡片进行测试。测试时请关注：
> 1. 第一个问题出现后选择答案，应继续出现第二个不同的问题。
> 2. 第二个问题回答后，应继续出现第三个问题，而不是卡住或重复。
> 3. 最终澄清完成后应生成需求设计文档草案并输出 `[[FILE:...]]` 标记。
