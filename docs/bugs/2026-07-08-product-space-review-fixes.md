# 2026-07-08 ProductSpace 后端评审修复记录

## 1. DELETE /folders 不支持请求体

### 现象
`DELETE /api/v1/workspaces/{id}/product-space/folders` 原实现从 JSON body 读取 `category` 与 `name`。部分 HTTP 代理、缓存及语言运行时对 DELETE 请求体支持不完整，会导致真实客户端调用失败。

### 根因
实现计划中将删除参数放在请求体里，未遵循更通用的 REST 实践。

### 解决方案
- `handler.go` 中 DELETE 分支改为从 query 参数读取：`?category=docs&name=xxx`。
- `docs/superpowers/specs/2026-07-08-product-space-design.md` 同步更新 API 说明。
- POST 创建文件夹仍使用 JSON body，不受影响。

---

## 2. 父目录符号链接逃逸风险

### 现象
`ensureParentDir` 直接调用 `os.MkdirAll` 创建文件父目录。如果攻击者能在产品空间目录树内放置符号链接（例如 `products/docs` 指向工作区外），`MkdirAll` 会跟随链接，导致文件写到非预期位置。

### 根因
`ensureParentDir` 只校验目标路径本身，未逐级检查中间目录段是否为符号链接。

### 解决方案
- 新增 `resolveProductSpacePathWithBase`，同时返回产品空间根目录与目标绝对路径。
- 新增 `safeMkdirAll(baseAbs, targetAbs)`：从 base 开始逐级 `Lstat`，遇到符号链接立即报错，不存在则逐层 `Mkdir`。
- `CreateItem`、`UpdateContent`、`RestoreVersion` 的文件写入以及 `CreateFolder` 的目录创建全部改为调用 `safeMkdirAll`。

---

## 3. DeleteFolder 返回 500（PostgreSQL invalid escape string）

### 现象
调用 `DELETE /folders` 删除空目录时，后端返回 `500 failed to delete product space folder`，日志显示 `ERROR: invalid escape string (SQLSTATE 22025)`。

### 根因
`folderHasItems` 查询使用 `LIKE $3 ESCAPE '\\'`。在 PostgreSQL `standard_conforming_strings=on` 环境下，字符串字面量 `'\\'` 被解析为两个反斜杠，而 `ESCAPE` 要求转义字符串为空或单个字符，因此报错。

### 解决方案
- 将 SQL 改为 `ESCAPE '\\'`（Go raw string 中单个反斜杠，发送到 PostgreSQL 为单个反斜杠）。
- `escapeLikePattern` 继续输出 `\\%` / `\\_` 形式的转义，与新的 ESCAPE 子句匹配。
- 验证删除空目录现在返回 `204 No Content`。

---

## 4. 非成员访问统一返回 403

### 现象
当用户不是工作空间成员或工作空间不存在时，`requirePM` 返回 `403 Forbidden`，会泄露“该工作空间存在”的信息。

### 根因
`workspace/service/db_service.go` 的 `GetMemberSubRole` 在 `sql.ErrNoRows` 时返回普通 `errors.New("member not found")`，调用方无法区分“成员不存在”与“数据库其他错误”，统一包装为 `ErrForbidden`。

### 解决方案
- 在 `workspace/service/service.go` 定义 sentinel 错误 `ErrMemberNotFound`。
- `GetMemberSubRole` 在 `sql.ErrNoRows` 时返回 `fmt.Errorf("%w", ErrMemberNotFound)`。
- `productspace/service/db_service.go` 的 `requirePM` 通过 `errors.Is(err, workspaceservice.ErrMemberNotFound)` 识别后返回 `ErrNotFound`，最终映射为 `404 Not Found`。
