# 2026-07-05 发送“你好”后前端一直显示“思考中”

## 现象

在聊天页面发送简单问候语“你好”后，助手消息区域持续显示“思考中”动画，长时间无响应，用户体验差。

影响范围：所有使用 `AGUIHandler.AgentRun` 处理用户输入的聊天会话。

## 根因

后端在处理非斜杠指令的用户输入时，会先调用 `recognizeIntent` 进行意图识别。`recognizeIntent` 通过 `AGUIClient.QuickComplete` 向 gatewayd/agent 发起一次完整的 LLM run。当前 gatewayd 挂载的 agent 插件（claude-code / opencode / codex）在缺少可用模型配置或 API 密钥时，无法在合理时间内返回内容，`QuickComplete` 会等待其 60 秒超时后才返回空响应；随后后端 fallback 到正常 agent run，再次进入长等待。整个过程中前端只收到 `RUN_STARTED`，因此一直显示“思考中”。

关键日志片段：

```
[Intent] recognizing intent for input: "你好"
[AGUIClient] ... first SSE event ... type=RUN_STARTED
[AGUIClient] ... sse scanner error: context deadline exceeded
[Intent] raw response: ""
[AGUIHandler] intent recognition failed, fallback to normal run
```

## 解决方案

1. 在 `AGUIHandler.AgentRun` 中增加简单问候语快速通道：命中常见中英文问候语时，直接通过已有的 `streamChatResponse` 返回静态问候回复，跳过意图识别与 agent run 调用。
2. 新增 `gateway/handler/greeting.go` 维护问候语正则与回复文案，便于后续扩展。
3. 保留原有意图识别与 agent run 流程，仅对明确命中的问候语短路。

验证结果：

- `go vet ./...` 通过
- `pnpm lint` 通过
- `pnpm build` 通过
- 通过 `curl` 调用 `/api/v1/agent` 发送“你好”，后端立即返回 `TEXT_MESSAGE_CONTENT` 与 `RUN_FINISHED`，不再卡住。
