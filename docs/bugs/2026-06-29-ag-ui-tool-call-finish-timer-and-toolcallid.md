# 2026-06-29 AG-UI tool call 期间提前结束及 tool 消息缺失 toolCallId

## 现象

1. 前端通过 AG-UI 协议调用 `dh gwd` 的 Claude Code 时，Agent 正在执行工具调用（tool calls）就收到 `RUN_FINISHED`，前端报错：
   > Cannot send 'RUN_FINISHED' while tool calls are still active
2. 多轮对话后出现 gatewayd 422 错误：
   > Failed to deserialize the JSON body into the target type: messages[N]: missing field `toolCallId`

## 根因

### 1. finish timer 5 秒太短

`apps/dh-backend/gateway/handler/agui.go` 中为了在 gatewayd 不主动发送 `RUN_FINISHED` 时避免连接挂起，设置了 5 秒兜底 timer：

```go
const finishWait = 5 * time.Second
```

仅在收到 `TEXT_MESSAGE_END` 时重置 timer。Claude Code 在回答后进入 tool call 时，可能 5 秒内没有新的文本消息事件，后端就主动发送 `RUN_FINISHED`，但 gatewayd/Claude 的 tool calls 仍在执行，导致前端状态机报错。

### 2. tool role 消息缺少 toolCallId

`apps/dh-backend/agent/agui/types.go` 的 `Message.ToGatewaydMessage()` 把 `role: tool` 的消息序列化为：

```go
{"role": "tool", "id": ..., "content": ..., "name": ...}
```

没有包含 `toolCallId`。gatewayd 的 AG-UI 消息反序列化要求 tool 消息必须包含 `toolCallId`，因此多轮对话（包含 tool result）时报 422。

## 解决方案

### 修复 finish timer

- 将 `finishWait` 从 5 秒调整为 30 秒，给 tool call 留出足够时间。
- 跟踪当前活跃的 tool call 数量（使用计数器，而非 `toolCallId` 集合；因为 gatewayd 在某些情况下 `TOOL_CALL_START` 与 `TOOL_CALL_RESULT` 的 `toolCallId` 不一致）。
  - 收到 `TOOL_CALL_START` 时计数器 +1 并停止 idle timer。
  - 收到 `TOOL_CALL_END` / `TOOL_CALL_RESULT` 时计数器 -1，归零后重新启动 idle timer。
- 这样保证 **只要有 tool call 在运行，就不会因为 idle 超时而提前发送 `RUN_FINISHED`**。
- 新增 `maxRunDuration = 10 分钟` 作为兜底，避免单个 run 无限挂起。
- 对 `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT` 增加日志，方便后续排查。

文件：`apps/dh-backend/gateway/handler/agui.go`

### 3. gatewayd 未发送 TOOL_CALL_END，且 toolCallId 不一致

在修复 finish timer 后，前端在部分场景下仍然报错：

> Cannot send 'RUN_FINISHED' while tool calls are still active

通过阅读 `@ag-ui/client@0.0.57` 的 `verifyEvents` 实现发现：

- 校验器只把 `TOOL_CALL_END` 视为 tool call 的结束事件；
- `TOOL_CALL_RESULT` 并不会清除内部的 active tool call 集合；
- 如果事件流中只有 `TOOL_CALL_START` + `TOOL_CALL_RESULT`，校验器在收到 `RUN_FINISHED` 时仍认为有未完成的 tool call，从而抛出上述错误。

同时观察到 gatewayd/Claude Code 下发的事件中，`TOOL_CALL_START` 与后续 `TOOL_CALL_ARGS` / `TOOL_CALL_RESULT` / `TOOL_CALL_END` 的 `toolCallId` 可能不一致，导致即使补发了 `TOOL_CALL_END`，校验器也会因为 ID 不匹配而无法清除 active 集合。

## 解决方案（补充）

### 补发 TOOL_CALL_END 并统一 toolCallId

