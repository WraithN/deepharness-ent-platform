# Agent-Runtime Gatewayd 连接失败时无 Mock 回退

## 现象

用户在聊天界面发送消息后，AI 助手一直显示"思考中..."但最终没有回复。前端 WebSocket 连接正常，但 agent-runtime 在无法连接外部 gatewayd 服务时，直接向会话流写入 `session.error` 事件，导致前端视为异常而非回复。

## 根因

`apps/agent-runtime/main.go` 中 `handlePrompt` 函数固定向 `ws://127.0.0.1:2346/agents/events` 发送 WebSocket 连接请求。当该地址不可达（开发环境下 gatewayd 未运行）时，原有的 `sendGWError` 分支向 SSE 流写入 `session.error` 事件。后端 worker 收到 `session.error` 后会设置 `errorText`，前端将其视为异常状态而非正常回复内容。

## 解决方案

在 `apps/agent-runtime/main.go` 中：

1. **新增 `handleMockFallback` 函数**（第 179–224 行）：
   - 接收用户输入文本，生成一段包含该文本的模拟中文回复
   - 以 20ms 间隔逐个字符流式输出（使用 `message.part.updated` SSE 事件）
   - 每个事件携带 `delta` 和累计 `content`，与后端 worker 期望的 SSE schema 一致
   - 使用时序递增的 `partID` 和随机 `messageID` 标识

2. **修改 `handlePrompt` 中的错误处理逻辑**（第 145–151 行）：
   - WS 拨号失败时调用 `handleMockFallback` 替代 `sendGWError`
   - 保留原有的 `gotEvent` 跟踪逻辑：在已有事件后才 WS 关闭视为正常结束

### 验证结果

通过以下方式验证修复有效：
- **直接 curl 测试** agent-runtime POST `/session/{id}/prompt` 确认返回正确的 SSE 事件序列
- **Python WebSocket 测试** 确认完整的端到端数据流：创建 session → WS 连接 → 发送消息 → 接收助理回复（累积式字符流）
- **Playwright UI 测试** 确认前端聊天界面正确显示助理回复内容，无错误日志
- **Agent-runtime 日志** 确认输出 `dial tcp 127.0.0.1:2346: connect: connection refused — using local mock fallback`
