# 历史消息丢失思考过程和工具调用 + 同一轮回复分多块

## 现象

1. 加载历史会话消息时，AI 回复中不展示思考过程（ThinkingCard）和工具调用（ToolCallView）
2. 同一轮 AI 回复被拆分成多条独立的消息块显示

## 根因

后端 `agui.go` 的消息持久化逻辑存在两个缺陷：

### 缺陷 1：思考/工具调用丢失

后端追踪 reasoning 和 tool-call 部件时，全部依赖 `activeTextMessageID != ""` 条件判断。但 Agent 的实际事件流为：

```
THINKING_START          ← activeTextMessageID == "" → 思考内容丢失
THINKING_TEXT_CONTENT   ← activeTextMessageID == "" → 思考内容丢失
THINKING_END            ← activeTextMessageID == "" → 思考内容丢失
TEXT_MESSAGE_START      ← 设置 activeTextMessageID
TEXT_MESSAGE_CONTENT    ← 追踪成功
TEXT_MESSAGE_END        ← 清空 activeTextMessageID
TOOL_CALL_START         ← activeTextMessageID == "" → 工具调用丢失
TOOL_CALL_RESULT        ← activeTextMessageID == "" → 工具结果丢失
TEXT_MESSAGE_START      ← 设置 activeTextMessageID
TEXT_MESSAGE_CONTENT    ← 追踪成功
TEXT_MESSAGE_END        ← 清空 activeTextMessageID
RUN_FINISHED
```

思考发生在文本消息之前，工具调用发生在两条文本消息之间，此时 `activeTextMessageID` 为空，所有 reasoning 和 tool-call 部件丢失。

### 缺陷 2：消息分多块

每次 `TEXT_MESSAGE_END` 事件都调用 `persistAssistantText` 将该段文本作为独立的数据库记录保存。而前端流式传输时，一次 run 的所有内容（reasoning + text + tool-call）合并为一条消息。因此加载历史时同一轮回复被拆成多条。

## 解决方案

### 核心重构：Run 级累加器

将 per-messageID 的 `assistantBuffers` / `assistantParts` 替换为 run 级累加器：

- `runParts []contentPart` — 按实际到达顺序累积所有部件（reasoning / text / tool-call）
- `runTextBuilder strings.Builder` — 累积所有文本内容
- `runMessageID string` — 第一条 TEXT_MESSAGE_START 的 ID，作为 DB 记录 ID

**关键改动**：
1. 移除所有 `activeTextMessageID != ""` 条件 — reasoning/tool-call 无条件追踪
2. `TEXT_MESSAGE_END` 不再触发持久化 — 只清空 `activeTextMessageID`（SSE 事件转发仍需要）
3. `RUN_FINISHED` / `RUN_ERROR` / 超时 / 断连时统一调用 `persistRunAssistant()` 合并为一条消息入库

### 崩溃恢复：Buffer Checkpoint

扩展 `SSEBuffer` 接口，新增 `SaveRunState` / `LoadRunState` / `ClearRunState` / `LoadPendingRunStates` 方法：
- 每次部件更新时调用 `checkpointRun()` 将 `runParts` 序列化存入 buffer
- `RUN_FINISHED` 持久化后清除 checkpoint
- 用户加载历史时 `recoverPendingRuns()` 检查 buffer 中的未持久化 checkpoint，落库为 assistant 消息

### Redis Buffer（生产环境）

实现 Redis 版 `SSEBuffer`，支持单节点和 Cluster 模式：
- SSE 事件：Redis List（`{prefix}:sse:{sessionID}`）
- Run checkpoint：Redis Hash（`{prefix}:runstates:{sessionID}`）
- 24h TTL 防止无限增长
- `PopPending` 使用 Lua 脚本保证原子性

## 验证结果

- `go build ./...` — 通过
- `go vet ./...` — 通过
- `pnpm build` — 通过
- `pnpm --filter @repo/dh-frontend lint` — 通过
- 前端 `backendMessageToThreadMessageLike` 无需改动，已正确处理 `metadata.contentParts`

## 影响范围

| 文件 | 改动 |
|------|------|
| `buffer/buffer.go` | SSEBuffer 接口新增 4 个 run state 方法 |
| `buffer/memory/buffer.go` | MemoryBuffer 实现 run state 存储 |
| `buffer/redis/buffer.go` | 新增 Redis 实现（Cluster + 单节点） |
| `agui.go` | Run 级累加器替换 per-messageID 追踪 |
| `session.go` | 新增 `recoverPendingRuns` 崩溃恢复 |
| `server.go` | 根据 `buffer_store_type` 选择 memory/redis |
| `config/config.go` | 新增 Redis 配置项 |
| `config.yaml` | 添加 Redis 配置示例 |
