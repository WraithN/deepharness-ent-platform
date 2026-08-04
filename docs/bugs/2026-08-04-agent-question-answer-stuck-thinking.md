# 2026-08-04 agent.question 回答后前端一直“思考中”

## 现象

在智能会话中，当 agent 通过 `agent.question` 工具向用户提问并给出 A/B/C 选项后，用户点击任意选项回答。前端会立即显示“用户回答：...”，但随后一直显示“思考中 ...”，长时间没有后续输出。

相关日志：

- `gatewayd.log` 显示 `agent.question` 事件后紧接着 `agent.done`，gatewayd 认为当前 run 已结束。
- `dh-backend.log` 显示 `POST /api/v1/agent/respond` 耗时约 2 分钟，最终返回 `500: Process error: agent stalled: no SSE events for 120s`。
- 后端进入 fallback 启动新 run 后，`gatewayd` 的 `agent_service.send_message accepted after 299.910s`，新 run 被排队约 5 分钟才继续。

## 根因

1. **gatewayd / opencode 插件行为**：`agent.question` 工具发出后，gatewayd 立即发送 `agent.done` 结束本次响应，但前端和后端都按“run 仍在继续”处理，等待用户回答并通过 `Respond` 接口继续同一个 run。
2. **`Respond` 无法恢复已结束的 run**：当用户回答后，后端调用 `POST /sessions/{id}/agents/{instance}/respond`，但原 agent 实例已经 stall 或 run 已结束，导致 `respond` 在 120 秒无 SSE 事件后失败，后端再进入 fallback 流程。
3. **fallback 复用原 thread 导致排队**：fallback 启动新 run 时仍然使用原 `threadId`，gatewayd 的旧 agent 实例仍在占用该 session，`send_message` 被排队约 300 秒（5 分钟），因此前端一直“思考中”。
4. **消息 ID 超长导致用户回答保存失败**：`agui.generateID()` 原实现使用 `time.Now().UnixNano()` + 随机数拼接，长度超过 36 字符，写入 `agent_messages.id VARCHAR(36)` 时报 `value too long for type character varying(36)`，用户回答、system reminder 等关键消息无法持久化，后续 fallback 读取不到完整上下文。
6. **fallback run 丢失原始上下文与 agent key**：`fallbackRunForRespond` 仅传递 `Messages` 和 `Workspace`，丢失了原始 run 的 `Context`（任务卡片、代码库等）、`AgentKey` 以及 session 上下文中的 `pluginKey`。导致 fallback run 中 agent 看到的上下文不完整，可能无法继续按原指令使用 `agent.question` 提问。
7. **AGUIClient SSE 读取不结束导致 runFallback 泄漏**：gatewayd 在 `RUN_FINISHED` 后长时间不关闭 SSE 流，`AGUIClient.readSSE` 没有主动结束读取，导致事件通道不关闭，`runFallback`  goroutine 阻塞在 `for ev := range events` 中，无法持久化 assistant 消息，也无法记录 `fallback run finished`。
8. **Postgres 重复键检测与驱动不匹配**：`session/postgres.go` 使用 `pq.Error` 检测 `SQLSTATE 23505`，但实际驱动是 `pgx`，`errors.As` 匹配失败，导致 `fallback` 中 `Create` 重复 session 的报错未被识别为 `ErrAlreadyExists`。 

## 解决方案

### 后端：`apps/dh-backend/gateway/handler/agui_respond.go`

- 在 `RespondToAgent` 中保留 10 秒超时（此前已引入），失败即进入 fallback。
- 在 `fallbackRunForRespond` 中**创建新 thread** 来启动 fallback run，而不是复用原 thread：
  - 调用 `aguiClient.CreateThread(ctx, "")` 创建新 session。
  - 将旧 session 的历史消息迁移到新 session（`MigrateMessages`）。
  - 复制旧 session 标题和上下文（`pluginKey` 等）。
  - 从旧消息 metadata 中恢复 `quotedCard` / `selectedRepos` 等上下文项，并注入到 fallback run 的 `RunAgentInput.Context` 中。
  - 从旧 session 上下文中读取原始 `pluginKey`，设置到 `RunAgentInput.AgentKey`，保证 fallback run 使用与原始 run 相同的 agent 插件。
  - 将用户回答消息保存到新 session。
  - 使用新 threadId 启动 `Run`。
  - 返回 `ThreadID` 给前端。
- 增强用户回答前缀和 system reminder：明确告知 agent 这是“对上一个问题的回答”，不是新指令；必须继续按原格式提问；绝对禁止提前生成文档或工具调用。
- 修复 `h.sessions.Create` 与 `MigrateMessages` 创建占位 session 的主键冲突：调用 `Create` 时允许 `common.ErrAlreadyExists`，避免 `duplicate key value violates unique constraint` 中断 fallback。

