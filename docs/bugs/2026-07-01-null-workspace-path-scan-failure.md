# 2026-07-01 NULL workspace_path 导致会话查询失败

## 现象

在 `agent_sessions` 表新增 `workspace_path` 字段后，对已有数据（该字段为 `NULL`）调用以下接口会失败：

- `GET /api/v1/sessions`（`ListSessions`）返回 `{"code":1,"message":"failed to list sessions"}`
- `GET /api/v1/sessions/{id}`（`Get`）可能报 `scan session failed: sql: Scan error on column index 2, name "workspace_path": converting NULL to string is unsupported`

影响范围：升级后所有在新增字段前创建的会话都无法被正常读取。

## 根因

`PostgresStore.Get` 和 `PostgresStore.ListSessions` 直接使用 `SELECT workspace_path ...` 并将结果扫描到 `string` 字段。Go 的 `database/sql` 不允许把 `NULL` 扫描到 `*string` 以外的字符串变量，因此遇到历史 `NULL` 数据时会直接报错。

## 解决方案

在 SQL 查询中使用 `COALESCE(workspace_path, '')` 将 `NULL` 转为空字符串，保持向后兼容：

- 修改 `apps/dh-backend/agent/chat/session/postgres.go`
- `Get` 与 `ListSessions` 查询均使用 `COALESCE(workspace_path, '')`

验证结果：

1. `go test -count=1 ./...` 通过
2. `pnpm build` 通过
3. 本地 dev 服务器 `GET /api/v1/sessions` 可正常返回历史会话，`workspacePath` 为空字符串
