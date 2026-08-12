# 2026-08-10 comet 工具调用长时间"执行中"且结果张冠李戴（FIFO ID 错配 + 600s 看门狗重启）

## 现象

会话 `run=1786363332051-7gu4ov3` 处理 comet classic 流程需求时，前端两个 `bash`（`cat .comet/config.yaml`）工具卡片长时间停留在"执行中"（约 20 分钟），整体 run 耗时 21 分钟以上。日志还显示工具结果与调用张冠李戴：`tool=bash` 的 START 最后填进去的 RESULT 内容是 `<skill_content name="openspec-explore">`、`read` 文件路径等其它工具的结果。

## 根因

### 1. 主因：LLM 单次响应超过 10 分钟无事件，传输链路本身无固有延迟

gatewayd 日志（`/tmp/gatewayd-a0564de55589467d935d797611963493.log`）时间线：

- 20:02:25 最后一个 SSE 事件（bash 工具 part running），随后**完全静默**；
- 20:12:31 watchdog 判定 `agent stalled: no SSE events for 600s`，杀掉 opencode 进程并重启 resume；
- 20:12:44 事件恢复流动（同一逻辑步骤重新生成），随后再次静默；
- 20:22:48 第二次 600s stall，重启；20:22:50 之后事件恢复，run 最终完成。

两次静默都发生在工具结果提交给 LLM 之后、下一个 assistant 事件之前，即 **opencode 在等待 LLM API 响应**（comet classic 流程上下文大、生成量大的长推理）。平台传输链路（gatewayd 串行 broadcast、dh-backend 逐事件 Flush、双端 15s 心跳）逐事件即时转发，不是延迟来源。

### 2. 放大因素：600s 看门狗杀掉在途 LLM 生成

看门狗已在 `docs/bugs/2026-08-10-comet-intent-frame-stall.md` 中从 120s 调到 600s（dh-backend 默认 timeout），本次日志确认 gatewayd 已收到 `watchdog timeout updated: 120s -> 600s`。但 LLM 单次响应超过 600s 时，看门狗仍然误杀：已生成的内容被作废，resume 后重新生成，两轮浪费约 20 分钟。若 LLM 响应持续略超 600s，理论上会永远重试无法完成。

### 3. 显示层 bug：gatewayd 工具结果用 FIFO 关联，并行/重放时 ID 错配

- `crates/opencode-plugin/src/mapper.rs` 的 `map_tool_use_part` 丢弃了 opencode part 自带的 `id`/`callID`，`ProcessEvent::ToolUse`/`ToolResult`（`crates/agent-core/src/process/event.rs`）根本没有 id 字段；
- `apps/gatewayd/src/agui/mapper.rs` 的 `map_tool_result` 在 payload 无 `tool_use_id` 时取 `pending_tool_call_ids.first()`（最早未结算的 START）兜底。

看门狗重启后 opencode 重放历史 part，一批 RESULT 集中到达，按 FIFO 依次领走最早的 START ID → 结果与工具完全错配。秒级完成的 `cat .comet/config.yaml` 卡片要等 20 分钟后才被（别人的）RESULT 关闭，前端表现为长期"执行中"。

dh-backend 日志实证（`/tmp/dh-backend.log`）：

- `TOOL_CALL_START id=6f7f743c tool=bash`（20:02:25）→ 20:22:59 收到的 RESULT 内容是 `<skill_content name="openspec-explore">`；
- `TOOL_CALL_START id=be975b29 tool=bash`（20:12:44）→ RESULT 内容是 `read` 的 `<path>DESIGN.md</path>`；
- `TOOL_CALL_START id=51b6a777 tool=skill`（20:22:58）→ RESULT 内容是另一个 `read` 的文件路径。

## 解决方案

### 已确认的诊断结论

- "慢"的主体是 LLM API 响应时长（单次 >10 分钟），属模型侧/上下文规模问题，平台传输链路无固有缓冲延迟；
- 平台侧两个可修的问题：看门狗策略与 FIFO ID 错配。

### 待实施（需修改 deepharness-ent-desktop Rust 仓库，本次未改）

1. **工具调用精确关联**：`opencode-plugin` mapper 透传 part `id`/`callID`，`ProcessEvent::ToolUse`/`ToolResult` 增加 id 字段，gatewayd agui mapper 按 id 精确配对，FIFO 仅作最后兜底。
2. **看门狗策略改进**：区分"agent 进程无响应"与"LLM 生成/工具执行中但无事件"——例如有未结算工具调用或上一步刚提交 LLM 请求时使用更长的阈值，或彻底依赖 opencode 侧心跳事件（需 opencode 支持）。
3. **模型侧**：comet classic 流程单步生成量过大时考虑拆分生成任务或换用更快模型，降低单次响应时长到看门狗阈值以内。

## 相关日志

- `/tmp/gatewayd-a0564de55589467d935d797611963493.log`：搜 `agent stalled: no SSE events for 600s`（20:12:31、20:22:48 各一次）。
- `/tmp/dh-backend.log`：搜 `run=1786363332051-7gu4ov3`，可见 TOOL_CALL_START/RESULT 的 ID 错配。

## 关联文档

- `docs/bugs/2026-08-10-comet-intent-frame-stall.md`（120s → 600s 看门狗阈值调整）
