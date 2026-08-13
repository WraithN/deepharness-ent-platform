# 选 claude-code 但闲聊被 opencode/DeepSeek 冒充回答

## 现象

用户在智能会话页选了 `agentKey=claude-code`，发了一句"你是什么模型"。
返回的回答来自 opencode/DeepSeek-v4-flash，不是用户选的 claude-code。

回复内容："我是 DeepSeek 模型（deepseek-v4-flash），由 opencode 驱动。"

## 根因

意图识别（Intent Recognition）预检查步骤在用户消息进入主对话线之前先跑了一次 LLM 调用，这次调用不读用户请求里的 `agentKey`：

1. **`recognizeIntent` 不接收 agentKey**：`intent.go:121` 签名只有 `(ctx, aguiClient, userInput)`，agentKey=claude-code 没传进去
2. **`QuickComplete` 不设 AgentKey**：`quick_complete.go:30-41` 构造的 `RunAgentInput` 没有 `AgentKey` 字段
3. **`AGUIClient.Run` 三层 if 全 miss**：`agui_client.go:245-257` 中 `input.AgentKey`/`input.AgentPluginKey`/`ForwardedProps` 全空，回退到 `c.pluginKey="opencode"`
4. 结果：闲聊路径用 opencode/DeepSeek 回答，claude-code 从未被 attach 或运行

## 解决方案

方案 A（最小改动）：让意图识别阶段也用用户选的 agent 跑。

### 改动清单

1. **`agent/client/quick_complete.go`**：`QuickComplete` 签名加 `agentKey string` 参数，内部设置 `input.AgentKey = agentKey`
2. **`gateway/handler/intent.go`**：`recognizeIntent` 签名加 `agentKey string` 参数，透传给 `QuickComplete`
3. **`gateway/handler/agui_run.go:357`**：调用处传 `input.AgentKey`
4. **`gateway/handler/agui_respond.go`**：`AGUIHandler.QuickComplete` wrapper 签名加 `agentKey string`，透传
5. **`gateway/server/server.go:397`**：`InitStandardCompleter` 用闭包包装，传空 agentKey（规范生成不绑定特定 agent）
6. **`domain/feishu/service/dispatcher.go`**：两处 `QuickComplete` 调用传空 agentKey（飞书场景不绑定特定 agent）

### 效果

用户选什么 agent，闲聊就用什么 agent 回答，行为一致。

### 验证

- `go vet ./...` 通过，0 warnings
- `go build` 通过
- `pnpm build` + `pnpm check-types` 通过
