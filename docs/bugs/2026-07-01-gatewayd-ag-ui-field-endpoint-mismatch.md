# gatewayd AG-UI 接口字段名与端点不匹配

## 现象

dh-backend 通过 AGUIClient / GatewaydClient 调用 ent-desktop gatewayd 时，使用的接口字段名和端点路径与 gatewayd 实际实现的 AG-UI 协议不一致，导致：

1. **挂载 Agent 实例失败**：`POST /sessions/{sessionId}/agents` 请求体使用 `plugin_key` 和 `workspace` 字段，但 gatewayd 期望 `agent_key` 和 `work_directory`。由于这两个字段在 gatewayd 侧为必填，发送错误字段名会导致 gatewayd 收到空值并返回错误。
2. **启动 run 失败**：`AGUIClient.Run` 向 `POST /sessions/{sessionId}/runs` 发送请求，但 gatewayd 文档中该端点为 `POST /sessions/{sessionId}/chat`，导致 404。
3. **返回给前端的 WebSocket 地址为已废弃端点**：`GatewaydClient.WsURL()` 返回 `ws://host/agents/events`（已废弃），而非 AG-UI 协议的 `ws://host/sessions/{sessionId}/events`。

影响范围：所有通过 dh-backend 与 gatewayd 通信的会话创建、Agent 挂载和消息发送流程。

## 根因

ent-desktop 的 README 接口文档明确定义了 AG-UI 协议的请求/响应结构，但 dh-backend 在开发时使用了与文档不一致的字段名和端点路径：

| 位置 | 代码使用值 | 文档定义值 |
|------|-----------|-----------|
| `CreateAgentRequest` 插件标识 | `plugin_key` | `agent_key` |
| `CreateAgentRequest` 工作目录 | `workspace` | `work_directory` |
| Run 端点 | `POST /sessions/{id}/runs` | `POST /sessions/{id}/chat` |
| WebSocket 事件端点 | `WS /agents/events`（已废弃） | `WS /sessions/{sessionId}/events` |

此外，`GatewaydClient` 的 `ResolveAgentID`（`GET /agents`）和 `SendMessage`（`POST /agents/{id}/message`）也使用了 README 中标注为已废弃的旧版接口。

## 解决方案

### 1. 修正 CreateAgentRequest 字段名（两处）

- `apps/dh-backend/agent/client/agui_client.go` `attachAgentWithKey`：`plugin_key` → `agent_key`，`workspace` → `work_directory`
- `apps/dh-backend/agent/client/http.go` `AttachAgent`：同上

### 2. 修正 Run 端点路径

- `apps/dh-backend/agent/client/agui_client.go` `Run`：`/sessions/{id}/runs` → `/sessions/{id}/chat`
- 同步更新日志输出和 `agui.go` 中的注释

### 3. 新增 AG-UI 兼容的 WebSocket 地址方法

- `apps/dh-backend/agent/client/http.go`：新增 `WsURLForSession(sessionID)` 方法，返回 `ws://host/sessions/{sessionId}/events`
- `apps/dh-backend/gateway/handler/session.go`：`CreateSession` 响应中使用 `WsURLForSession(session.ID)` 替代 `WsURL()`
- 旧 `WsURL()` 标记为 `Deprecated`，仅供旧版内部 `connect()` 使用

### 4. 标注已废弃的旧版接口

- `ResolveAgentID`（`GET /agents`）和 `SendMessage`（`POST /agents/{id}/message`）添加 `Deprecated` 注释，指明新代码应使用 `AGUIClient.Run`

### 验证

- `go vet ./...`：0 warnings
- `go build ./...`：成功
- `go test ./gateway/... ./agent/...`：全部通过
- `tsc --noEmit`（前端类型检查）：0 errors
