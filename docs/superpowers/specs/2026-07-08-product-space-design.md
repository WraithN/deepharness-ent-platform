# 产品空间功能设计文档

> 状态：已评审通过，待转入实现计划  
> 作者：AI Agent + 产品负责人  
> 日期：2026-07-08

---

## 1. 目标

为产品经理（PM）角色在产品工作区内提供一个专属的产品空间：
- 在磁盘目录 `WORKSPACE_ROOT/{workspace_id}/{user_id}/products` 下创建 `docs`（文档）和 `prototypes`（原型）两个系统目录。
- 支持在 `docs` 和 `prototypes` 下创建一级子目录。
- 支持文档和原型的版本化管理，版本历史存入数据库。
- 前端页面不直接展示 `docs/` 和 `prototypes/` 这两层系统目录，而是作为顶层分类展示其内容。

---

## 2. 范围与约束

- **仅 `sub_role = pm` 可使用产品空间**，其他角色不可见、不可访问。
- **目录 owner 为当前登录用户的 `user_id`**；同步修正现有 `EnsureUserWorkspaceDirs` / `resolveWorkspacePath` 中可能使用 workspace 最老成员 user_id 的逻辑，使研发空间也按当前登录用户隔离。
- **子目录仅支持一级**，但代码结构预留多级扩展。
- **复用现有 `product_docs` / `product_doc_versions` 表**并扩展字段，不新建表。
- 文档类型：Markdown / 文本；原型类型：图片（png/jpg/jpeg）/ PDF。

---

## 3. 数据模型

### 3.1 `product_docs` 主表扩展

```sql
ALTER TABLE product_docs
    ADD COLUMN user_id VARCHAR(36) NOT NULL,
    ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'doc', -- doc | prototype
    ADD COLUMN relative_path VARCHAR(1000) NOT NULL,    -- 示例：docs/产品需求/PRD.md
    ADD COLUMN current_version INT NOT NULL DEFAULT 1,
    ADD COLUMN file_ext VARCHAR(50),
    ADD COLUMN mime_type VARCHAR(200),
    ADD COLUMN size_bytes BIGINT;

ALTER TABLE product_docs
    DROP CONSTRAINT IF EXISTS product_docs_workspace_id_slug_key;

ALTER TABLE product_docs
    ADD CONSTRAINT product_docs_ws_user_path UNIQUE (workspace_id, user_id, relative_path);

CREATE INDEX IF NOT EXISTS idx_product_docs_workspace_user ON product_docs (workspace_id, user_id);
```

### 3.2 `product_doc_versions` 版本表扩展

```sql
ALTER TABLE product_doc_versions
    ADD COLUMN file_path VARCHAR(2000),  -- 磁盘绝对路径，如 .../products/docs/产品需求/PRD-v1.md
    ADD COLUMN file_ext VARCHAR(50),
    ADD COLUMN mime_type VARCHAR(200),
    ADD COLUMN size_bytes BIGINT;
```

---

## 4. 后端 API

前缀：`/api/v1/workspaces/{workspace_id}/product-space`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/tree` | 获取当前用户的 `docs` / `prototypes` 下一级子目录及文件树 |
| POST | `/items` | 创建文档或原型条目；同时写入磁盘当前版本文件 |
| GET | `/items/{id}` | 获取条目元数据 + 当前版本内容/预览 URL |
| PUT | `/items/{id}/content` | 更新内容；自动保存新版本到 `product_doc_versions` 并递增 `current_version` |
| GET | `/items/{id}/versions` | 获取版本历史列表 |
| POST | `/items/{id}/versions/{version}/restore` | 把指定版本复制为当前版本，并生成新版本记录 |
| DELETE | `/items/{id}` | 删除数据库记录、当前文件及所有历史版本文件 |
| POST | `/folders` | 在 `docs/` 或 `prototypes/` 下创建一级子目录 |
| DELETE | `/folders` | 删除空子目录 |
| GET | `/items/{id}/download?version={n}` | 下载指定版本文件 |

### 4.1 权限

- 仅当当前用户在该 workspace 的 membership `sub_role = pm` 时允许访问。
- 后端 middleware 与 service 层双重校验。

### 4.2 安全

- 路径遍历防护：`relative_path` 与目录名经过 `filepath.Clean` 校验，禁止包含 `..`。
- 文件类型白名单：文档 `md/txt`；原型 `png/jpg/jpeg/pdf`。
- 文件大小限制：原型单文件不超过 50MB（可配置常量）。
- 失败回滚：写磁盘成功但写库失败时，记录日志并尝试清理已写文件。

---

## 5. 磁盘目录与版本管理

### 5.1 目录结构

```text
WORKSPACE_ROOT/
  {workspace_id}/
    {user_id}/
      products/
        docs/
          产品需求/
            PRD.md              ← 当前版本
        prototypes/
          App首页/
            home.png            ← 当前版本
        versions/               ← 历史版本独立存放，避免与用户文件命名冲突
          docs/
            产品需求/
              PRD-v1.md
              PRD-v2.md
          prototypes/
            App首页/
              home-v1.png
              home-v2.png
