# 2026-07-20-user-story-card-title-and-summary-fix

## 现象

在使用 `/user-story` 指令生成用户故事时，聊天消息出现以下显示问题：

1. **文本内容被截断**：助手输出的用户故事文本默认折叠，需要点击"展开全部"才能看到完整内容，给用户"内容没有输出完整"的观感。
2. **用户故事卡片没有标题**：卡片顶部原本应展示标题的位置为空，与工程卡片、文件附件卡片等统一带标题的卡片风格不一致。
3. **卡片摘要统计不正确**：卡片只显示 `P0 × 1` / `总计 1条`，但实际文本中包含 `US-001`、`US-002` 等多条用户故事条目，统计摘要明显不对。

## 根因

1. **标题提取逻辑缺失兜底**：`UserStoryCard.tsx` 中的 `parseUserStoryFromText` 只尝试从文件路径、Markdown 一级标题或 `**需求名称：...**` 中提取标题，当前模型输出中不存在这些标记时，标题保持为空。
2. **故事解析格式单一**：解析函数仅按 `作为` 分割并匹配"作为...，我希望...，以便..."的严格格式。实际模型输出常以 `US-001: 创建营销活动...` 这类编号条目呈现，导致大量故事未被识别，最终落入兜底逻辑，只生成一条汇总故事。
3. **AI 思考过程混入正文**：模型输出中夹杂 "Let me..."、"I need to..." 等规划性语句，干扰了格式识别与摘要统计。
4. **文本默认折叠**：`AssistantMessage.tsx` 中对所有长文本统一折叠，没有针对已生成用户故事卡片的消息做默认展开处理。

## 解决方案

1. **完善标题提取**：在 `UserStoryCard.tsx` 中新增 `extractTitle`，按以下优先级获取标题：
   - 文件路径 `stories/需求名-user-stories.md`
   - Markdown 一级标题 `# 标题`
   - `**需求名称：...**`
   - 兜底默认标题 `用户故事`
2. **扩展故事解析格式**：在 `UserStoryCard.tsx` 中将解析拆分为独立小函数：
   - `parseAsStories`：识别"作为...，我希望...，以便..."格式。
   - `parseUsCodeStories`：识别 `US-xxx` / `US_xxx` 编号条目。
   - `createFallbackStory`：兜底生成一条汇总故事。
   同时新增 `cleanStoryText` 清理 `[[FILE:...]]`、`[[PROJECT:...]]`、`[[CARD:...]]` 标记以及 AI 思考过程语句。
3. **默认展开用户故事文本**：在 `AssistantMessage.tsx` 中检测到 `hasUserStoryFromMarker` 或 `hasUserStoryFromLegacy` 时，通过 `useEffect` 将 `textExpanded` 置为 `true`，让完整文本直接展示。
4. **修复 lint 报错**：顺手将 `use-ag-ui-chat.ts` 中 `tsgo` 不支持的 `.at(-1)` 替换为 `userMessages[userMessages.length - 1]`，保证 `pnpm lint` 零错误。

## 验证结果

- `pnpm check-types`：全部通过。
- `pnpm lint`：全部通过（`ast-grep` 环境缺失警告与代码无关）。
- `pnpm build`：全部通过。
- `pnpm --filter @repo/dh-backend dev` + `pnpm --filter @repo/dh-frontend dev`：前后端服务正常启动，后端 `/health` 返回 `{"status":"ok"}`，前端 `http://localhost:8888/` 返回 200。

## 涉及文件

- `apps/dh-frontend/src/components/chat/UserStoryCard.tsx`
- `apps/dh-frontend/src/components/chat/AssistantMessage.tsx`
- `apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`
