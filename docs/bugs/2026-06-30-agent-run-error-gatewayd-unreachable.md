# Agent 运行时 gatewayd 不可达错误提示不友好

## 现象

在未启动 gatewayd（ent-desktop Agent Runtime）的开发环境中，用户在聊天页面发送消息后，前端收到 `RUN_ERROR` 事件，消息内容是一段技术错误：

```
attach agent: attach agent: Post "http://127.0.0.1:2346/sessions/.../agents": dial tcp 127.0.0.1:2346: connect: connection refused
```

普通用户无法理解该错误，也不知道如何排查和启动 gatewayd。

## 根因

`apps/dh-backend/gateway/handler/agui.go` 的 `AgentRun` 在 `AGUIClient.Run` 失败时，直接把 `err.Error()` 作为 `RUN_ERROR` 的消息返回给前端。对于连接拒绝这类网络错误，原始 Go 错误包含 HTTP 方法、URL、底层 TCP 细节，不适合直接展示。此外，项目中没有提供统一的 gatewayd 帮助入口。

## 解决方案

1. **统一网关连接错误判断**：在 `apps/dh-backend/gateway/handler/common.go` 中新增 `IsGatewaydConnectionError` 和 `FormatGatewaydError`，集中识别 `connection refused`、`no such host`、`timeout`、`network is unreachable` 等特征，并转换为用户友好提示。
2. **优化 AgentRun 错误输出**：`AGUIHandler.AgentRun` 调用 `FormatGatewaydError(err)`，将技术错误替换为：
   > Agent运行时未启动，请联系系统管理员
3. **复用连接错误判断**：`SessionHandler.CreateSession` 中原有的 `isGatewaydConnectionError` 改为使用 `common.go` 中的共享函数，避免重复逻辑。
4. **新增 dh CLI 帮助工具**：
   - 创建 `scripts/dh` 可执行脚本。
   - 实现 `dh gwd help`：输出 gatewayd 作用、启动步骤、环境变量说明。
   - 实现 `dh gwd status`：检查 `http://127.0.0.1:2346/health` 是否可达。
   - 在根 `package.json` 中注册 `"dh": "./scripts/dh"` 脚本，因此可通过 `pnpm dh gwd` 调用（错误文案中不再直接引导，CLI 仍保留供管理员排查）。

### 修改文件

- `apps/dh-backend/gateway/handler/common.go`
- `apps/dh-backend/gateway/handler/session.go`
- `apps/dh-backend/gateway/handler/agui.go`
- `scripts/dh`（新增）
- `package.json`

### 验证结果

```bash
cd apps/dh-backend && go test ./gateway/handler/ -v
# PASS

cd apps/dh-backend && go vet ./...
# 0 warnings

pnpm dh gwd status
# gatewayd 未运行或不可达：http://127.0.0.1:2346
# 请运行：dh gwd help

pnpm dh gwd help
# 显示 gatewayd 帮助文档

# 测试 /api/v1/agent 返回的友好错误
curl -s -X POST http://localhost:8080/api/v1/agent \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{...}'
# data: { "type": "RUN_ERROR", ..., "message": "Agent运行时未启动，请联系系统管理员", "code": "RUN_FAILED" }
```

## 注意事项

- 本修复仅改善错误提示和提供排查入口，不替代真正启动 gatewayd。
- 开发环境若未启动 gatewayd，创建会话仍可降级成功，但发送消息会失败并显示友好提示。
- 生产环境必须保证 gatewayd 可达。
