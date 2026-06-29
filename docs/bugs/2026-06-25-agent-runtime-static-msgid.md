# 多轮对话中 AI 消息合并为一个消息块

## 现象

用户在 chat 界面发起多轮对话时，第二轮的 AI 输出会合并到第一轮的 AI 消息块中，而不是产生新的独立消息块。表现为：
- 第一轮：用户发送 "写一个 hello world" → AI 产生一条消息
- 第二轮：用户发送 "改成冒泡排序" → AI 输出追加到第一条消息中，而不是作为第二条消息

## 根因

`apps/agent-runtime/main.go` 中 `handlePrompt` 函数使用 `sessionID` 生成固定的 `msgID` 和 `partID`：

```go
partID := fmt.Sprintf("part-%s", sessionID)
msgID := fmt.Sprintf("msg-%s", sessionID)
```

由于同一 session 的多次请求使用相同的 `sessionID`，导致 `msgID` 也相同。前端 `useChatRuntime.ts:49` 的 `updateAssistantMessage` 函数通过 `messageID` 查找已有 assistant 消息：

```ts
const existingIndex = messages.findIndex(m => m.messageID === messageID && m.role === 'assistant');
```

第二次请求时，`messageID` 仍为 `msg-{sessionID}`，`findIndex` 找到第一条 assistant 消息，将新的 part 合并进去，而不是创建新消息。

## 解决方案

1. **`apps/agent-runtime/main.go`**：添加 `randomHex` 辅助函数，使用 `crypto/rand` 生成唯一 ID：
   - 新增 `randomHex(n int)` 函数（第 19-25 行）
   - 第 177-178 行：将 `msgID` 和 `partID` 改为 `fmt.Sprintf("msg-%s", randomHex(8))` 和 `fmt.Sprintf("part-%s", randomHex(8))`，确保每次请求生成唯一 ID

2. **`apps/web/src/pages/Chat.tsx`**：在 `useChatRuntime` 的 destructuring 中添加缺少的 `isRunning` 变量（第 280 行），并在 `ScrollArea` 中 ChatThread 之后添加"思考中..." 加载指示器（第 1071-1081 行），在 AI 未响应时显示。

### 验证结果

- 第一轮请求：`msgID = msg-3abbf16e861e12f8`
- 第二轮请求：`msgID = msg-7072d570cfc0426a`（不同 ID，确保前端创建新消息）
- `go vet ./...` 通过，`tsgo` 类型检查通过
