# agent.question 内联提问卡片展示过长且点击选项不关闭

## 现象
智能会话中 agent 发起 `agent.question` 后，输入框上方的内联提问卡片：
1. 高度随 agent 的推理过程无限增长，把输入框区域挤得非常高。
2. 卡片中把 agent 的完整思考过程（任务卡片关键信息、推理维度、调整说明等）全部展示出来，而不是只展示最终问题和选项。
3. 点击选项后卡片没有立即关闭，用户视觉上仍然停留在提问卡片，必须等待后端响应才消失。

## 根因
1. 内联提问卡片没有限制最大高度，也没有滚动区域。
2. 解析问题时把选项前所有非选项文本都当作问题正文，导致推理过程被当作问题展示。
3. `respondToQuestion` 在调用 `/v1/agent/respond` 成功后才 `setPendingQuestion(null)`，网络请求期间 UI 不关闭。

## 解决方案
### 前端 UI（`apps/dh-frontend/src/pages/Chat.tsx`）
1. 给内联提问卡片增加 `max-h-[400px] overflow-y-auto`，限制高度并支持滚动。
2. 重写 `parseInlineOptions`：只提取最后一个以 `?`/`？` 结尾的问题段落，过滤掉前面的推理过程。
3. 卡片继续以内联形式展示在输入框上方，保持原有样式（`bg-amber-50/50 dark:bg-amber-950/20` 等）。

### 交互逻辑（`apps/dh-frontend/src/hooks/use-ag-ui-chat.ts`）
在 `respondToQuestion` 中：
- 先保存当前 `pendingQuestion` 引用，然后立即 `setPendingQuestion(null)` 关闭卡片，再发送 API 请求。
- 失败时 toast 提示并 `cancelRun()`，成功时按原有 fallback 逻辑继续 run。

## 验证结果
- `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 0 错误。
- `pnpm build` 全部成功。
- 重启开发服务后前后端访问正常：前端 200、后端 `/health` 200。
- 由于当前环境未安装 Chromium，无法直接截图，需用户在会话中触发 `agent.question` 后验证卡片高度、问题文本及点击关闭行为。
