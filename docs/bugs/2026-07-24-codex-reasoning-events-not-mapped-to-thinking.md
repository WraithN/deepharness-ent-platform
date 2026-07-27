# 2026-07-24-codex-reasoning-events-not-mapped-to-thinking

## 现象

在 `deepharness-ent-desktop` 的 `dh-gatewayd` 中，Codex app-server 事件流里的 reasoning 内容没有被识别：

- `item/reasoning/summaryTextDelta`（可读推理摘要）
- `item/reasoning/textDelta`（原始推理文本）
- `item/completed` 中 `type: "reasoning"` 的完整推理项

这些事件被直接丢弃，导致使用 Codex 时前端看不到独立的“思考过程”，只能把可能的英文独白混在最终文本中展示。

## 根因

`crates/codex-plugin/src/parser.rs` 只解析了 `item/agentMessage/delta`、工具调用和 `turn/completed` 等事件，没有处理 Codex app-server 协议中的 reasoning 系列通知，也没有从已完成的 `reasoning` item 中提取 `summary`/`content`。

## 解决方案

在 `deepharness-ent-desktop` 工程中：

1. `crates/codex-plugin/src/constants.rs`：新增 Codex app-server 方法名、item 类型和 JSON key 常量，避免魔法字符串。
2. `crates/codex-plugin/src/parser.rs`：
   - 增加 `extract_delta_text` 辅助函数，统一解析 `{"delta":{"text":"..."}}` 和 `{"delta":"..."}` 两种形状。
   - 处理 `item/reasoning/summaryTextDelta` 和 `item/reasoning/textDelta`，映射为 `ProcessEvent::Thinking`。
   - `item/reasoning/summaryPartAdded` 为边界标记，不产生事件。
   - 在 `item/completed` 中识别 `type: "reasoning"`，优先取 `summary`、兜底取 `content`，映射为 `ProcessEvent::Thinking`。
   - 其余工具调用、agent message 等分支改用常量替代魔法字符串。
   - 新增 5 个单测覆盖 reasoning 解析。
3. 构建并重启：
   - `cargo test -p codex-plugin` 全部通过（10 个测试）。
   - `cargo build --release -p dh-gatewayd` 构建成功。
   - 在 `deepharness-ent-platform` 执行 `bash scripts/restart-dev.sh` 重新加载新的 gatewayd 二进制。

## 验证

- 使用 Codex 运行时，reasoning 流会经 gatewayd 转成 `agent.thinking` → 前端 `reasoning` 部件，折叠在“思考过程”卡片中。
- 当前 OpenCode 仍然是默认 agent；如果 OpenCode 的英文独白仍作为 `text` delta 下发，前端 `isLikelyReasoningText` 启发式仍起兜底作用。
- 建议后续模型/协议能严格区分 thinking/text 时，再移除前端启发式。

## 相关文件

- `deepharness-ent-desktop/crates/codex-plugin/src/constants.rs`
- `deepharness-ent-desktop/crates/codex-plugin/src/parser.rs`
