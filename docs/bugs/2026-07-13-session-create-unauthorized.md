# 会话创建接口始终返回 unauthorized

## 现象

在 Chat 页面输入任意消息点击发送后，前端 toast 提示「创建会话失败」，无法开始任何会话。浏览器 Network 显示 `POST /api/v1/sessions` 返回 401 `{"code":2,"message":"unauthorized"}`，即使用户已登录且其他接口（如 `/v1/identity/users/me`）正常。

## 根因

`apps/dh-backend/gateway/server/server.go` 中 `/api/v1/sessions` 使用 `mux.HandleFunc` 直接注册，**未包裹 `middleware.Auth`**；而 `gateway/handler/session.go` 的 `CreateSession` 中通过 `middleware.UserIDFromContext(r.Context())` 取登录用户 ID（用于计算 agent 工作目录 `{workspaceRoot}/{wsId}/{userId}`）。由于 auth 中间件未执行，context 中不存在 userID，handler 必然走到 401 分支。该问题一直被「gatewayd unreachable」的降级日志掩盖，表现为会话创建必失败。

## 解决方案

将路由注册改为包裹 auth 中间件，与 workspace/agent-config 等需登录态路由保持一致：

```go
mux.Handle("/api/v1/sessions", middleware.Auth(http.HandlerFunc(sessionHandler.Sessions)))
```

验证结果：
- `curl -X POST /api/v1/sessions`（带 Bearer token）返回 `{"code":0,"data":{"sessionId":...}}`；
- 浏览器 e2e：Chat 页发送消息后成功创建会话，用户消息正常渲染，agent 侧报错仅剩预存在的「Agent运行时未启动」（gatewayd 未部署，与本缺陷无关）。
