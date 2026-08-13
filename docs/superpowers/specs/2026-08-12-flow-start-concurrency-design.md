# AI 需求设计流程发起并发控制设计

> 创建日期：2026-08-12
> 状态：已确认，待编写实施计划

## 1. 背景与目标

### 1.1 现状

AI 需求设计流程（`product` 类型 process）已存在完整实现，发起入口位于两个组件：

- `apps/dh-frontend/src/components/chat/FileAttachmentCard.tsx:133` - brainstorm 结果文件卡片
- `apps/dh-frontend/src/components/chat/InlineFilePreview.tsx:294` - 内联文件预览顶栏

两个入口均调用 `processApi.startProductFlow({ workspaceId, workitemId, workitemTitle, workitemDesc })`，后端 `Orchestrator.StartProductFlow`（`apps/dh-backend/orchestrator/orchestrator.go:355`）在 goroutine 中异步启动流程，HTTP 立即返回。

**问题**：

- `StartProductFlow` 不检查该文档是否已有进行中的流程，可被重复发起。
- `processes` 表无文档级唯一约束，仅有 `workitem_id` 索引。
- `ProcessService` 接口无"按文档查询"或"查活跃流程"方法。
- 无流程取消/终止能力。
- 发起接口返回 `{code:0, message:"product flow started"}`，不含 process ID，前端无法跳转详情。

### 1.2 目标

实现"同一 brainstorm 文档同一时间只能有一个进行中的 AI 需求设计流程"的并发控制，并提供如下发起逻辑：

1. 检测该 brainstorm 文档下已存在的流程。
2. 无 -> 直接发起，跳转流程详情。
3. 有进行中的流程 -> 提示"当前已有进行中的流程"。
4. 有但无进行中 -> 弹窗"是否重新发起"，确认后发起新流程（保留旧流程），跳转详情。

### 1.3 范围与非目标

**范围**：

- `processes` 表新增 `source_doc_path` 字段。
- 后端检测 API、并发校验、StartProductFlow 返回 process ID。
- 前端两个发起入口改造 + 公共发起函数 + 确认弹窗。

**非目标**（明确排除）：

- 不处理老数据（`source_doc_path` 为空的存量 process 不参与并发控制）。
- 不实现"杀掉旧流程"的清理逻辑（用户明确说明老数据不处理）。
- 不引入前端测试框架（项目无此约定）。
- 不追踪 brainstorm 文件重命名/移动。

## 2. 数据模型

### 2.1 DB Schema 变更

新增迁移文件 `infra/database/process/migration-20260812-source-doc-path.sql`：

```sql
ALTER TABLE processes ADD COLUMN IF NOT EXISTS source_doc_path VARCHAR(512) DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_processes_workitem_doc ON processes(workitem_id, source_doc_path);
```

说明：

- `source_doc_path`：发起时传入的 brainstorm 文件路径（如 `pm-jobs/brainstorm/xxx-brainstorm.md`）。
- 老数据该字段为空字符串，不参与并发控制。
- 不加 UNIQUE 约束：允许"重新发起"产生多条记录，仅约束"进行中"唯一。

### 2.2 "进行中"判定

`Process` 实体新增方法 `IsInProgress()`（`apps/dh-backend/domain/process/object/types.go`）：

```
流程进行中 = 存在任一阶段状态为 pending 或 in_progress
```

阶段状态枚举：

| 状态 | 含义 | 是否进行中 |
|------|------|-----------|
| `pending` | 未开始 | 是 |
| `in_progress` | 进行中 | 是 |
| `completed` | 已完成 | 否 |
| `failed` | 已失败 | 否 |
| `terminated` | 已终止（新增） | 否 |

新增 `terminated` 状态用于支撑未来"杀掉"扩展与显式区分终止态。流程被终止后所有未完成 stage 标记为 `terminated`。

`Process.IsInProgress()` 实现：遍历 `stages`，任一 stage `status ∈ {pending, in_progress}` 则返回 true。

### 2.3 ProcessService 接口扩展

`apps/dh-backend/domain/process/service/service.go` 新增方法：

