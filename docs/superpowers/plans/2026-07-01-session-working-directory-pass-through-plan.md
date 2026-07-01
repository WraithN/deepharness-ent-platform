# Session 工作目录透传实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `CreateSession` 阶段根据 workspace + 成员 user_id + `RepositoryRoot` 拼接出动态工作目录，透传给 gatewayd，并持久化到 session；后续 `AgentRun` 复用该目录。

**Architecture:** 后端在创建 session 时解析工作目录并写入 `chat.Session.WorkspacePath`；`GatewaydClient.AttachAgent` 与 `AGUIClient.Run` 改为按调用传入 workspace；`AgentRun` Handler 从 session store 读取已持久化的路径传给 `AGUIClient`。

**Tech Stack:** Go 1.22, PostgreSQL, standard library `net/http`, AG-UI protocol, gatewayd Admin HTTP API.

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `apps/dh-backend/agent/chat/session.go` | `chat.Session` 领域模型，新增 `WorkspacePath` |
| `apps/dh-backend/agent/chat/session/session.go` | 内存 SessionStore，读写 `WorkspacePath` |
| `apps/dh-backend/agent/chat/session/postgres.go` | Postgres SessionStore，读写 `workspace_path` |
| `apps/dh-backend/agent/agui/types.go` | `RunAgentInput` 新增内部 `Workspace` 字段 |
| `apps/dh-backend/agent/client/http.go` | `GatewaydClient.AttachAgent` 接收 workspace 参数 |
| `apps/dh-backend/agent/client/agui_client.go` | `AGUIClient.attachAgentWithKey/Run` 接收/使用 workspace |
| `apps/dh-backend/gateway/handler/session.go` | `SessionHandler` 计算并透传 workspace path |
| `apps/dh-backend/gateway/handler/agui.go` | `AgentRun` 读取 session 并传给 `AGUIClient.Run` |
| `apps/dh-backend/gateway/server/server.go` | 注入 `WorkspaceService` 与 `Config` 到 `SessionHandler` |
| `apps/dh-backend/gateway/handler/session_test.go` | 更新现有测试以匹配新的 `NewSessionHandler` 签名 |
| `infra/database/agent/schema.sql` | `agent_sessions` 表新增 `workspace_path` 列 |

---

### Task 1: 更新 `chat.Session` 模型与数据库 Schema

**Files:**
- Modify: `apps/dh-backend/agent/chat/session.go`
- Modify: `infra/database/agent/schema.sql`

- [ ] **Step 1: 新增 `WorkspacePath` 字段**

修改 `apps/dh-backend/agent/chat/session.go`：

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

- [ ] **Step 2: 新增 `workspace_path` 列**

在 `infra/database/agent/schema.sql` 的 `CREATE TABLE agent_sessions` 语句中加入：

```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    workspace_path VARCHAR(500),          -- 新增
    agent_id VARCHAR(36) NOT NULL,
    agent_type VARCHAR(50) NOT NULL DEFAULT 'opencode',
    model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
    project_id VARCHAR(50),
    title VARCHAR(500),
    context JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

同时新增一条独立的 `ALTER TABLE` 语句用于已存在的数据库：

```sql
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS workspace_path VARCHAR(500);
```

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/agent/chat/session.go infra/database/agent/schema.sql
git commit -m "feat(session): add WorkspacePath to Session model and schema"
```

---

### Task 2: 更新内存 SessionStore

**Files:**
- Modify: `apps/dh-backend/agent/chat/session/session.go`

- [ ] **Step 1: 修改 `Create` 以写入完整 Session（已是完整结构体赋值，无需改动）**

确认 `Create` 中 `s.sessions[sess.ID] = sess` 已天然保存新增字段，无需额外修改。

- [ ] **Step 2: Commit**

```bash
git add apps/dh-backend/agent/chat/session/session.go
git commit -m "chore(session): memory store already supports WorkspacePath via struct assignment"
```

---

### Task 3: 更新 Postgres SessionStore

**Files:**
- Modify: `apps/dh-backend/agent/chat/session/postgres.go`

- [ ] **Step 1: 修改 `Create`**

