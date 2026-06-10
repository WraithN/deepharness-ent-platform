# Agent Mock Service

模拟 OpenCode serve 的 SSE 流式响应服务，用于开发和测试 Gateway 的 AgentClient。

## 启动

```bash
cd services/agent-mock
make run
# 或
PORT=9090 go run .
```

## 接口

### Health Check
```bash
curl http://localhost:9090/health
```

### 创建 Session
```bash
curl -X POST http://localhost:9090/session/test-session-id
```

### 发送 Prompt（SSE 流式返回）
```bash
curl -N -X POST http://localhost:9090/session/test-session-id/prompt \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"hello"}]}'
```

## 场景触发

Mock 服务根据 prompt 内容自动选择响应场景：

| Prompt 关键词 | 场景 |
|-------------|------|
| "think", "思考" | 带有 reasoning 思考过程的回复 |
| "tool", "file", "read", "搜索" | 包含 tool_use + tool_result 的回复 |
| "error", "错误" | 返回错误事件 |
| 其他 | 简单文本流式回复 |

## SSE 事件格式

```
data: {"type":"message.updated","properties":{"info":{"id":"...","role":"assistant"}}}

data: {"type":"message.part.updated","properties":{"part":{"id":"...","type":"text","content":"..."},"delta":"..."}}

data: {"type":"message.part.updated","properties":{"part":{"id":"...","type":"reasoning","content":"..."},"delta":"..."}}

data: {"type":"message.part.updated","properties":{"part":{"id":"...","type":"tool_use","name":"read_file","input":"..."}}}

data: {"type":"message.part.updated","properties":{"part":{"id":"...","type":"tool_result","output":"...","status":"completed"}}}
```
