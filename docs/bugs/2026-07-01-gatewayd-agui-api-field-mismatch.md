# gatewayd AG-UI 接口字段与端点不匹配

## 现象

dh-backend 通过 AG-UI 协议对接 ent-desktop gatewayd 时，存在三处与 README 接口文档不一致的问题，导致 gatewayd 无法正确处理请求：

1. **CreateAgentRequest 字段名错误**：`agui_client.go` 与 `http.go` 中向 `POST /sessions/{sessionId}/agents` 发送请求体时使用 `plugin_key` 和 `workspace` 字段，但 gatewayd 文档要求的字段名为 `agent_key` 和 `work_directory`。由于这两个字段在文档中标记为必填，gatewayd 收到错误字段名后会因缺少必填字段而返回错误。
2. **Run 端点路径错误**：`agui_client.go` 中 `Run()` 方法向 `POST /sessions/{sessionId}/runs` 发送请求，但 gatewayd 文档中该接口的实际路径为 `POST /sessions/{sessionId}/chat`，导致 404。
3. **返回前端的 WebSocket 地址使用已废弃端点**：`session.go` 中 `CreateSession` 响应的 `gatewaydWsUrl` 字段返回旧版全局 `WS /agents/events` 地址，而 gatewayd 已废弃该接口，文档中替代为按会话的 `WS /sessions/{sessionId}/events`。

影响范围：所有通过 AG-UI 路径（`/api/v1/agent`）发起的 agent run 请求，以及会话创建时返回给前端的 WebSocket 地址。

## 根因

ent-desktop gatewayd 的 AG-UI 协议接口在文档（README "AG-UI 协议接口详情"章节）中明确定义了字段名与端点路径，但 dh-backend 客户端代码在实现时使用了与文档不一致的命名：

- `plugin_key` 应为 `agent_key`（文档 §3 CreateAgentRequest）
- `workspace` 应为 `work_directory`（文档 §3 CreateAgentRequest）
- `/sessions/{id}/runs` 应为 `/sessions/{id}/chat`（文档 §5）
- `/agents/events` 已废弃，应为 `/sessions/{sessionId}/events`（文档 §4 及末尾废弃说明）

此外，旧版 `GatewaydClient` 中的 `ResolveAgentID`（`GET /agents`）和 `SendMessage`（`POST /agents/{id}/message`）也使用了已废弃端点，但这些方法属于已被 AG-UI 路径（`AGUIClient.Run`）取代的旧版代码路径。

## 解决方案

### 1. 修正 CreateAgentRequest 字段名（`agui_client.go` + `http.go`）

将两处 `attachAgentWithKey` / `AttachAgent` 的请求体字段从 `plugin_key`/`workspace` 改为 `agent_key`/`work_directory`，与文档 §3 保持一致。

### 2. 修正 Run 端点路径（`agui_client.go`）

将 `Run()` 方法中的请求 URL 从 `/sessions/{id}/runs` 改为 `/sessions/{id}/chat`，同步更新日志与 `agui.go` 中的注释。

### 3. 返回 AG-UI WebSocket 地址（`http.go` + `session.go`）

新增 `WsURLForSession(sessionID)` 方法返回 `ws://host/sessions/{sessionId}/events`，并在 `session.go` 的 `CreateSession` 响应中使用该方法替代旧版 `WsURL()`。

### 4. 标记已废弃方法（`http.go`）

为旧版 `WsURL()`、`ResolveAgentID()`、`SendMessage()` 添加 `Deprecated` 注释，指明对应的 AG-UI 替代接口，便于后续清理。

### 验证

- `go vet ./...`：0 warnings
- `go build ./...`：编译通过
- `go test ./gateway/... ./agent/...`：全部通过
- 前端 `tsc --noEmit`：0 errors
