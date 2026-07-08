# 产品空间功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 DeepHarness 平台上为 PM 角色实现产品空间，支持 `docs`/`prototypes` 一级子目录、文档/原型的数据库版本管理，并在前端 `ProductWorkspace` 中集成目录树、编辑器、预览器和版本面板。

**Architecture:** 后端新增 `domain/productspace` 模块，复用并扩展 `product_docs`/`product_doc_versions` 表，所有文件操作限制在 `WORKSPACE_ROOT/{ws}/{user}/products` 下；前端重构 `ProductWorkspace`，按 `sub_role=pm` 展示产品空间。同步修正 `workspace_path.go` 使目录 owner 为当前登录用户。

**Tech Stack:** Go 1.22 + PostgreSQL + React 18 + TypeScript + Vite + shadcn/ui + Tailwind CSS

---

## 任务清单

- [ ] Task 1: 数据库 Schema 迁移
- [ ] Task 2: 修正 workspace 路径为当前登录用户
- [ ] Task 3: 后端 ProductSpace 对象类型与常量
- [ ] Task 4: 后端 ProductSpace Service 接口与实现
- [ ] Task 5: 后端 ProductSpace HTTP Handler 与路由注册
- [ ] Task 6: 前端 ProductSpace API 模块与类型
- [ ] Task 7: 前端 ProductSpaceTree 目录树组件
- [ ] Task 8: 前端 DocEditor + PrototypeViewer + VersionPanel
- [ ] Task 9: 重构 ProductWorkspace 页面
- [ ] Task 10: 构建、类型检查与编译验证

---

## Task 1: 数据库 Schema 迁移

**Files:**
- Create: `infra/database/productdoc/migration-20260708-product-space.sql`

**Steps:**
- [ ] **Step 1: 编写迁移脚本**

```sql
-- 产品空间功能：扩展 product_docs / product_doc_versions 表

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS user_id VARCHAR(36) NOT NULL DEFAULT '';

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'doc';

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS relative_path VARCHAR(1000) NOT NULL DEFAULT '';

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1;

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS file_ext VARCHAR(50);

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS mime_type VARCHAR(200);

ALTER TABLE product_docs
    ADD COLUMN IF NOT EXISTS size_bytes BIGINT;

-- 旧表有 (workspace_id, slug) 唯一约束；产品空间改用 (workspace_id, user_id, relative_path)
ALTER TABLE product_docs
    DROP CONSTRAINT IF EXISTS product_docs_workspace_id_slug_key;

ALTER TABLE product_docs
    ADD CONSTRAINT product_docs_ws_user_path UNIQUE (workspace_id, user_id, relative_path);

CREATE INDEX IF NOT EXISTS idx_product_docs_workspace_user ON product_docs (workspace_id, user_id);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS file_path VARCHAR(2000);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS file_ext VARCHAR(50);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS mime_type VARCHAR(200);

ALTER TABLE product_doc_versions
    ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
```

- [ ] **Step 2: 验证迁移语法**

Run:
```bash
cd /home/nan/deepharness/deepharness-ent-platform/.worktrees/feature-product-space
# 如果本地有 PostgreSQL 容器，可执行：
# psql -h localhost -U dh -d dh -f infra/database/productdoc/migration-20260708-product-space.sql
# 否则仅做语法检查（无数据库时跳过）
```

Expected: 无语法错误。

---

## Task 2: 修正 workspace 路径为当前登录用户

**Files:**
- Modify: `apps/dh-backend/gateway/handler/workspace_path.go`
- Modify: `apps/dh-backend/domain/workspace/service/db_service.go`
- Modify: 调用 `resolveWorkspacePath` 的地方（搜索后修改）

**Context:**
现有 `resolveWorkspacePath` 使用 workspace 最老成员 user_id。产品空间要求目录 owner 为当前登录用户，研发空间也确认应如此。

**Steps:**
- [ ] **Step 1: 修改 `resolveWorkspacePath` 签名，接受当前 user_id**

