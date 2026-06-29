# Agent Runtime WebSocket Write Bridge 缺陷修复

## 现象
agent-runtime 启动后无法正常转发用户的 Prompt 请求到外部 Agent（opencode），前端发送消息后无任何响应返回。具体表现为：
1. 发送到 agent-runtime 的 `POST /session/{id}/prompt` 请求始终无 SSE 事件返回
2. dh-backend 的 AgentWorker 无法收到 agent 的流式回复，导致前端表现为"发送消息后无响应"
3. 所有服务（dh-backend、dh-gatewayd、opencode agent）均正常运行，但消息链路中断

## 根因
原有 agent-runtime 实现存在**根本性的架构错误**：

1. **错误的通信方式**：原有的 `handlePrompt` 函数在接收到用户的 Prompt 请求后，通过 WebSocket 向 `ws://127.0.0.1:2346/agents/events` 发送初始化消息和用户消息。但该 WebSocket 端点（dh-gatewayd 的 `events_handler`）**仅用于广播 Agent 事件给订阅者（read-only），不接受入站消息**。所有写入该 WebSocket 的数据均被静默丢弃，没有任何错误提示。

2. **错误的 API 调用**：正确的通信方式应该使用 dh-gatewayd 的 Admin API：
   - 发送消息：`POST /agents/{agent_id}/message`
   - 接收回复：订阅 `ws://127.0.0.1:2346/agents/events?instance_id={agent_id}` 的事件广播
   
3. **事件流错误映射**：原有代码期望通过 WebSocket 直接获得 SSE 格式的回复，但实际上 dh-gatewayd 通过 Admin API 处理消息后，回复通过事件系统广播（以 `agent.token`、`agent.done` 等事件类型），而不是直接通过 WebSocket 返回。

4. **Agent 生命周期理解错误**：Agent 不需要显式启动——发往 `POST /agents/{id}/message` 的请求会自动触发 agent 启动（auto-start），状态从 `stopped` 自动变为 `running`。

## 解决方案

### 修复措施
完全重写 `apps/agent-runtime/main.go` 中的 `handlePrompt` 函数，改为正确的 Admin API + WS 事件监听模式：

1. **建立 WebSocket 事件订阅**（步骤必须在发送消息之前，避免竞争条件）：
   ```
   ws://127.0.0.1:2346/agents/events?instance_id={agent_id}
   ```
   使用 gorilla/websocket 客户端连接，设置 `ReadDeadline` 和 `PongHandler` 以保持连接活跃。

2. **通过 Admin API 发送用户消息**：
   ```
   POST /agents/{agent_id}/message
   Content-Type: application/json
   {"conversation_id": "{session_id}", "message": "{user_text}"}
   ```
   该请求会自动启动 agent（如果处于 stopped 状态）。

3. **按 conversation_id 过滤并转换事件**：
   从 WebSocket 读取 `gatewaydEvent`，按 `payload.conversation_id` 匹配当前会话，按规则转换：
   - `agent.token` → `message.part.updated {type:"text", delta:token, content:accumulated}`
   - `agent.done` → 结束流并关闭连接
   - `agent.error` / `session.error` → `session.error {code:500, message:...}`

4. **SSE 输出格式**：保持与 dh-backend 的 `HTTPClient.SendMessage()` 和 `AgentWorker.handleAgentEvent()` 期望格式一致（`message.updated` 建立消息信封 + 多个 `message.part.updated` 流式输出）。

### 涉及文件
- `apps/agent-runtime/main.go` — 完全重写 `handlePrompt` 函数，新增 `handleSession` 路由分发

### 验证结果
1. 直接测试 agent-runtime：
   ```bash
   curl -s -N http://127.0.0.1:8090/session/{session_id}/prompt \
     -H "Content-Type: application/json" \
     -d '{"parts":[{"type":"text","text":"简单回复：你好"}]}'
   ```
   输出正确的 SSE 事件流，包含完整的 token 级回复。

2. 全链路测试通过 WebSocket：
   ```python
   # 创建 session → 连接 WS → 发送消息 → 接收流式 token
   ws://127.0.0.1:8080/ws/v1/sessions/{session_id}
   ```
   收到合格的流式回复（如 "用户说"简单回复：你好"，意思是让我简单回复"你好"。"）。确认完整链路：前端 WS → dh-backend → agent-runtime → dh-gatewayd → opencode agent → 事件返回到前端。

3. 构建验证：
   - `go build`：编译通过，版本号更新为 1.1.0
   - `go vet`：零警告
   - `pnpm build`：全部 7 个包构建成功
   - `pnpm check-types`：全部通过
