# 2026-07-27 APISIX 空闲超时切断 SSE 连接

## 现象

会话执行 `/prd-write`、`/proto-make` 等长任务时，agent 实际成功完成（后端 4m7s 后正常 `RUN_FINISHED`），但前端在 ~79s 时断连，看不到最终结果。

时间线（会话 1785123303250-4087quq）：

| 时间 | 事件 | 距开始 |
|------|------|--------|
| 11:35:03 | Run 开始, `/prd-write` | 0s |
| 11:35:04 | RUN_STARTED | 1s |
| 11:35:13 | TEXT_MESSAGE_START (TTFT) | 10s |
| 11:35:14 | 2 个 bash 工具开始执行 | 11s |
| 11:35:14 | 第 1 个 bash 工具返回结果 | 11s |
| 11:35:14 | 前端断连 (frontend disconnected) | 11s |
| 11:36:22 | 第 2 个 bash 工具才返回结果 | 79s |
| 11:37:41 | write 工具执行 | 147s |
| 11:39:10 | RUN_FINISHED (成功完成!) | 4m7s |

第 2 个 bash 工具从 11:35:14 开始执行，到 11:37:41 才返回，中间 147 秒没有任何 SSE 事件输出。在这段静默期内，前端连接被中间层切断。

## 根因

完整网络链路：

```
Browser -> APISIX (10.245.99.180, 默认 60s 超时) -> Nginx (10.245.179.220, 200s) -> dh-backend (8080)
```

通过 `curl -s -o /dev/null -w '%{http_code}'` 探测确认，`deepharness-fronted-ctest1-8080.msxf.msxfyun.ttest` 解析到 `10.245.99.180`（APISIX 3.9.1 API 网关），响应头 `Server: APISIX/3.9.1`。

APISIX 默认 `proxy_read_timeout` 为 60 秒。当 bash 工具执行期间无 SSE 事件超过 60s，APISIX 切断连接。dh-backend 在 `r.Context().Done()` 时检测到前端断连，进入后台缓冲模式继续从 gatewayd 读取事件，但前端已无法收到结果。

## 解决方案

**方案 B：后端添加 SSE 心跳（自主可控）**

在 `apps/dh-backend/gateway/handler/agui.go` 的事件循环中增加心跳定时器，定期发送 SSE 注释（`: heartbeat\n\n`），保持连接活跃。

### 改动内容

1. **新增常量** `sseHeartbeatInterval = 15 * time.Second`（L33-36）：心跳间隔，远小于 APISIX 60s 超时，留足安全余量。

2. **创建心跳定时器**（L769-770）：在主事件循环前创建 `heartbeatTicker`，`defer` 确保清理。

3. **新增 select case**（L932-942）：在主 `select` 中增加 `case <-heartbeatTicker.C:` 分支：
   - 前端断连后跳过（`frontendDone` 检查）
   - 写入 `: heartbeat\n\n`（SSE 注释，EventSource 解析器自动忽略，不影响 AG-UI 事件流）
   - 立即 `Flush()` 确保数据到达客户端
   - 写入失败时记录日志

### 设计要点

- **SSE 注释格式**：`: heartbeat\n\n` 是 SSE 规范中的注释行，以 `:` 开头，EventSource 解析器自动忽略，不会产生 `MessageEvent`。
- **不干扰事件逻辑**：心跳不重置 `finishTimer` 或 `maxTimer`（这两个只由真实 AG-UI 事件重置），不影响 run 状态机。
- **不写入 buffer**：心跳是传输层保活，不是 AG-UI 事件，不追加到 SSE buffer。
- **前端断连后停止**：`frontendDone` 后不再发送心跳（断连后仅缓冲事件，无需保活）。
- **间隔选择**：15s 提供 4x 安全余量（APISIX 60s），即使经过多层代理也能覆盖。

### 配合运维措施

如条件允许，建议同时在 APISIX 路由配置中为 SSE 端点调整超时（方案 A）：

```json
{
  "uri": "/api/v1/agent",
  "upstream": { ... },
  "timeout": {
    "read": 600,
    "send": 600,
    "connect": 60
  }
}
```

双层保障：后端心跳（自主可控）+ APISIX 超时调整（需联系运维）。

## 验证结果

- `go vet ./...`（dh-backend）：0 warnings。
- `go build ./...`（dh-backend）：通过。
- `pnpm build`（全部 6 个包）：通过。
- 重启开发环境后 SSE 流正常，心跳定时器创建成功（无错误日志）。
- 快速响应场景（无静默期）心跳不触发，不影响正常事件流。
