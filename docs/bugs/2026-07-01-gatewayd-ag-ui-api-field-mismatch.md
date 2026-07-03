# gatewayd AG-UI 接口字段与端点不匹配

## 现象

dh-backend 在调用 ent-desktop gatewayd 时，使用的接口字段名与端点路径与 README 接口文档不一致，导致 agent 实例挂载与对话 run 请求失败：

1. **CreateAgentRequest 字段名错误**：发送 `plugin_key` / `workspace`，但文档定义为 `agent_key` / `work_directory`。
2. **Run 端点路径错误**：调用 `POST /sessions/{id}/runs`，但文档定义为 `POST /sessions/{id}/chat`。
3. **旧版已废弃接口仍在使用**：`WsURL()` 返回 `WS /agents/events`、`ResolveAgentID()` 调用 `GET /agents`、`SendMessage()` 调用 `POST /agents/{id}/message`，这些接口已被 gatewayd 废弃。

影响范围：所有通过 AGUIClient 发起的 agent 挂载与对话流，以及旧版 GatewaydClient 路径的 WebSocket 事件订阅。

## 根因

dh-backend 客户端代码在 AG-UI 协议迁移过程中未完全对齐 ent-desktop README 中文档化的接口契约。具体表现：

- `agui_client.go` 的 `attachAgentWithKey` 方法发送的 JSON body 使用了非文档字段名（`plugin_key`/`workspace`），gatewayd 反序列化时会忽略未知字段或因必填字段缺失而报错。
- `agui_client.go` 的 `Run` 方法构造的请求 URL 为 `/sessions/{id}/runs`，但 gatewayd 实际暴露的 AG-UI 对话端点为 `/sessions/{id}/chat`，导致 404。
- `http.go`（GatewaydClient）中保留了大量旧版 `/agents/*` 接口调用，README 明确标注这些接口已废弃，应使用 `/sessions` 为入口的 AG-UI 接口替代。

## 解决方案

### 1. 修正 CreateAgentRequest 字段名（agui_client.go + http.go）

将 `attachAgentWithKey` 与 `AttachAgent` 方法发送的 body 字段改为文档定义的名称：

```go
body, _ := json.Marshal(map[string]any{
    "agent_key":      pluginKey,      // 原 plugin_key
    "name":           pluginKey + "-" + uuid.New().String()[:8],
    "work_directory": workspace,      // 原 workspace
    "force":          force,
})
```

涉及文件：
- `apps/dh-backend/agent/client/agui_client.go:102`
- `apps/dh-backend/agent/client/http.go:391`

### 2. 修正 Run 端点路径（agui_client.go）

将 `POST /sessions/{id}/runs` 改为 `POST /sessions/{id}/chat`，并同步更新日志输出：

```go
url := fmt.Sprintf("%s/sessions/%s/chat", c.adminURL, input.ThreadID)
```

涉及文件：`apps/dh-backend/agent/client/agui_client.go:234`

### 3. 旧版接口标记废弃 + 新增 AG-UI 替代方法（http.go）

- 为 `WsURL()`、`ResolveAgentID()`、`SendMessage()` 添加 `Deprecated` 注释，指向 AG-UI 替代方案。
- 新增 `WsURLForSession(sessionID)` 方法，返回文档定义的 `WS /sessions/{sessionId}/events` 地址。
- `session.go` 的 `CreateSession` 响应改用 `WsURLForSession(session.ID)` 返回按会话的 WebSocket 地址。

涉及文件：
- `apps/dh-backend/agent/client/http.go:269`（WsURL deprecated + WsURLForSession 新增）
- `apps/dh-backend/agent/client/http.go:401`（ResolveAgentID deprecated）
- `apps/dh-backend/agent/client/http.go:448`（SendMessage deprecated）
- `apps/dh-backend/gateway/handler/session.go:176`（改用 WsURLForSession）

### 4. 同步更新 agui.go 中引用 /runs 的注释

`apps/dh-backend/gateway/handler/agui.go:113` 的注释从 `/sessions/{id}/runs` 改为 `/sessions/{id}/chat`。

### 验证结果

- `go vet ./...` 通过，0 warnings。
- `go build ./...` 通过。
- `go test ./gateway/... ./agent/...` 全部通过。
- `npx tsc --noEmit -p apps/web/tsconfig.check.json` 前端类型检查通过。
