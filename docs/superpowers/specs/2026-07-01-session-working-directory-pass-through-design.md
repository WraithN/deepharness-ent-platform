# Session 工作目录透传设计文档

## 背景与目标

当前 `apps/dh-backend` 在创建 Agent Session 时，传给 ent-desktop `gatewayd` 的工作目录是固定值（`defaultGatewaydWorkspace`，默认 `/home/nan/deepharness-ent-platform`）。这导致无论用户在哪个 workspace、以哪个成员身份打开 session，agent 都在同一个目录下运行，无法区分不同 workspace/用户的代码工程。

目标：在 `CreateSession` 阶段，后端根据请求的 `workspaceId`、该 workspace 在 `workspace_members` 表中的 `user_id`，以及配置项 `RepositoryRoot`（代码工程根目录），拼接出完整工作目录并透传给 gatewayd；后续 `AgentRun` 复用该目录，保证 agent 在正确的工程目录下执行。

工作目录格式：

```
{RepositoryRoot}/{workspace_id}/{user_id}/
```

例如：`/home/nan/test/bb8040a8-.../u123456/`

## 设计方案

### 1. 配置

复用已有配置项，不新增配置：

- `Config.RepositoryRoot`（默认 `/home/nan/test`）
- 环境变量：`REPOSITORY_ROOT`
- YAML：`repository.root`

该配置原本用于仓库克隆根目录，与“代码工程根目录”语义一致，因此直接复用。

### 2. 数据模型变更

#### 2.1 `chat.Session`

在 `apps/dh-backend/agent/chat/session.go` 中新增字段：

```go
type Session struct {
    ID            string         `json:"id"`
    WorkspaceID   string         `json:"workspaceId"`
    WorkspacePath string         `json:"workspacePath"` // 新增：gatewayd 工作目录
    AgentID       string         `json:"agentId"`
    AgentType     string         `json:"agentType"`
    Model         string         `json:"model"`
    ProjectID     string         `json:"projectId"`
    Title         string         `json:"title"`
    Context       map[string]any `json:"context,omitempty"`
    CreatedAt     time.Time      `json:"createdAt"`
    UpdatedAt     time.Time      `json:"updatedAt"`
}
```

#### 2.2 `agent_sessions` 表

在 `infra/database/agent/schema.sql` 中新增列：

```sql
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS workspace_path VARCHAR(500);
```

#### 2.3 SessionStore 实现

- `apps/dh-backend/agent/chat/session/session.go`（内存实现）
- `apps/dh-backend/agent/chat/session/postgres.go`（Postgres 实现）

两者都需要在 `Create`/`Get`/`ListSessions` 中读写 `workspace_path`。

### 3. `AGUIClient` 改造

当前 `AGUIClient` 在构造时绑定一个全局 `workspace`，改为每次 Attach 调用时传入。

#### 3.1 `apps/dh-backend/agent/agui/types.go`

`RunAgentInput` 新增内部字段：

```go
type RunAgentInput struct {
    // ... 原有字段 ...
    Workspace string `json:"-"` // 新增：仅内部使用，不序列化到 gatewayd
}
```

使用 `json:"-"` 避免该字段被意外发给 gatewayd。

#### 3.2 `apps/dh-backend/agent/client/http.go`（`GatewaydClient`）

`SessionHandler.CreateSession` 实际使用的是 `GatewaydClient`：

- `AttachAgent(ctx, threadID, pluginKey, workspace string)` 新增 `workspace` 参数。
- 使用传入的 `workspace` 构造请求体 `"workspace"` 字段，替代原来的 `defaultGatewaydWorkspace`。

#### 3.3 `apps/dh-backend/agent/client/agui_client.go`（`AGUIClient`）

`AgentRun` Handler 实际使用的是 `AGUIClient`：

- `attachAgentWithKey` 新增 `workspace string` 参数。
- `Run` 方法从 `input.Workspace` 取路径，用于 AttachAgent 及失败重试时的重新 Attach。
- 保留 client 级别的默认 workspace，作为兜底。