这样绕过仍在占用旧 session 的 agent 实例，避免新 run 被排队 5 分钟。

### 消息 ID：`apps/dh-backend/agent/agui/types.go`

- `generateID()` 改为使用 `uuid.New().String()`（36 字符），不再使用 `time.Now().UnixNano()` 拼接超长字符串，解决 `agent_messages.id VARCHAR(36)` 写入时报 `value too long for type character varying(36)` 的问题，确保用户回答、system reminder 等消息能正确持久化。

### AGUIClient SSE 读取：`apps/dh-backend/agent/client/agui_client.go`

- `readSSE` 在发送 `RUN_FINISHED` 或 `RUN_ERROR` 事件后主动 `break` 循环并关闭 response body，避免 gatewayd 长期不关闭 SSE 流导致下游 goroutine 泄漏和 `runFallback` 无法收尾。
- 扫描器出错时若已收到终局事件，不再重复发送 `RUN_ERROR`。

### PostgreSQL 错误识别：`apps/dh-backend/agent/chat/session/postgres.go`

- 新增 `isDuplicateKeyError` 同时按 `pq.Error.Code == "23505"` 和错误文本 `SQLSTATE 23505` / `unique constraint` 兜底，兼容 `pgx` 驱动，使 `fallback` 能正确识别 `ErrAlreadyExists`。

### 前端：`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`

- `respondToQuestion` 收到 `fallback: true` 且后端返回 `threadId` 时，前端将当前 `sessionId` 切换到新 thread，并基于新 sessionId 启动 SSE 断连重放轮询。

## 验证

- `go vet ./gateway/handler/... ./agent/client/...` ✅
- `pnpm exec tsc --noEmit -p tsconfig.check.json` ✅
- `bash scripts/restart-dev.sh` 成功重启所有服务。
- `curl http://localhost:8080/health`、`http://localhost:8888`、`http://localhost:2346/health` 均正常。

## 待人工确认

由于当前环境无浏览器，无法直接触发 `agent.question` 流程。请在前端重新发起一次会触发 `agent.question` 的任务，点击选项回答后观察：

- 是否仍长时间“思考中”
- 浏览器 Network 面板 `/api/v1/agent/respond` 是否快速返回（10 秒内）
- 返回后是否继续输出新的 agent 内容

## 第二轮修复：agent 不发出 `agent.question` 且展示英文推理过程

### 新增现象

点击答案后 fallback run 继续，但 agent 并没有再调用 `agent.question` 工具，而是把下一问题以普通 assistant 文本输出，同时附带了英文推理过程。前端因此：

- 不渲染内联问题卡片，只展示普通文本消息；
- 文本里混有英文思考内容，不符合“只展示问题 + 选项”的要求；
- 有时回答后前端仍持续“思考中”，新问题的文本和事件都没有正确持久化。

### 根因

1. **opencode/gatewayd 插件未稳定调用 `agent.question` 工具**：在 fallback run 中，agent 虽然收到了“继续提问”的 system reminder，但仍常以普通文本形式输出问题和选项，而不是发出 `agent.question` 自定义事件。前端只识别 `agent.question` 事件来渲染内联问题卡片，因此看不到卡片。
2. **英文推理过程被当成普通文本展示**：gatewayd 把模型的思考链（THINKING_* 事件）和最终文本都推送到了前端，fallback 原样缓冲，导致英文思考内容出现在对话里。
3. **文本消息未清洗**：即使前端用 `parseInlineOptions` 解析， fallback 里保存的 assistant 消息仍包含完整推理文本，没有裁剪为“问题 + 选项”。

### 解决方案

#### 后端：`apps/dh-backend/gateway/handler/agui_respond.go` + `agui_respond_question_parser.go`

- 在 `fallbackRunForRespond` 中：
  - 将用户回答从 `answerPrefix + req.Message` 拆分为干净的用户回答 + 独立的 system reminder，避免把强制提示语混在 user 消息里。
  - 为每次 fallback run 生成独立的 `fallbackInstanceID`，回传给前端，并写入 synthetic `agent.question` 事件的 `instanceId` 字段，保证下一轮回答能定位到当前 fallback run。
- 在 `runFallback` 中：
  - 收集事件时**过滤 THINKING_* 事件**，不再把英文推理过程缓冲给前端。
  - 收集普通文本消息后，用 `parseQuestionFromText` 解析是否包含“问题 + A/B/C 选项”结构；若解析成功且原事件流里没有 `agent.question` 自定义事件，则：
    - 把 assistant 文本裁剪为只含“问题 + 选项”的干净文本；
    - 补发一个合成的 `agent.question` CUSTOM 事件，让前端渲染内联问题卡片；
    - 只持久化清洗后的 assistant 消息。
  - 若解析失败（agent 没有按格式提问），则回退为原样输出，避免信息丢失。
