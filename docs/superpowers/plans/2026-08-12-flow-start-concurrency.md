# 实施计划：AI 需求设计流程发起并发控制

> 关联 Spec：`docs/superpowers/specs/2026-08-12-flow-start-concurrency-design.md`

## 任务概览

| # | 任务 | 层 | 文件 | 状态 |
|---|------|----|------|------|
| 1 | 数据模型变更 | 后端 | `domain/process/object/types.go` | ⬜ |
| 2 | 数据库 Migration | 后端 | `infra/database/migrations/` | ⬜ |
| 3 | Store 接口+实现扩展 | 后端 | `domain/process/store/` | ⬜ |
| 4 | Service 并发检测 | 后端 | `domain/process/service/service.go` | ⬜ |
| 5 | Process Handler 新增 ActiveCheck | 后端 | `domain/process/handler.go` | ⬜ |
| 6 | 路由注册 | 后端 | `gateway/server/server.go` | ⬜ |
| 7 | Orchestrator 并发校验+返回 processId | 后端 | `orchestrator/orchestrator.go` + `handler.go` | ⬜ |
| 8 | 前端 API 层扩展 | 前端 | `lib/process-api.ts` | ⬜ |
| 9 | 前端公共函数 | 前端 | `lib/process-start.ts` | ⬜ |
| 10 | RestartFlowDialog 组件 | 前端 | `components/chat/RestartFlowDialog.tsx` | ⬜ |
| 11 | 入口组件改造 | 前端 | `FileAttachmentCard.tsx` + `InlineFilePreview.tsx` | ⬜ |
| 12 | 验证 | 全栈 | 构建 + 启动 + curl | ⬜ |

---

## 任务 1：数据模型变更

**文件**：`apps/dh-backend/domain/process/object/types.go`

### 1a. Process 结构体新增 `SourceDocPath` 字段（`Process` struct 中）

在 `UpdatedAt` 之后添加：

```go
SourceDocPath string `json:"sourceDocPath,omitempty"`
```

### 1b. CreateProcessRequest 新增 `SourceDocPath` 字段

在 `WorkitemID` 和 `Title` 之间添加：

```go
SourceDocPath string `json:"sourceDocPath,omitempty"`
```

### 1c. NewProductProcess 函数签名新增 `docPath` 参数

```go
func NewProductProcess(workspaceID, workitemID, title, docPath string) *Process {
```

并在 return 的 Process 中添加 `SourceDocPath: docPath`。

### 1d. 新增 `StageStatusTerminated` 常量

在 `StageStatusFailed` 之后：

```go
StageStatusTerminated = "terminated"
```

### 1e. 新增错误码常量

**文件**：`apps/dh-backend/gateway/handler/common.go`

在 `ErrCodeForbidden` 之后：

```go
ErrCodeProductFlowInProgress = 40901
```

### 1f. FlowContext.CreateProcess 需要从 Process 传递 SourceDocPath

**文件**：`apps/dh-backend/orchestrator/core/context.go` 中 `CreateProcess` 方法

在 `CreateProcessRequest` 中添加 `SourceDocPath: proc.SourceDocPath`。

---

## 任务 2：数据库 Migration

**文件**：`infra/database/migrations/2026_08_12_add_source_doc_path.sql`

```sql
ALTER TABLE processes ADD COLUMN source_doc_path VARCHAR(512) DEFAULT '';
CREATE INDEX idx_processes_workitem_doc ON processes(workitem_id, source_doc_path);
```

> 注：如果 `source_doc_path` 为空字符串，则索引中也不会有冲突条目，自然不会触发并发检查。

---

## 任务 3：Store 接口+实现扩展

### 3a. ProcessStore 接口新增方法

**文件**：`apps/dh-backend/domain/process/store/store.go`

```go
ListByWorkitemAndDoc(ctx context.Context, workitemID, sourceDocPath string) ([]object.Process, error)
```

### 3b. db_store.go 实现

**文件**：`apps/dh-backend/domain/process/store/db_store.go`

