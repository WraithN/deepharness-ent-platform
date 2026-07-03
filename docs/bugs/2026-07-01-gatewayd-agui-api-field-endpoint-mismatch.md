# gatewayd AG-UI 接口字段与端点不匹配

## 现象

dh-backend 调用 ent-desktop gatewayd 的 AG-UI 协议接口时，使用的请求字段名和端点路径与 gatewayd README 文档不一致，导致：

1. **挂载 Agent 实例失败**：`POST /sessions/{sessionId}/agents` 请求体使用 `plugin_key` / `workspace` 字段，而 gatewayd 文档要求 `agent_key` / `work_directory`。由于这两个字段在文档中标记为必填，gatewayd 收到请求后看到空的 `agent_key` 和 `work_directory`，会返回 400 错误。
2. **启动 run 失败**：`AGUIClient.Run` 调用 `POST /sessions/{sessionId}/runs`，但 gatewayd 文档中该端点为 `POST /sessions/{sessionId}/chat`。`/runs` 端点不存在，gatewayd 返回 404。
3. **前端获取到已废弃的 WebSocket 地址**：`CreateSession` 响应中的 `gatewaydWsUrl` 返回旧版 `/agents/events` 全局 WebSocket 地址，而 gatewayd 文档标记该端点已废弃，应使用 `WS /sessions/{sessionId}/events` 按会话地址。

影响范围：所有通过 AG-UI 路径（`/api/v1/agent`）与 gatewayd 通信的会话均无法正常挂载 agent 实例和启动 run。

## 根因

dh-backend 的 `AGUIClient` 与 `GatewaydClient` 在实现时使用了与 gatewayd 最终发布的 README 文档不一致的字段命名和端点路径。具体差异：

| 位置 | 代码原值 | 文档要求值 |
|------|----------|------------|
| `agui_client.go` AttachAgent 请求体 | `plugin_key` | `agent_key` |
| `agui_client.go` AttachAgent 请求体 | `workspace` | `work_directory` |
| `agui_client.go` Run 端点 | `POST /sessions/{id}/runs` | `POST /sessions/{id}/chat` |
| `http.go` AttachAgent 请求体 | `plugin_key` | `agent_key` |
| `http.go` AttachAgent 请求体 | `workspace` | `work_directory` |
| `http.go` WsURL() 返回值 | `ws://.../agents/events`（已废弃） | `ws://.../sessions/{id}/events` |
| `http.go` ResolveAgentID | `GET /agents`（已废弃） | 无直接替代，AG-UI 通过 AttachAgent 返回 instance_id |
| `http.go` SendMessage | `POST /agents/{id}/message`（已废弃） | `POST /sessions/{id}/chat`（SSE） |

## 解决方案

### 1. 修复 CreateAgentRequest 字段名（agui_client.go + http.go）

将 `attachAgentWithKey` 和 `AttachAgent` 中的请求体字段从 `plugin_key` / `workspace` 改为 `agent_key` / `work_directory`，与 gatewayd README `CreateAgentRequest` 文档一致。

### 2. 修复 Run 端点路径（agui_client.go）

将 `AGUIClient.Run` 中的端点从 `POST /sessions/{id}/runs` 改为 `POST /sessions/{id}/chat`，同步更新相关日志和注释。

### 3. 新增 AG-UI 按会话 WebSocket 地址（http.go + session.go）

新增 `WsURLForSession(sessionID)` 方法，返回 `ws://host/sessions/{sessionId}/events`，并在 `CreateSession` 响应中使用该方法替代旧版 `WsURL()`。

### 4. 标记已废弃接口（http.go）

为 `WsURL()`、`ResolveAgentID()`、`SendMessage()` 添加 `Deprecated` 注释，说明 gatewayd 已废弃对应端点（`/agents/events`、`GET /agents`、`POST /agents/{id}/message`），新代码应使用 AGUIClient 通过 `/sessions` 路径通信。

### 验证结果

- `go vet ./...`：0 warnings
- `go build ./...`：成功
- `go test ./gateway/... ./agent/...`：全部通过
- `tsc --noEmit`（前端类型检查）：0 errors

涉及文件：
- `apps/dh-backend/agent/client/agui_client.go`
- `apps/dh-backend/agent/client/http.go`
- `apps/dh-backend/gateway/handler/agui.go`
- `apps/dh-backend/gateway/handler/session.go`
