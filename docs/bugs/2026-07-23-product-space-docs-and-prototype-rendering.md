# 产品空间文档列表与原型渲染修复

## 1. 现象

### 问题一：原型条目泄漏到文档列表
产品工作区（ProductWorkspace）的"文档模式"下，文档列表中出现了不应展示的原型条目（如 `personal-dashboard` 等原型文件）。

### 问题二：原型 HTML 无样式
打开原型预览 iframe 后，页面仅有裸 HTML 结构，缺少所有 CSS 样式，视觉效果异常。

## 2. 根因

### 问题一：`ListDocs` 查询未排除原型条目
`product_docs` 表由两个领域共享：
- `productdoc` 领域：传统文档 CRUD，`type` 列为 `"doc"`
- `productspace` 领域：新版产品空间，`type` 列区分 `"doc"`（文档）和 `"prototype"`（原型）

`productdoc/service/db_service.go:ListDocs` 的 SQL 查询 `SELECT ... FROM product_docs` 未按 `type` 列过滤，导致原型条目与文档条目一起返回到文档列表。

### 问题二：iframe 子资源请求 401 + MIME 类型缺失
- **认证问题**：原型 HTML 通过 `?auth=<token>` 参数加载，但 HTML 中引用的相对路径资源（`dh-base.css`、`dh-base.js`）不带认证参数，浏览器请求时被 `Auth` 中间件拦截返回 401。
- **MIME 类型缺失**：`productspace/service/db_service.go:mimeTypeByExt` 映射表缺少 `.css` 和 `.js` 条目，即便请求通过，也会返回 `Content-Type: application/octet-stream`。

## 3. 解决方案

### 问题一：添加 `type` 过滤条件（3 处变更）
1. **`productdoc/service/db_service.go:ListDocs`**：始终追加 `WHERE (type IS NULL OR type != 'prototype')` 条件，排除原型条目。
2. **`productspace/service/db_service.go:insertProductDoc`**：为产品空间条目 INSERT 补充 `category` 列（值为 `itemType`），使各领域条目数据完整。

### 问题二：内联注入脚手架 CSS/JS + 补充 MIME 类型（4 处变更）
3. **`gateway/handler/command.go`**：导出 `ScaffoldCSS` 和 `ScaffoldJS` 变量（首字母大写），供其他包引用。
4. **`productspace/service/db_service.go:mimeTypeByExt`**：新增 `.css`（`text/css; charset=utf-8`）和 `.js`（`application/javascript; charset=utf-8`）条目。
5. **`productspace/handler.go:injectPrototypeAnnotationScript`**：在 HTML 响应中内联注入 `ScaffoldCSS` 和 `ScaffoldJS` 内容（通过 `gateway/handler` 包导出的公共变量），替代依赖浏览器加载外部相对路径资源的方案。