```go
func (s *PostgresStore) Create(ctx context.Context, sess chat.Session) error {
    ctxJSON, err := json.Marshal(sess.Context)
    if err != nil {
        return fmt.Errorf("marshal context failed: %w", err)
    }
    _, err = s.db.ExecContext(ctx, `
        INSERT INTO agent_sessions (id, workspace_id, workspace_path, agent_id, agent_type, model, project_id, title, context, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, sess.ID, sess.WorkspaceID, sess.WorkspacePath, sess.AgentID, sess.AgentType, sess.Model, sess.ProjectID, sess.Title, ctxJSON, sess.CreatedAt, sess.UpdatedAt)
    if err != nil {
        return fmt.Errorf("insert session failed: %w", err)
    }
    return nil
}
```

- [ ] **Step 2: 修改 `Get`**

```go
func (s *PostgresStore) Get(ctx context.Context, id string) (chat.Session, error) {
    var sess chat.Session
    var ctxJSON []byte
    err := s.db.QueryRowContext(ctx, `
        SELECT id, workspace_id, workspace_path, agent_id, agent_type, model, project_id, title, context, created_at, updated_at
        FROM agent_sessions WHERE id = $1
    `, id).Scan(&sess.ID, &sess.WorkspaceID, &sess.WorkspacePath, &sess.AgentID, &sess.AgentType, &sess.Model, &sess.ProjectID, &sess.Title, &ctxJSON, &sess.CreatedAt, &sess.UpdatedAt)
    // ... 后续不变
}
```

- [ ] **Step 3: 修改 `ListSessions`**

```go
func (s *PostgresStore) ListSessions(ctx context.Context) ([]chat.Session, error) {
    rows, err := s.db.QueryContext(ctx, `
        SELECT id, workspace_id, workspace_path, agent_id, agent_type, model, project_id, title, context, created_at, updated_at
        FROM agent_sessions
        ORDER BY updated_at DESC
    `)
    // ... 后续不变
}
```

- [ ] **Step 4: 编译检查**

```bash
cd apps/dh-backend
go build ./agent/chat/session/...
```

Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/agent/chat/session/postgres.go
git commit -m "feat(session): persist WorkspacePath in postgres store"
```

---

### Task 4: `RunAgentInput` 新增内部 `Workspace` 字段

**Files:**
- Modify: `apps/dh-backend/agent/agui/types.go`

- [ ] **Step 1: 定位 `RunAgentInput` 并新增字段**

找到 `RunAgentInput` 结构体，在末尾新增：

```go
type RunAgentInput struct {
    // ... 原有字段保持不变 ...

    // Workspace 仅在 dh-backend 内部使用，用于向 gatewayd 挂载 agent 时指定工作目录。
    // 该字段不会被序列化到 gatewayd。
    Workspace string `json:"-"`
}
```

- [ ] **Step 2: 编译检查**

```bash
cd apps/dh-backend
go build ./agent/agui/...
```

Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/agent/agui/types.go
git commit -m "feat(agui): add internal Workspace field to RunAgentInput"
```

---

### Task 5: 修改 `GatewaydClient.AttachAgent` 接收 workspace 参数

**Files:**
- Modify: `apps/dh-backend/agent/client/http.go`

- [ ] **Step 1: 修改 `AttachAgent` 签名与实现**

```go
// AttachAgent 向 gatewayd 指定 thread 挂载指定插件的 agent 实例，
// 返回 gatewayd 生成的 instance_id，用于前端展示智能体唯一标识。
func (c *GatewaydClient) AttachAgent(ctx context.Context, threadID, pluginKey, workspace string) (string, error) {
    if threadID == "" {
        return "", fmt.Errorf("thread id is required")
    }
    if pluginKey == "" {
        pluginKey = c.agentID
    }
    if workspace == "" {
        workspace = defaultGatewaydWorkspace
    }

    body, _ := json.Marshal(map[string]any{
        "plugin_key": pluginKey,
        "name":       pluginKey + "-" + uuid.New().String()[:8],
        "workspace":  workspace,
        "force":      false,
    })

    // ... 后续不变
}
```

- [ ] **Step 2: 编译检查**

```bash
cd apps/dh-backend
go build ./agent/client/...
```

Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/agent/client/http.go
git commit -m "feat(gatewayd-client): accept workspace in AttachAgent"
```

---

### Task 6: 修改 `AGUIClient` 接收并使用 workspace

**Files:**
- Modify: `apps/dh-backend/agent/client/agui_client.go`

