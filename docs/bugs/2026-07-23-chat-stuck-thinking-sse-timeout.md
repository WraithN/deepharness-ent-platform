# 2026-07-23 会话长任务卡在"思考中"且最终结果丢失

## 现象

用户在智能会话中发送 `/prd-write`（引用需求 req-001）后，前端一直停留在"思考中 · 工具调用 0 次"，超过 10 分钟无任何输出。实际上 agent（opencode）最终在 09:21 完成了 PRD 并写入工作区文件，但用户在前端永远看不到这条回复：dh-backend 的 messages 存储中没有该 assistant 消息，切回会话也什么都看不到。

## 根因

完整事件链（09:00:05 – 09:21）：

1. dh-backend 收到请求后经 gatewayd 正常启动 run，前端收到 `RUN_STARTED` 进入"思考中"。
2. **opencode serve 冷启动极慢**（其 `opencode.db` 已达 1.88GB，首次请求需长时间 bootstrap），约 10 分钟内不产生任何事件。
3. 静默期间多处超时/缺陷同时引爆：
   - **gatewayd SSE 流完全静默**：gatewayd 只在有 AG-UI 事件时写流，从不发送 keepalive，下游无法区分"慢"与"死"。
   - **dh-backend `SSE_IDLE_TIMEOUT = 10min`**（`apps/dh-backend/agent/client/agui_client.go`）：09:10:06 判定流挂死，主动断开，run 后续事件全部丢失，assistant 回复未能持久化。
   - **dh-backend `maxRunDuration = 10min`**（`apps/dh-backend/gateway/handler/agui.go`）：总时长硬顶，长任务（PRD/原型生成普遍超过 10 分钟）必然被截断。
   - **gatewayd reqwest 全局 600s 超时**：`POST /session/{id}/message` 在 opencode 侧会阻塞到整个 run 结束，600s 超时中止 POST 导致 opencode 服务端 run 被取消；随后的 `reset_and_restart` 把正常工作的 opencode 进程 SIGKILL 并重跑整条消息（双倍 LLM 成本，结果险些丢失）。
   - **gatewayd session 回收器只看最后用户输入时间**：`DEFAULT_EXPIRED_TIME_SECS = 600`，run 进行中照样可能把 agent 进程当闲置回收。
   - **gatewayd 拉起 opencode 时 stdout/stderr 管道无人消费**：pipe 缓冲（64KB）写满后子进程阻塞在 write()，端口开着但服务冻结。
   - **gatewayd 健康检查复用 600s 超时的 HTTP client**：一次挂起的探测可让启动重试循环卡 10 分钟。
   - **gatewayd 日志为空**：`EnvFilter::from_default_env()` 在 `RUST_LOG` 未设置时只放行 ERROR，导致线上 0 日志、无法排查。

## 解决方案

### dh-backend（本仓库）
- `agent/client/agui_client.go`：`SSE_IDLE_TIMEOUT` 10min → 30min（覆盖合法长静默）；`runRequestTimeout` 12min → 35min（大于 `maxRunDuration`，让优雅超时先触发）。
- `gateway/handler/agui.go`：`maxRunDuration` 10min → 30min；`finishWait` 5min → 10min（覆盖模型长思考无事件输出）。

### gatewayd（deepharness-ent-desktop 仓库）
- `apps/gatewayd/src/handlers/sse.rs`：SSE 响应增加 15s keepalive（`: ping`），静默期下游不再误判挂死；`start_run` 失败时向 session 广播 `RUN_ERROR` 终结事件，客户端立即感知失败而不是干等。
- `apps/gatewayd/src/session.rs`：`Session` 新增 `run_active` 标志，`is_expired()` 在 run 进行中返回 false，回收器不再杀进行中的 run。
- `crates/opencode-plugin/src/transport.rs`：子进程 stdout/stderr 后台 drain，消除管道写满死锁；`DEFAULT_TIMEOUT_SECS` 600 → 1800（message POST 本来就按整个 run 时长阻塞）；health_check 使用 2s 独立超时，挂起的探测快速失败。
- `apps/gatewayd/src/main.rs`：日志过滤器未设 `RUST_LOG` 时默认 `info`，恢复可观测性。

### 验证
- `cargo build -p dh-gatewayd -p opencode-plugin`：0 warnings。
- `go build ./... && go vet`（dh-backend）：通过。
- 重启开发环境后全链路验证见本文档末尾"验证结果"。

## 遗留建议（非代码）

- opencode 数据目录（`~/.local/share/opencode/opencode.db` 1.88GB + 95MB WAL）导致冷启动约 10 分钟，建议定期清理/归档历史数据，或升级 opencode 版本观察启动性能。