实现 `ListByWorkitemAndDoc`：
- SQL: `SELECT * FROM processes WHERE workitem_id = $1 AND source_doc_path = $2 ORDER BY created_at DESC`
- `sourceDocPath` 为空时直接返回空列表（无 source_doc_path 的老数据不参与并发检测）

### 3c. memory_store.go 实现

**文件**：`apps/dh-backend/domain/process/store/memory_store.go`

实现 `ListByWorkitemAndDoc`：
- 遍历内存 map，过滤 `workitemID` + `sourceDocPath` 匹配的记录
- `sourceDocPath` 为空时直接返回空列表

---

## 任务 4：Service 并发检测

### 4a. ProcessService 接口新增方法

**文件**：`apps/dh-backend/domain/process/service/service.go`

```go
ListByWorkitemAndDoc(ctx context.Context, workitemID, sourceDocPath string) ([]object.Process, error)
```

### 4b. 实现 ListByWorkitemAndDoc（代理到 store）

### 4c. 实现 HasInProgress 方法

```go
func (s *processService) HasInProgress(ctx context.Context, workitemID, sourceDocPath string) (bool, error) {
    if sourceDocPath == "" {
        return false, nil
    }
    list, err := s.store.ListByWorkitemAndDoc(ctx, workitemID, sourceDocPath)
    if err != nil {
        return false, err
    }
    for _, p := range list {
        if hasInProgressStage(p.Stages) {
            return true, nil
        }
    }
    return false, nil
}

func hasInProgressStage(stages []object.ProcessStage) bool {
    for _, s := range stages {
        if s.Status == object.StageStatusPending || s.Status == object.StageStatusInProgress {
            return true
        }
    }
    return false
}
```

---

## 任务 5：Process Handler 新增 ActiveCheck

**文件**：`apps/dh-backend/domain/process/handler.go`

新增 `ActiveCheck` 处理函数：

```go
func ActiveCheck(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    if defaultProcessService == nil {
        notInitialized(w)
        return
    }
    workitemID := r.URL.Query().Get("workitemId")
    docPath := r.URL.Query().Get("docPath")
    if workitemID == "" || docPath == "" {
        handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "workitemId and docPath are required")
        return
    }
    hasInProgress, err := defaultProcessService.HasInProgress(r.Context(), workitemID, docPath)
    if err != nil {
        handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
        return
    }
    json.NewEncoder(w).Encode(map[string]any{
        "hasInProgress": hasInProgress,
    })
}
```

---

## 任务 6：路由注册

**文件**：`apps/dh-backend/gateway/server/server.go`

### 6a. 新增路由常量

```go
ROUTE_GET_PROCESSES_ACTIVE_CHECK = http.MethodGet + " " + API_V1_PREFIX + "/processes/active-check"
```

### 6b. 注册 handler

在 process 路由组附近添加：

```go
mux.Handle(ROUTE_GET_PROCESSES_ACTIVE_CHECK, middleware.Auth(http.HandlerFunc(process.ActiveCheck)))
```

---

## 任务 7：Orchestrator 并发校验+返回 processId

### 7a. Orchestrator 新增 processMutex

**文件**：`apps/dh-backend/orchestrator/orchestrator.go`

在 `Orchestrator` 结构体中添加：

```go
processMutex sync.Mutex
```

### 7b. StartProductFlow 改造

1. 新增 `docPath` 参数
2. 使用 mutex 保护并发校验
3. 将 `docPath` 传入 `FlowContext` 和 `NewProductProcess`
4. 返回值改为 `(processID string, err error)`

```go
func (o *Orchestrator) StartProductFlow(ctx context.Context, userID, userName, workspaceID, tenantID, workitemID, workitemTitle, workitemDesc, workspacePath, docPath string) (string, error)
```

**并发校验逻辑**（在 mutex 锁内）：
1. 如果 `docPath != ""`，调用 `process.GetService().HasInProgress(ctx, workitemID, docPath)`
2. 如果返回 `hasInProgress=true`，返回 `("", ErrProductFlowInProgress)`
3. 否则正常启动流程

