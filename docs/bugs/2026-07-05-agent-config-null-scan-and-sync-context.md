# 2026-07-05 Agent 配置查询与同步问题

## 现象

1. `GET /api/v1/workspaces/{id}/agent-configs` 与 `GET /api/v1/workspaces/{id}/available-agents` 返回 HTTP 500：
   ```json
   {"code":1,"message":"failed to list workspace agent configs"}
   ```
   后端日志显示：
   ```
   [AgentConfig] scan workspace config failed: scan workspace agent config failed: sql: Scan error on column index 5, name "enabled": sql/driver: couldn't convert <nil> (<nil>) into type bool
   ```
2. 在 `PUT /api/v1/workspaces/{id}/agent-configs/{key}` 保存配置后，异步向 gatewayd 同步模型配置时失败：
   ```
   [AgentConfig] list sessions for sync failed: list sessions failed: context canceled
   ```

## 根因

1. `ListWorkspaceConfigs` 使用 `LEFT JOIN workspace_agent_configs` 查询某工作空间下所有平台级智能体类型。当某个智能体尚未在该空间下配置时，右表的 `c.enabled` 等列全部为 `NULL`。`scanWorkspaceAgentConfig` 直接使用 `*bool` 扫描 `c.enabled`，导致 `sql.Scan` 失败。
2. 保存配置的 handler 在同步时把 `r.Context()` 传入 goroutine。HTTP 请求返回后该上下文立即被取消，导致 `ListSessions` 等数据库操作因 `context canceled` 失败。
3. 同步逻辑未过滤历史会话，数据库中存在大量 gatewayd 端已过期/回收的会话，产生大量 404 错误日志。

## 解决方案

1. 在 `scanWorkspaceAgentConfig` 中将 `c.enabled` 扫描到 `sql.NullBool`：
   - 若存在配置记录则使用其值；
   - 若不存在（`NULL`）则默认启用，由平台级 `enabled` 最终决定。
2. 为 `WorkspaceAgentConfig` 回填 `WorkspaceID`，使 API 响应更完整。
3. 保存配置时使用 `context.Background()` 启动同步 goroutine，并在同步函数内部包装 `30s` 超时，避免被 HTTP 生命周期影响。
4. 同步时仅处理最近 1 小时内活跃的会话，减少无效请求与日志噪音。
5. 增加同步成功/失败日志，便于排查。

## 验证结果

- `GET /api/v1/workspaces/ws-default/agent-configs` 正常返回 4 条记录（含未配置智能体的默认空配置）。
- `GET /api/v1/workspaces/ws-default/available-agents` 正常返回已启用的智能体列表。
- 保存 `claude-code` 配置后，后端日志显示：
  ```
  [AgentConfig] synced config to gatewayd session=5634628f-b00b-4258-9937-84b88faf28c8 instance=claude-code-1
  [AgentConfig] runtime sync finished: workspace=ws-default agent=claude-code matched=2
  ```
- `go build ./apps/dh-backend/...`、`go vet ./...`、`pnpm build`、`pnpm check-types` 均通过。
