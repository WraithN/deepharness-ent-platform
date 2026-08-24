# /prd-analysis 卡在「正在进行竞品信息分析」——opencode 僵尸 session 恢复后空 run

## 现象

执行 `/prd-analysis` 后，前端持续停留在合成提示「正在进行竞品信息分析，可能需要一些时间，请稍候...」，无任何 agent 输出、无工具调用，但实际 run 在 1~2 秒内就「结束」了（前端收到 `RUN_FINISHED` 却没有文本/工具事件）。

## 全链路排查

| 层 | 现象 | 结论 |
|----|------|------|
| dh-backend | 正确渲染指令模板（4345 字符，含完整 `/prd-analysis` 模板 + 4 个 URL），`POST CHAT` 200，SSE `RUN_STARTED`→`RUN_FINISHED` 仅 1.9s | 正常 |
| gatewayd | `crawler MCP server loaded from backend` 成功；但 `resuming persisted session=ses_004cec43cffeLuxhDRI86eR2TP` 后 1.5s 即 `session.idle`→`agent.done` | 正常加载工具，但 run 空转 |
| opencode | `loop session.id=... step=0` 后立即 `exiting loop`，**无 `process`/`stream` 步骤** | **根因所在** |
| 前端 | 收到 `RUN_FINISHED` 但无任何文本，thinking 提示不消失 | 被动表现 |

### 关键证据

1. opencode 日志（`~/.local/share/opencode/log/opencode.log`）：
   ```
   loop session.id=ses_004cec43cffeLuxhDRI86eR2TP step=0
   exiting loop
   ```
   正常 run 应有 `tracking`→`process`→`stream providerID=...`，此 run 在 step=0 直接退出。

2. opencode.db 中该 session（`ses_004cec43cffeLuxhDRI86eR2TP`，标题「操作日志审计需求澄清与文档草案」）：
   - 08-13 正常对话（7 轮 user/assistant 交替）
   - 08-19 起连续 7 条 user 消息**均无 assistant 回复**

3. 直接 `curl POST /session/ses_004cec43cffeLuxhDRI86eR2TP/message` 复现：返回的是 **08-13 的旧 assistant 消息**（`info.time.created=1786625932847`，内容「需求已澄清，需求设计文档草案已生成...」），而非对新消息的回复。

## 根因

gatewayd 的 session resume 机制（`persist_agent_session_id`/`load_agent_session_id`）会把 opencode 侧的 session id 持久化到 `~/.dh-gatewayd/sessions.json` 的 `agent_session_id` 字段。实例被 reap 后重建时，通过该 id 恢复 opencode 会话以延续上下文。

当这个 opencode session 因版本升级/数据异常变成「僵尸 session」后：
1. opencode 恢复该 session，`loop step=0` 即退出，不 process 新消息；
2. `POST /session/{id}/message` 返回历史最后一条 assistant 消息（旧回复）；
3. gatewayd 收到 SSE `session.idle`，`mapper.rs` 将其映射为 `ProcessEvent::Done`，emit `agent.done`；
4. 前端收到 `RUN_FINISHED` 却无任何输出，thinking 提示滞留。

由于 `send_with_watchdog_retry` 只在 HTTP 错误/看门狗卡死时重试，无法识别「HTTP 200 但返回旧消息」的空 run，故僵尸 session 一直无法自愈。

## 解决方案

### 治本：gatewayd 检测空 run，自动重建 session

`crates/opencode-plugin/src/instance.rs`：
- 新增 `is_stale_reply(value, sent_at_ms)`：解析 opencode 响应的 `info.time.created`，若早于发送时间 `STALE_REPLY_TOLERANCE_MS`（60s）则判定为空 run（僵尸 session 回显旧消息）。
- `send_message` 记录 `sent_at_ms = now_millis()` 并传入 `send_with_watchdog_retry`。
- `send_with_watchdog_retry` 的 `Ok(value)` 分支：若 `is_stale_reply` 且未超重试上限，则 `create_opencode_session()` 新建 session（不复用僵尸 session）、更新 `session_map` 与 `last_session_id`，重试发送。

### 治标：清除当前僵尸 session 的持久化映射

手动清除 `~/.dh-gatewayd/sessions.json` 中 `bcc7fd96-836b-44e8-8c7e-16086add8f87` 的 `agent_session_id`，使该会话下次新建 opencode session。

### 影响文件

- `deepharness-ent-desktop/crates/opencode-plugin/src/instance.rs` —— 空 run 检测 + 自动重建 session

## 验证结果

- `cargo build -p dh-gatewayd` 通过。
- 重启后 gatewayd 日志：`crawler MCP server loaded from backend: http://127.0.0.1:8091/mcp`、`loaded 237 persisted sessions`。
- `sessions.json` 中目标会话 `agent_session_id = None`（清除生效，重启未被覆盖）。
- 修复后用户重新执行 `/prd-analysis` 将新建 opencode session 正常处理；若未来再次出现僵尸 session，空 run 检测会自动重建，不再静默空转。
