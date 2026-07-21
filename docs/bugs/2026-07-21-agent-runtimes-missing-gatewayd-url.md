# 2026-07-21 — agent_runtimes 表缺少 gatewayd_url 列导致运行时状态上报 500

## 现象

本地 platform 后端（`dh-backend` 8080 端口）收到外部 gatewayd / agent-stub 的运行时状态上报请求后返回 500，日志报错：

```
Report failed: 500 Internal Server Error
{"code":1,"message":"upsert runtime status failed: ERROR: column \"gatewayd_url\" of relation \"agent_runtimes\" does not exist (SQLSTATE 42703)"}
```

这导致管理后台无法正确展示 agent 运行时的 gatewayd URL，影响运行时监控。

## 根因

1. **代码与数据库 schema 不一致**
   - `apps/dh-backend/domain/agentruntime/service/service.go` 中的 `agent_runtimes` 建表语句已包含 `gatewayd_url VARCHAR(512) NOT NULL DEFAULT ''`。
   - 但 `infra/database/agentruntime/schema.sql` 中未包含该列，因此新初始化或旧数据库均无此列。
   - 本地 PostgreSQL 中的 `agent_runtimes` 表是在 schema.sql 缺少该列时创建的，导致与 Go 代码中的 upsert SQL 不匹配。

2. **缺少增量迁移脚本**
   - 项目已有其他模块的 migration 脚本，但 `agent_runtimes` 表此前没有为 `gatewayd_url` 提供迁移脚本。

## 解决方案

1. **更新 schema.sql**
   - 在 `infra/database/agentruntime/schema.sql` 的 `agent_runtimes` 建表语句中加入 `gatewayd_url VARCHAR(512) NOT NULL DEFAULT ''`。

2. **新增迁移脚本**
   - 创建 `infra/database/agentruntime/migration-20260721-add-gatewayd-url.sql`：
     ```sql
     ALTER TABLE agent_runtimes ADD COLUMN IF NOT EXISTS gatewayd_url VARCHAR(512) NOT NULL DEFAULT '';
     ```

3. **应用迁移到本地 PostgreSQL**
   - 通过 Docker 进入容器执行：
     ```bash
     docker exec -i deepharness-postgres psql -U deepharness -d deepharness < infra/database/agentruntime/migration-20260721-add-gatewayd-url.sql
     ```

## 验证结果

- 迁移后 `\d agent_runtimes` 显示 `gatewayd_url` 列已存在。
- `curl -X POST http://127.0.0.1:8080/api/v1/agent-runtimes/test-runtime-001/status` 返回 200，响应体包含 `gatewaydUrl` 字段，无 500 错误。
- `/health` 返回 200，后端运行正常。

## 相关文件

- `infra/database/agentruntime/schema.sql`
- `infra/database/agentruntime/migration-20260721-add-gatewayd-url.sql`
