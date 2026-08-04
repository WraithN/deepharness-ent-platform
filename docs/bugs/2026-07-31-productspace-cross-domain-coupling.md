# productspace 跨 domain 直接依赖导致模块耦合

## 现象

`domain/productspace` 作为产品空间核心模块，直接 import 了其它 3 个 domain 的 service/object 包：

| 来源 | 目标 | 说明 |
|------|------|------|
| `domain/productspace/service/service.go` | `domain/productdoc/object` | 直接返回 `productdocobject.ShareComment` |
| `domain/productspace/service/requirement_share.go` | `domain/productdoc/object` | 扫描/返回 `productdocobject.ShareComment` |
| `domain/productspace/service/db_service.go` | `domain/workspace/service` | 使用 `workspaceservice.ErrMemberNotFound` |
| `domain/productspace/handler.go` | `domain/workitem/service` | 注入完整 `workitemservice.WorkItemService` |
| `domain/productspace/import_handler.go` | `domain/workitem/object` | 使用 `workitemobject.CreateDocLinkRequest` |
| `domain/productspace/import_handler.go` | `domain/workitem/service` | 调用 `CreateDocLink`、`GetWorkItem`、`CreateDesignVersion` |

这违反了 DDD 中 domain 模块应通过共享接口或领域事件解耦的原则。

## 根因

1. 缺少本地抽象：productspace 直接消费了其它 domain 的具体类型与具体服务实现。
2. `ErrMemberNotFound` 这类跨 domain 共享的哨兵错误放在单一 domain 包内，迫使其它 domain 反向依赖。
3. Handler 为了调用少量外部方法，引入了整个 service 包和 object 包。

## 解决方案

### 1. 消除对 productdoc/object 的依赖

在 `domain/productspace/object/types.go` 中定义自有的 `DocShareComment` 类型，字段与 `productdocobject.ShareComment` 完全一致：

```go
type DocShareComment struct {
    ID          string     `json:"id"`
    ShareToken  string     `json:"shareToken"`
    DocID       string     `json:"docId"`
    WorkspaceID string     `json:"workspaceId"`
    AuthorName  string     `json:"authorName"`
    QuoteText   string     `json:"quoteText"`
    Content     string     `json:"content"`
    Status      string     `json:"status"`
    CreatedAt   time.Time  `json:"createdAt"`
    ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
    ResolvedBy  string     `json:"resolvedBy,omitempty"`
}
```

`ProductSpaceRequirementShareService` 的两个方法改为返回 `*object.DocShareComment` / `[]object.DocShareComment`。`requirement_share.go` 内部在访问 productdoc 服务时做字段映射转换，删除对 `domain/productdoc/object` 的 import。

### 2. 消除对 workspace service 的依赖

将 `ErrMemberNotFound` 迁移到 `packages/go-sdk/common/errors.go` 作为共享哨兵错误：

```go
var ErrMemberNotFound = NotFoundErrorf("workspace member not found")
```

`domain/workspace/service/service.go` 移除本地定义，改用 `common.ErrMemberNotFound`；`domain/productspace/service/db_service.go` 的 `requirePM` / `requireMember` 也改用 `common.ErrMemberNotFound`，从而删除对 `domain/workspace/service` 的 import。

### 3. 消除对 workitem service/object 的依赖

在 `domain/productspace/handler.go` 中定义本地接口与请求类型：

```go
type WorkItemDocLinker interface {
    GetWorkItem(ctx context.Context, workspaceID, workitemID string) (workitem.WorkItem, error)
    CreateDocLink(ctx context.Context, req CreateDocLinkRequest) error
    CreateDesignVersion(ctx context.Context, workspaceID, workitemID, docID string) (workitem.WorkItem, error)
}

type CreateDocLinkRequest struct {
    WorkspaceID string
    WorkitemID  string
    DocID       string
    LinkType    string
}
```

`Handler` 的 `workItemSvc` 字段类型改为 `WorkItemDocLinker`。`import_handler.go` 移除 `domain/workitem/service` 和 `domain/workitem/object` 的 import，使用本地 `CreateDocLinkRequest`。

`domain/workitem/service.WorkItemService` 天然满足 `WorkItemDocLinker` 接口，`server.go` 中通过一个小型适配器 `workItemDocLinkerAdapter` 注入，保持编译期兼容。

## 验证

- `cd apps/dh-backend && go build ./... && go vet ./...` 通过
- `cd packages/go-sdk && go build ./... && go vet ./...` 通过
- `cd apps/personal-stub && go build ./... && go vet ./...` 通过
- `pnpm build` 通过
- `pnpm --filter @repo/dh-frontend check-types` 通过
- `bash scripts/restart-dev.sh` 重启后，health 检查均正常
