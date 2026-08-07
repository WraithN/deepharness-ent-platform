# 后端重启后旧会话 404 导致聊天页初始化失败

## 现象

后端服务重启后（如执行 `scripts/restart-dev.sh`），浏览器中保留的旧会话 ID（localStorage 中的 `chat-tabs` 和 `session-id`）在请求 `GET /v1/sessions/{sessionId}/messages` 时返回 404 "session not found"。

用户看到：
- 浏览器控制台报 404 错误
- `toast.error('加载会话历史失败')` 弹窗
- 聊天页显示空白，无法发送消息（会话 ID 已失效）
- 每次刷新页面重复触发，因为 localStorage 未被清除

## 根因

1. **后端会话存储在内存中**：`dh-backend` 的 session/message 存储使用内存实现，服务重启后全部丢失。
2. **`loadMessages` 未处理 "session not found"**：`use-ag-ui-chat.ts` 中的 `loadMessages` 函数对 404 "session not found" 错误的处理与普通错误相同——弹出 toast 并清空消息，但未清除 localStorage 中的旧 session ID，导致下次加载重复触发。
3. **Chat.tsx 初始化流程未容错**：`Chat.tsx` 初始化时从 localStorage 读取已保存的 tab 列表，调用 `switchSession(activeId)`。`.catch(() => {})` 静默吞掉错误，`return` 语句阻止了后续的新会话创建逻辑执行，用户卡在空白聊天页。

## 解决方案

### 1. `use-ag-ui-chat.ts` — `loadMessages` 增加 "session not found" 处理

- 导入 `ApiError` 类型，检测 `err.status === 404 && err.message.includes('session not found')`
- 命中时：清除 localStorage 中的旧 session key、清空消息、**重新抛出错误**（让调用方 `switchSession` 的 Promise reject，从而触发后续容错逻辑）
- 不弹出 toast（后端重启导致的会话丢失是预期行为，无需打扰用户）

### 2. `Chat.tsx` — 初始化流程提取 `initNewSession` 并在 tab 恢复失败时回退

- 将 `tryRestoreSession` → `createSession` 的新建会话流程提取为 `initNewSession` 函数
- `switchSession(activeId).catch()` 中：清除 localStorage 中的 `chat-tabs` 和 `active-tab`，调用 `initNewSession()` 创建新会话
- `.finally(finish)` 确保无论成功/失败都结束 `isInitializingChat` 状态

### 验证

- 重启后端后刷新页面：不再弹出 toast 错误，自动创建新会话
- `go build`/`go vet`：0 warnings
- `biome lint`：0 errors
- `tsc --noEmit`：0 new errors（仅预存的 5 个 MarkdownView/MessageMarkers 错误）