### 4. `SessionHandler` 依赖扩展

修改 `apps/dh-backend/gateway/handler/session.go`：

```go
type SessionHandler struct {
    sessions         chat.SessionStore
    messages         chat.MessageStore
    gatewaydClient   *client.GatewaydClient
    workspaceService workspaceService.WorkspaceService // 新增
    cfg              config.Config                      // 新增
}
```

`NewSessionHandler` 相应增加这两个依赖。

### 5. `CreateSession` 流程

`apps/dh-backend/gateway/handler/session.go` 中 `CreateSession`：

1. 解析 `workspaceID`：
   ```go
   workspaceID := req.WorkspaceID
   if workspaceID == "" {
       workspaceID = "ws-default"
   }
   ```
2. 查询 workspace 成员：
   ```go
   members, err := h.workspaceService.ListMembers(workspaceID)
   ```
3. 选取 `userID`：
   - 若成员数为 1，直接使用该 `user_id`。
   - 若成员数大于 1，按 `joined_at` 取最早加入的成员，并打印 warning。
   - 若无成员，回退到 `"default"`，并打印 warning。
4. 拼接工作目录：
   ```go
   workspacePath := filepath.Clean(filepath.Join(h.cfg.RepositoryRoot, workspaceID, userID))
   ```
5. 创建 gatewayd thread 后，调用 `AttachAgent` 时传入 `workspacePath`：
   ```go
   instanceID, attachErr := h.gatewaydClient.AttachAgent(r.Context(), threadID, pluginKey, workspacePath)
   ```
6. 将 `WorkspacePath` 写入 `chat.Session` 并持久化。

### 6. `AgentRun` 流程

`apps/dh-backend/gateway/handler/agui.go` 中 `AgentRun`：

1. 根据 `input.ThreadID` 从 session store 读取 session。
2. 将 `session.WorkspacePath` 赋给 `input.Workspace`。
3. 调用 `AGUIClient.Run`，并确保 `input.Workspace` 已设置。

这样即使 gatewayd 重启、session 丢失后 `AGUIClient` 重新 Attach，也会使用创建时确定的目录。

### 7. 降级与容错

| 场景 | 处理 |
|------|------|
| gatewayd 不可达 | 仍正常计算 `WorkspacePath` 并持久化；gatewayd 恢复后 agent run 会重新 attach 到正确目录 |
| `RepositoryRoot` 为空 | 回退到现有 `AGUIWorkspace` |
| workspace 无成员 | `userID` 回退为 `"default"`，并打印 warning |
| workspace 多个成员 | 取 `joined_at` 最早的成员，并打印 warning |
| 路径拼接结果 | 使用 `filepath.Clean` 处理，避免 `..` 等异常路径 |

## 涉及文件清单

- `apps/dh-backend/agent/chat/session.go`
- `apps/dh-backend/agent/chat/session/session.go`
- `apps/dh-backend/agent/chat/session/postgres.go`
- `apps/dh-backend/agent/agui/types.go`
- `apps/dh-backend/agent/client/http.go`
- `apps/dh-backend/agent/client/agui_client.go`
- `apps/dh-backend/gateway/handler/session.go`
- `apps/dh-backend/gateway/handler/agui.go`
- `apps/dh-backend/gateway/server/server.go`（注入新依赖）
- `infra/database/agent/schema.sql`

## 验收标准

1. 创建 session 后，`agent_sessions.workspace_path` 记录为 `/home/nan/test/{workspace_id}/{user_id}`。
2. gatewayd 的 `AttachAgent` 请求体中 `"workspace"` 字段为上述路径。
3. `AgentRun` 时，重新 Attach 或重试 Attach 仍使用同一路径。
4. Go 编译通过，`go vet ./...` 无 warning。
5. 前后端 `pnpm build` 通过。