- [ ] **Step 1: 修改 `AttachAgent` 与 `attachAgentWithKey` 签名**

```go
// AttachAgent 向指定 thread 挂载默认 agent 实例。
func (c *AGUIClient) AttachAgent(ctx context.Context, threadID string, force bool, workspace string) error {
    return c.attachAgentWithKey(ctx, threadID, force, c.pluginKey, workspace)
}

// attachAgentWithKey 向指定 thread 挂载指定插件的 agent 实例。
func (c *AGUIClient) attachAgentWithKey(ctx context.Context, threadID string, force bool, pluginKey string, workspace string) error {
    if workspace == "" {
        workspace = c.workspace
    }

    body, _ := json.Marshal(map[string]any{
        "plugin_key": pluginKey,
        "name":       pluginKey + "-" + uuid.New().String()[:8],
        "workspace":  workspace,
        "force":      force,
    })
    // ... 后续不变
}
```

- [ ] **Step 2: 修改 `Run` 中的 attach 调用**

在 `Run` 方法中，计算本次使用的 workspace：

```go
workspace := input.Workspace
if workspace == "" {
    workspace = c.workspace
}
```

然后将所有 `c.attachAgentWithKey(attachCtx, ...)` 调用末尾追加 `workspace` 参数：

```go
if err := c.attachAgentWithKey(attachCtx, input.ThreadID, false, pluginKey, workspace); err != nil {
    // ...
    if attachErr := c.attachAgentWithKey(attachCtx, input.ThreadID, true, pluginKey, workspace); attachErr != nil {
        // ...
    }
}
```

以及失败重试时的重新创建 thread 后的 attach：

```go
if attachErr := c.attachAgentWithKey(attachCtx, input.ThreadID, true, pluginKey, workspace); attachErr != nil {
    // ...
}
```

- [ ] **Step 3: 编译检查**

```bash
cd apps/dh-backend
go build ./agent/client/...
```

Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add apps/dh-backend/agent/client/agui_client.go
git commit -m "feat(agui-client): accept per-call workspace in AttachAgent and Run"
```

---

### Task 7: 创建 workspace 路径解析 helper

**Files:**
- Create: `apps/dh-backend/gateway/handler/workspace_path.go`

- [ ] **Step 1: 创建 helper 文件**

```go
package handler

import (
    "log"
    "path/filepath"
    "sort"

    workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
)

// resolveWorkspacePath 根据 workspace 成员、配置根目录拼接 gatewayd 工作目录。
// 多成员时取 joined_at 最早的成员；无成员时回退到 "default"。
func resolveWorkspacePath(workspaceID, repositoryRoot string, workspaceService workspaceservice.WorkspaceService) string {
    userID := "default"

    if workspaceService != nil && workspaceID != "" {
        members, err := workspaceService.ListMembers(workspaceID)
        if err != nil {
            log.Printf("[resolveWorkspacePath] failed to list members for workspace %s: %v", workspaceID, err)
        } else if len(members) > 0 {
            sort.Slice(members, func(i, j int) bool {
                return members[i].JoinedAt.Before(members[j].JoinedAt)
            })
            userID = members[0].UserID
            if len(members) > 1 {
                log.Printf("[resolveWorkspacePath] workspace %s has %d members, using oldest joined user %s", workspaceID, len(members), userID)
            }
        } else {
            log.Printf("[resolveWorkspacePath] workspace %s has no members, fallback to default", workspaceID)
        }
    }

    if repositoryRoot == "" {
        repositoryRoot = "/home/nan/test"
    }

    return filepath.Clean(filepath.Join(repositoryRoot, workspaceID, userID))
}
```

- [ ] **Step 2: 编译检查**

```bash
cd apps/dh-backend
go build ./gateway/handler/...
```

Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/gateway/handler/workspace_path.go
git commit -m "feat(handler): add workspace path resolver helper"
```

---

### Task 8: 扩展 `SessionHandler` 依赖

**Files:**
- Modify: `apps/dh-backend/gateway/handler/session.go`

- [ ] **Step 1: 添加 import 并修改结构体与构造函数**

新增 import：

```go
import (
    // ... 原有 import ...

    "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
    workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
)
```

修改结构体：