```go
// 按 workitem + 文档路径查询所有流程（按创建时间倒序）
ListByWorkitemAndDoc(ctx context.Context, workitemID, docPath string) ([]*object.Process, error)

// 是否存在进行中的流程（workitem + 文档路径维度）
// 返回 (是否进行中, 最新的进行中 process, error)
HasInProgress(ctx context.Context, workitemID, docPath string) (bool, *object.Process, error)
```

`ProcessStore` 接口对应新增 `ListByWorkitemAndDoc`：

- 内存版（`memory_store.go`）：遍历 map 过滤 `workitemID + docPath`，按 `created_at` 倒序。
- DB 版（`db_store.go`）：`WHERE workitem_id=$1 AND source_doc_path=$2 ORDER BY created_at DESC`。

`HasInProgress` 在 service 层基于 `ListByWorkitemAndDoc` 结果遍历调用 `IsInProgress()` 实现。

## 3. 后端 API 设计

### 3.1 检测接口

`GET /v1/processes/active-check`

**请求参数**（query string）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workitemId` | string | 是 | 需求 ID |
| `docPath` | string | 是 | brainstorm 文件路径 |

**响应**：

```json
{
  "code": 0,
  "data": {
    "hasExisting": true,
    "hasInProgress": false,
    "latestProcess": {
      "id": "proc_xxx",
      "title": "xxx",
      "type": "product",
      "createdAt": "2026-08-12T...",
      "inProgress": false
    }
  }
}
```

字段说明：

- `hasExisting`：该 workitem+docPath 下是否存在任意 process 记录。
- `hasInProgress`：是否存在进行中的 process。
- `latestProcess`：最新一条 process（按 `created_at DESC`），无则 `null`。

**兜底**：`docPath` 为空时直接返回 `{hasExisting:false, hasInProgress:false, latestProcess:null}`。

**实现位置**：

- `apps/dh-backend/domain/process/handler.go` 新增 `ActiveCheck` 方法。
- `apps/dh-backend/gateway/server/server.go` 注册路由 `ROUTE_PROCESSES_ACTIVE_CHECK = "/v1/processes/active-check"`，带 Auth 中间件。

### 3.2 StartProductFlow 改造

`POST /v1/orchestrator/product-flow` 请求体新增 `docPath` 字段：

```go
type StartProductFlowRequest struct {
    WorkspaceID   string `json:"workspaceId"`
    WorkitemID    string `json:"workitemId"`
    WorkitemTitle string `json:"workitemTitle"`
    WorkitemDesc  string `json:"workitemDesc"`
    DocPath       string `json:"docPath"`  // 新增
}
```

`Orchestrator.StartProductFlow`（`orchestrator.go:355`）改造流程：

1. 获取 `workitemID+docPath` 维度 mutex（从 `sync.Map` 取或创建）。
2. 加锁后调用 `ProcessService.HasInProgress(ctx, workitemID, docPath)`。
3. 若存在进行中 -> 返回业务错误 `code=40901, message="当前已有进行中的流程"`。
4. 否则创建 process（写入 `source_doc_path`）并持久化。
5. 持久化后释放 mutex。
6. `safego.Go` 启动流程 goroutine（mutex 不覆盖 goroutine 执行期，仅覆盖"检测->创建->持久化"）。

**返回值改造**：

```json
{ "code": 0, "data": { "processId": "proc_xxx" } }
```

前端据此跳转 `/personal/flow/{processId}`。

**并发锁实现**：

- `Orchestrator` 持有 `flowMu sync.Map`（key=`workitemID+"\x00"+docPath`，value=`*sync.Mutex`）。
- key 总量 = 文档数，可控，不主动清理（YAGNI）。

### 3.3 错误码常量

后端新增常量（`apps/dh-backend/constants/` 或 `orchestrator/` 包内）：

```go
const CodeFlowInProgress = 40901
const ErrMsgFlowInProgress = "当前已有进行中的流程"
```

## 4. 前端设计

### 4.1 processApi 扩展

`apps/dh-frontend/src/lib/process-api.ts` 新增：

```ts
export interface ActiveCheckResult {
  hasExisting: boolean;
  hasInProgress: boolean;
  latestProcess: {
    id: string;
    title: string;
    type: string;
    createdAt: string;
    inProgress: boolean;
  } | null;
}

