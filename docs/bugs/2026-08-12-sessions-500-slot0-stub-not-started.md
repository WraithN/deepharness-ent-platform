# /api/v1/sessions 在 slot 0 stub 未启动时 500

## 现象

前端调 `POST /api/v1/sessions`（创建会话）时，在 direct-host 模式下当 slot 0 personal-stub 未启动时返回 500：

```
POST /api/v1/sessions 500 1.606236ms
```

后端日志：

```
[ensureWorkspaceDir] failed to create workspace dir /home/nan/test/<userID>/<workspaceID>:
stubclient MkdirAll: Post "http://127.0.0.1:8090/api/v1/files/mkdir":
dial tcp 127.0.0.1:8090: connect: connection refused
```

**触发条件**：direct-host 模式下 slot 0 personal-stub 没起（lazy 启进程，没人发过 chat 触发 `Acquire`）。

**影响范围**：所有走 `ensureWorkspaceDir` 的接口：
- `POST /api/v1/sessions`（创建会话）
- `POST /api/v1/files/*`（创建文件/目录）
- `POST /api/v1/projects/*`（创建项目）
- `POST /api/v1/preview/*`（创建预览）

**业务后果**：用户首次打开页面想做任何操作都 500，必须先有任意一次成功的 chat 触发 `Acquire` 拉 slot 0 stub 才能正常用。这跟 direct-host "per-user 隔离"设计原则矛盾——sessions API 永远走 default `:8090` = slot 0 stub，slot 0 挂了 = 整站挂。

## 根因

位置：`apps/dh-backend/gateway/handler/workspace_path.go:24`

```go
func ensureWorkspaceDir(path string) error {
    if path == "" { return nil }
    sc := stubclient.FromContext(context.Background()) // ⚠️ 关键 bug
    if sc == nil {
        return errors.New("personal-stub client not initialized")
    }
    if err := sc.MkdirAll(context.Background(), path); err != nil { // ⚠️ 同样用 Background
        ...
    }
    return nil
}
```

三处问题：

1. **`context.Background()` 拿不到请求上下文**：`stubclient.FromContext(context.Background())` 永远拿不到 `containerMW` 注入的 per-user stubclient，降级到 `defaultClient`（指向 `cfg.PersonalStubURL` = `http://127.0.0.1:8090` = slot 0 stub）。
2. **`MkdirAll` 也用 `context.Background()`**：即使修了第 1 点，`MkdirAll` 内部用 ctx 做超时和取消，不传请求 ctx 会丢失这些控制。
3. **`/api/v1/sessions` 路由未经过 `containerMW`**：`server.go:459` 只包了 `middleware.Auth`，没有 `containerMW`。即使 `ensureWorkspaceDir` 改用 `r.Context()`，ctx 里也没有被注入的 stubclient（因为 `containerMW` 没运行），仍然降级到 default。

**辅助问题**：`stub_proxy.go:67-71` 的 `IsStubRoute` 是死代码，从未被调用。bug 报告中"把 sessions 加进 IsStubRoute"的方案 B1 是错误的——`StubProxy.ServeHTTP` 会把请求**代理转发**到 personal-stub，sessions 请求会被转发到一个不处理 sessions 的服务，直接破坏功能。

## 解决方案

### 1. `ensureWorkspaceDir` / `resolveWorkspacePath` 接收 ctx（方案 A）

`workspace_path.go`：函数签名增加 `ctx context.Context` 参数，用 `stubclient.FromContext(ctx)` 取 per-user stubclient，`MkdirAll(ctx, path)` 传请求 ctx。

### 2. 所有调用点传 `r.Context()` / 请求 ctx

| 文件 | 行号 | 改动 |
|------|------|------|
| `session.go` | 152 | `resolveWorkspacePath(r.Context(), ...)` |
| `agui_run.go` | 256 | `resolveWorkspacePath(r.Context(), ...)` |
| `agui_respond.go` | 200-216 | fallback 流程用 `context.Background()` 避免 cancel，但从中 `r.Context()` 提取 per-user stubclient 注入到 background ctx，确保不降级到 default |

### 3. `ROUTE_SESSIONS` 包上 `containerMW`（正确的方案 B）

`server.go:459`：将 `middleware.Auth(http.HandlerFunc(sessionHandler.Sessions))` 改为 `containerMW(http.HandlerFunc(sessionHandler.Sessions))`。

`containerMW` 内部已包含 `middleware.Auth`，且额外完成：
- `containerPool.Acquire(r.Context(), userID)` —— 触发 lazy 启动用户专属 stub
- `provisioner.WithContainer(ctx, container)` —— 注入 ContainerInfo
- `stubclient.WithClient(ctx, stubclient.New(container.PersonalStubURL()))` —— 注入 per-user stubclient

这样 `ensureWorkspaceDir(r.Context(), ...)` 就能路由到用户专属 stub，而非 default slot 0。

### 4. 回归测试

新增 `gateway/handler/workspace_path_test.go`，包含 4 个测试用例：
- `TestEnsureWorkspaceDir_UsesContextClient`：验证 `ensureWorkspaceDir` 使用 ctx 中的 per-user stubclient 而非 default（核心回归测试）
- `TestEnsureWorkspaceDir_EmptyPathSkipsStub`：空路径不调用 stub
- `TestEnsureWorkspaceDir_NoClientReturnsError`：无 stubclient 时返回明确错误
- `TestEnsureWorkspaceDir_StubErrorPropagates`：stub 返回错误时传播

同时修复 `gateway/handler/tests/session_test.go` 中预先失败的 `TestCreateSession_Success`（缺 `workspaceId` + 缺 stubclient 注入）。

## 验证结果

- `go vet ./...`：0 warnings
- `go build ./...`：成功
- `go test ./gateway/handler/...`：全部通过（4 个新测试 + 3 个已有测试）
- 回归测试 `TestEnsureWorkspaceDir_UsesContextClient` 确认 per-user stub 收到 1 次请求，default stub 收到 0 次
