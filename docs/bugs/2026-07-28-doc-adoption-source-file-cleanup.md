# 产品文档采纳后源文件行为不一致与状态持久化问题

## 现象

产品文档卡片与预览页面新增“采纳”按钮后，将个人工作区的文档文件采纳到产品空间对应的需求文档目录时，存在以下问题：

1. **与原型采纳行为不一致**：原型采纳到产品空间后源文件不会被删除，而早期文档采纳实现若直接移动源文件，会导致行为不一致。
2. **再次点击无法查看文档**：若源文件被移动/删除，用户从产品文档卡片或预览页面再次点击时会提示“文档已删除”，无法查看已采纳的内容。
3. **“已采纳”状态未持久化**：刷新页面后，“已采纳”状态丢失，用户无法直观识别哪些文档已被采纳。
4. **复制语义带来的磁盘隐患**：若采用永久保留源文件的复制方案，随着采纳次数增加，个人工作区会积累大量废弃草稿文件，存在磁盘占用持续增长的风险。

## 根因

- 文档采纳逻辑早期未明确“复制 vs 移动”语义，也未将采纳后的元数据持久化到数据库，导致刷新后状态丢失。
- 产品空间的文档条目虽然保存了采纳后的内容副本，但前端和状态接口仍以源文件是否存在作为“已采纳”判断依据，源文件删除后状态即失效。
- 缺少对废弃源草稿文件的自动清理机制，无法平衡“状态持久化”与“磁盘占用”之间的矛盾。

## 解决方案

采用**方案 C：保留源文件 14 天，之后自动清理**，并在数据库中持久化采纳关系。

### 后端改动

1. **数据库迁移** (`infra/database/productdoc/migration-20260728-doc-source-path.sql`)
   - 在 `product_docs` 表新增 `source_path VARCHAR(2000)` 字段，记录文档采纳时的源文件相对路径。

2. **配置层** (`apps/dh-backend/config/config.go` + `config.yaml`)
   - 新增 `ProductSpace.DocAdoptionCleanup` 配置块：
     - `enabled`：是否启用自动清理。
     - `retention_days`：源文件保留天数（默认 14 天，可配置）。
     - `interval`：清理任务执行间隔（默认 24h，可配置）。
   - 支持通过环境变量覆盖：`DOC_ADOPTION_CLEANUP_ENABLED`、`DOC_ADOPTION_CLEANUP_RETENTION_DAYS`、`DOC_ADOPTION_CLEANUP_INTERVAL`。

3. **Service 接口与实现** (`apps/dh-backend/domain/productspace/service/`)
   - `ImportDoc` 在创建或更新 doc 条目后，调用 `updateSourcePath` 将 `source_path` 写入数据库，实现“已采纳”状态的持久化。
   - `GetDocImportStatus` 改为按 `source_path` 精确匹配，避免同名文件误判，刷新后仍能正确返回 `adopted: true`。
   - 新增 `StartDocAdoptionCleanupTask` 与 `runDocAdoptionCleanup`：
     - 按 `interval` 周期扫描所有已记录 `source_path` 的 doc 条目。
     - 对超过 `retention_days` 未修改的源文件，通过 `stubclient.DeleteFile` 委托 `personal-stub` 删除（架构合规：dh-backend 不直接写共享目录）。
     - 删除前校验相对路径规则，并确保拼接后的绝对路径不逃逸出 `workspaceRoot`。

4. **启动注册** (`apps/dh-backend/gateway/server/server.go`)
   - 在 `stubclient.SetDefault` 初始化完成后启动清理任务，避免首次扫描时客户端未就绪。

### 行为说明

- 采纳后，产品空间会保存一份完整的内容副本；源文件继续保留在个人工作区 14 天。
- 14 天内用户仍可从源路径预览/下载原文件；14 天后由后台任务自动删除源草稿。
- 无论源文件是否被清理，`import-doc/status` 都按 `source_path` 返回 `adopted: true`，产品空间中的文档条目及其内容始终可访问。
- 保留天数和清理间隔均可在 `config.yaml` 中调整，满足不同部署环境的磁盘策略。

### 验证结果

- `go build ./...` 与 `go vet ./...` 通过。
- `pnpm build`、`pnpm lint` 通过。
- `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` 无错误。
- 开发环境 (`pnpm dev`) 启动后，日志显示清理任务按配置启动。
- 通过 curl 验证：
  - 文档采纳接口 (`POST /product-space/import-doc`) 正常返回 doc 条目。
  - 采纳状态接口 (`GET /product-space/import-doc/status`) 返回 `adopted: true`。
  - 临时将 `retention_days` 设为 1、`interval` 设为 `1s` 并将源文件 mtime 改到 15 天前，清理任务正确删除源文件。
  - 源文件删除后，产品空间条目仍可通过 `GET /product-space/items/{itemId}` 访问，内容完整；`import-doc/status` 仍返回 `adopted: true`。
