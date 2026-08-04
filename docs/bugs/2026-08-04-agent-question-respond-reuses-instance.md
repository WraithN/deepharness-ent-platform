# 2026-08-04 agent.question 回答后复用首实例失败导致二次思考慢

## 现象

在 `/brainstorm` 需求澄清流程中，agent 通过 `agent.question` 工具提出多轮问题：

1. 用户回答第一个问题后，agent 长时间显示“思考中”。
2. 第二个问题（以及后续问题）迟迟没有输出，后台日志显示 respond 失败 404。
3. 最终 fallback 到创建新 thread + 新 agent 实例，新实例重新读取代码、重新思考，导致延迟数分钟且上下文断裂。

## 根因

全链路存在两个 instance id 不一致：

1. **gatewayd 实际 instance id 是插件名（如 `opencode` / `opencode-1`）**。
   - `POST /sessions/{id}/agents` 返回的 `instance_id` 是 `opencode` 这类名称。
   - 后端 `CreateSession` 已将其保存到 `chat.Session.GatewaydAgentID`。

2. **agent.question 自定义事件 payload 中同时存在两个 instance 字段**。
   - `payload.instance_id`：gatewayd 实际返回的 `opencode`。
   - `payload.instanceId`：前端渲染时混入的 UUID（非 gatewayd 真实 instance id）。

3. **前端优先使用 `payload.instanceId`（UUID）**。
   - `use-ag-ui-chat.ts` 中解析 `agent.question` 时：
     ```ts
     const instanceId = payload.instanceId ?? payload.instance_id ?? instanceIdRef.current ?? '';
     ```
   - 导致 `respondToQuestion` 把 UUID 发给后端 `/api/v1/agent/respond`。

4. **后端 `/api/v1/agent/respond` 直接用前端传来的 UUID**。
   - 调用 `gatewayd POST /sessions/{id}/agents/{instanceId}/respond` 时 instanceId 错误，gatewayd 返回 404。
   - 404 被判定为“实例已死亡”，进入 fallback 创建新 thread + 新 instance，重新走完整启动/读代码/思考流程。

## 解决方案

### 1. 前端优先使用 gatewayd 真实 `instance_id`

`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`：

```ts
const instanceId = payload.instance_id ?? payload.instanceId ?? instanceIdRef.current ?? '';
```

优先使用 `payload.instance_id`（如 `opencode`），回退到 `payload.instanceId`（兼容旧格式），最后回退到会话级 `instanceIdRef.current`。

### 2. 后端使用会话持久化的 `GatewaydAgentID` 覆盖前端可能错误的 UUID

`apps/dh-backend/gateway/handler/agui_respond.go` -> `RespondToAgent`：

- 从 `chat.SessionStore` 读取当前会话。
- 若 `session.GatewaydAgentID` 非空，用它作为有效 `instanceId` 覆盖 `req.InstanceID`。
- 这样即使前端仍传 UUID，后端也会用 `opencode` 调用 gatewayd，保证 Respond 命中同一实例。

### 3. 增加 `RespondAndListen` 同实例回退

`apps/dh-backend/agent/client/agui_client.go` 新增 `RespondAndListen`：

- 先建立 `WS /sessions/{id}/events` 监听事件。
- 再调用 `Respond`。
- 事件捕获到后端 SSE buffer，供前端重放。

`RespondToAgent` 回退顺序：

1. 直接 `Respond`（复用原实例）。
2. `RespondAndListen`（直接 Respond 失败时仍尝试复用原实例）。
3. `fallbackRunForRespond`（创建新 thread 兜底）。

## 验证

- `go build ./apps/dh-backend/...` 通过。
- `go vet ./apps/dh-backend/...` 无 warning。
- `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 无 error。
- `bash scripts/restart-dev.sh` 成功启动所有服务，前后端 `/health` 正常。

## 影响范围

- 影响 `/brainstorm` 等多轮 `agent.question` 场景。
- 修复后用户回答完问题，agent 应继续复用原实例提出下一个问题，避免重新读代码和“思考中”卡顿。