进程 ID 通过 `safego.Go` 中的 goroutine 无法直接获取返回。解决方案：**先生成 Process，在流程启动前拿到 processId**。

在 `StartProductFlow` 中同步创建 Process 并获取 ID，然后将 ID 传入 FlowContext：

```go
proc := processobject.NewProductProcess(workspaceID, workitemID, workitemTitle, docPath)
created, err := process.GetService().Create(ctx, ...)
if err != nil {
    return "", err
}
processID = created.ID
// 然后启动 goroutine，FlowContext 中携带 processID
```

但当前 `product_flow_nodes.go` 中的 `ProductRequirementNode.Input` 也调用了 `NewProductProcess` + `CreateProcess`。需要修改：让 `FlowContext` 中已经有 processID 时，跳过 Input 中的创建逻辑。

修改 `ProductRequirementNode.Input`：

```go
func (n *ProductRequirementNode) Input(fc *core.FlowContext) error {
    if fc.ProcessID != "" {
        // processID 已在 StartProductFlow 中预创建，跳过
        return nil
    }
    proc := processobject.NewProductProcess(fc.WorkspaceID, fc.WorkitemID, fc.WorkitemTitle, fc.DocPath)
    created := fc.CreateProcess(proc)
    fc.ProcessID = created.ID
    return nil
}
```

### 7c. FlowContext 新增 DocPath 字段

**文件**：`apps/dh-backend/orchestrator/core/context.go`

在 `FlowContext` 中添加：

```go
DocPath string
```

### 7d. Handler 改造

**文件**：`apps/dh-backend/orchestrator/handler.go`

1. `StartProductFlowRequest` 新增 `DocPath` 字段
2. 调用 `h.Orchestrator.StartProductFlow` 时传入 `req.DocPath`
3. 接收返回的 `processID` 和 `err`
4. 如果 err 是并发冲突错误（自定义 sentinel error），返回 409 + code 40901
5. 成功时返回 `{"code": 0, "message": "product flow started", "processId": processID}`

### 7e. 定义 sentinel error

**文件**：`apps/dh-backend/orchestrator/orchestrator.go`

```go
var ErrProductFlowInProgress = errors.New("product flow already in progress for this document")
```

Handler 中通过 `errors.Is(err, ErrProductFlowInProgress)` 判断，返回 409。

---

## 任务 8：前端 API 层扩展

**文件**：`apps/dh-frontend/src/lib/process-api.ts`

### 8a. 新增错误码常量

```ts
export const ERROR_CODES = {
  PRODUCT_FLOW_IN_PROGRESS: 40901,
} as const;
```

### 8b. STAGE_STATUS 新增 TERMINATED

```ts
TERMINATED: 'terminated',
```

### 8c. StartProductFlowRequest 新增 docPath

```ts
export interface StartProductFlowRequest {
  workspaceId: string;
  tenantId?: string;
  workitemId: string;
  workitemTitle: string;
  workitemDesc: string;
  docPath?: string;  // 新增
}
```

### 8d. processApi 新增 checkActiveProcess

```ts
/** 检查指定文档是否有进行中的产品流程 */
checkActiveProcess: (workitemId: string, docPath: string) =>
    api.get<{ hasInProgress: boolean }>(
      `/v1/processes/active-check?workitemId=${encodeURIComponent(workitemId)}&docPath=${encodeURIComponent(docPath)}`
    ),
```

### 8e. 返回值类型调整

`startProductFlow` 返回值改为：

```ts
api.post<{ code: number; message: string; processId?: string }>('/v1/orchestrator/product-flow', req),
```

---

## 任务 9：前端公共函数

**文件**：`apps/dh-frontend/src/lib/process-start.ts`（新建）

