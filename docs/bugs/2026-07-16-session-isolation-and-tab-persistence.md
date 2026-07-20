# 2026-07-16 会话历史未隔离 / 历史标题展示 session ID / 智能体 tab 未持久化

## 现象

1. 在「智能会话」页面，不同用户/不同工作空间的历史会话列表会相互串扰：A 用户创建或删除的会话会出现在 B 用户的历史下拉中。
2. 历史会话下拉中，若后端返回的 `title` 为空，则直接展示 session ID 前 8 位，可读性差。
3. 点击「新增智能体」创建的 tab 只保存在 React state 中，切换左侧菜单再返回 `/chat` 后，新增 tab 丢失，只剩初始 tab。

## 根因

1. `agent_sessions` 表缺少 `user_id` 列，`ListSessions` 接口也未按 `workspace_id` / `user_id` 过滤，导致所有会话全局共享。
2. 前端 `historyList` 的标题回退逻辑写死为 `s.title || s.id.slice(0, 8)`，没有为无标题会话生成友好占位文案。
3. `agentTabs` / `activeAgentTabId` 未写入 `localStorage`，页面重新挂载后无法恢复；同时 `createSession` 在 `use-ag-ui-chat.ts` 中硬编码 `workspaceId: 'ws-default'`，也会导致会话创建到错误空间。

## 解决方案

1. 数据库与后端隔离
   - `infra/database/agent/schema.sql` 新增 `user_id VARCHAR(36)` 列及复合索引；并补充迁移文件 `migration-20260716-add-user-id.sql`。
   - `chat.Session` 结构体新增 `UserID` 字段。
   - `SessionStore.ListSessions` 接口改为 `ListSessions(ctx, workspaceID, userID string)`，PostgreSQL 与内存实现均按 `workspace_id + user_id` 过滤（对旧数据兼容：若 `user_id` 为空则不限制用户）。
   - `CreateSession` 保存当前登录用户的 `user_id`。
   - `DeleteSession` / `GetMessages` 增加会话归属校验，并将对应路由在 `server.go` 中纳入 `middleware.Auth` 保护。
   - 运行时配置同步场景 `agentconfig/handler.go` 调用 `ListSessions(ctx, workspaceID, "")`，只按空间过滤。

2. 前端历史展示优化
   - `use-ag-ui-chat.ts` 中 `createSession` 改为读取 `localStorage.currentWorkspaceId`，不再硬编码 `ws-default`。
   - `Chat.tsx` 中历史接口改为 `/v1/sessions?workspaceId=...`；新增 `formatSessionTitle`，无标题时展示为「`<Agent 名> · 未命名会话 · MM/DD HH:mm`」。

3. 智能体 tab 持久化
   - `Chat.tsx` 新增 `getChatTabsStorageKey` / `getChatActiveTabStorageKey`，按工作空间隔离 key。
   - 初始化 effect 优先从 `localStorage` 恢复当前空间的 tab 列表与激活 tab，失败再回退到创建默认会话。
   - 新增 effect，在首次渲染后监听 `agentTabs` / `activeAgentTabId` 变化，自动写入 `localStorage`。

## 验证结果

- `pnpm check-types` 通过，`pnpm build` 通过，`go vet ./...` 无 warning。
- 重启 `pnpm dev` 后，通过 `curl` 验证：
  - 同一工作空间下，`developer` 只能看到自己的会话，`tester` 列表为空。
  - `tester` 创建会话后，`developer` 列表不受影响。
  - `tester` 无法删除或读取 `developer` 的会话，返回 403。
- 前端代码已通过类型检查，浏览器验证需手动刷新页面后进入 `/chat` 测试历史下拉与 tab 恢复。