```go
type SessionHandler struct {
    sessions         chat.SessionStore
    messages         chat.MessageStore
    gatewaydClient   *client.GatewaydClient
    workspaceService workspaceservice.WorkspaceService
    cfg              config.Config
}
```

修改构造函数：

```go
func NewSessionHandler(
    sessions chat.SessionStore,
    messages chat.MessageStore,
    gatewaydClient *client.GatewaydClient,
    workspaceService workspaceservice.WorkspaceService,
    cfg config.Config,
) *SessionHandler {
    return &SessionHandler{
        sessions:         sessions,
        messages:         messages,
        gatewaydClient:   gatewaydClient,
        workspaceService: workspaceService,
        cfg:              cfg,
    }
}
```

- [ ] **Step 2: 编译检查**

```bash
cd apps/dh-backend
go build ./gateway/handler/...
```

Expected: 此时会有签名不匹配的报错（下一步修复）。

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/gateway/handler/session.go
git commit -m "feat(session-handler): extend SessionHandler with workspace service and config"
```

---

### Task 9: 修改 `CreateSession` 计算并透传工作目录

**Files:**
- Modify: `apps/dh-backend/gateway/handler/session.go`

- [ ] **Step 1: 在解析 workspaceID 后计算 workspacePath**

```go
workspaceID := req.WorkspaceID
if workspaceID == "" {
    workspaceID = "ws-default"
}

workspacePath := resolveWorkspacePath(workspaceID, h.cfg.RepositoryRoot, h.workspaceService)
```

- [ ] **Step 2: AttachAgent 传入 workspacePath**

```go
if pluginKey != "" {
    if id, attachErr := h.gatewaydClient.AttachAgent(r.Context(), threadID, pluginKey, workspacePath); attachErr == nil {
        instanceID = id
    } else {
        log.Printf("[CreateSession] AttachAgent failed: %v", attachErr)
    }
}
```

- [ ] **Step 3: 将 WorkspacePath 写入 Session 结构体**

```go
session := chat.Session{
    ID:            threadID,
    WorkspaceID:   workspaceID,
    WorkspacePath: workspacePath,
    AgentID:       agentID,
    AgentType:     agentType,
    Model:         req.Model,
    ProjectID:     req.ProjectID,
    Context:       context,
    CreatedAt:     time.Now(),
    UpdatedAt:     time.Now(),
}
```

- [ ] **Step 4: 编译检查**

```bash
cd apps/dh-backend
go build ./gateway/handler/...
```

Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/gateway/handler/session.go
git commit -m "feat(session): compute and pass workspace path on CreateSession"
```

---

### Task 10: 修改 `AgentRun` 读取 session 并透传 workspace

**Files:**
- Modify: `apps/dh-backend/gateway/handler/agui.go`

- [ ] **Step 1: 读取当前代码并定位 `AgentRun` 函数**

打开 `apps/dh-backend/gateway/handler/agui.go`，找到 `AgentRun` 函数。

- [ ] **Step 2: 在 session 校验处复用 session 并注入 `Workspace`**

当前代码已有：

```go
sessionID := input.ThreadID
if sessionID != "" && sessionID != "main" {
    if _, err := h.sessions.Get(r.Context(), sessionID); err == nil {
        _ = h.sessions.UpdateActivity(r.Context(), sessionID)
        log.Printf("[AGUIHandler] run=%s reuse session=%s", input.RunID, sessionID)
    } else {
        log.Printf("[AGUIHandler] run=%s session=%s not found, will create after run", input.RunID, sessionID)
        sessionID = ""
    }
} else {
    sessionID = ""
}
```

改为：

```go
sessionID := input.ThreadID
if sessionID != "" && sessionID != "main" {
    if sess, err := h.sessions.Get(r.Context(), sessionID); err == nil {
        _ = h.sessions.UpdateActivity(r.Context(), sessionID)
        if sess.WorkspacePath != "" {
            input.Workspace = sess.WorkspacePath
        }
        log.Printf("[AGUIHandler] run=%s reuse session=%s", input.RunID, sessionID)
    } else {
        log.Printf("[AGUIHandler] run=%s session=%s not found, will create after run", input.RunID, sessionID)
        sessionID = ""
    }
} else {
    sessionID = ""
}
```

- [ ] **Step 3: 编译检查**