在 `apps/dh-backend/gateway/handler/agui.go` 的事件转发层增加一个 FIFO 队列 `pendingToolCallIDs`：

1. 收到 `TOOL_CALL_START` 时把 `toolCallId` 入队，并增加活跃计数。
2. 收到 `TOOL_CALL_ARGS` 时，如果 ID 与最近一个 pending ID 不一致，则重写成 pending ID 后再转发，避免 `verifyEvents` 找不到 active tool call。
3. 收到 `TOOL_CALL_RESULT` 时：
   - 取出最早 pending 的 ID；
   - 如果 RESULT 的 ID 与 pending ID 不一致，则重写为 pending ID；
   - 先发送一条 `TOOL_CALL_END`（带 pending ID），再转发 `TOOL_CALL_RESULT`；
   - 减少活跃计数。
4. 收到 `TOOL_CALL_END` 时：
   - 如果队列非空，取出最早 pending ID，统一 ID 后转发；
   - 如果队列为空（说明已经被 RESULT 处理过），则忽略该孤儿 END，避免重复减计数。

这样 `@ag-ui/client` 的校验器会看到完整且 ID 一致的 `START -> (ARGS) -> END -> RESULT` 序列，`RUN_FINISHED` 不会再因 active tool call 而失败。

文件：`apps/dh-backend/gateway/handler/agui.go`

### 处理 Claude API 错误被静默吞掉

Claude Code CLI 当前配置的模型是 `deepseek-chat`，当账户余额不足时会返回：

> API Error: 402 Insufficient Balance

这个错误信息位于 `type: assistant` 事件的 `message.content[0].text` 中，并在顶层带有 `error` 字段。`deepharness-ent-desktop/crates/claude-plugin/src/parser.rs` 原本只从 `type: error` 事件提取错误，并且会忽略 `assistant` 事件里的文本内容（因为 stream-json 模式下普通文本由 `text_delta` 流承载）。结果前端收不到任何事件，表现为“一直在思考中，没有回复”。

修复 parser：
- 解析 `assistant` 事件时，如果顶层存在 `error` 字段，优先按错误处理；
- 错误信息优先从 `message.content` 中的文本提取，确保 `"API Error: 402 Insufficient Balance"` 能透传出来。

同时修复 `apps/dh-backend/gateway/handler/agui.go`：
- 转发 `RUN_ERROR` 后立即结束响应，不再继续 idle timer 并在 30 秒后补发 `RUN_FINISHED`，避免 `@ag-ui/client` 状态机二次报错。

相关文件：
- `deepharness-ent-desktop/crates/claude-plugin/src/parser.rs`
- `apps/dh-backend/gateway/handler/agui.go`

### 修复工具名称/参数解析

前端能渲染 `tool-call` 部件后，发现工具卡片显示为 **unknown**、参数为 **{}**：

- gatewayd 的 `AguiMapper::map_tool_use` 从 `agent.thinking` 事件的 `toolName` 字段取工具名，但 claude-plugin 发出的 `toolName` 经常为 `"unknown"`；
- 真正的工具名和参数被拼在 `content` 字段里，格式为 `"WebSearch {\"query\":\"...\"}"`；
- gatewayd 直接把整个字符串作为 `TOOL_CALL_ARGS.delta` 下发，`@ag-ui/client` 无法将其解析为 JSON，导致 `args` 为空对象。

修复 `deepharness-ent-desktop/apps/gatewayd/src/agui/mapper.rs`：
- 新增 `parse_tool_call_delta`，从 `content` 字符串中提取工具名（`{` 前面的前缀）和 JSON 参数；
- 当顶层 `toolName` 缺失或为 `"unknown"` 时，用解析出的前缀作为 `toolCallName`；
- 将纯 JSON 参数作为 `TOOL_CALL_ARGS.delta` 下发，前端即可正确展示工具名和参数。

相关文件：
- `deepharness-ent-desktop/apps/gatewayd/src/agui/mapper.rs`

### 修复 tool role 消息序列化

