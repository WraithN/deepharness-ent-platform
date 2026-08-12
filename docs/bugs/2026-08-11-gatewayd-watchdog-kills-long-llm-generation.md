# 2026-08-11 gatewayd 看门狗误杀 LLM 长生成导致工具重复执行、卡片永远"执行中"

## 现象

会话 `threadId=46001d13-3eb3-4ee1-9c30-0d0235b77629`（opencode session `ses_015dbe495ffeZbxcFwqygnWOEz`）的 comet classic 流程中，`bash`（`cat .comet/config.yaml ...`）工具卡片反复出现并长期停留在"执行中"：

- opencode DB 中该命令的 tool part 共 4 条（08-10 13:35、20:02、20:12，08-11 09:49），**全部永久 `status=running`、无结束时间**；
- 今天 run=`1786412959614-njalg80` 实测时间线：09:49:39 TOOL_CALL_START(bash) → 20 分钟零 SSE 事件 → 10:09:21 看门狗杀进程 → 10:09:23 resume 重放 → 10:12:07 RUN_FINISHED（总 22m47s），该 bash 卡片的 RESULT **从未到达** dh-backend；
- 命令本身实测 2ms 完成（三个 config.yaml 均为普通小文件），"一直在执行"与命令耗时无关。

## 根因

1. **主因：看门狗"静默即杀"误杀在途 LLM 长生成**。`opencode-plugin` 的 `watchdog_until_stalled` 只按无 SSE 事件时长判死（busy/retry 时抬升到 1800s 下限）。但 `session.status` 心跳本身也会中断（本次约 10 分钟后连心跳都没有了），阈值一到照样杀进程。已生成内容作废，resume 重放后 comet skill 要求重新解析语言配置（`SKILL.md` 输出语言规则），同一命令被重复执行——形成"执行 → 误杀 → 重放 → 再执行"的循环。昨天文档预警的"若 LLM 响应持续略超阈值，理论上会永远重试无法完成"成为现实。
2. **放大因素：孤儿工具调用不结算**。`apps/gatewayd/src/agui/mapper.rs` 的 `map_done`/`map_error` 直接清空未结算的 `pending_tool_call_ids`，前端卡片永远等不到 END/RESULT，即使 run 结束仍显示"执行中"。
3. **架构缺陷**：stall 检测逻辑只存在于 opencode-plugin（claude/codex 没有任何看门狗），且"静默"与"卡死"未区分——缺少插件无关的活性判定契约。

注：工具调用 ID 精确关联（`ProcessEvent::ToolUse/ToolResult.id` + agui mapper 按 id 配对）已在上一轮修复并生效（本次 skill 调用 START/RESULT id 匹配正常），不是本次复发的原因。

## 解决方案

改动全部在 `deepharness-ent-desktop` Rust 仓库，插件无关的整体方案：

### 1. agent-core：通用活性探针契约 + 共享看门狗（新模块）

- `crates/agent-core/src/instance.rs`：`AgentInstance` 新增 `liveness_probe()`，默认弱检查（`status()==Running`），有 HTTP/IPC 端点的插件应覆盖为真实探活。
- `crates/agent-core/src/process/watchdog.rs`（新增）：`wait_until_stalled()` 共享策略——静默超窗（`watchdog_timeout_secs`，dh-backend 推 600s，配置链路不变）后**先探活**：
  - 探活成功 → warn 日志（silent but alive）继续等待（LLM 长生成不再被杀）；
  - 探活失败/探针超时（5s）→ 判定卡死（`ProbeFailed`），走原有重启/resume 重试；
  - 静默总时长超硬上限 `MAX_SILENCE_CAP_SECS=3600` → 无论探活结果判死（`SilenceCapExceeded`），防止 LLM SDK 永久挂死但探活仍成功时 run 永不结束。

### 2. opencode-plugin：接入共享看门狗

- 覆盖 `liveness_probe`：子进程句柄存活检查 + `/health` HTTP 探活（双层超时）。
- `watchdog_until_stalled` 改为委托 `agent_core::process::watchdog::wait_until_stalled`。
- 移除 busy/retry 1800s 阈值下限（`stall_threshold_secs` 及 `BUSY_STALL_THRESHOLD_SECS`）——探活机制已覆盖该场景，双阈值只会延迟真卡死的发现；`session.status` 心跳刷新活跃时间戳的逻辑保留。
- 重启/resume 重试路径（`MAX_SEND_RETRIES=2`）不变。

### 3. gatewayd agui mapper：回合结束结算孤儿工具调用

- `map_done`/`map_error` 在清空关联状态前，为每个未结算 tool_call_id 补发 `ToolCallEnd` + `ToolCallResult`（内容标记 `[中断] 工具调用未返回结果（agent 重启或回合结束）`），前端卡片正常关闭。只依赖 mapper 自身状态，opencode/claude/codex 均受益。

### 验证结果

- `cargo test -p agent-core -p opencode-plugin -p dh-gatewayd` 全部通过（agent-core 35、dh-gatewayd 34+4、opencode-plugin 31；含看门狗探活策略 6 项新测试与孤儿结算 3 项新测试）；`cargo build -p dh-gatewayd` 0 warning。
- `scripts/restart-dev.sh` 重启全链路：dh-backend(8080)/frontend(8888)/crawler(8091) 正常；新 debug 二进制单独冒烟 `--port 12345` `/health` 返回 ok。gatewayd 按需由 dh-backend Manager 用新二进制拉起（`AGENT_PROVISIONER_DIRECT_HOST_GATEWAYD_BIN` 指向 `target/debug/dh-gatewayd`）。
- 待真实回归（需用户在前端操作）：重跑 comet 流程，预期 LLM 长生成期间 gatewayd 日志出现 `silent for ... but liveness probe OK; keep waiting` 而非 `agent stalled`，回合结束后工具卡片全部关闭。

### 后续项

- claude-plugin / codex-plugin 接入共享看门狗（两者当前无 stall 检测，claude 发送路径为 fire-and-forget，接入是独立需求）。
- opencode 自身将被 kill 的 part 永久置 `running`（上游行为，不再误杀后自然消失）。

## 关联文档

- `docs/bugs/2026-08-10-comet-tool-call-fifo-mismatch.md`（FIFO ID 错配 + 600s 看门狗误杀，本轮的 ID 关联修复已生效）
- `docs/bugs/2026-08-10-comet-intent-frame-stall.md`（120s → 600s 阈值调整，dh-backend 侧）