```bash
cd apps/dh-backend
go build ./gateway/handler/...
```

Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add apps/dh-backend/gateway/handler/agui.go
git commit -m "feat(agent-run): pass session workspace path to AGUIClient.Run"
```

---

### Task 11: 在 `server.go` 注入新依赖

**Files:**
- Modify: `apps/dh-backend/gateway/server/server.go`

- [ ] **Step 1: 定位 `SessionHandler` 与 `AGUIHandler` 的初始化位置**

通常形如：

```go
sessionHandler := handler.NewSessionHandler(sessions, messages, gatewaydClient)
aguiHandler := handler.NewAGUIHandler(aguiClient)
```

- [ ] **Step 2: 修改 `initWorkspaceService` 返回 service**

在 `apps/dh-backend/gateway/server/server.go` 中：

```go
func initWorkspaceService(db *sql.DB) workspaceservice.WorkspaceService {
    if db != nil {
        log.Println("[Workspace] using postgres storage")
        svc := workspaceservice.NewDBWorkspaceService(db)
        workspace.Init(svc)
        return svc
    }
    log.Println("[Workspace] using memory mock")
    svc := workspaceservice.NewMockWorkspaceService()
    workspace.Init(svc)
    return svc
}
```

并在 `New` 函数中接收：

```go
workspaceService := initWorkspaceService(db)
```

- [ ] **Step 3: 修改 `SessionHandler` 初始化**

传入 `workspaceService` 与 `cfg`：

```go
sessionHandler := handler.NewSessionHandler(sessions, messages, gatewaydClient, workspaceService, cfg)
```

- [ ] **Step 4: 编译检查**

```bash
cd apps/dh-backend
go build .
```

Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/gateway/server/server.go
git commit -m "feat(server): wire workspace service and config into handlers"
```

---

### Task 12: 更新现有单元测试

**Files:**
- Modify: `apps/dh-backend/gateway/handler/session_test.go`

- [ ] **Step 1: 修改测试中的 `NewSessionHandler` 调用**

原代码：

```go
h := NewSessionHandler(sessions, messages, client.NewGatewaydClient("", ""))
```

改为：

```go
h := NewSessionHandler(
    sessions,
    messages,
    client.NewGatewaydClient("", ""),
    nil,   // workspaceService
    config.Config{RepositoryRoot: "/tmp/test-repos"},
)
```

需要新增 import：

```go
import (
    // ... 原有 import ...
    "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)
```

- [ ] **Step 2: 运行测试**

```bash
cd apps/dh-backend
go test ./gateway/handler/... -v
```

Expected: 所有测试通过。

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/gateway/handler/session_test.go
git commit -m "test(session): update handler tests for new SessionHandler signature"
```

---

### Task 13: 全量构建与验证

**Files:**
- 全部已修改文件

- [ ] **Step 1: Go 构建与 vet**

```bash
cd apps/dh-backend
go build .
go vet ./...
```

Expected: 无报错、无 warning。

- [ ] **Step 2: 后端单元测试**

```bash
cd apps/dh-backend
go test ./...
```

Expected: 全部通过。

- [ ] **Step 3: 全仓库构建**

```bash
cd /home/nan/deepharness-ent-platform
pnpm build
```

Expected: `@repo/dh-backend:build` 与 `@repo/web:build` 均成功。

- [ ] **Step 4: 启动 dev 并验证**

```bash
pnpm dev
```

在另一个终端：

```bash
curl -s http://localhost:8080/health
curl -s -X POST http://localhost:8080/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"workspaceId":"ws-default","agentType":"chat","pluginKey":"claude-code"}'
```

Expected: `/health` 返回 `{"status":"ok"}`；创建 session 返回 200。

- [ ] **Step 5: Commit（如通过）**

```bash
git add -A
git commit -m "chore: build and verify workspace path pass-through"
```

---

## 自检清单

- [ ] **Spec coverage:** 设计文档中的每一部分（配置复用、数据模型、GatewaydClient、AGUIClient、SessionHandler、AgentRun、降级策略）都有对应 task。
- [ ] **Placeholder scan:** 计划中没有 TBD/TODO/"implement later"/"适当处理" 等模糊描述。
- [ ] **Type consistency:** `WorkspacePath` / `workspace_path`、`Workspace` 字段名在全计划保持一致；方法签名改动已同步到调用方与测试。
