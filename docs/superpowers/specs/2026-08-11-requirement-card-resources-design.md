# 需求卡片相关资源增强设计文档

> 状态：待评审  
> 作者：AI Agent + 产品负责人  
> 日期：2026-08-11

---

## 1. 目标

围绕需求卡片「相关资源」区域，完成三项改进：

1. **修复过期 bug（版本快照方案）**：需求关联的文档被下线（archived）/草稿（draft）后，点击「产品设计」打开分享页不再显示「分享链接不存在或已失效」。创建分享时锁定文档版本快照，文档后续状态变化不影响已发出的分享。
2. **代码仓库改为代码提交（全量自动汇集）**：需求卡片「代码仓库」占位符改为「代码提交」，自动汇集该需求关联会话在开发过程中产生的 git commit，点击可查看 diff。
3. **产品设计关联文档和原型**：已完整实现，本次仅确认现状，不改动。

---

## 2. 范围与约束

- **仅影响需求详情 Dialog 的「相关资源」区域**，涉及 `ProcessDetail.tsx` 与 `KanbanWorkspace.tsx` 两处重复实现（本次顺带抽取共享组件，遵循 AGENTS.md 规则6）。
- **版本快照仅作用于文档**；原型无 `published`/`archived` 状态，继续实时 serve。
- **commit 自动汇集依赖 SSE tool call 事件回流**：仅在 agent 通过 bash 工具执行 `git commit` 时解析记录；非 agent 产生的提交（如用户手动在终端 commit）不在自动汇集范围。
- **会话与需求的关联**基于现有 `quotedCard` 机制（`command.go:48` 已有提取逻辑），本次将其持久化到 `agent_sessions.workitem_id`。
- 遵循 AGENTS.md 规则4（嵌套≤3层）、规则7（禁止魔法值）、规则12（架构合规：不要求 agent 生成额外内容，dh-backend 侧解析事件）。

---

## 3. 现状分析

### 3.1 需求卡片「相关资源」现状

| 资源卡片 | 状态 | 实现位置 |
|----------|------|----------|
| 产品设计 | ✅ 已实现 | `ProcessDetail.tsx:251` / `KanbanWorkspace.tsx:295` 打开 `/share/requirement/{token}` |
| 代码仓库 | ⚠️ 占位符 | `ProcessDetail.tsx:428` / `KanbanWorkspace.tsx:702` 无 onClick |
| 测试用例 | ⚠️ 占位符 | 同上，无逻辑 |

`ResourceCard` 组件在 `ProcessDetail.tsx:184` 与 `KanbanWorkspace.tsx:833` 各定义一份（完全相同，违反规则6）。

### 3.2 过期 bug 根因

`GetSharedRequirement`（`requirement_share.go:188-251`）组装分享视图：

```go
// 文档：仅取已发布状态的最新版本
SELECT ... FROM product_docs d
JOIN product_doc_versions v ON v.doc_id = d.id
WHERE d.id = $1 AND d.status = 'published'   // ← 硬编码 published
ORDER BY v.version DESC LIMIT 1
```

- 文档状态 `draft`/`published`/`archived`（即用户所说的「上下线状态」）。
- 文档下线（archived）或草稿（draft）时查询无结果 -> `view.Doc = nil`。
- 若该需求无原型 -> `view.Doc == nil && view.Prototype == nil` -> 返回 `ErrNotFound: 分享内容不存在`（`requirement_share.go:247`）。
- 前端 `ShareRequirement.tsx:572` 将该错误显示为「分享链接不存在或已失效」= 用户看到的「过期」。

### 3.3 会话与需求/提交的关联现状

| 关联链路 | 现状 |
|----------|------|
| 会话 -> 需求 | `quotedCard` 每次 run 由前端传入（`command.go:48`），用于构建提示词，**未持久化**到 `agent_sessions` |
| 会话 -> commit | `agent_sessions` **无 commit_hash 字段**；commit_hash 仅存于 `agent_review_reports`（评审场景） |
| 会话 -> 仓库 | 会话已可关联 `repositoryId`（`types/index.ts:254`） |

后端 repository service 具备 git 查询能力（`scanner.go` 的 `loadWeeklyCommits`/`loadCommitterStats`/`LastCommit`、`GetUnpushedCommits`）。

