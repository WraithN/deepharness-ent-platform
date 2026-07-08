# 产品文档保存失败：唯一约束冲突

## 现象

在产品空间功能迁移后，前端 `ProductWorkspace` 中点击“保存/创建”文档时接口返回 500，提示“创建文档失败”。后端日志显示：

```
[ProductDoc] CreateDoc failed: create product doc failed: ERROR: duplicate key value violates unique constraint "product_docs_ws_user_path" (SQLSTATE 23505)
```

该错误在第二次及以后创建文档时必现；第一次创建可以成功。

## 根因

`infra/database/productdoc/migration-20260708-product-space.sql` 为了支持新的产品空间（ProductSpace）功能，给 `product_docs` 表增加了 `user_id`、`type`、`relative_path` 等字段，并新增唯一约束：

```sql
ADD CONSTRAINT product_docs_ws_user_path UNIQUE (workspace_id, user_id, relative_path);
```

旧版 `domain/productdoc` 服务层的 `CreateDoc` 仍然按照原表结构插入数据，没有为 `user_id` 和 `relative_path` 赋值。PostgreSQL 使用列的默认值 `''`（空字符串），导致同一工作空间下第二次插入时出现：

```
(workspace_id, user_id='', relative_path='')
```

重复，触发唯一约束冲突。

## 解决方案

1. 在 `apps/dh-backend/domain/productdoc/service/db_service.go` 的 `CreateDoc` 中显式设置：
   - `user_id`：优先使用请求中的 `createdBy`，为空时使用兜底值 `legacy`。
   - `relative_path`：使用 `docs/{slug}.md` 格式，确保与 ProductSpace 树形解析逻辑兼容，并避免空路径冲突。
   - `type`：固定为 `doc`。
   - `current_version`：初始为 `1`。

2. 在 `apps/dh-backend/domain/productdoc/handler.go` 中，如果请求未携带 `createdBy`，从 `middleware.UserIDFromContext` 自动注入当前登录用户 ID，保证 `user_id` 有真实值。

3. `PublishVersion` 同样通过 auth 上下文补全 `createdBy`，使版本快照的作者信息正确。

## 验证结果

- `go build ./... && go vet ./...` 通过。
- `pnpm build && pnpm check-types` 通过。
- 本地启动前后端服务后：
  - 连续两次 `POST /api/v1/workspaces/{id}/product-docs` 均返回 201，无唯一约束冲突。
  - `POST /api/v1/workspaces/{id}/product-docs/{docId}/publish` 返回版本快照，发布逻辑正常。
  - 前端 dev server 返回 200。
