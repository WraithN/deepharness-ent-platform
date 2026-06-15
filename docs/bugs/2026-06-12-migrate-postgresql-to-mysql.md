# 迁移：数据库从 PostgreSQL 切换为 MySQL

## 现象

项目早期在 `infra/database/` 下编写了 PostgreSQL 方言的 Schema 文件，但存在以下问题：

1. **数据库层未真正落地**：Go 后端各微服务均使用内存 mock 数据，`go.mod` 中无任何数据库驱动，未调用 `sql.Open`。
2. **前端依赖 Supabase 但配置缺失**：`apps/web/src/contexts/AuthContext.tsx` 引用了不存在的 `@/db/supabase`，`apps/web/.env` 未配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`，导致前端无法通过类型检查且登录/上传功能不可用。
3. **无数据库运行时配置**：没有 docker-compose、K8s DB 部署清单或 `DATABASE_URL` 等连接参数。

用户要求将数据库从 PostgreSQL 改为 MySQL。

## 根因

- 项目处于原型阶段，持久化层尚未统一设计。
- 前端选用了 Supabase（基于 PostgreSQL 的后端即服务），与后端自托管 MySQL 的目标架构冲突。
- Schema 文件使用了 PostgreSQL 特有语法：`UUID` 类型、`gen_random_uuid()`、`TIMESTAMP WITH TIME ZONE`。

## 解决方案

1. **Schema 迁移至 MySQL 8.0**：
   - `infra/database/identity/schema.sql` 与 `infra/database/workitem/schema.sql` 改写为 MySQL 方言。
   - `UUID` 改为 `CHAR(36)`，由应用层生成。
   - `TIMESTAMP WITH TIME ZONE` 改为 `DATETIME(3)`，时区由应用层处理。
   - 统一使用 `InnoDB` 引擎与 `utf8mb4_unicode_ci` 字符集。

2. **新增 Go MySQL 连接基础设施**：
   - `packages/go-sdk/infrastructure/mysql/mysql.go` 提供统一的 DSN 构造与 `sql.DB` 初始化。
   - `packages/go-sdk/go.mod` 引入 `github.com/go-sql-driver/mysql`。
   - `identity-service` 与 `workitem-service` 的 `main.go` 初始化 MySQL 连接；未配置 DSN 时降级为内存 mock，保证 dev 模式可运行。

3. **添加 MySQL 运行时**：
   - 新增 `infra/docker/compose.mysql.yml`，提供 MySQL 8.0 容器，自动挂载 identity/workitem schema 初始化脚本。

4. **前端去 Supabase**：
   - 移除 `apps/web/package.json` 中的 `@supabase/supabase-js`。
   - 重写 `apps/web/src/contexts/AuthContext.tsx` 为基于后端 API 的占位实现。
   - 将 `use-supabase-upload.ts` 替换为 `use-file-upload.ts`，并更新 `dropzone.tsx` 的导入。

5. **验证结果**：
   - `pnpm build` 全量构建成功。
   - `go vet ./...` 于所有 Go 模块无警告。
   - `npx tsc --noEmit -p apps/web/tsconfig.check.json` 无错误。
   - `pnpm dev` 启动后，`curl` 访问 API Gateway、identity-service、workitem-service 健康端点均正常。
   - 前端开发服务器 `http://127.0.0.1:5173` 返回 200。

## 后续工作

- 将 identity-service / workitem-service 的内存 mock 替换为真实 MySQL Repository。
- 为 project-service、audit-service 等补充 MySQL schema 与连接。
- 引入数据库迁移工具（如 `golang-migrate`）并完善 `infra/database/` 的版本管理。
