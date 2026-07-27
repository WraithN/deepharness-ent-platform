# 2026-07-24-req-breakdown-card-not-detected-and-reasoning-text-mixed-with-output

## 现象

在前端会话消息中，执行 `/req-breakdown` 等命令时：

1. 助手输出的英文内部独白（如 `Part 2 done. Now R-1.3...`、`Good progress...`、`Now let me verify...`）被直接渲染在“用户输出”区域，与正式回复混排。
2. 模型把 `[[CARD:req_breakdown]]` 标记放在内部独白文本流中，前端只从最终输出文本里检测卡片标记，导致需求拆分卡片无法被触发，卡片显示“暂无数据”。
3. 生成过程中卡片提前出现（`isRunning` 控制已存在，但标记检测失败导致无数据）。

## 根因

1. **Gatewayd 事件模型兼容**：`gatewayd` 本身已支持 `agent.thinking` → `ThinkingTextMessageStart/Content/End` 与 `agent.token` → `TextMessageStart/Content` 的交替结构；但 `opencode` 模型把内部英文独白作为普通 `text` delta 下发，没有走 `thinking` 事件。
2. **前端检测范围过窄**：`AssistantMessage.tsx` 中 `cardTypes` 与 `useRequirementBreakdownData` 使用的 `textContent` 只包含被判定为“用户输出”的 `text` 部件，排除了被识别为推理的文本，导致放在独白里的标记丢失。
3. **缺少兜底**：用于检测卡牌的完整文本 `allTextContent` 已计算，但未被使用。

## 解决方案

1. 在 `apps/dh-frontend/src/components/chat/AssistantMessage.tsx` 中：
   - 将 `cardTypes` 的检测从 `textContent` 改为 `allTextContent`，确保即使 `[[CARD:req_breakdown]]` 出现在内部独白中也能被识别。
   - 将 `useRequirementBreakdownData` 的入参从 `textContent` 改为 `allTextContent`，用于内联 JSON 的兜底解析。
   - 保留 `FILE`/`PROJECT` 标记从所有 `text` 部件提前提取，避免被折叠后丢失附件路径。
   - 把 `isLikelyReasoningText` 从默认启用改为**条件兜底**：仅在 `agentPluginKey === 'codex'` 或当前消息没有任何 `reasoning` 部件时才启用。这样 OpenCode / Claude 一旦正确输出 `reasoning` 事件，就完全走事件类型，不再靠内容猜测；Codex 作为新补齐 reasoning 解析的插件保留兜底，同时任意 agent 若未输出 reasoning 部件也保留兜底。
2. 通过 `ChatThread` 把 `activePluginKey` 从 `pages/Chat.tsx` 透传给 `AssistantMessage`。
3. 在 `deepharness-ent-desktop` 的 `crates/codex-plugin/src/parser.rs` 中补齐 Codex reasoning 事件解析（`item/reasoning/summaryTextDelta`、`item/reasoning/textDelta`、`item/completed` 中 `type: "reasoning"` 等），映射为 `ProcessEvent::Thinking`。
4. 构建与重启：
   - `pnpm --filter @repo/dh-frontend check-types` 通过。
   - `pnpm build` 全量构建成功。
   - `bash scripts/restart-dev.sh` 重启所有服务（Gatewayd、Personal Stub、DH Backend、Frontend）。
   - `cargo test -p codex-plugin` 与 `cargo build --release -p dh-gatewayd` 在 desktop 工程成功。

## 验证

请在前端重新测试 `/req-breakdown 登录功能`，确认：

1. 英文内部独白被折叠进“思考过程”卡片（默认折叠）。
2. 用户输出区域不再显示重复的英文独白和 `[[CARD:...]]` 标记。
3. 生成完成后出现“需求拆分”卡片，并正确加载 JSON 数据。

> 注意：后端原有测试 `config/tests` 和 `gateway/handler/tests` 存在两个与本次改动无关的失败（配置默认值与 workspaceId 缺失），未在本次修复范围内处理。