```ts
import { processApi } from './process-api';

export async function startProductFlowWithCheck(params: {
  workspaceId: string;
  workitemId: string;
  workitemTitle: string;
  workitemDesc: string;
  docPath?: string;
  onInProgress: () => void;
  onSuccess: (processId: string) => void;
  onError: (msg: string) => void;
}): Promise<void> {
  const { workspaceId, workitemId, workitemTitle, workitemDesc, docPath, onInProgress, onSuccess, onError } = params;

  try {
    if (docPath) {
      const checkResult = await processApi.checkActiveProcess(workitemId, docPath);
      if (checkResult.hasInProgress) {
        onInProgress();
        return;
      }
    }
    const result = await processApi.startProductFlow({
      workspaceId, workitemId, workitemTitle, workitemDesc, docPath,
    });
    if (result.code === 0) {
      onSuccess(result.processId || '');
    } else {
      onError(result.message || '未知错误');
    }
  } catch (err) {
    console.error('[process-start] start product flow failed:', err);
    const msg = err instanceof Error ? err.message : '';
    onError(msg || '启动AI需求设计流程失败，请重试');
  }
}
```

---

## 任务 10：RestartFlowDialog 组件

**文件**：`apps/dh-frontend/src/components/chat/RestartFlowDialog.tsx`（新建）

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface RestartFlowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const RestartFlowDialog: React.FC<RestartFlowDialogProps> = ({ open, onOpenChange, onConfirm }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>已有进行中的流程</AlertDialogTitle>
        <AlertDialogDescription>
          当前文档已有进行中的 AI 需求设计流程，确认重新发起将保留旧流程记录并创建新流程。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>取消</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>
          确认重新发起
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
```

---

## 任务 11：入口组件改造

### 11a. FileAttachmentCard.tsx

1. 导入 `useNavigate`、`startProductFlowWithCheck`、`RestartFlowDialog`
2. 新增状态：`restartDialogOpen`
3. 改造 `handleStartProductFlow`：

```ts
const navigate = useNavigate();
const [restartDialogOpen, setRestartDialogOpen] = useState(false);

const handleStartProductFlow = async (e: React.MouseEvent) => {
  e.stopPropagation();
  if (!workspaceId || !workitemId) return;
  setStartingFlow(true);
  await startProductFlowWithCheck({
    workspaceId,
    workitemId,
    workitemTitle: displayTitle,
    workitemDesc: '',
    docPath: path,
    onInProgress: () => {
      setStartingFlow(false);
      setRestartDialogOpen(true);
    },
    onSuccess: (processId) => {
      toast.success('AI需求设计流程已启动');
      navigate(`/personal/flow/${processId}`);
    },
    onError: (msg) => {
      toast.error(msg);
    },
  });
  setStartingFlow(false);
};
```

4. 在 JSX 中添加 RestartFlowDialog：

```tsx
<RestartFlowDialog
  open={restartDialogOpen}
  onOpenChange={setRestartDialogOpen}
  onConfirm={() => {
    setRestartDialogOpen(false);
    setStartingFlow(true);
    processApi.startProductFlow({...}).then(res => {
      if (res.processId) navigate(`/personal/flow/${res.processId}`);
    }).catch(err => toast.error(err.message)).finally(() => setStartingFlow(false));
  }}
/>
```

> 注：确认重新发起时不走前端检查（直接调 API，后端并发锁处理）；入口点 "无进行中"时走前端检测 + 后端双保险。

### 11b. InlineFilePreview.tsx

同样改造，引入 `useNavigate`、`startProductFlowWithCheck`、`RestartFlowDialog`。

---

## 任务 12：验证

```bash
# 1. 构建
pnpm build

# 2. 启动
bash scripts/restart-dev.sh

# 3. 验证接口
curl -s "http://localhost:8080/api/v1/processes/active-check?workitemId=test&docPath=/test/brainstorm/test.md" | jq .

# 4. 启动产品流程（含 docPath）
curl -s -X POST "http://localhost:8080/api/v1/orchestrator/product-flow" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{"workspaceId":"ws1","workitemId":"test","workitemTitle":"test","workitemDesc":"","docPath":"/test/brainstorm/test.md"}' | jq .

# 5. 再次发起相同 docPath，验证 409 返回
```
