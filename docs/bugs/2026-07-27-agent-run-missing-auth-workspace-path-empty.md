# 2026-07-27 /api/v1/agent 未鉴权导致 workspace path 为空

## 现象

执行 `/proto-make` 等流式指令时，后端返回错误事件：

> 运行出错：intercept commands: workspace path is required but empty

后端日志显示：

```
[AGUIHandler] run=... HandleRun ENTER ... workspace=056529...
[AGUIHandler] run=... intercept commands failed: workspace path is required but empty
```

## 根因

`AGUIHandler.AgentRun` 通过 `middleware.UserIDFromContext(r.Context())` 获取当前登录用户 ID，然后与 `workspaceID`、`workspaceRoot` 拼接出 gatewayd 工作目录：

```go
userID, _ := middleware.UserIDFromContext(r.Context())
if workspaceID != "" && userID != "" && h.workspaceRoot != "" {
    workspacePath, err := resolveWorkspacePath(workspaceID, userID, h.workspaceRoot)
    ...
}
```

`middleware.UserIDFromContext` 只有在请求经过 `middleware.Auth` 时才会被注入；而 `gateway/server/server.go` 中注册 `/api/v1/agent` 时使用的是：

```go
mux.HandleFunc("/api/v1/agent", aguiHandler.AgentRun)
```

**没有加 `middleware.Auth`**，因此 `userID` 为空，`resolveWorkspacePath` 未被调用，`workspacePath` 保持为空。随后 `interceptCommands` 在渲染模板时发现 `{WORKSPACE_PATH}` 无法替换，返回 `workspace path is required but empty`。

（gatewayd 通过 status 接口上报的 workspacePath 保存在 `agentruntime` 表中，但当前 `AgentRun` 路径并未读取该表；正确做法仍是让请求先通过 Auth 注入 userID。）

## 解决方案

为 `/api/v1/agent` 路由补充 `middleware.Auth`：

```go
mux.Handle("/api/v1/agent", middleware.Auth(http.HandlerFunc(aguiHandler.AgentRun)))
```

`Auth` 中间件本身不包装 `ResponseWriter`，因此不会影响 SSE 的 `http.Flusher` 能力。

## 验证

- `go build ./...` 与 `go vet ./...` 通过。
- `bash scripts/restart-dev.sh` 成功启动全部服务。
- 后端日志中 `HandleRun` 后应出现 `resolved workspace path: ...`。
- 再次执行 `/proto-make` 应能正常进入 agent run 流程。