// StartProductFlowRequest 新增 docPath
export interface StartProductFlowRequest {
  workspaceId: string;
  workitemId: string;
  workitemTitle: string;
  workitemDesc: string;
  docPath: string;
}

// processApi 新增
checkExisting(workitemId: string, docPath: string): Promise<ActiveCheckResult>
```

`STAGE_STATUS` 常量补充 `TERMINATED: 'terminated'`。

### 4.2 公共发起函数

新增 `apps/dh-frontend/src/lib/process-start.ts`，封装"检测->分支"逻辑（避免两个入口重复，规则6）：

```ts
export interface StartFlowParams {
  workspaceId: string;
  workitemId: string;
  workitemTitle: string;
  docPath: string;
  onNeedConfirm: (latest: NonNullable<ActiveCheckResult['latestProcess']>) => void;
  onStarted: (processId: string) => void;
}

export async function startProductFlowWithCheck(params: StartFlowParams): Promise<void>
```

执行逻辑：

1. 调 `processApi.checkExisting(workitemId, docPath)`。
2. `hasExisting === false` -> 调 `startProductFlow` -> `onStarted(processId)`。
3. `hasInProgress === true` -> `toast.error(TOAST_FLOW_IN_PROGRESS)`。
4. `hasExisting && !hasInProgress` -> 调 `onNeedConfirm(latestProcess)`。

**确认后复用**：用户在弹窗点击"确认重新发起"时，再次调用 `startProductFlowWithCheck`（内部再次 checkExisting，若状态已变进行中则按分支3提示），不直接调发起接口。避免确认期间状态变化导致重复发起。

**错误处理**：

- 检测失败 -> `toast.error`，终止。
- 发起返回 `code=40901` -> `toast.error(TOAST_FLOW_IN_PROGRESS)`（与检测分支一致）。
- 发起成功但无 `processId` -> `toast.error(TOAST_DETAIL_UNAVAILABLE)`，不跳转。
- 其他错误 -> `toast.error(msg || TOAST_START_FAILED)`。

### 4.3 确认弹窗组件

新增 `apps/dh-frontend/src/components/process/RestartFlowDialog.tsx`：

- 基于 shadcn `AlertDialog`（复用 `components/ui/alert-dialog.tsx`）。
- Props：`{ open: boolean; onOpenChange: (open:boolean)=>void; onConfirm: ()=>void; latestProcess: { id; title; createdAt } | null }`。
- 文案：`检测到该文档已存在历史流程（最新：{title}，{createdAt}）。是否重新发起？`
- 操作：取消 / 确认重新发起。

### 4.4 发起入口改造

**FileAttachmentCard.tsx**（`:133` `handleStartProductFlow`）：

- 引入 `useNavigate`。
- 引入 `RestartFlowDialog`，新增 `confirmState` useState。
- `handleStartProductFlow` 改为调用 `startProductFlowWithCheck`：
  - `onNeedConfirm` -> `setConfirmState({ open: true, latest })`
  - `onStarted` -> `navigate('/personal/flow/' + processId)`
- 弹窗 `onConfirm` -> 关闭弹窗 + 再次调用 `startProductFlowWithCheck`。
- `docPath` 取组件已有的 `path` prop。

**InlineFilePreview.tsx**（`:294` `handleStartProductFlow`）：

- 同上改造，`docPath` 取 `path`。
- `workitemTitle` 取 `requirementTitle || displayTitle`（保留现有逻辑）。

### 4.5 常量定义（规则7）

`apps/dh-frontend/src/lib/process-api.ts`：

```ts
export const API_ERROR_CODE_FLOW_IN_PROGRESS = 40901;
```

`apps/dh-frontend/src/lib/process-start.ts` 顶部：

```ts
const TOAST_FLOW_IN_PROGRESS = '当前已有进行中的流程';
const TOAST_FLOW_STARTED = 'AI需求设计流程已启动';
const TOAST_START_FAILED = '启动AI需求设计流程失败，请重试';
const TOAST_DETAIL_UNAVAILABLE = '流程已启动，但获取详情失败';
const CONFIRM_RESTART_DIALOG_TITLE = '重新发起流程';
const CONFIRM_RESTART_DIALOG_DESC_PREFIX = '检测到该文档已存在历史流程（最新：';
const CONFIRM_RESTART_DIALOG_DESC_SUFFIX = '）。是否重新发起？';
const PROCESS_DETAIL_ROUTE_PREFIX = '/personal/flow/';
```

## 5. 错误处理与边界

### 5.1 并发请求防护

| 场景 | 防护层 | 处理 |
|------|--------|------|
| 用户双击发起按钮 | 前端 | `startingFlow` state 禁用按钮（保留现有模式） |
| 多标签页同时点击 | 后端 | `workitemID+docPath` 维度 mutex + HasInProgress 校验，第二个返回 `code=40901` |
| 检测与创建之间窗口 | 后端 | 同一 mutex 覆盖"检测->创建->持久化"全程 |
| 旧 goroutine 仍在运行 | 后端 | 不主动停止（老数据不处理） |

### 5.2 老数据兼容

- `source_doc_path` 为空的老 process 不被检测接口匹配（查询条件 `WHERE source_doc_path=$2` 且新发起必带非空 docPath）。
- 老流程若仍在运行，因 `source_doc_path` 为空不会被检测到，用户可正常发起新流程。
- 前端检测接口 `docPath` 为空时直接返回无记录（兜底）。

### 5.3 异常分支

| 异常 | 处理 |
|------|------|
| 检测接口失败 | `toast.error`，不发起，不弹窗 |
| 发起返回 `code=40901` | `toast.error(TOAST_FLOW_IN_PROGRESS)` |
| 发起其他错误 | `toast.error(msg \|\| TOAST_START_FAILED)` |
| `processId` 缺失 | `toast.error(TOAST_DETAIL_UNAVAILABLE)`，不跳转 |
| docPath 无法获取 | 入口按钮不显示（现有 `canStartProductFlow` 判断覆盖） |

### 5.4 边界场景

- **同一 workitem 不同 brainstorm 文档**：各自独立并发控制，互不影响。
- **brainstorm 文件被重命名/移动**：`docPath` 变化视为新文档，可发起新流程。本期不追踪路径变更（YAGNI）。
- **弹窗确认期间状态变化**：确认后再次走 `startProductFlowWithCheck`，若已变进行中则提示。

## 6. 测试策略

### 6.1 后端单元测试

**`apps/dh-backend/domain/process/service/service_test.go`**（新建）：

- `TestIsInProgress`：覆盖 pending/in_progress/completed/failed/terminated 各组合。
- `TestHasInProgress_None`：无记录 -> false。
- `TestHasInProgress_WithInProgress`：存在 in_progress stage -> true。
- `TestHasInProgress_OnlyCompleted`：仅 completed/failed/terminated -> false。
- `TestListByWorkitemAndDoc_FiltersByDocPath`：不同 docPath 互不干扰。
- `TestListByWorkitemAndDoc_EmptyDocPathExcluded`：空 docPath 老数据不被匹配。

**`apps/dh-backend/orchestrator/orchestrator_test.go`**（新建或追加）：

- `TestStartProductFlow_RejectWhenInProgress`：已有进行中 -> `code=40901`。
- `TestStartProductFlow_ConcurrentSameDoc`：并发 2 goroutine -> 仅一个成功。
- `TestStartProductFlow_DifferentDocPathIndependent`：不同 docPath 并发 -> 均成功。

使用内存 `MemoryProcessStore`，mock 必要依赖。

### 6.2 前端验证

项目无前端测试框架（AGENTS.md §8），通过类型检查 + 手动验证清单：

**类型检查**：`npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 0 error。

