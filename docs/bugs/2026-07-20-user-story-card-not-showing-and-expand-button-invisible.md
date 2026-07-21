# 2026-07-20 用户故事卡片未展示 & 展开按钮几乎不可见

## 现象

1. A+B 卡片系统改造后，通过 `[[CARD:user_story]]` 标记自动生成的用户故事卡片在 SSE 流式输出时没有展示
2. 卡片右下角的展开/关闭按钮（Eye 图标）与背景对比度太低，几乎看不到

## 根因

1. **卡片未展示**：`parseUserStoryFromText` 函数依赖 `filePath` 参数（取自 `[[FILE:...]]` 标记）来提取卡片标题。而在 SSE 流式阶段，当 `[[CARD:user_story]]` 标记已输出但文件路径中的中文占位符（如「需求名称」）尚未被 Agent 替换为实际值时，`fileAttachments` 数组为空，导致 `parseUserStoryFromText` 收到空字符串作为 `filePath`，直接返回 `null`，卡片不渲染。

2. **按钮不可见**：展开按钮使用 `bg-muted text-muted-foreground` 样式组合，在卡片的点状背景（`radial-gradient`）上对比度极低，hover 态也不够明显。

## 解决方案

1. **卡片标题提取增加降级逻辑**（`UserStoryCard.tsx:27-48`）：
   - 优先从文件路径 `filePath` 中匹配 `stories/(.+?)-user-stories.md$` 提取标题
   - 若未获取到标题，尝试从文本内容中匹配 Markdown 一级标题（`^# `）
   - 若仍未获取到，尝试匹配 `**需求名称：xxx**` 模式
   - 移除最后的 `return null` 提前返回（`!title return null`），允许无标题时仍生成卡片（stories 默认取前几行）

2. **展开按钮样式增强**（`UserStoryCard.tsx:168`）：
   - 背景从 `bg-muted` 改为 `bg-card`
   - 文字从 `text-muted-foreground` 改为 `text-foreground/70`
   - 增加 `border border-border` 边框和 `shadow-sm` 阴影
   - hover 态增加 `border-primary/40`，使交互更明显
