# 2026-08-10 智能会话输出文本折叠按钮始终显示且点击无效

## 现象

智能会话中，助手消息的输出文本底部始终显示"展开全部 / 收起"折叠按钮，即使可见内容很短（远不足一屏）也会出现；点击按钮后界面无任何变化，看似无效。

## 根因

`apps/dh-frontend/src/components/chat/AssistantMessage.tsx` 中折叠按钮的显隐判断存在三层叠加问题：

1. **判定依据与真实渲染内容不一致（主因）**：`shouldCollapseText` 统计的是未剥离标记的原始文本 `textContent`（超过 12 行或 800 字符即判定需要折叠）。agent 消息几乎必带 `[[PROJECT:…]]`/`[[FILE:…]]` 标记，长路径占大量字符，且多段 text part 用 `join('\n')` 人为抬高行数；而渲染时这些标记被 `stripAllMarkers` 删除。结果：可见内容很短，原始文本却超阈值 → 按钮总是显示。
2. **折叠是纯 CSS 截断**：折叠态只是 `max-height: 215px; overflow: hidden`。可见内容实际高度不足 215px 时，切换 `textExpanded` 只是换一个无视觉效果的类名 → 点击看起来"无效"。
3. **流式期间状态不一致**：`isStreaming` 时 `showCollapsed` 恒为 false（内容完整展开），但按钮仍照常渲染；点击翻转 `textExpanded` 对折叠毫无影响 → 点击无效。另有卡片类消息强制 `textExpanded=true`，按钮显示"收起"但内容从未折叠过。

## 解决方案

将折叠判定从"原始文本长度"改为"渲染后真实高度"：

- 在输出文本容器内新增不做 `max-height` 截断的测量节点（`textContentRef`），`scrollHeight` 恒为完整内容高度；
- `useLayoutEffect` + `ResizeObserver` 测量内容高度，超过 `TEXT_COLLAPSE_MAX_HEIGHT_PX`（215px，与 `index.css` 中 `.chat-bubble-text-closed` 的 `max-height` 保持一致）才认为内容可折叠，同时覆盖图片/Mermaid 等异步渲染与流式增长导致的高度变化；
- 折叠按钮显隐条件改为 `textOverflows && !isStreaming`：没有可折叠内容（高度不足 215px）时不显示按钮；流式输出期间内容完整展开，也不显示按钮；
- `showCollapsed` 同步改为基于 `textOverflows`，保证按钮显隐与折叠效果始终一致；
- 移除原有的 `TEXT_COLLAPSE_LINE_THRESHOLD` / `TEXT_COLLAPSE_CHAR_THRESHOLD` 字符串阈值常量。

## 验证

- `tsc --noEmit -p apps/dh-frontend/tsconfig.check.json`：`AssistantMessage.tsx` 无新增 error（存量的 6 个 error 位于 `MarkdownView.tsx`/`MessageMarkers.tsx`，与本次改动无关）；
- `pnpm --filter @repo/dh-frontend build` 构建通过；
- 短回复消息不再出现折叠按钮；长文本消息（>215px）正常显示"展开全部"，点击展开后显示"收起"，再点击可正常折叠。