SSE 事件回流含完整 tool call 生命周期：`EventToolCallStart`/`Args`/`End`/`Result`（含命令与输出）+ `EventRunFinished`（`agui_run.go:765-811`）。

---

## 4. 需求点 1：过期 bug 修复（版本快照方案）

### 4.1 数据模型

新增迁移 `infra/database/productdoc/migration-20260811-requirement-share-snapshots.sql`：

```sql
-- 需求级分享文档快照：创建分享时锁定文档当前最新已发布版本，
-- 后续文档上下线状态变化不影响已发出的分享内容。

CREATE TABLE IF NOT EXISTS requirement_share_doc_snapshots (
    share_token     VARCHAR(16) PRIMARY KEY,
    doc_id          VARCHAR(36) NOT NULL,
    doc_title       TEXT,
    doc_content     TEXT,
    doc_version     INT,
    published_at    TIMESTAMPTZ,
    created_by_name VARCHAR(200),
    snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rsd_snapshots_share FOREIGN KEY (share_token)
        REFERENCES requirement_shares(token) ON DELETE CASCADE
);
```

> `share_token` 引用 `requirement_shares.token`（VARCHAR(16) UNIQUE，是分享页查询入口），保持一对一。

### 4.2 后端改动

**创建分享时写快照**（`requirement_share.go` `createRequirementShareInternal`）：

- 在 INSERT `requirement_shares` 成功后，若 `req.DocID != ""`，查询当前最新 published 版本（复用现有查询逻辑），将 title/content/version/publishedAt/createdByName 写入 `requirement_share_doc_snapshots`。
- 幂等场景（已存在分享）不重复写快照；若快照缺失（老数据兼容）则补写。

**读取分享视图改读快照**（`requirement_share.go` `GetSharedRequirement`）：

- 文档部分：按 `share_token`（即 token）查 `requirement_share_doc_snapshots`，不再查 `product_docs`。
- 原型部分：保持现状（实时查 `product_docs` 原型页面）。
- `view.Doc == nil && view.Prototype == nil` 判断保留，但现在 doc 为空仅当快照不存在（老数据且未补写成功），属异常兜底。

### 4.3 前端改动

无需改动。`ShareRequirement.tsx` 的「分享链接不存在或已失效」提示作为异常兜底保留。

---

## 5. 需求点 2：代码仓库 -> 代码提交（全量自动汇集）

### 5.1 数据模型

新增迁移 `infra/database/agent/migration-20260811-sessions-workitem-commit.sql`：

```sql
-- 会话关联需求：从 quotedCard 持久化 workitem_id，支持按需求汇集会话与提交。
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS workitem_id VARCHAR(36);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_workitem ON agent_sessions(workitem_id);

-- 需求开发提交记录：agent 在会话中执行 git commit 时自动记录。
CREATE TABLE IF NOT EXISTS workitem_commits (
    id             VARCHAR(36) PRIMARY KEY,
    workitem_id    VARCHAR(36) NOT NULL,
    workspace_id   VARCHAR(36) NOT NULL,
    session_id     VARCHAR(36) NOT NULL,
    repository_id  VARCHAR(36),
    commit_hash    VARCHAR(64) NOT NULL,
    commit_message TEXT,
    author         VARCHAR(200),
    committed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workitem_commits_workitem
    ON workitem_commits(workitem_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS idx_workitem_commits_session
    ON workitem_commits(session_id);
-- 同一提交在相同需求下仅记录一次，避免重复入库
CREATE UNIQUE INDEX IF NOT EXISTS idx_workitem_commits_workitem_hash
    ON workitem_commits(workitem_id, commit_hash);
```

### 5.2 后端改动

#### 5.2.1 会话持久化 workitem_id

在 agent run 处理流程中（`agui_run.go` 或 `command.go` 的 run 入口），复用现有 `extractQuotedCard`（`command.go:48`）提取 `quotedCard.ID`，通过 `PostgresStore` 新增 `UpdateWorkitemID(ctx, sessionID, workitemID)` 方法持久化到 `agent_sessions.workitem_id`。