- 新增 `agui_respond_question_parser.go`：
  - 支持 A./A、/A)/A）、bullet、数字选项；
  - 支持选项在同一行或分行；
  - 通过“最后一个问号所在段落”提取问题正文，过滤掉前面的英文推理段落。

#### 前端：`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`

- `RespondResponse` 接口增加 `instanceId?: string`，与后端返回对齐，方便后续调试和追踪。

### 验证

- `go build ./apps/dh-backend/...` ✅
- `go vet ./apps/dh-backend/...` ✅
- `pnpm --filter @repo/dh-frontend check-types` ✅
- `bash scripts/restart-dev.sh` 成功，服务端口 8888/8080/8090/2345 均正常监听。
- `curl http://127.0.0.1:8080/health` 与 `curl http://127.0.0.1:8888` 均返回 200。

### 待人工确认

请在前端 `/brainstorm` 或任何会触发 `agent.question` 的任务中再次测试：

1. 点击答案后是否快速关闭问题卡片并展示下一个问题卡片；
2. 问题卡片是否只展示“问题 + 选项”，不再出现英文推理文本；
3. 连续回答多个问题后，对话是否保持上下文连贯，不再“思考中”卡住。

如仍有问题，请提供 `/tmp/dh-backend.log` 和 `/tmp/gatewayd.log` 中对应时段的日志。

## 第三轮修复：第二个问题把整段分析文本展示成问题

### 新增现象

用户回答后，agent 在 fallback run 中并没有继续按格式提问，而是开始探索代码库（输出大量英文分析、文件内容、组件名如 `FunnelChart`、`ChevronDown` 等）。后端的兜底解析器从这段分析文本中误匹配了 A/B 标记，把 “The user wants me to understand the current funnel...” 当成问题正文，合成 `agent.question` 事件后前端问题卡片展示了整段分析内容。

### 根因

1. **解析器策略有误**：旧实现从文本开头寻找第一个 A/B 选项标记，在包含大量分析/代码的文本中会误匹配代码里的 A/B 字母，导致问题正文被提取为整段分析。
2. **缺乏合法性校验**：即使提取出明显是英文分析或代码的内容，也没有过滤规则，仍然合成 `agent.question` 事件。
3. **system reminder 不够强制**：agent 把用户回答当作新需求，开始调用工具、探索代码库，没有严格遵守“只继续提问”的约束。

### 解决方案

#### 后端：`apps/dh-backend/gateway/handler/agui_respond_question_parser.go`

- 重写解析策略：先定位**最后一个问号**，然后只在问号之后寻找 A/B/C 选项，避免在开头代码/分析内容中误匹配。
- 提取问题正文时只取问号所在段落及最多前 2 行短上下文，并过滤空行、超长行和代码样文本。
- 增加 `isValidQuestion` 校验：
  - 问题长度不超过 400 字符；
  - 拒绝以英文分析开头（如 `The user wants`, `Let me`, `I need to` 等）；
  - 拒绝包含代码标记（` ``` `, `FunnelChart`, `ChevronDown`, `import `, `function `, `->`, `=>` 等）；
  - 至少包含一个 CJK 字符或半角问号，确保是真正的中文澄清问题。
- 支持更多选项标记：`:`, `：`, `.`, `、`, `)`, `）`。

#### 后端：`apps/dh-backend/gateway/handler/agui_respond.go`

- 将 fallback 中的 system reminder 升级为 `developer` 角色（更高优先级），并明确列出：
  - 用户回答 ONLY 用于澄清需求，不是新任务/开发指令；
  - 绝对禁止调用任何工具、探索代码库、生成文档/代码/架构分析；
  - 禁止输出英文思考/分析；
  - 必须输出下一个问题 + 2-3 个选项 + 立即调用 `question` 工具。

### 验证

- `go build ./apps/dh-backend/...` ✅
- `go vet ./apps/dh-backend/...` ✅
- `pnpm --filter @repo/dh-frontend check-types` ✅
- `bash scripts/restart-dev.sh` 成功，服务端口 8888/8080/8090/2345 均正常监听。
- `curl http://127.0.0.1:8080/health` 与 `curl http://127.0.0.1:8888` 均返回 200。

### 待人工确认

请在前端 `/brainstorm` 中再次测试多轮问答：

1. 回答后 agent 是否继续提出下一个中文问题，而不是开始探索代码或输出英文分析；
2. 问题卡片是否只展示简短的问题 + A/B/C 选项，不再把整段分析文本塞进去；
3. 如果 agent 仍跑偏，请提供 `/tmp/dh-backend.log` 对应 fallback run 的日志片段（可搜索 `parseQuestionFromText` 或 `emitted synthetic agent.question`）。
