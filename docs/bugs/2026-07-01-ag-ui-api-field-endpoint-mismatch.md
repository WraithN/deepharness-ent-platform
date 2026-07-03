# AG-UI 接口字段名与端点路径与 gatewayd 文档不一致

## 现象

平台后端 `apps/dh-backend` 调用 ent-desktop gatewayd 的 AG-UI 协议接口时，使用的字段名和端点路径与 `deepharness-ent-desktop/README.md` 中文档定义不一致，导致：

1. **挂载 Agent 实例失败**：`POST /sessions/{sessionId}/agents` 请求体使用了 `plugin_key` 和 `workspace` 字段，而文档要求 `agent_key` 和 `work_directory`。由于 `agent_key` 和 `work_directory` 均为必填字段，gatewayd 收到空值后返回 400 错误。
2. **启动 Run 失败**：`AGUIClient.Run` 调用 `POST /sessions/{sessionId}/runs`，但文档中不存在 `/runs` 端点，正确的 SSE 信道端点为 `POST /sessions/{sessionId}/chat`，gatewayd 返回 404。
3. **前端获取到已废弃的 WebSocket 地址**：`CreateSession` 响应中的 `gatewaydWsUrl` 返回旧版 `WS /agents/events`（已废弃），而非 AG-UI 协议的 `WS /sessions/{sessionId}/events`。

影响范围：所有通过 `AGUIClient`（`/api/v1/agent`）和 `GatewaydClient`（`/api/v1/sessions`）与 gatewayd 交互的代码路径。

## 根因

ent-desktop gatewayd 升级到 AG-UI 协议后，README 文档明确定义了 `CreateAgentRequest` 的字段名（`agent_key` / `work_directory`）和 Run 端点（`POST /sessions/{sessionId}/chat`）。平台后端代码仍沿用旧版字段名（`plugin_key` / `workspace`）和未文档化的端点（`/runs`），未随协议升级同步修改。

同时，README 明确标注旧版 `/agents`、`/agents/{id}/message`、`/agents/events` 接口已废弃，但 `GatewaydClient` 中的 `WsURL()`、`ResolveAgentID()`、`SendMessage()` 仍在使用这些废弃端点。

## 解决方案

### 1. 修正 `CreateAgentRequest` 字段名（两处）

- `apps/dh-backend/agent/client/agui_client.go` — `attachAgentWithKey` 方法
- `apps/dh-backend/agent/client/http.go` — `GatewaydClient.AttachAgent` 方法

将请求体字段 `plugin_key` → `agent_key`，`workspace` → `work_directory`，与 README `CreateAgentRequest` 定义一致。

### 2. 修正 Run 端点路径

- `apps/dh-backend/agent/client/agui_client.go` — `Run` 方法

将 `POST /sessions/{id}/runs` 改为 `POST /sessions/{id}/chat`，同步更新日志和 `agui.go` 中的注释。

### 3. 新增 AG-UI WebSocket 地址方法

- `apps/dh-backend/agent/client/http.go` — 新增 `WsURLForSession(sessionID)` 方法，返回 `ws://host/sessions/{sessionId}/events`
- `apps/dh-backend/gateway/handler/session.go` — `CreateSession` 响应改用 `WsURLForSession(session.ID)`

### 4. 标注废弃接口

为 `GatewaydClient.WsURL()`、`ResolveAgentID()`、`SendMessage()` 添加 `Deprecated` 注释，说明 gatewayd 已废弃对应端点，新代码应使用 `AGUIClient.Run`。

### 验证

- `go vet ./...`：0 warnings
- `go build ./...`：成功
- `go test ./gateway/... ./agent/...`：全部通过
- `tsc --noEmit`（前端类型检查）：0 errors