**手动验证清单**：

1. 全新 brainstorm 文档发起 -> 成功 -> 跳转 `/personal/flow/{id}`。
2. 同一文档首次流程进行中再次发起 -> toast"当前已有进行中的流程"。
3. 同一文档首次流程完成后再次发起 -> 弹窗 -> 确认 -> 发起成功 + 跳转。
4. 弹窗点击取消 -> 不发起。
5. 不同 brainstorm 文档各自发起 -> 互不影响。
6. 双击发起按钮 -> 仅触发一次。
7. 检测接口失败 -> toast 错误，不发起。
8. 老数据（source_doc_path 为空）-> 不影响新流程发起。

### 6.3 集成验证（规则1）

1. `pnpm build` 构建全栈。
2. `bash scripts/restart-dev.sh` 启动。
3. 按 §6.2 清单逐项验证。
4. `go vet ./...` 0 warning（规则8）。
5. tsc 0 error（规则8）。

### 6.4 不测试的内容

- 不引入前端测试框架。
- 不做 E2E 自动化。
- 不测试"杀掉老数据"。

## 7. 改动文件清单

### 7.1 后端

| 文件 | 改动 |
|------|------|
| `infra/database/process/migration-20260812-source-doc-path.sql` | 新建迁移 |
| `apps/dh-backend/domain/process/object/types.go` | 新增 `terminated` 状态常量、`IsInProgress()` 方法、`Process.SourceDocPath` 字段、`NewProductProcess` 写入 docPath |
| `apps/dh-backend/domain/process/service/service.go` | 接口新增 `ListByWorkitemAndDoc`/`HasInProgress` |
| `apps/dh-backend/domain/process/store/store.go` | 接口新增 `ListByWorkitemAndDoc` |
| `apps/dh-backend/domain/process/store/memory_store.go` | 实现新方法 |
| `apps/dh-backend/domain/process/store/db_store.go` | 实现新方法 + 写入 `source_doc_path` |
| `apps/dh-backend/domain/process/handler.go` | 新增 `ActiveCheck` handler |
| `apps/dh-backend/orchestrator/orchestrator.go` | `StartProductFlow` 加并发校验 + mutex + 返回 processId |
| `apps/dh-backend/orchestrator/handler.go` | 请求体新增 `DocPath`，返回 `processId` |
| `apps/dh-backend/gateway/server/server.go` | 注册 `active-check` 路由 |
| `apps/dh-backend/constants/`（或 orchestrator 包） | 新增错误码常量 |
| `apps/dh-backend/domain/process/service/service_test.go` | 新建测试 |
| `apps/dh-backend/orchestrator/orchestrator_test.go` | 新建/追加测试 |

