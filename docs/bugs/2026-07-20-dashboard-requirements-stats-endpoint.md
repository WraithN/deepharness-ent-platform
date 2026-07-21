# 数据大盘「近7天需求完成」接入真实数据

## 现象

Dashboard 页面「近7天需求完成」卡片始终显示 `0 个` 和 `+5% 较上周` 硬编码数据。

## 根因

`Dashboard.tsx:171` 中 `const totalReqs = 0` 硬编码为 0，后端无对应的需求统计 API 端点。

## 解决方案

### 后端

1. **`domain/workitem/service/service.go`**：`WorkItemService` 接口新增 `CountWorkItems(projectID, status, days)` 和 `CountWorkItemsPrevPeriod(projectID, status, days)` 方法。

2. **`domain/workitem/service/db_service.go`**：实现 PostgreSQL 统计查询，按 `type='requirement'`、`status=done` 和 `updated_at` 时间范围统计需求完成数量。

3. **`gateway/handler/stats.go`**：
   - `StatsHandler` 新增 `workspaceSvc` 和 `workItemSvc` 依赖
   - 新增 `WorkItemSummary` handler：解析 `workspaceId` → 通过 workspace service 获取关联的 `workitem_project.externalKey` → 调用 workitem service 统计
   - 30 秒缓存以减少重复查询

4. **`gateway/server/server.go`**：注册 `GET /api/v1/stats/requirements` 路由，传递 workspace 和 workitem 服务实例。

### 前端

**`Dashboard.tsx`**：
- 新增 `reqSummary` state（类型复用 `SummaryResponse`）
- `useEffect` 中新增 `GET /v1/stats/requirements` API 调用
- 「近7天需求完成」卡片使用 `reqSummary.thisWeek` 和 `reqSummary.deltaPercent` 渲染

## 验证结果

- 前端 `pnpm build` ✓
- 前端 `tsc --noEmit` ✓
- 后端 `go build` ✓
- 后端 `go vet` ✓
- API 验证：
  - `GET /api/v1/stats/requirements?workspaceId=xxx` → `{"thisWeek":0,"lastWeek":0,"deltaPercent":0}`（无关联项目时返回 0）