在 `Message.ToGatewaydMessage()` 中，当 `Role == RoleTool` 且 `ToolCallID != ""` 时，添加 `toolCallId` 字段。

文件：`apps/dh-backend/agent/agui/types.go`

### 支持 agent plugin 选择

- `RunAgentInput` 新增 `AgentPluginKey` 字段。
- `AGUIClient.Run()` 优先从 `AgentPluginKey` 读取，其次从 `forwardedProps.agentPluginKey` 读取，最后回退默认值 `claude-code`。
- 前端 `useAgUiChat` 接受 `agentPluginKey` 参数，通过 `runConfig.custom.agentPluginKey` 传给后端。
- 前端 `Chat` 页面新增 `Select` 组件，支持选择 Claude / OpenCode / Codex，默认 Claude。

相关文件：
- `apps/dh-backend/agent/agui/types.go`
- `apps/dh-backend/agent/client/agui_client.go`
- `apps/dh-backend/gateway/handler/agui.go`
- `apps/web/src/hooks/useAgUiChat.ts`
- `apps/web/src/pages/Chat.tsx`

### / 指令透传

当前实现中用户输入直接作为普通文本消息发送，`/xx` 会原样透传给 Claude Code，由 Claude Code 自行处理，前端不做拦截。

### 4. 前端未渲染 tool-call 部件

后端事件序列修复后，流已能正常结束，但前端聊天界面仍然看不到工具调用过程（例如 Web Search），只有最终的文本回复。

`@assistant-ui/react-ag-ui` 的 runtime 会把 `TOOL_CALL_*` 事件聚合成 `tool-call` 类型的消息部件（`ToolCallMessagePart`），但 `apps/web/src/components/chat/AssistantMessage.tsx` 里只处理了：

- `text`
- `reasoning`
- `data`（旧版自定义 tool_use / tool_result）

对于 `part.type === 'tool-call'` 直接 `return null`，所以工具调用虽然存在于消息状态里，但没有任何可见 UI。

## 解决方案（补充）

### 新增 ToolCallView 组件并接入 AssistantMessage

1. 在 `apps/web/src/components/chat/ToolCallView.tsx` 新增工具调用卡片组件：
   - 显示工具名称、执行状态（执行中/已完成/失败）；
   - 提取并展示参数预览（优先取第一个字符串参数，如搜索 query）；
   - 使用与现有设计一致的圆角、边框、 muted 背景。
2. 在 `AssistantMessage.tsx` 的 `content.map` 中增加 `tool-call` 分支，调用 `<ToolCallView part={...} />`。
3. `hasVisibleContent` 判断已包含 `tool-call`，因此运行期间会正确展示内容，不会只显示“思考中”占位。

相关文件：
- `apps/web/src/components/chat/ToolCallView.tsx`
- `apps/web/src/components/chat/AssistantMessage.tsx`

## 验证结果

- `go build` 与 `go vet ./...` 通过，无 warning。
- `pnpm exec tsc --noEmit -p tsconfig.check.json` 通过，无类型错误。
- curl 测试：
  - `agentPluginKey=opencode` 可正常返回流式文本。
  - `agentPluginKey=claude-code` 可正常返回流式文本与 thinking 事件。
- 后端事件流在 `TOOL_CALL_RESULT` 前成功补发 `TOOL_CALL_END`，且 `toolCallId` 经统一后与 `TOOL_CALL_START` 一致。
- 不再出现 "Cannot send 'RUN_FINISHED' while tool calls are still active" 报错。
- 多轮对话不再出现 `missing field toolCallId` 422 错误。
- 前端新增 `ToolCallView`，可正确渲染 `tool-call` 部件（工具名称、状态、参数预览）。
- curl 复现：复杂 prompt 现在会在约 1 秒内返回 `RUN_ERROR: API Error: 402 Insufficient Balance`，不再挂起。
- curl 复现：工具调用事件现在 `toolCallName` 正确显示为 `WebSearch`，`delta` 为合法 JSON 参数，前端可展示工具名和 query。