将 `resolveWorkspacePath(workspaceID, workspaceRoot, workspaceService)` 改为 `resolveWorkspacePath(workspaceID, userID, workspaceRoot)`。

```go
func resolveWorkspacePath(workspaceID, userID, workspaceRoot string) (string, error) {
    if workspaceID == "" || userID == "" || workspaceRoot == "" {
        return "", errors.New("workspaceID, userID and workspaceRoot are required")
    }
    p := filepath.Join(workspaceRoot, workspaceID, userID)
    if err := ensureWorkspaceDir(p); err != nil {
        return "", err
    }
    return p, nil
}
```

- [ ] **Step 2: 更新 `EnsureUserWorkspaceDirs`**

在 `db_service.go` 中，当创建用户目录时，使用传入的 `userID` 而非查找最老成员。

```go
func (s *DBWorkspaceService) EnsureUserWorkspaceDirs(ctx context.Context, workspaceID, userID string) error {
    base := filepath.Join(s.workspaceRoot, workspaceID, userID)
    dirs := []string{
        filepath.Join(base, "projects"),
        filepath.Join(base, "files"),
        filepath.Join(base, "products", "docs"),
        filepath.Join(base, "products", "prototypes"),
    }
    for _, d := range dirs {
        if err := os.MkdirAll(d, 0755); err != nil {
            return fmt.Errorf("create dir %s: %w", d, err)
        }
    }
    return nil
}
```

- [ ] **Step 3: 搜索并更新所有 `resolveWorkspacePath` 调用点**

Run:
```bash
cd /home/nan/deepharness/deepharness-ent-platform/.worktrees/feature-product-space
grep -rn "resolveWorkspacePath" apps/dh-backend/
```

Expected: 列出所有调用点。逐个修改，把当前 userID 从 context/request 中取出传入。

---

## Task 3: 后端 ProductSpace 对象类型与常量

**Files:**
- Create: `apps/dh-backend/domain/productspace/object/types.go`
- Create: `apps/dh-backend/domain/productspace/object/constants.go`

**Steps:**
- [ ] **Step 1: 创建常量文件**

```go
package object

const (
    ProductSpaceRoot        = "products"
    ProductSpaceDocsDir     = "docs"
    ProductSpacePrototypesDir = "prototypes"

    ItemTypeDoc       = "doc"
    ItemTypePrototype = "prototype"

    DocExtMarkdown = "md"
    DocExtText     = "txt"

    MaxPrototypeSizeBytes = 50 * 1024 * 1024 // 50MB
)

var AllowedDocExts = map[string]bool{"md": true, "txt": true}
var AllowedPrototypeExts = map[string]bool{"png": true, "jpg": true, "jpeg": true, "pdf": true}
```

- [ ] **Step 2: 创建请求/响应类型**

