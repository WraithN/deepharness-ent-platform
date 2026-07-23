# 2026-07-23 成员会话轨迹详情未展示真实会话内容

## 现象

数据大盘「成员会话轨迹」表格本身有数据，但点击某条轨迹后，右侧详情面板只显示一个占位的时间轴节点（绿色对勾 + "会话记录 (历时 X，共 Y 条消息)"），并不展示该会话的真实消息内容。用户无法查看成员在会话中说了什么、AI 如何回复，轨迹信息流形同虚设。

此外，即便前端尝试拉取消息，既有的 `GET /api/v1/sessions/{id}/messages` 端点禁止跨用户访问（看他人会话返回 403 `not allowed to access this session`），导致大盘场景下根本无法获取其他成员的会话消息。

## 根因

1. **前端详情为占位实现**：`apps/dh-frontend/src/pages/Dashboard.tsx` 的轨迹详情 Sheet 仅渲染一个静态 timeline 节点，从未拉取或渲染会话历史消息，与 PRD 3.5.2「详情页面以信息流形式展示单个成员的会话轨迹」不符。
2. **后端无大盘可用的跨用户消息端点**：`SessionHandler.GetMessages`（`gateway/handler/session.go`）在取消息前校验 `sess.UserID != userID` 即拒绝，大盘查看者（管理员/有 canViewDashboard 权限者）无法读取同工作空间内其他成员的会话消息。`StatsHandler` 也未持有 `MessageStore`，无法提供消息。

## 解决方案

### 后端
- `apps/dh-backend/gateway/handler/stats.go`：
  - `StatsHandler` 新增 `messages chat.MessageStore` 字段，`NewStatsHandler` 增加该参数。
  - 新增 `TrailMessages` 处理器（`GET /api/v1/stats/trails/{sessionId}/messages?workspaceId=...`）：允许跨用户读取（大盘场景），但严格校验会话 `WorkspaceID == workspaceId`，防止跨工作空间越权；复用 `extractOriginalUserPrompt` 提取用户原始输入，与 `/sessions/{id}/messages` 行为一致。
  - 新增常量 `statsTrailMsgLimit = 100`（消息历史上限，消除魔法值）。
- `apps/dh-backend/gateway/server/server.go`：向 `NewStatsHandler` 注入 `messages`；注册新路由 `/api/v1/stats/trails/{sessionId}/messages`。

### 前端
- `apps/dh-frontend/src/pages/Dashboard.tsx`：
  - 新增 `TrailMessageDTO` 类型与 `ROLE_USER`/`ROLE_ASSISTANT` 角色常量。
  - 新增 `trailMessages`/`trailMessagesLoading` 状态；`openTrailDetail` 在打开详情时拉取 `/v1/stats/trails/{id}/messages`，`closeTrailDetail` 关闭时清空。
  - 抽取 `TrailMessageItem` 组件（用户消息展示原始输入纯文本，AI 消息用 `MarkdownView` 渲染），替换原占位时间轴为真实消息信息流，含加载与空态。
  - 行点击改为调用 `openTrailDetail`。

### 验证
- `go build ./... && go vet ./...`（dh-backend）：0 warnings。
- `npx tsc --noEmit -p tsconfig.check.json`：0 errors；`npx biome lint src/pages/Dashboard.tsx`：0 warnings。
- 重启开发环境后 `curl` 验证：
  - 同工作空间跨用户读取：返回 6 条消息（user/assistant 交替，含 originalText）。
  - 跨工作空间读取：403 `session not in this workspace`。
  - 缺少 workspaceId：400 `workspaceId is required`。
