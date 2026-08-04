# 胖接口违反接口隔离原则（ISP）

## 现象

代码审查发现三个核心 domain 服务接口方法数过多，强迫调用方依赖大量不需要的方法：

| 接口 | 方法数 | 混杂职责 |
|------|--------|---------|
| `ProductSpaceService` | 29 | item CRUD、version、folder、comment、prototype share、requirement share、import、file serve、cleanup task |
| `WorkspaceService` | 24 | workspace CRUD、members、agent config、standards、CICD、workitem project |
| `ProductDocService` | 23 | doc CRUD、version、folder、materialize、share/comments |

例如 `prototype_share_handler.go` 只使用原型分享相关方法，却不得不依赖包含 29 个方法的 `ProductSpaceService`；新增一个与当前 handler 无关的方法也会触发重新编译。

## 根因

1. 各 domain 的 `service/service.go` 将所有职责塞进单一接口。
2. Handler 层通过全局变量或单字段持有完整接口，未按子域按需依赖。
3. 前期缺少 ISP 约束，导致接口随需求增长不断膨胀。

## 解决方案

### ProductSpace 拆分

在 `apps/dh-backend/domain/productspace/service/service.go` 拆分为 8 个子接口：
- `ProductSpaceItemService`
- `ProductSpaceFolderService`
- `ProductSpaceCommentService`
- `ProductSpaceFileService`
- `ProductSpacePrototypeShareService`
- `ProductSpaceRequirementShareService`
- `ProductSpaceImportService`
- `ProductSpaceCleanupTaskService`

保留 `ProductSpaceService` 作为组合接口（embed 全部子接口），便于实现侧与过渡使用。`DBProductSpaceService` 仍实现全部方法，因此同时满足所有子接口。

`domain/productspace/handler.go` 改为持有子接口字段，各 handler 文件只访问自己需要的子服务：
- `item_handler.go` → `itemSvc` / `folderSvc` / `fileSvc`
- `comment_handler.go` → `commentSvc` / `fileSvc`
- `prototype_share_handler.go` → `protoShareSvc`
- `requirement_share_handler.go` → `reqShareSvc`
- `import_handler.go` → `importSvc`

### Workspace 拆分

在 `apps/dh-backend/domain/workspace/service/service.go` 拆分为 7 个子接口：
- `WorkspaceCRUDService`
- `WorkspaceDirectoryService`
- `WorkspaceMemberService`
- `WorkspaceAgentService`
- `WorkspaceStandardService`
- `WorkspaceCICDService`
- `WorkspaceWorkitemProjectService`

`domain/workspace/handler.go` 从全局 `defaultService` 改为 struct-based `Handler`，持有各子接口字段，并新增 `NewHandler(...)` 构造函数。

### ProductDoc 拆分

在 `apps/dh-backend/domain/productdoc/service/service.go` 拆分为 5 个子接口：
- `ProductDocCRUDService`
- `ProductDocVersionService`
- `ProductDocFolderService`
- `ProductDocMaterializeService`
- `ProductDocShareService`

`domain/productdoc/handler.go` 同样改为 struct-based 并注入子接口。

### 注入点调整

`apps/dh-backend/gateway/server/server.go` 中：
- `productspace` 使用 `NewHandler` 并传入子接口参数与 `WorkItemDocLinker` 适配器。
- `workspace` 与 `productdoc` 改为构造 `Handler` 实例，并用实例方法注册路由，替代原来的包级函数 + 全局变量模式。

## 验证

- `cd apps/dh-backend && go build ./... && go vet ./...` 通过
- `cd packages/go-sdk && go build ./... && go vet ./...` 通过
- `cd apps/personal-stub && go build ./... && go vet ./...` 通过
- `pnpm build` 通过
- `pnpm --filter @repo/dh-frontend check-types` 通过
- `bash scripts/restart-dev.sh` 重启后，health 检查均正常