```go
package object

import "time"

type ProductSpaceItem struct {
    ID             string    `json:"id"`
    WorkspaceID    string    `json:"workspace_id"`
    UserID         string    `json:"user_id"`
    Type           string    `json:"type"` // doc | prototype
    Title          string    `json:"title"`
    RelativePath   string    `json:"relative_path"`
    CurrentVersion int       `json:"current_version"`
    FileExt        string    `json:"file_ext"`
    MimeType       string    `json:"mime_type"`
    SizeBytes      int64     `json:"size_bytes"`
    Status         string    `json:"status"`
    CreatedBy      string    `json:"created_by"`
    CreatedAt      time.Time `json:"created_at"`
    UpdatedAt      time.Time `json:"updated_at"`
}

type ProductSpaceVersion struct {
    ID           string    `json:"id"`
    DocID        string    `json:"doc_id"`
    Version      int       `json:"version"`
    Title        string    `json:"title"`
    FilePath     string    `json:"file_path"`
    FileExt      string    `json:"file_ext"`
    MimeType     string    `json:"mime_type"`
    SizeBytes    int64     `json:"size_bytes"`
    ChangeSummary string   `json:"change_summary"`
    CreatedBy    string    `json:"created_by"`
    CreatedAt    time.Time `json:"created_at"`
}

type ProductSpaceTreeNode struct {
    Name     string                `json:"name"`
    Path     string                `json:"path"`
    Type     string                `json:"type"` // folder | doc | prototype
    Children []ProductSpaceTreeNode `json:"children,omitempty"`
}

// Requests

type CreateItemRequest struct {
    Type         string `json:"type" validate:"required,oneof=doc prototype"`
    Title        string `json:"title" validate:"required,max=500"`
    Folder       string `json:"folder"` // 一级子目录名，可为空
    Content      string `json:"content"` // doc 初始内容
    FileData     []byte `json:"file_data,omitempty"` // prototype base64 或 raw bytes
}

type UpdateContentRequest struct {
    Content      string `json:"content"`
    ChangeSummary string `json:"change_summary"`
}

type CreateFolderRequest struct {
    Category string `json:"category" validate:"required,oneof=docs prototypes"`
    Name     string `json:"name" validate:"required,max=200"`
}

type DeleteFolderRequest struct {
    Category string `json:"category" validate:"required,oneof=docs prototypes"`
    Name     string `json:"name" validate:"required"`
}
```

---

## Task 4: 后端 ProductSpace Service 接口与实现

**Files:**
- Create: `apps/dh-backend/domain/productspace/service/service.go`（接口）
- Create: `apps/dh-backend/domain/productspace/service/db_service.go`（实现）

**Steps:**
- [ ] **Step 1: 定义 Service 接口**

```go
package service

import (
    "context"
    "apps/dh-backend/domain/productspace/object"
)

type ProductSpaceService interface {
    GetTree(ctx context.Context, workspaceID, userID string) ([]object.ProductSpaceTreeNode, error)
    CreateItem(ctx context.Context, workspaceID, userID string, req object.CreateItemRequest) (*object.ProductSpaceItem, error)
    GetItem(ctx context.Context, workspaceID, userID, itemID string) (*object.ProductSpaceItem, []byte, error)
    UpdateContent(ctx context.Context, workspaceID, userID, itemID string, req object.UpdateContentRequest) (*object.ProductSpaceItem, error)
    ListVersions(ctx context.Context, workspaceID, userID, itemID string) ([]object.ProductSpaceVersion, error)
    RestoreVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (*object.ProductSpaceItem, error)
    DeleteItem(ctx context.Context, workspaceID, userID, itemID string) error
    CreateFolder(ctx context.Context, workspaceID, userID string, req object.CreateFolderRequest) error
    DeleteFolder(ctx context.Context, workspaceID, userID string, req object.DeleteFolderRequest) error
    DownloadVersion(ctx context.Context, workspaceID, userID, itemID string, version int) (string, []byte, error)
}
```

- [ ] **Step 2: 实现 DBProductSpaceService**

实现要点：
- 使用 `uuid.NewString()` 生成 ID。
- 路径拼接：`<workspaceRoot>/<workspaceID>/<userID>/products/<category>/<folder>/<name>.<ext>`。
- `relative_path` 存储为 `<category>/<folder>/<name>.<ext>`（folder 为空则 `<category>/<name>.<ext>`）。
- 创建条目时：version=1，写入当前文件，不带 `-v1` 后缀。
- 更新内容时：把当前文件复制为 `-v{current_version}.ext`，写入新当前文件，`current_version++`，插入版本记录。
- 使用 `filepath.Clean` + 检查 `..` 防止路径遍历。
- 文件扩展名校验使用 `object.AllowedDocExts` / `object.AllowedPrototypeExts`。
- 数据库操作使用 `*sql.DB` 和标准 SQL。

由于实现较长，请在文件中分小函数实现：
- `resolveItemPath(workspaceID, userID, relativePath string) (string, error)`
- `validateRelativePath(relativePath string) error`
- `writeCurrentFile(absPath string, content []byte) error`
- `copyFile(src, dst string) error`
- `deleteVersionFiles(baseDir, name, ext string) error`

