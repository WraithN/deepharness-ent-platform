# 会话创建在 gatewayd 未启动时返回 500

## 现象

前端默认使用 `claude-code` 插件创建会话时，POST `/api/v1/sessions` 返回 **500 Internal Server Error**，响应体为：

```json
{"code":5,"message":"failed to create gatewayd thread"}
```

影响范围：开发环境或未启动 ent-desktop gatewayd 时，智能会话页面无法创建新会话，前端直接报错。

## 根因

`apps/dh-backend/gateway/handler/session.go` 的 `CreateSession` 在最近一次改造中强依赖外部 gatewayd 服务：

1. 调用 `GatewaydClient.CreateThread()` 向 `http://127.0.0.1:2346/sessions` 创建 thread。
2. 当前环境中 gatewayd 未监听 `127.0.0.1:2346`，连接被拒绝。
3. `CreateSession` 在 `CreateThread` 失败时直接返回 500，没有降级路径。

另外，`apps/dh-backend/agent/client/http.go` 的 `NewGatewaydClient` 在 `agentID` 为空时的 fallback 写死为 `"opencode"`，与 `config/config.go` 和 `config.yaml` 中默认的 `"claude-code"` 不一致。

## 解决方案

1. **gatewayd 不可达时降级**：在 `CreateSession` 中捕获 `CreateThread` 错误，若判断为网络不可达（connection refused / no such host / timeout / network unreachable），则回退到本地 `uuid.New()` 生成 session id，并记录日志。非网络类错误仍返回 500，避免掩盖真正的 gatewayd 逻辑异常。
2. **统一默认 agent 插件**：将 `NewGatewaydClient` 的默认 `agentID` 从 `"opencode"` 改为 `"claude-code"`，与全局配置保持一致。
3. **修复单元测试**：`session_test.go` 原先校验不存在的 `wsUrl` 字段，改为校验 `gatewaydWsUrl`；并将测试请求中的 `agentType` 从 `"opencode"` 改为 `"chat"`。

### 修改文件

- `apps/dh-backend/gateway/handler/session.go`
- `apps/dh-backend/agent/client/http.go`
- `apps/dh-backend/gateway/handler/session_test.go`

### 验证结果

```bash
cd apps/dh-backend && go test ./gateway/handler/ -run TestCreateSession -v
# === RUN   TestCreateSession_Success
# --- PASS: TestCreateSession_Success (0.00s)
# === RUN   TestCreateSession_InvalidBody
# --- PASS: TestCreateSession_InvalidBody (0.00s)
# PASS

cd apps/dh-backend && go vet ./...
# 0 warnings
```
