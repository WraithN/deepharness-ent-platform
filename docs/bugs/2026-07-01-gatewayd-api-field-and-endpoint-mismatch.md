# gatewayd AG-UI 接口字段名与端点不匹配

## 现象

dh-backend 调用 ent-desktop gatewayd 的 AG-UI 协议接口时，使用的请求字段名和端点路径与 gatewayd README 文档不一致，导致：

1. **`POST /sessions/{sessionId}/agents`（挂载 Agent 实例）请求失败**：平台发送 `plugin_key` 和 `workspace` 字段，但 gatewayd 文档要求的必填字段为 `agent_key` 和 `work_directory`。gatewayd 收到请求后无法识别这两个必填字段，导致 agent 实例挂载失败或使用空值。
2. **`POST /sessions/{sessionId}/runs`（启动 run）返回 404**：平台使用 `/sessions/{id}/runs` 端点，但 gatewayd 文档中该 SSE 接口的正确路径为 `POST /sessions/{sessionId}/chat`。
3. **前端获取到已废弃的 WebSocket 地址**：`CreateSession` 响应中的 `gatewaydWsUrl` 返回旧版 `/agents/events` 全局事件地址，该端点已被 gatewayd 标记为废弃。

影响范围：
- `apps/dh-backend/agent/client/agui_client.go` — AG-UI 主路径（`AGUIClient`）
- `apps/dh-backend/agent/client/http.go` — 旧版路径（`GatewaydClient`）
- `apps/dh-backend/gateway/handler/agui.go` — AG-UI 请求处理器
- `apps/dh-backend/gateway/handler/session.go` — 会话创建处理器

## 根因

ent-desktop gatewayd 升级到 AG-UI 协议后，README 文档明确了以下接口契约：

| 接口 | 文档要求 | 平台实际发送 |
|------|----------|-------------|
| `POST /sessions/{sessionId}/agents` 请求体 | `agent_key`, `work_directory` | `plugin_key`, `workspace` |
| 启动 run 的 SSE 端点 | `POST /sessions/{sessionId}/chat` | `POST /sessions/{sessionId}/runs` |
| WebSocket 事件端点 | `WS /sessions/{sessionId}/events` | `WS /agents/events`（已废弃） |

平台代码在 AG-UI 迁移过程中，字段名和端点路径未与 gatewayd README 文档完全对齐。同时旧版 `/agents`、`/agents/{id}/message`、`/agents/events` 接口已被 gatewayd 废弃。

## 解决方案

### 1. 修正 `CreateAgentRequest` 字段名（两处）

**`agui_client.go` `attachAgentWithKey` 方法**：
- `plugin_key` → `agent_key`
- `workspace` → `work_directory`

**`http.go` `AttachAgent` 方法**：
- `plugin_key` → `agent_key`
- `workspace` → `work_directory`

### 2. 修正 Run 端点路径

**`agui_client.go` `Run` 方法**：
- `POST /sessions/{id}/runs` → `POST /sessions/{id}/chat`
- 同步更新日志输出和 `agui.go` 中的注释

### 3. 迁移 WebSocket 地址到 AG-UI 协议

**`http.go`**：
- 新增 `WsURLForSession(sessionID)` 方法，返回 AG-UI 按会话 WebSocket 地址 `ws://host/sessions/{sessionId}/events`
- `WsURL()` 标记为 `Deprecated`，仅供旧版内部 `connect()` 使用

**`session.go`**：
- `CreateSession` 响应中的 `GatewaydWsURL` 改用 `WsURLForSession(session.ID)`

### 4. 标记旧版废弃接口

为 `ResolveAgentID`（`GET /agents`）和 `SendMessage`（`POST /agents/{id}/message`）添加 `Deprecated` 注释，指明新代码应使用 `AGUIClient.Run` 通过 `POST /sessions/{sessionId}/chat` 发送消息。

### 验证

- `go vet ./...` — 0 warnings
- `go build ./...` — 编译通过
- `go test ./gateway/... ./agent/...` — 全部测试通过
- `tsc --noEmit`（前端类型检查）— 0 errors