```

### 5.2 版本命名

- 当前版本：`{name}.{ext}`，位于 `products/{docs|prototypes}/{folder}/`。
- 历史版本：`{name}-v{version}.{ext}`，位于 `products/versions/{docs|prototypes}/{folder}/`。
- `version` 从 1 开始，每次更新时递增。

### 5.3 核心流程

1. **创建条目**：数据库插入记录；磁盘写入初始文件（version=1，不带 `-v1` 后缀）。
2. **更新内容**：复制当前文件到 `products/versions/` 下的 `{name}-v{current_version}.ext`；写入新的当前文件；`current_version++`；插入版本记录。
3. **恢复版本**：从 `products/versions/` 复制 `文件名-v{n}.ext` 为新的当前文件；`current_version++`；在 `products/versions/` 插入新版本记录（change_summary 标记为“恢复至 v{n}”）。
4. **删除条目**：级联删除版本记录，同时删除当前文件及 `products/versions/` 下所有对应的历史版本文件。
5. **子目录操作**：仅允许在 `docs/` 或 `prototypes/` 下创建一级目录；删除前校验目录为空，并同步清理 `versions/` 下对应的空目录。

---

## 6. 前端设计

### 6.1 入口与路由

- 保持现有路由 `/personal-space`；`PersonalSpace` 对 `sub_role = pm` 渲染 `ProductWorkspace`。
- `ProductWorkspace` 内部用本地状态管理当前目录/文件/标签，暂不加 URL 子路由。

### 6.2 组件结构

| 组件 | 文件 | 职责 |
|------|------|------|
| `ProductWorkspace` | `src/components/workspace/ProductWorkspace.tsx` | 整体布局：目录树 + 内容区 + 版本面板 |
| `ProductSpaceTree` | `src/components/workspace/ProductSpaceTree.tsx` | 左侧树：展示 `docs`、`prototypes` 及其一级子目录下的条目；支持新建子目录/文件 |
| `DocEditor` | `src/components/workspace/DocEditor.tsx` | Markdown 编辑器，保存时触发版本快照 |
| `PrototypeViewer` | `src/components/workspace/PrototypeViewer.tsx` | 图片/PDF 预览，切换版本 |
| `VersionPanel` | `src/components/workspace/VersionPanel.tsx` | 版本历史列表、恢复、下载 |

### 6.3 UI 约定

- 沿用 shadcn/ui 组件：`Collapsible`、`Tabs`、`Card`、`Button`、`Dialog`、`DropdownMenu`。
- 样式：`soft-shadow border border-border/50`。
- 图标：`lucide-react`。
- 反馈：`sonner` toast。

### 6.4 隐藏系统目录

- 前端树组件把 `docs` 和 `prototypes` 作为顶层分类标签展示，不把它们渲染为可点击的目录节点。
- 用户创建文件时选择分类（文档 / 原型），系统自动映射到对应目录。

---

## 7. 需要修正的现有逻辑

- `apps/dh-backend/gateway/handler/workspace_path.go` 中的 `resolveWorkspacePath`：改为使用当前登录用户的 `user_id`，而非 workspace 最老成员 user_id。
- `apps/dh-backend/domain/workspace/service/db_service.go` 中的 `EnsureUserWorkspaceDirs`：确保为当前登录用户创建目录；同步保证研发空间目录隔离也符合当前登录用户。

---

## 8. 错误处理

- 路径越界：返回 `400 Bad Request`。
- 无权限：返回 `403 Forbidden`。
- 条目/目录不存在：返回 `404 Not Found`。
- 磁盘 IO / 数据库失败：返回 `500 Internal Server Error` 并记录日志，必要时清理残留文件。
- 删除非空目录：返回 `409 Conflict`。

---

## 9. 后续可扩展点

- 多级子目录支持。
- 原型在线标注/评论。
- 文档与原型关联（link）。
- 协作权限（多个 PM 共享查看）。

---

## 10. 评审记录

- 2026-07-08：与用户逐 section 确认通过（架构、数据模型、API、磁盘目录、前端、权限安全）。
