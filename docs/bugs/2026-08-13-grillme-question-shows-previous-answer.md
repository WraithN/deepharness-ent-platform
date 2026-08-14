# /grill-me 连续提问时问题弹层展示上个问题答案

## 现象
用户执行 `/grill-me` 需求澄清流程，经过几次 question 提问后，新弹出的问题卡片（内联提问弹层）展示了**上一个问题的答案**（或 agent 复述的上个回答内容），而非当前问题。

## 根因
前端提问弹层渲染时（`apps/dh-frontend/src/pages/Chat.tsx` 内联提问卡片），问题文本的取值优先级错误：

```tsx
const displayQuestionText = parsedQuestionText || q.question || q.text || '需要你的输入';
```

其中 `parsedQuestionText` 通过 `parseInlineOptions(assistantText)` 从**最近一条 assistant 消息文本**解析得到，优先级高于 `q.question`（`agent.question` 事件携带的真实问题字段）。

`/grill-me` 走 Flow 编排（`product_brainstorm`、`product_breakdown` 等节点，见 dh-backend 日志 `CodeWriteNode:product_brainstorm`），每个节点会输出大量分析文本（实测单节点 response length 8126 字符），其中可能包含"复述用户上个回答"的内容（如"你选择了 C. 管理员 + 活动负责人可见"）。当节点末尾调用 question 工具提问时，`agent.question` 事件的 `q.question` 才是正确的当前问题，但 `parseInlineOptions` 从这段长文本中解析出的 `parsedQuestionText` 会误取到"上个问题的答案/复述"，从而覆盖正确问题。

## 解决方案
调整问题文本取值优先级，优先使用 `agent.question` 事件携带的真实问题字段（`q.question` / `q.text`），消息文本解析结果仅作兜底：

```tsx
const displayQuestionText = q.question || q.text || parsedQuestionText || '需要你的输入';
```

`q.question` 在所有协议下均可靠：
- `[[QUESTION:...]]` marker 协议：`q.question` = marker 解析出的 `questionText`；
- 真实 `agent.question` 工具事件：`q.question` = question 工具的问题参数；
- dh-backend 合成的 synthetic `agent.question` 事件：`q.question` = `fallbackQuestion.Question`。

选项取值 `allOptions = q.options?.length ? q.options : parsedOptions` 已是 `q.options` 优先，本次未改动。

## 影响文件
- `apps/dh-frontend/src/pages/Chat.tsx` — 提问弹层 `displayQuestionText` 取值优先级调整

## 验证结果
- `tsc --noEmit`（@repo/dh-frontend）0 errors
- `biome lint src/pages/Chat.tsx` 0 warnings
- 前端为 Vite HMR，改动自动热更新，无需重启