---

## Task 5: 后端 ProductSpace HTTP Handler 与路由注册

**Files:**
- Create: `apps/dh-backend/domain/productspace/handler.go`
- Modify: `apps/dh-backend/gateway/server/server.go` 或路由注册文件

**Steps:**
- [ ] **Step 1: 实现 Handler**

```go
package productspace

import (
    "encoding/json"
    "net/http"
    "strconv"

    "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
    "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
    "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

type Handler struct {
    service service.ProductSpaceService
}

func NewHandler(svc service.ProductSpaceService) *Handler {
    return &Handler{service: svc}
}

// RegisterRoutes 注册到传入的 mux
func (h *Handler) RegisterRoutes(mux *http.ServeMux, middleware ...func(http.Handler) http.Handler) {
    base := "/api/v1/workspaces/"
    // 路由模式使用 Go 1.22 的 pattern：GET /api/v1/workspaces/{id}/product-space/tree
    mux.HandleFunc(base+"{id}/product-space/tree", handler.WithAuth(h.GetTree))
    mux.HandleFunc(base+"{id}/product-space/items", handler.WithAuth(h.CreateItem))
    mux.HandleFunc(base+"{id}/product-space/items/{itemId}", handler.WithAuth(h.ItemByID))
    mux.HandleFunc(base+"{id}/product-space/items/{itemId}/content", handler.WithAuth(h.UpdateContent))
    mux.HandleFunc(base+"{id}/product-space/items/{itemId}/versions", handler.WithAuth(h.ListVersions))
    mux.HandleFunc(base+"{id}/product-space/items/{itemId}/versions/{version}/restore", handler.WithAuth(h.RestoreVersion))
    mux.HandleFunc(base+"{id}/product-space/items/{itemId}/download", handler.WithAuth(h.DownloadVersion))
    mux.HandleFunc(base+"{id}/product-space/folders", handler.WithAuth(h.Folders))
}

// ... 各方法实现：从 context 取 userID，解析 workspaceID，校验 pm 权限，调用 service
```

- [ ] **Step 2: 集成到 server**

在 `apps/dh-backend/gateway/server/server.go` 中：
1. 初始化 `ProductSpaceService`：传入 `*sql.DB` 和 `workspaceRoot`。
2. 初始化 `productspace.NewHandler(svc)`。
3. 调用 `handler.RegisterRoutes(mux)`。

- [ ] **Step 3: 权限中间件**

在 handler 层或 middleware 中校验 `sub_role = pm`。可先通过 `workspaceService.GetMemberRole(workspaceID, userID)` 获取 membership，检查 `SubRole == "pm"`。

---

## Task 6: 前端 ProductSpace API 模块与类型

**Files:**
- Create: `apps/dh-frontend/src/lib/productspace-api.ts`
- Modify: `apps/dh-frontend/src/types/index.ts`

**Steps:**
- [ ] **Step 1: 定义类型**

```ts
export interface ProductSpaceItem {
  id: string;
  workspace_id: string;
  user_id: string;
  type: 'doc' | 'prototype';
  title: string;
  relative_path: string;
  current_version: number;
  file_ext: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProductSpaceVersion {
  id: string;
  doc_id: string;
  version: number;
  title: string;
  file_path: string;
  file_ext: string;
  mime_type: string;
  size_bytes: number;
  change_summary: string;
  created_by: string;
  created_at: string;
}

export interface ProductSpaceTreeNode {
  name: string;
  path: string;
  type: 'folder' | 'doc' | 'prototype';
  children?: ProductSpaceTreeNode[];
}

export interface CreateItemRequest {
  type: 'doc' | 'prototype';
  title: string;
  folder?: string;
  content?: string;
  file_data?: string; // base64
}

export interface CreateFolderRequest {
  category: 'docs' | 'prototypes';
  name: string;
}

export interface UpdateContentRequest {
  content: string;
  change_summary?: string;
}
```

