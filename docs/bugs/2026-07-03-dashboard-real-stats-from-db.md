# 数据大盘接入数据库统计

## 现象

数据大盘页面的「会话轨迹」「AI 会话趋势」「7 日会话次数」均使用前端 mock 数据，未从数据库读取真实统计数据。

## 根因

后端无任何统计 API 端点（`/api/v1/stats/*` 不存在），`SessionStore`/`MessageStore` 接口无聚合查询方法。前端 `Dashboard.tsx` 使用 `mockDashboardStats` 和硬编码数组渲染所有图表和表格。

## 解决方案

### 后端

1. **`chat/store.go`**：新增 `DateCount` 和 `SessionTrailInfo` 类型；`SessionStore` 接口新增 `GetSessionTrend(ctx, days)` 和 `GetSessionTrails(ctx, limit)` 方法。

2. **`chat/session/postgres.go`**：实现 PostgreSQL 统计查询：
   - `GetSessionTrend`：`SELECT DATE(created_at), COUNT(*) FROM agent_sessions WHERE created_at >= NOW() - INTERVAL 'N days' GROUP BY DATE(created_at)`
   - `GetSessionTrails`：`agent_sessions LEFT JOIN agent_messages` 获取每条会话的消息数量，按 `updated_at DESC` 排序

3. **`chat/session/session.go`**：内存实现（用于测试），从 sessions map 中按日期分组统计。

4. **`gateway/handler/stats.go`**：新增 `StatsHandler`，拆分为 3 个独立接口：
   - `GET /api/v1/stats/summary` — 统计卡片：本周会话数、上周会话数、较上周变化百分比（上周为 0 时 delta=0）
   - `GET /api/v1/stats/trend` — AI 会话趋势：最近 7 天每天的会话创建数量
   - `GET /api/v1/stats/trails` — 成员会话轨迹：最近 50 条会话（含消息数量）

5. **`gateway/server/server.go`**：注册 3 条路由。

### 前端

1. **`Dashboard.tsx`**：
   - 移除 mock 数据依赖（`mockDashboardStats.sessions`），改为分别调用 3 个 API
   - 「近 7 天会话数量」卡片使用 `/stats/summary` 返回的 `thisWeek`，副标题显示较上周变化百分比
   - 「AI 会话趋势」柱状图使用 `/stats/trend` 返回的按日数据
   - 「成员会话轨迹」表格使用 `/stats/trails` 返回的真实会话记录
   - 日期格式改为「X月X日」（`formatDateShort` 使用 `Date.getMonth()/getDate()`）
   - 新增 `formatRelativeTime`、`formatDuration`、`formatDateShort` 工具函数

## 验证结果

- 前端 `pnpm build` ✓
- 前端 `tsc --noEmit` ✓
- 前端 `biome lint` ✓
- 后端 `go build` ✓
- 后端 `go vet` ✓
- API 验证：
  - `/api/v1/stats/summary` → `{"thisWeek":65,"lastWeek":0,"deltaPercent":0}`
  - `/api/v1/stats/trend` → `{"data":[{"date":"2026-06-30...","count":11},...]}`
  - `/api/v1/stats/trails` → `{"data":[{"id":"...","title":"...","messageCount":2,...}]}`

## 注意事项

- `agent_sessions` 表无 `user_id` 列，会话轨迹的「成员」列显示"未知用户"
- 「代码提交趋势」和「近 7 天需求完成」仍使用 mock 数据（用户未要求改造）
- 会话轨迹详情 Sheet 中的活动流已简化为会话摘要（不再展示 mock 的对话时间线）
