# Workitem 外部系统对接设计文档

## 1. 目标

让 DeepHarness 平台能够对接外部需求/工作项管理系统（如 Meego），实现：

- **定时拉取**：按配置周期从外部系统拉取需求到本地 DB。
- **状态回写**：用户在平台内修改 workitem 状态后，异步回写到外部系统。
- **外部为事实源**：冲突时以外部系统数据为准。
- **可配置化**：通过 `config.yaml` 控制可用平台白名单和全局调度参数；通过页面表单维护每个 workspace 的平台类型、项目 key 和字段映射 JSON。

## 2. 总体架构

采用“通用核心 + 平台驱动钩子”的方案：

```
UI: Workspace Settings
        │
        ▼
dh-backend
┌─────────────────────────────┐
│ WorkItem HTTP Handler       │  REST API
├─────────────────────────────┤
│ WorkItemService (DB 实现)    │  本地 DB 读写 + 异步回写入队
├─────────────────────────────┤
│ SyncScheduler               │  定时轮询 + 状态回写 Worker
├─────────────────────────────┤
│ HTTPTracker (通用核心)       │  HTTP/重试/日志/错误处理
├─────────────────────────────┤
│ MeegoDriver / JiraDriver    │  构造请求 + 解析响应
└─────────────────────────────┘
        │                      │
        ▼                      ▼
   外部平台 API           PostgreSQL
```

## 3. 核心接口

### 3.1 Tracker（服务层统一入口）

```go
type Tracker interface {
    List(ctx context.Context, projectKey string) ([]workitem.WorkItem, error)
    Get(ctx context.Context, externalID string) (*workitem.WorkItem, error)
    UpdateStatus(ctx context.Context, externalID string, status workitem.Status) error
}
```

### 3.2 Driver（每个平台实现的轻量钩子）

```go
type Driver interface {
    Platform() string
    BuildListRequest(ctx context.Context, cfg DriverConfig, projectKey string) (*http.Request, error)
    ParseListResponse(body []byte, mapping MappingConfig) ([]workitem.WorkItem, error)
    BuildUpdateStatusRequest(ctx context.Context, cfg DriverConfig, externalID string, status workitem.Status, mapping MappingConfig) (*http.Request, error)
    ParseUpdateStatusResponse(body []byte) error
}
```

`HTTPTracker` 实现 `Tracker`，内部调用 `Driver` 完成平台相关的请求构造与响应解析，自身只负责通用 HTTP 执行、重试、日志和错误封装。

## 4. 配置设计

### 4.1 全局配置 `config.yaml`

```yaml
workitem:
  # workspace 可选的平台白名单
  platforms:
    - meego
    - jira
  sync:
    interval: 5m          # 定时拉取间隔
    workers: 4            # 并发同步 worker 数
    timeout: 30s          # 单次同步 HTTP 超时
  writeback:
    enabled: true
    workers: 2            # 状态回写并发数
    retry: 3              # 失败重试次数
```

### 4.2 每个 Workspace 的 `WorkitemProject.config` JSONB

```json
{
  "platform": "meego",
  "projectKey": "my-project",
  "api": {
    "baseURL": "https://meego.example.com/api/v1",
    "auth": {
      "type": "bearer",
      "token": "xxx"
    }
  },
  "endpoints": {
    "list": "/projects/{projectKey}/issues",
    "get": "/issues/{externalID}",
    "updateStatus": "/issues/{externalID}/status"
  },
  "fieldMapping": {
    "id": "id",
    "title": "title",
    "description": "description",
    "status": "status",
    "priority": "priority",
    "assigneeId": "assignee.id",
    "reporter": "reporter.name",
    "externalID": "id",
    "createdAt": "createdAt",
    "updatedAt": "updatedAt"
  },
  "statusMapping": {
    "open": "backlog",
    "in_progress": "in_progress",
    "resolved": "done",
    "closed": "closed"
  },
  "priorityMapping": {
    "P0": "high",
    "P1": "medium",
    "P2": "low"
  }
}
```

- `fieldMapping` 的 value 支持点号路径，用于取嵌套字段。
- `endpoints` 支持 `{projectKey}`、`{externalID}` 占位符。

## 5. 数据流

### 5.1 定时拉取

1. `SyncScheduler` 启动后创建 `time.Ticker`，按 `workitem.sync.interval` 触发。
2. 每次触发：
   - 从 DB 加载所有 `WorkitemProject`。
   - 过滤掉 `platform` 不在 `config.yaml` 白名单中的项目。
   - 将项目放入 channel，由 worker pool（数量为 `workitem.sync.workers`）并发执行。
3. 单个项目同步：
   - 调用 `Tracker.List(projectKey)`。
   - `HTTPTracker` 调用 `Driver.BuildListRequest` + 执行 HTTP + `Driver.ParseListResponse`。
   - 使用 `fieldMapping/statusMapping/priorityMapping` 转换为 `[]workitem.WorkItem`。
   - 按 `ExternalID` 在本地 DB 做 upsert（外部为事实源，覆盖本地）。
4. 同步结束后更新 `WorkitemProject` 的 `last_sync_at` 和 `last_sync_status`。

### 5.2 状态回写

1. 用户调用 `PATCH /api/v1/workitems/{id}/status`。
2. `WorkItemService.UpdateWorkItemStatus` 先更新本地 DB。
3. 如果该 workitem 的 `Source != internal` 且全局 `writeback.enabled` 为 true，将回写任务放入内存队列。
4. `WritebackWorker` 异步消费队列，调用 `Tracker.UpdateStatus(externalID, status)`。
5. 回写成功后更新本地 `UpdatedAt`；失败则按指数退避重试，最多 `workitem.writeback.retry` 次。

## 6. 页面配置项

在 workspace 设置页面扩展“需求管理平台”表单：

- **平台类型**：下拉框，选项由后端读取 `config.yaml` 的 `workitem.platforms` 返回。
- **外部项目 Key**：对应 `WorkitemProject.external_key`。
- **映射配置**：JSON 编辑器，保存到 `WorkitemProject.config`。

后端需要复用/新增 `/api/v1/workspaces/{id}/workitem-project` 接口，并新增一个返回平台白名单的接口（如 `GET /api/v1/workitem/platforms`）。

## 7. 错误处理

- 同步失败只记录日志和 `last_sync_status`，不影响 UI 读取本地缓存。
- 状态回写失败不重试无限次，最多 `workitem.writeback.retry` 次。
- 外部平台返回 401/403 时，停止该项目的同步直到配置更新。
- 所有外部调用必须设置超时（`workitem.sync.timeout`）。

## 8. 依赖与前置条件

- 需要实现 DB 版本的 `WorkItemRepository`，替换当前内存 mock。
- 需要实现 DB 版本的 `WorkItemService`，与 `Tracker`、`SyncScheduler` 交互。
- 需要新增 `SyncScheduler` 和 `WritebackWorker`。
- 前端 Settings 页面需要扩展表单。

## 9. 非目标（YAGNI）

- 不实现动态加载 `.so` 插件。
- 不实现复杂的双向字段冲突合并：非状态字段只从外部拉取，本地只回写状态。
- 不实现 OAuth 等复杂鉴权：第一期只支持 `bearer token`。