- [ ] **Step 2: 创建 API 模块**

```ts
import { api } from './api';
import type {
  ProductSpaceItem,
  ProductSpaceVersion,
  ProductSpaceTreeNode,
  CreateItemRequest,
  CreateFolderRequest,
  UpdateContentRequest,
} from '@/types';

export const productSpaceApi = {
  getTree: (workspaceId: string) =>
    api.get<ProductSpaceTreeNode[]>(`/v1/workspaces/${workspaceId}/product-space/tree`),

  createItem: (workspaceId: string, req: CreateItemRequest) =>
    api.post<ProductSpaceItem>(`/v1/workspaces/${workspaceId}/product-space/items`, req),

  getItem: (workspaceId: string, itemId: string) =>
    api.get<ProductSpaceItem>(`/v1/workspaces/${workspaceId}/product-space/items/${itemId}`),

  updateContent: (workspaceId: string, itemId: string, req: UpdateContentRequest) =>
    api.put<ProductSpaceItem>(`/v1/workspaces/${workspaceId}/product-space/items/${itemId}/content`, req),

  listVersions: (workspaceId: string, itemId: string) =>
    api.get<ProductSpaceVersion[]>(`/v1/workspaces/${workspaceId}/product-space/items/${itemId}/versions`),

  restoreVersion: (workspaceId: string, itemId: string, version: number) =>
    api.post<ProductSpaceItem>(`/v1/workspaces/${workspaceId}/product-space/items/${itemId}/versions/${version}/restore`),

  deleteItem: (workspaceId: string, itemId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/product-space/items/${itemId}`),

  createFolder: (workspaceId: string, req: CreateFolderRequest) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/product-space/folders`, req),

  deleteFolder: (workspaceId: string, req: CreateFolderRequest) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/product-space/folders`, { body: req } as RequestInit),

  downloadVersion: (workspaceId: string, itemId: string, version: number) =>
    `/api/v1/workspaces/${workspaceId}/product-space/items/${itemId}/download?version=${version}`,
};
```

---

## Task 7: 前端 ProductSpaceTree 目录树组件

**Files:**
- Create: `apps/dh-frontend/src/components/workspace/ProductSpaceTree.tsx`

**Steps:**
- [ ] **Step 1: 实现组件**

功能：
- 从 API 加载 tree 数据。
- 左侧渲染两个顶层分类：`文档`（docs）和 `原型`（prototypes）。
- 每个分类下展示一级子目录及其文件。
- 支持右键/按钮：新建子目录、新建文档、上传原型、删除条目/空目录。
- 点击文件触发 `onSelectItem(item)`。

UI 结构：
```tsx
<div className="flex flex-col h-full">
  <div className="flex items-center justify-between p-3 border-b">
    <span className="font-medium">产品空间</span>
    <DropdownMenu>...</DropdownMenu>
  </div>
  <ScrollArea className="flex-1">
    {/* docs section */}
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex items-center w-full px-3 py-2 hover:bg-accent">
        <FileText className="w-4 h-4 mr-2" /> 文档
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* folders and docs */}
      </CollapsibleContent>
    </Collapsible>
    {/* prototypes section */}
    <Collapsible defaultOpen>
      ...
    </Collapsible>
  </ScrollArea>