- 仅在 `workitem_id` 非空且会话当前 `workitem_id` 为空时更新（首条引用锁定，避免后续 run 切换需求导致关联漂移）。
- 提取为独立函数 `persistSessionWorkitem(sessionID, ctxItems)`，保持嵌套≤3层（规则4）。

#### 5.2.2 commit 自动记录

在 SSE 事件处理（`agui_run.go` 的 `EventToolCallResult` 分支，约 `:799`）中，新增 commit 解析与记录逻辑：

1. **检测 git commit 命令**：从对应 `ToolCallArgs` 中读取工具名与命令参数（bash 工具），判断命令字符串是否包含 `git commit`。
2. **解析 commit_hash**：从 `ToolCallResult.Content`（git commit 输出）中用正则提取 commit hash（如 `\[main [0-9a-f]{7,40}\]` 或 `commit <hash>` 模式）。
3. **写入 workitem_commits**：仅当当前会话已关联 `workitem_id` 时记录，关联 session_id、repository_id（从会话 context 的 `selectedRepos` 提取，复用 `extractSelectedRepos` `command.go:75`）。
4. **幂等**：依赖 `idx_workitem_commits_workitem_hash` 唯一索引，重复记录忽略。

实现要点：
- 解析逻辑提取为独立函数 `tryRecordWorkitemCommit(sessionID, workspaceID, workitemID, toolName, args, resultContent)`，返回是否记录。
- 正则与命令检测常量提取到包级 `const`/`var`（规则7）。
- 解析失败静默跳过（不阻塞 agent 流程），仅记日志便于排查（规则2 缺陷排查流程）。
- `committed_at` 优先用 git 输出解析的时间，无法解析时用 `created_at`。

#### 5.2.3 新增接口

`GET /v1/workitems/{id}/commits`（`workitem` domain handler）：

- 鉴权：工作空间成员校验。
- 返回该 workitem 关联的 commit 列表，按 `committed_at DESC` 排序。
- 响应体：

```json
{
  "commits": [
    {
      "id": "uuid",
      "commitHash": "abcdef0",
      "commitMessage": "feat: 实现登录页",
      "author": "dev",
      "committedAt": "2026-08-11T10:00:00Z",
      "repositoryId": "repo-uuid",
      "sessionId": "session-uuid"
    }
  ]
}
```

路由注册于 `gateway/server/server.go`，常量命名遵循现有 `ROUTE_` 前缀风格（规则7）。

### 5.3 前端改动

#### 5.3.1 抽取共享组件（规则6）

- 新建 `apps/dh-frontend/src/components/workitem/ResourceCard.tsx`：抽取 `ResourceCard`（合并 `ProcessDetail.tsx:184` 与 `KanbanWorkspace.tsx:833` 两份重复定义）。
- 新建 `apps/dh-frontend/src/components/workitem/WorkItemDetailDialog.tsx`：抽取需求详情 Dialog（合并 `ProcessDetail.tsx:371` 与 `KanbanWorkspace.tsx:642` 两处重复实现），接收 `workitem`、`onOpenDesign`、`onOpenCommits` 等回调。
- `ProcessDetail.tsx` / `KanbanWorkspace.tsx` 改为引用共享组件，删除各自的重复定义。

#### 5.3.2 代码提交卡片

- `ResourceCard`「代码仓库」改为「代码提交」：新增 `lib/workitem-commit-api.ts`，封装 `listCommits(workitemId)` 调用新接口。
- 点击「代码提交」打开 commit 列表 Dialog（或 Sheet），展示 commit hash（短）、消息、作者、时间。
- 点击某条 commit：调用 `project-api.ts` 的 `diff` 接口（`/v1/projects/diff?path=`）查看 diff，复用现有 diff 展示逻辑（参考 `ProjectCode.tsx`）。
- 无 commit 时卡片灰显并提示「暂无开发提交」。

#### 5.3.3 状态映射重复消除

顺带消除 `API_STATUS_TO_UI`/`API_PRIORITY_TO_UI` 三处重复（`WorkItemCard.tsx:7`、`Requirements.tsx:16`、`KanbanWorkspace.tsx:52`），抽取到 `lib/workitem-utils.ts`（规则6）。

---

## 6. 需求点 3：产品设计关联文档和原型（确认现状）

已完整实现，链路如下，本次不改动：

