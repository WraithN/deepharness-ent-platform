# 前端发消息后 AI 无回复（agent-runtime 超时降级）

## 现象

用户在 chat 界面发送消息后，AI 始终无回复。表现为：
- 前端显示用户消息已发送，但一直显示"思考中..."或"AI 响应中..."后无结果
- 服务端各组件均正常运行：前端 :8888、dh-backend :8080、agent-runtime :8090、dh-gatewayd :2346、opencode serve :3001
- `curl localhost:2346/agents` 显示 dh-gatewayd agent 状态为 `{"running":{"pid":0}}`

## 根因

消息流链路为：`前端 WS → dh-backend → HTTP POST agent-runtime → WS dh-gatewayd → Admin API opencode → WS events → agent-runtime SSE → dh-backend → WS 前端`

关键卡点在 agent-runtime → dh-gatewayd 段：
- dh-gatewayd 的 opencode agent 进程已死（PID=0），但 agent-runtime 的连接已建立（TCP 连接成功）
- agent-runtime 通过 WS 连接到 dh-gatewayd 的 `/agents/events` 端点成功，并通过 Admin API 将消息发送给 opencode agent
- 由于 opencode 进程已死，dh-gatewayd 不会产生任何 WS 事件
- agent-runtime 在 `readEvents` 中阻塞在 `conn.ReadMessage()` 等待事件，永不超时
- 最终前端收不到任何回复

## 解决方案

1. **`apps/agent-runtime/main.go`**：在 `handlePrompt` 中添加 WS 事件超时降级机制：
   - 定义常量 `WS_EVENT_TIMEOUT = 15s`（第 25 行）
   - 在 `readEvents` goroutine 外层包装 `context.WithTimeout`，超时后自动取消
   - 超时触发 `callLLMFallback()` 函数，使用已有的 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`、`ANTHROPIC_MODEL=deepseek-chat` 环境变量直连 DeepSeek
   - LLM 回复通过 SSE `message.part.updated` 事件流式返回，格式与 dh-gatewayd WS 事件一致
   - 添加 `[prompt]`、`[llm]` 前缀日志，便于调试追踪

2. 使用 `randomHex(8)` 为每次 LLM 响应生成唯一的 `msgID` 和 `partID`，避免前端多轮对话消息合并问题（与 2026-06-25-agent-runtime-static-msgid.md 保持一致）

### 验证结果

- agent-runtime 日志清晰显示降级流程：`no events within 15s, falling back to LLM` → `starting LLM fallback for text: 说你好` → `sending LLM response: 你好！有什么可以帮你的吗？😊`
- Python WebSocket 端到端测试：session 创建 → WS 连接 → 发送消息 → ~17s 后收到 assistant 回复（含完整 `Type` / `Payload` / `Error` 结构）
- `go vet ./apps/agent-runtime/...` 通过
- 若未来 dh-gatewayd + opencode 正常运行，15s 内收到 WS 事件则不会触发降级，保持原路径