</div>
```

---

## Task 8: 前端 DocEditor + PrototypeViewer + VersionPanel

**Files:**
- Create: `apps/dh-frontend/src/components/workspace/DocEditor.tsx`
- Create: `apps/dh-frontend/src/components/workspace/PrototypeViewer.tsx`
- Create: `apps/dh-frontend/src/components/workspace/VersionPanel.tsx`

**Steps:**
- [ ] **Step 1: DocEditor**

- 使用 `<textarea>` 或现有 Markdown 编辑器组件。
- props: `item: ProductSpaceItem; onSave: (content, changeSummary) => void`
- 底部显示当前版本号、保存按钮、版本说明输入框。
- 保存时调用 `productSpaceApi.updateContent`。

- [ ] **Step 2: PrototypeViewer**

- 根据 `mime_type` 渲染：
  - `image/*`：`<img src={downloadUrl} />`
  - `application/pdf`：`<iframe src={downloadUrl} />`
- 提供版本切换下拉框。
- 上传新版本：读取 file 转 base64，调用 `updateContent`（后端扩展为接收 base64）。

- [ ] **Step 3: VersionPanel**

- 列表展示 `listVersions` 结果。
- 每行显示版本号、变更说明、创建时间、操作（恢复、下载）。
- 恢复版本时二次确认。

---

## Task 9: 重构 ProductWorkspace 页面

**Files:**
- Modify: `apps/dh-frontend/src/components/workspace/ProductWorkspace.tsx`

**Steps:**
- [ ] **Step 1: 重构页面布局**

```tsx
export const ProductWorkspace: React.FC = () => {
  const { membership } = useAuth();
  const [selectedItem, setSelectedItem] = useState<ProductSpaceItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => setRefreshKey(k => k + 1);

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      <div className="w-64 border-r bg-card">
        <ProductSpaceTree
          workspaceId={membership?.workspaceId}
          refreshKey={refreshKey}
          onSelectItem={setSelectedItem}
          onRefresh={handleRefresh}
        />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        {selectedItem ? (
          <>
            <div className="flex-1 overflow-auto p-6">
              {selectedItem.type === 'doc' ? (
                <DocEditor item={selectedItem} onSave={...} />
              ) : (
                <PrototypeViewer item={selectedItem} />
              )}
            </div>
            <div className="h-48 border-t bg-card p-4">
              <VersionPanel item={selectedItem} onRestore={...} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            选择一个文档或原型开始工作
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: 移除/保留现有标签**

现有 `ProductWorkspace` 有 doc/kanban/prototype/history 标签。重构后保留：
- 文档/原型通过左侧树管理。
- 看板/历史如果仍需要，可作为右侧Tab或单独保留；本次先 focus 产品空间，可简化或保留。

---

## Task 10: 构建、类型检查与编译验证

**Files:** 全部修改过的文件

**Steps:**
- [ ] **Step 1: 后端编译**

Run:
```bash
cd /home/nan/deepharness/deepharness-ent-platform/.worktrees/feature-product-space/apps/dh-backend
go build ./...
go vet ./...
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 2: 前端类型检查**

Run:
```bash
cd /home/nan/deepharness/deepharness-ent-platform/.worktrees/feature-product-space
npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json
```

Expected: 0 errors.

- [ ] **Step 3: 构建全部**

Run:
```bash
cd /home/nan/deepharness/deepharness-ent-platform/.worktrees/feature-product-space
pnpm build
```

Expected: 前端和后端均构建成功。

- [ ] **Step 4: 启动开发服务器验证**

Run:
```bash
cd /home/nan/deepharness/deepharness-ent-platform/.worktrees/feature-product-space
pnpm dev
```

Expected: 服务启动，PM 登录后访问 `/personal-space` 能看到产品空间目录树。

---

## 参考文件

- 设计文档：`docs/superpowers/specs/2026-07-08-product-space-design.md`
- 现有 workspace service：`apps/dh-backend/domain/workspace/service/db_service.go`
- 现有 workspace path 工具：`apps/dh-backend/gateway/handler/workspace_path.go`
- 现有 productdoc：`apps/dh-backend/domain/productdoc/`
- 现有 file handler：`apps/dh-backend/gateway/handler/files.go`
- 现有 ProductWorkspace：`apps/dh-frontend/src/components/workspace/ProductWorkspace.tsx`
- 现有前端 API 模式：`apps/dh-frontend/src/lib/workspace-api.ts`
- 权限 hook：`apps/dh-frontend/src/hooks/use-permissions.ts`
- 角色常量：`apps/dh-frontend/src/lib/role-constants.ts`