- 关联：`workitem-doc-api.ts` 的 doc/prototype link（`/v1/workitems/{id}/doc-links`）。
- 版本：`workitem-design-version-api.ts` 的 `DesignVersion` 快照。
- 分享：`requirementShareApi` 创建 `/share/requirement/{token}` 落地页（文档+原型 Tab 切换）。
- 导入自动关联：`productSpaceApi.importPrototype/importDoc` 传 `workitemId` 自动建 link + 生成设计版本。

---

## 7. 测试策略

> 当前仓库无测试框架（AGENTS.md §8），以下为手动验证清单 + 可选的 Go 单测。

### 7.1 需求点 1 验证

1. 创建需求，关联一份已发布文档（无原型）。
2. 点击「产品设计」-> 分享页正常展示文档。
3. 将该文档下线（archived）。
4. 再次点击「产品设计」-> **应仍展示快照内容**（修复前会显示「已失效」）。
5. 文档重新发布新版本 -> 已发出的分享仍展示旧快照（符合版本快照语义）。

### 7.2 需求点 2 验证

1. 创建需求 A，在 Chat 中通过 `#需求设计 @需求A` 引用后执行 `/code` 开发。
2. agent 执行 `git commit` 后，`workitem_commits` 表新增一条记录，`workitem_id` 指向需求 A。
3. 需求卡片「代码提交」展示该 commit。
4. 点击 commit 查看 diff 正常。
5. 同一 commit 重复触发不产生重复记录（幂等）。
6. 未引用需求的会话产生的 commit 不被记录（`workitem_id` 为空）。

### 7.3 可选 Go 单测

- `requirement_share.go`：`GetSharedRequirement` 读快照的单元测试（mock DB）。
- commit 解析函数 `tryRecordWorkitemCommit`：传入不同 git commit 输出样本，验证 hash 提取正确性。

---

## 8. 风险与权衡

| 风险 | 影响 | 缓解 |
|------|------|------|
| git commit 输出格式多样，正则解析可能漏提取 | 部分 commit 未记录 | 静默跳过+日志；后续可增加更多正则模式；提供手动补录接口（未来） |
| 版本快照导致分享内容不随文档更新 | 用户看到旧内容 | 符合「分享即快照」语义；文档更新后可重新创建分享刷新 |
| `quotedCard` 首条锁定策略可能误关联 | 会话引用多个需求时仅锁定首个 | 符合「一个会话主做一个需求」的预期；多需求场景需新建会话 |
| 老分享数据无快照 | 老分享仍可能「已失效」 | `GetSharedRequirement` 兜底：快照缺失时回退查 `product_docs`（兼容老数据） |
| 抽取共享组件可能影响现有交互 | ProcessDetail/Kanban 行为变化 | 抽取后逐项比对交互，保持外部行为一致（规则15） |

---

## 9. 实施顺序

1. **迁移脚本**：两个 SQL 迁移文件。
2. **需求点 1 后端**：快照表 + 写快照 + 读快照（含老数据兼容回退）。
3. **需求点 2 后端**：`agent_sessions.workitem_id` 持久化 + commit 自动记录 + `GET /workitems/{id}/commits` 接口。
4. **前端共享组件抽取**：`ResourceCard` + `WorkItemDetailDialog` + 状态映射 utils。
5. **需求点 2 前端**：代码提交卡片 + commit 列表 + diff 查看。
6. **验证**：按 §7 清单手动验证；`go vet ./...` + `tsc --noEmit` 清零 warnings（规则8）。
7. **编译启动**：`pnpm build` + `bash scripts/restart-dev.sh`，curl 验证接口（规则1、规则11）。
8. **缺陷文档**：过期 bug 修复记录到 `docs/bugs/2026-08-11-share-expired-when-doc-offline.md`（规则3）。

---

## 10. 架构合规性（规则12）

- ✅ 不要求 agent 生成额外内容：commit 记录由 dh-backend 解析 SSE 事件完成。
- ✅ 不直接执行 agent/git 命令：commit 记录是被动解析，非主动触发。
- ✅ 文件流向不变：原型仍实时 serve，文档快照存 DB。
- ✅ 容器隔离不变：gatewayd 无感知，dh-backend 侧扩展。
