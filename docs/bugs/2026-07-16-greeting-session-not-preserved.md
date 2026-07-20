# 2026-07-16 问候/闲聊会话未保留到历史列表

## 现象

在智能会话中输入「你好」等问候语，系统走意图识别/静态回复，没有调用模型。此时如果点击「新会话」按钮，刚才的问候会话不会出现在历史会话列表中；而模型正常回复的会话预期会保留。

## 根因

1. 后端 `AGUIHandler.AgentRun` 在命中问候或闲聊意图后，通过 `streamChatResponse` 直接返回回复，但没有调用 `finalizeSession` 更新会话活动时间；虽然用户/助手消息已落库，但会话未被进一步激活。
2. 前端 `handleNewSession` 在新建会话时会无条件 `DELETE` 旧会话，导致即使后端已保存的问候会话也会被清理。

## 解决方案

1. 后端 `apps/dh-backend/gateway/handler/agui.go`：
   - 问候命中分支与闲聊意图分支在 `streamChatResponse` 之后调用 `h.finalizeSession(...)`，与正常 agent run 保持一致，更新 `updated_at` 并尝试生成标题。
2. 前端 `apps/dh-frontend/src/pages/Chat.tsx`：
   - `handleNewSession` 仅在当前会话没有消息时才删除旧会话；已有对话记录（包括问候/闲聊）的会话会被保留到历史列表。
   - 新建会话后继续调用 `loadHistory()` 刷新历史列表。

## 验证结果

- `go build ./...` 通过，`pnpm check-types` 通过，`pnpm build` 通过。
- 通过 `curl` 模拟前端发送带 `__USER_PROMPT__` 标记的「你好」：
  - 后端返回问候回复 SSE。
  - 会话 `updated_at` 被更新。
  - 用户消息与助手消息均落入 `agent_messages`。
  - 会话出现在 `GET /api/v1/sessions` 列表中。
- 前端 dev 服务已重启，刷新 `/chat` 后手动测试：输入问候语 → 点击「新会话」→ 历史下拉应保留刚才的会话。