### 7.2 前端

| 文件 | 改动 |
|------|------|
| `apps/dh-frontend/src/lib/process-api.ts` | 新增 `ActiveCheckResult` 类型、`checkExisting` 方法、`StartProductFlowRequest.docPath`、`STAGE_STATUS.TERMINATED`、错误码常量 |
| `apps/dh-frontend/src/lib/process-start.ts` | 新建公共发起函数 + 常量 |
| `apps/dh-frontend/src/components/process/RestartFlowDialog.tsx` | 新建确认弹窗 |
| `apps/dh-frontend/src/components/chat/FileAttachmentCard.tsx` | 改造 `handleStartProductFlow` |
| `apps/dh-frontend/src/components/chat/InlineFilePreview.tsx` | 改造 `handleStartProductFlow` |

### 7.3 文档

| 文件 | 改动 |
|------|------|
| `docs/bugs/2026-08-12-flow-start-concurrency.md` | 缺陷文档化（规则3，记录"可重复发起"问题及修复） |

## 8. 架构合规性（规则12）

- 本改动不涉及 agent（gatewayd）资源访问，无需放入共享目录。
- 不直接执行 agent/git/npm 命令。
- 不涉及原型文件 serve 与标注注入。
- 不涉及容器隔离边界。
- 改动均在 dh-backend 应用层与 dh-frontend，符合分层职责。

## 9. 验收标准

1. 同一 brainstorm 文档进行中时再次发起 -> 被拦截并提示。
2. 同一 brainstorm 文档无进行中时发起 -> 弹窗确认 -> 确认后发起成功 + 跳转详情。
3. 不同 brainstorm 文档互不影响。
4. 发起成功后跳转 `/personal/flow/{processId}`。
5. 老数据不影响新流程发起。
6. `go vet ./...` 0 warning，tsc 0 error。
7. `pnpm build` 与 `bash scripts/restart-dev.sh` 成功。
