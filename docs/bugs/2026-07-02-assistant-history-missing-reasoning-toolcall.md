# 会话历史未保存思考过程和工具调用信息

## 现象

包含工具调用的会话，重新打开后只有最终文本输出，缺少：
- 思考过程（reasoning 内容）
- 工具调用信息（工具名、参数、结果）

历史消息 API 返回的 assistant 消息只有纯文本 `content` 字段，`metadata` 为空。

## 根因

后端 `agui.go` 的 `persistAssistantText` 仅将 `assistantBuffers`（TEXT_MESSAGE_CONTENT 累积的纯文本）写入数据库的 `content` 字段，未保存 reasoning 和 tool-call 信息。

具体缺失：
1. `THINKING_TEXT_MESSAGE_CONTENT` 事件未追踪到任何持久化结构
2. `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_RESULT` 事件未追踪到持久化结构
3. `persistAssistantText` 的 `metadata` 参数为空 `map[string]any{}`
4. 前端 `backendMessageToThreadMessageLike` 仅创建单个 text content part，不从 metadata 恢复结构化部件

## 解决方案

### 后端（agui.go）

1. 新增 `contentPart` 结构体，描述 reasoning / tool-call / text 三种部件
2. 新增 `assistantParts map[string][]contentPart`，在事件循环中追踪每个 messageId 的结构化部件：
   - `TEXT_MESSAGE_CONTENT` → 追加/更新 text 部件
   - `THINKING_TEXT_MESSAGE_CONTENT` → 追加/更新 reasoning 部件
   - `THINKING_END` → 标记 reasoning 部件 done=true
   - `TOOL_CALL_START` → 新增 tool-call 部件
   - `TOOL_CALL_ARGS` → 更新 tool-call 的 argsText
   - `TOOL_CALL_RESULT` → 更新 tool-call 的 result
3. `persistAssistantText` 签名增加 `parts` 参数，将 `contentParts` 写入 `metadata`

### 前端（useAgUiChat.ts）

`backendMessageToThreadMessageLike` 增加逻辑：当 assistant 消息的 `metadata.contentParts` 存在时，用它重建 `content` 数组（含 reasoning / tool-call / text 部件），而非仅用纯文本。

### 验证结果

- `go vet` 通过
- `tsc --noEmit` 通过
- `pnpm build` 成功
- 前后端正常运行
