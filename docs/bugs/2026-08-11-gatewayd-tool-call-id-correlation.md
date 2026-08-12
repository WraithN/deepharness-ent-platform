# 2026-08-11 gatewayd 工具调用 ID 精确关联与看门狗 LLM 生成识别（opencode/claude/codex）

## 现象

- comet 流程中前端工具卡片长期"执行中"、结果张冠李戴（bash 卡片填入 skill/read 的结果），秒级命令的卡片 20 分钟后才关闭。详见 `docs/bugs/2026-08-10-comet-tool-call-fifo-mismatch.md`。
- comet 长 LLM 生成（单次 >10 分钟无 SSE 事件）被看门狗 600s 阈值误判为进程卡死，杀掉 opencode 重启后已生成内容作废重试，延迟翻倍。
- comet 需求澄清提问的参考选项（question 工具 options）到前端丢失，提问卡片只剩输入框。

## 根因

1. **工具调用 id 全链路丢失**：`ProcessEvent::ToolUse`/`ToolResult`（`crates/agent-core/src/process/event.rs`）没有 id 字段；opencode 的 `callID`、claude 的 `toolu_*`/`tool_use_id`、codex 的 `item.id` 在各自插件 mapper 中被丢弃；`EventMapper` 发出的 payload `id` 是常量 `thinking-{instance}`。gatewayd `AguiMapper` 的 `tool_call_id_map` 精确关联因此永不命中，永远走 `pending_tool_call_ids.first()` FIFO 兜底，并行/重放场景必然错配。
2. **看门狗不区分生成与卡死**：`watchdog_until_stalled` 只看 `last_event_at`，而 opencode 的 `session.status`（busy/retry/idle）事件未被利用，LLM 长生成的静默期与进程真卡死在事件流上同构。
3. **question options 被压缩丢弃**：`parse_question` 把每个问题压成 `{id, text}`，options 数组整体丢弃。
4. **附加 bug**：`AguiMapper.map_done` 在 MessageEnd 时也清空工具调用关联状态，而 claude 工具循环恰是 tool_use → message_stop → tool_result 跨消息的，关联被提前清掉。

## 解决方案

改动均在 `deepharness-ent-desktop` 仓库（Rust），本仓库无代码改动：

1. **id 精确关联**：
   - `agent-core`：`ToolUse`/`ToolResult` 增加 `id: Option<String>`（serde 兼容旧格式）；`EventMapper` 载荷补 `toolName` 与真实 `id`（ToolUse）/`tool_use_id`（ToolResult），为 None 时保留原占位字段。
   - opencode-plugin：提取 `part.callID`（兜底 `part.id`）；claude-plugin：content block `id`/`tool_use_id` 全链路透传；codex-plugin：`item/started` 与 `item/completed` 的 `item.id`。
   - gatewayd `AguiMapper`：`map_done` 拆分出 `map_message_end`，仅 Done（回合结束）清空关联状态，MessageEnd 保留 → claude 跨消息工具循环可精确关联；FIFO 兜底逻辑保留作为最后防线。
2. **看门狗双阈值**：opencode-plugin relay loop 跟踪 `session.status`（busy/retry/idle）并刷新活跃时间；`watchdog_until_stalled` 经纯函数 `stall_threshold_secs` 每轮重算阈值——busy/retry 取 `max(配置阈值, BUSY_STALL_THRESHOLD_SECS=1800)`，否则用配置阈值（600s）。LLM 长生成不再被误杀，进程真卡死仍会被发现。
3. **question options 透传**：`QuestionItem` 增加 `options`（label + description），opencode `parse_question` 保留 options，经 `agent.question` 载荷直达前端；前端提问卡片原有 `q.options` 渲染逻辑直接生效。

## 验证

- `cargo build -p dh-gatewayd` 通过；`cargo test -p agent-core -p opencode-plugin -p claude-plugin -p codex-plugin -p dh-gatewayd` 119 个测试全绿；clippy 改动文件 0 warning。
- 新增关键测试：`test_parallel_tool_results_correlate_by_call_id`（并行工具结果逆序返回仍正确配对）、`test_message_end_preserves_tool_call_correlation`（claude 跨消息关联）、`test_stall_threshold_*`（busy/retry 抬升阈值，idle/未知用配置阈值）、`test_parse_question_preserves_options`。
- 端到端验证：重启全链路后发起 comet 流程会话，观察工具卡片状态与结果对应关系、长生成期间不再出现 600s stalled 重启。

## 关联文档

- `docs/bugs/2026-08-10-comet-tool-call-fifo-mismatch.md`（问题定位）
- `docs/bugs/2026-08-10-comet-intent-frame-stall.md`（看门狗 120s → 600s 前序修复）
- `docs/bugs/2026-08-11-comet-question-format-fixes.md`（提问规范与中文配置，本仓库侧配套修复）
