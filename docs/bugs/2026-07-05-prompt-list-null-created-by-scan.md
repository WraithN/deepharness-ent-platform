# 提示词列表接口 500：created_by/reviewed_by 为 NULL 时扫描失败

## 现象

新增提示词状态改造并执行数据库迁移后，调用 `GET /api/v1/team/prompts` 返回：

```json
{"code":1,"message":"failed to list prompts"}
```

无论是超级管理员还是普通用户，列表接口均 500。

## 根因

数据库迁移为存量 `team_prompts` 增加了 `status`、`created_by`、`reviewed_by`、`reviewed_at` 字段，但存量记录的 `created_by` 与 `reviewed_by` 保持为 `NULL`。

后端 `DBTeamService.ListPromptsVisibleTo` 与 `getPrompt` 在扫描时直接将 `created_by`、`reviewed_by` 读入 `string` 类型：

```go
rows.Scan(..., &p.CreatedBy, &p.ReviewedBy, ...)
```

PostgreSQL 驱动不允许把 `NULL` 扫描到非指针/非 `sql.NullString` 的 `string`，导致 `sql: Scan error`，列表接口失败。

## 解决方案

将扫描改为 `sql.NullString`，再用 `sqlutil.ScanNullString` 转换为空字符串：

```go
var createdBy, reviewedBy sql.NullString
rows.Scan(..., &createdBy, &reviewedBy, ...)
p.CreatedBy = sqlutil.ScanNullString(createdBy)
p.ReviewedBy = sqlutil.ScanNullString(reviewedBy)
```

同时保持 `Prompt.CreatedBy` / `ReviewedBy` 的 JSON tag 为 `omitempty`，前端不展示空值。

## 验证

- `go build ./...` 与 `go vet ./...` 通过。
- `curl -H "Authorization: Bearer u1" http://localhost:8080/api/v1/team/prompts` 正常返回提示词列表。
- 普通用户只能看到 `on_shelf` 提示词以及自己创建的 `pending_review` 提示词。
- 超级管理员可以看到全部状态。
