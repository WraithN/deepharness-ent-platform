# 需求卡片相关资源增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复需求分享「过期」bug（文档下线导致分享失效）并将需求卡片「代码仓库」占位符改为「代码提交」自动汇集。

**Architecture:** 后端两块：(1) 创建需求分享时快照文档 published 版本到 `requirement_share_doc_snapshots`，读取时读快照；(2) `agent_sessions` 持久化 `workitem_id`，SSE `ToolCallResult` 事件中解析 `git commit` 自动记录到 `workitem_commits`，新增查询接口。前端抽取共享 `ResourceCard`/`WorkItemDetailDialog` 消除重复，「代码提交」卡片展示 commit 列表并支持查看 diff。

**Tech Stack:** Go 1.22（net/http + http.ServeMux）、PostgreSQL 15、React 18 + TypeScript 5.9 + Vite、Tailwind + shadcn/ui。

## Global Constraints

- 遵循 AGENTS.md 规则4（嵌套≤3层）、规则6（重复逻辑封装）、规则7（禁止魔法值，UPPER_SNAKE_CASE 常量）、规则8（`go vet ./...` + `tsc --noEmit` 0 warnings）。
- Go 模块路径前缀 `github.com/deepharness/deepharness-ent-platform/`。
- 前端路径别名 `@/*` → `apps/dh-frontend/src/*`。
- 当前仓库无测试框架，验证方式：`go vet` + `tsc --noEmit` + 手动 curl/浏览器验证。
- 不主动 git commit 除非任务步骤明确要求；本计划中 commit 步骤需用户确认后执行。

---

## File Structure

**后端新建：**
- `infra/database/productdoc/migration-20260811-requirement-share-snapshots.sql` — 文档快照表
- `infra/database/agent/migration-20260811-sessions-workitem-commit.sql` — 会话 workitem_id + workitem_commits 表
- `apps/dh-backend/domain/workitem/service/commit_service.go` — commit 记录与查询 service

**后端修改：**
- `apps/dh-backend/domain/productspace/service/requirement_share.go` — 写/读快照
- `apps/dh-backend/agent/chat/store.go` — SessionStore 接口加 UpdateWorkitemID/GetWorkitemID
- `apps/dh-backend/agent/chat/session/session.go` — 内存实现 UpdateWorkitemID/GetWorkitemID
- `apps/dh-backend/agent/chat/session/postgres.go` — PG 实现 UpdateWorkitemID/GetWorkitemID
- `apps/dh-backend/gateway/handler/agui_run.go` — 持久化 workitem_id + commit 自动记录
- `apps/dh-backend/gateway/handler/command.go` — 复用 extractQuotedCard（已存在）
- `apps/dh-backend/domain/workitem/handler.go` — 新增 WorkItemCommits handler
- `apps/dh-backend/domain/workitem/service/service.go` — WorkItemService 接口加 ListCommits
- `apps/dh-backend/gateway/server/server.go` — 注册新路由

**前端新建：**
- `apps/dh-frontend/src/components/workitem/ResourceCard.tsx` — 共享 ResourceCard
- `apps/dh-frontend/src/components/workitem/WorkItemDetailDialog.tsx` — 共享需求详情 Dialog
- `apps/dh-frontend/src/lib/workitem-utils.ts` — 状态/优先级映射
- `apps/dh-frontend/src/lib/workitem-commit-api.ts` — commit 查询 API

**前端修改：**
- `apps/dh-frontend/src/pages/ProcessDetail.tsx` — 引用共享组件
- `apps/dh-frontend/src/components/workspace/KanbanWorkspace.tsx` — 引用共享组件
- `apps/dh-frontend/src/components/WorkItemCard.tsx` — 引用共享状态映射
- `apps/dh-frontend/src/pages/Requirements.tsx` — 引用共享状态映射

**文档新建：**
- `docs/bugs/2026-08-11-share-expired-when-doc-offline.md` — 缺陷记录

---

### Task 1: 数据库迁移脚本

**Files:**
- Create: `infra/database/productdoc/migration-20260811-requirement-share-snapshots.sql`
- Create: `infra/database/agent/migration-20260811-sessions-workitem-commit.sql`

**Interfaces:**
- Produces: `requirement_share_doc_snapshots` 表（share_token PK）、`agent_sessions.workitem_id` 列、`workitem_commits` 表

- [ ] **Step 1: 创建文档快照迁移**

写入 `infra/database/productdoc/migration-20260811-requirement-share-snapshots.sql`：

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

- [ ] **Step 2: 创建会话 workitem_id + workitem_commits 迁移**

写入 `infra/database/agent/migration-20260811-sessions-workitem-commit.sql`：

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_workitem_commits_workitem_hash
    ON workitem_commits(workitem_id, commit_hash);
```

- [ ] **Step 3: 验证 SQL 语法**

Run: `psql` 连接开发库执行两个脚本（若无可跳过，启动时 `CREATE TABLE IF NOT EXISTS` 会自动执行）

---

### Task 2: 需求点1 — 版本快照写入

**Files:**
- Modify: `apps/dh-backend/domain/productspace/service/requirement_share.go`（`createRequirementShareInternal` 函数，约第 68-151 行）

**Interfaces:**
- Produces: `writeDocSnapshot(ctx, shareToken, docID)` 内部函数，查询最新 published 版本并写入 `requirement_share_doc_snapshots`

- [ ] **Step 1: 新增 writeDocSnapshot 函数**

在 `requirement_share.go` 末尾新增：

```go
// writeDocSnapshot 查询文档当前最新已发布版本，写入分享快照表。
// 文档不存在或非 published 状态时跳过（不阻断分享创建）。
func (s *DBProductSpaceService) writeDocSnapshot(ctx context.Context, shareToken, docID string) {
	if docID == "" {
		return
	}
	var (
		doc           object.SharedDocInfo
		createdByName sql.NullString
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT v.title, v.content, v.version, v.created_at, COALESCE(u.name, '')
		FROM product_docs d
		JOIN product_doc_versions v ON v.doc_id = d.id
		LEFT JOIN users u ON u.id = COALESCE(NULLIF(d.created_by, ''), v.created_by)
		WHERE d.id = $1 AND d.status = 'published'
		ORDER BY v.version DESC
		LIMIT 1
	`, docID).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
	if err != nil {
		log.Printf("[RequirementShare] writeDocSnapshot skip (doc=%s): %v", docID, err)
		return
	}
	doc.CreatedByName = createdByName.String
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO requirement_share_doc_snapshots
			(share_token, doc_id, doc_title, doc_content, doc_version, published_at, created_by_name, snapshot_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (share_token) DO UPDATE SET
			doc_id = EXCLUDED.doc_id, doc_title = EXCLUDED.doc_title,
			doc_content = EXCLUDED.doc_content, doc_version = EXCLUDED.doc_version,
			published_at = EXCLUDED.published_at, created_by_name = EXCLUDED.created_by_name,
			snapshot_at = NOW()
	`, shareToken, docID, doc.Title, doc.Content, doc.Version, doc.PublishedAt, doc.CreatedByName)
	if err != nil {
		log.Printf("[RequirementShare] writeDocSnapshot insert failed (token=%s): %v", shareToken, err)
	}
}
```

> 需在文件 import 中加 `"log"`（若未引入）。

- [ ] **Step 2: 在 createRequirementShareInternal 中调用 writeDocSnapshot**

在 `createRequirementShareInternal` 函数中，**新建分享成功后**（INSERT 成功的 `return share, nil` 之前，约第 149 行）调用：

```go
	// 创建分享时锁定文档版本快照，后续文档上下线不影响已发出的分享。
	if share.DocID != "" {
		s.writeDocSnapshot(ctx, share.Token, share.DocID)
	}
```

在**幂等返回已有分享**的分支（约第 121 行 `return existing, nil` 之前），补写缺失的快照：

```go
	// 老数据兼容：幂等返回已有分享时，若快照缺失则补写。
	if existing.DocID != "" {
		s.ensureDocSnapshot(ctx, existing.Token, existing.DocID)
	}
```

新增 `ensureDocSnapshot`（仅在快照不存在时补写，避免每次幂等都重写）：

```go
// ensureDocSnapshot 仅在快照不存在时补写，用于兼容老数据。
func (s *DBProductSpaceService) ensureDocSnapshot(ctx context.Context, shareToken, docID string) {
	var exists bool
	_ = s.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM requirement_share_doc_snapshots WHERE share_token = $1)`,
		shareToken,
	).Scan(&exists)
	if exists {
		return
	}
	s.writeDocSnapshot(ctx, shareToken, docID)
}
```

- [ ] **Step 3: 编译验证**

Run: `go build ./...`（在 `apps/dh-backend` 目录）
Expected: 编译通过，0 error

Run: `go vet ./...`
Expected: 0 warning

---

### Task 3: 需求点1 — 版本快照读取

**Files:**
- Modify: `apps/dh-backend/domain/productspace/service/requirement_share.go`（`GetSharedRequirement` 函数，约第 188-251 行）

**Interfaces:**
- Consumes: `writeDocSnapshot` 产出的 `requirement_share_doc_snapshots` 数据

- [ ] **Step 1: 修改 GetSharedRequirement 文档部分改读快照**

将 `GetSharedRequirement`（第 199-217 行）的文档查询块：

```go
	// 文档：仅取已发布状态的最新版本
	if docID != "" {
		var doc object.SharedDocInfo
		var createdByName sql.NullString
		err := s.db.QueryRow(`
			SELECT v.title, v.content, v.version, v.created_at, COALESCE(u.name, '')
			FROM product_docs d
			JOIN product_doc_versions v ON v.doc_id = d.id
			LEFT JOIN users u ON u.id = COALESCE(NULLIF(d.created_by, ''), v.created_by)
			WHERE d.id = $1 AND d.status = 'published'
			ORDER BY v.version DESC
			LIMIT 1
		`, docID).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
		if err == nil {
			doc.CreatedByName = createdByName.String
			view.Doc = &doc
		}
		// 文档不存在或不是已发布状态时，不返回错误，仅不展示文档
	}
```

替换为读快照 + 老数据回退：

```go
	// 文档：优先读快照（文档后续上下线不影响分享）；快照缺失时回退查 product_docs（兼容老数据）。
	if docID != "" {
		view.Doc = s.loadDocSnapshotOrFallback(token, docID)
	}
```

- [ ] **Step 2: 新增 loadDocSnapshotOrFallback 函数**

在 `GetSharedRequirement` 下方新增：

```go
// loadDocSnapshotOrFallback 优先读分享文档快照；快照缺失时回退查 product_docs 已发布版本（兼容老数据）。
func (s *DBProductSpaceService) loadDocSnapshotOrFallback(token, docID string) *object.SharedDocInfo {
	// 1. 读快照
	var doc object.SharedDocInfo
	var createdByName sql.NullString
	err := s.db.QueryRow(`
		SELECT doc_title, doc_content, doc_version, published_at, created_by_name
		FROM requirement_share_doc_snapshots WHERE share_token = $1
	`, token).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
	if err == nil {
		doc.CreatedByName = createdByName.String
		return &doc
	}
	// 2. 快照缺失：回退查 product_docs（兼容快照机制上线前的老分享）
	err = s.db.QueryRow(`
		SELECT v.title, v.content, v.version, v.created_at, COALESCE(u.name, '')
		FROM product_docs d
		JOIN product_doc_versions v ON v.doc_id = d.id
		LEFT JOIN users u ON u.id = COALESCE(NULLIF(d.created_by, ''), v.created_by)
		WHERE d.id = $1 AND d.status = 'published'
		ORDER BY v.version DESC
		LIMIT 1
	`, docID).Scan(&doc.Title, &doc.Content, &doc.Version, &doc.PublishedAt, &createdByName)
	if err != nil {
		return nil
	}
	doc.CreatedByName = createdByName.String
	return &doc
}
```

- [ ] **Step 3: 编译验证**

Run: `go build ./...` && `go vet ./...`（在 `apps/dh-backend` 目录）
Expected: 0 error, 0 warning

- [ ] **Step 4: 手动验证 bug 修复**

启动后端，创建需求关联已发布文档 -> 点击产品设计正常 -> 将文档下线（archived）-> 再次点击产品设计应仍展示快照内容（不再「已失效」）。

---

### Task 4: 需求点2 — SessionStore 加 workitem_id 方法

**Files:**
- Modify: `apps/dh-backend/agent/chat/store.go:26`（SessionStore 接口）
- Modify: `apps/dh-backend/agent/chat/session/session.go`（内存实现）
- Modify: `apps/dh-backend/agent/chat/session/postgres.go`（PG 实现）

**Interfaces:**
- Produces: `SessionStore.UpdateWorkitemID(ctx, sessionID, workitemID string) error`、`SessionStore.GetWorkitemID(ctx, sessionID string) (string, error)`

- [ ] **Step 1: 接口加两个方法**

在 `apps/dh-backend/agent/chat/store.go` 的 `SessionStore` 接口中新增两个方法（保持接口内其他方法不变）：

```go
	// UpdateWorkitemID 持久化会话关联的需求 ID（仅首次设置时写入，避免关联漂移）。
	UpdateWorkitemID(ctx context.Context, sessionID, workitemID string) error
	// GetWorkitemID 查询会话关联的需求 ID。
	GetWorkitemID(ctx context.Context, sessionID string) (string, error)
```

- [ ] **Step 2: 内存实现**

在 `apps/dh-backend/agent/chat/session/session.go` 末尾新增（内存实现用 map 存 workitemID，与 sessions 分离避免改动 Session 模型）：

```go
// workitemIndex 维护 sessionID -> workitemID 的映射（内存实现专用，PG 实现走数据库列）。
type SessionStore struct {
	mu            sync.RWMutex
	sessions      map[string]chat.Session
	maxSessions   int
	ttl           time.Duration
	done          chan struct{}
	workitemIndex map[string]string
}
```

> 将原 `SessionStore` struct 定义（第 23-29 行）补上 `workitemIndex map[string]string` 字段，并在 `NewSessionStore`（第 31 行）初始化 `workitemIndex: make(map[string]string)`。

在文件末尾新增方法：

```go
// UpdateWorkitemID 仅在当前会话未关联需求时写入，首条引用锁定。
func (s *SessionStore) UpdateWorkitemID(ctx context.Context, sessionID, workitemID string) error {
	if workitemID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing := s.workitemIndex[sessionID]; existing != "" {
		return nil
	}
	s.workitemIndex[sessionID] = workitemID
	return nil
}

func (s *SessionStore) GetWorkitemID(ctx context.Context, sessionID string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.workitemIndex[sessionID], nil
}
```

> 在 `Delete` 方法中补充 `delete(s.workitemIndex, id)` 保持一致。

- [ ] **Step 3: PG 实现**

在 `apps/dh-backend/agent/chat/session/postgres.go` 末尾新增：

```go
// UpdateWorkitemID 仅在当前 workitem_id 为空时写入，首条引用锁定，避免关联漂移。
func (s *PostgresStore) UpdateWorkitemID(ctx context.Context, sessionID, workitemID string) error {
	if workitemID == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE agent_sessions SET workitem_id = $1
		WHERE id = $2 AND (workitem_id IS NULL OR workitem_id = '')
	`, workitemID, sessionID)
	if err != nil {
		return fmt.Errorf("update session workitem_id failed: %w", err)
	}
	return nil
}

func (s *PostgresStore) GetWorkitemID(ctx context.Context, sessionID string) (string, error) {
	var workitemID sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT workitem_id FROM agent_sessions WHERE id = $1`, sessionID,
	).Scan(&workitemID)
	if err != nil {
		return "", fmt.Errorf("get session workitem_id failed: %w", err)
	}
	return workitemID.String, nil
}
```

> 需在 postgres.go import 中加 `"database/sql"`（若未引入）。

- [ ] **Step 4: 编译验证**

Run: `go build ./...` && `go vet ./...`（在 `apps/dh-backend` 目录）
Expected: 0 error, 0 warning

---

### Task 5: 需求点2 — 会话持久化 workitem_id

**Files:**
- Modify: `apps/dh-backend/gateway/handler/agui_run.go`（`AgentRun` 函数，约第 77-170 行）

**Interfaces:**
- Consumes: `extractQuotedCard`（`command.go:48` 已存在）、`SessionStore.UpdateWorkitemID`（Task 4 产出）
- Produces: `agentRunStream` 持有 `workitemID` 字段供 Task 6 使用

- [ ] **Step 1: agentRunStream 加 workitemID 字段**

在 `agui_run.go` 第 57-72 行的 `agentRunStream` struct 中新增字段：

```go
type agentRunStream struct {
	// ... 现有字段 ...
	workitemID    string // 当前 run 关联的需求 ID（从 quotedCard 提取），供 commit 记录使用
}
```

- [ ] **Step 2: AgentRun 中提取并持久化 workitemID**

在 `AgentRun` 函数中，阶段9（threadId 变更迁移，约第 136 行）之后、阶段10（事件流消费，约第 143 行）之前，新增 workitemID 提取与持久化：

```go
	// 从本次 run 的 context 提取 quotedCard，持久化会话关联的需求 ID（首条引用锁定）。
	runWorkitemID := ""
	if card, hasCard, cardErr := extractQuotedCard(input.Context); cardErr != nil {
		log.Printf("[AGUIHandler] run=%s extract quotedCard failed: %v", input.RunID, cardErr)
	} else if hasCard && card.ID != "" {
		runWorkitemID = card.ID
		if err := h.sessionStore.UpdateWorkitemID(r.Context(), sessionID, runWorkitemID); err != nil {
			log.Printf("[AGUIHandler] run=%s persist workitem_id failed: %v", input.RunID, err)
		}
	}
```

> 若 `h.sessionStore` 字段名不同，按 AGUIHandler 实际字段调整。可 grep `AGUIHandler struct` 确认。

- [ ] **Step 3: 传入 agentRunStream**

在 `stream := &agentRunStream{...}`（约第 151 行）初始化中新增：

```go
	stream := &agentRunStream{
		// ... 现有字段 ...
		workitemID:    runWorkitemID,
	}
```

- [ ] **Step 4: 确认 AGUIHandler 的 sessionStore 字段**

Run: `grep -n "sessionStore\|SessionStore" apps/dh-backend/gateway/handler/*.go | head -20`
确认 AGUIHandler 持有 session store 引用；若无，需在 AGUIHandler 初始化时注入（参考 server.go 中 session store 的创建）。

- [ ] **Step 5: 编译验证**

Run: `go build ./...` && `go vet ./...`（在 `apps/dh-backend` 目录）
Expected: 0 error, 0 warning

---

### Task 6: 需求点2 — commit 自动记录

**Files:**
- Create: `apps/dh-backend/domain/workitem/service/commit_service.go`
- Modify: `apps/dh-backend/domain/workitem/service/service.go`（WorkItemService 接口）
- Modify: `apps/dh-backend/gateway/handler/agui_run.go`（EventToolCallResult 分支，约第 799 行）

**Interfaces:**
- Consumes: `agentRunStream.workitemID`（Task 5 产出）、`agentRunStream.sessionID`、`agentRunStream.h`
- Produces: `WorkItemService.RecordCommit(ctx, req RecordCommitRequest) error`、`WorkItemService.ListCommits(workitemID string) ([]WorkItemCommit, error)`

- [ ] **Step 1: 定义 commit 对象类型与请求**

新建 `apps/dh-backend/domain/workitem/service/commit_service.go`：

```go
package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
)

// WorkItemCommit 需求开发提交记录。
type WorkItemCommit struct {
	ID            string    `json:"id"`
	WorkitemID    string    `json:"workitemId"`
	WorkspaceID   string    `json:"workspaceId"`
	SessionID     string    `json:"sessionId"`
	RepositoryID  string    `json:"repositoryId,omitempty"`
	CommitHash    string    `json:"commitHash"`
	CommitMessage string    `json:"commitMessage,omitempty"`
	Author        string    `json:"author,omitempty"`
	CommittedAt   time.Time `json:"committedAt"`
}

// RecordCommitRequest 记录一条需求开发提交。
type RecordCommitRequest struct {
	WorkitemID    string
	WorkspaceID   string
	SessionID     string
	RepositoryID  string
	CommitHash    string
	CommitMessage string
	Author        string
	CommittedAt   time.Time
}

// RecordCommit 幂等记录一条需求开发提交（workitem_id+commit_hash 唯一，重复忽略）。
func (s *DBWorkItemService) RecordCommit(ctx context.Context, req RecordCommitRequest) error {
	if req.WorkitemID == "" || req.CommitHash == "" {
		return errors.New("workitemID and commitHash are required")
	}
	committedAt := req.CommittedAt
	if committedAt.IsZero() {
		committedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO workitem_commits
			(id, workitem_id, workspace_id, session_id, repository_id, commit_hash, commit_message, author, committed_at, created_at)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, NULLIF($7, ''), NULLIF($8, ''), $9, NOW())
		ON CONFLICT (workitem_id, commit_hash) DO NOTHING
	`, idutil.GenerateID(), req.WorkitemID, req.WorkspaceID, req.SessionID,
		req.RepositoryID, req.CommitHash, req.CommitMessage, req.Author, committedAt)
	if err != nil {
		return fmt.Errorf("record workitem commit failed: %w", err)
	}
	return nil
}

// ListCommits 按需求 ID 查询开发提交列表，按提交时间倒序。
func (s *DBWorkItemService) ListCommits(workitemID string) ([]WorkItemCommit, error) {
	rows, err := s.db.Query(`
		SELECT id, workitem_id, workspace_id, session_id, COALESCE(repository_id, ''),
		       commit_hash, COALESCE(commit_message, ''), COALESCE(author, ''), committed_at
		FROM workitem_commits
		WHERE workitem_id = $1
		ORDER BY committed_at DESC
	`, workitemID)
	if err != nil {
		return nil, fmt.Errorf("list workitem commits failed: %w", err)
	}
	defer rows.Close()
	result := make([]WorkItemCommit, 0)
	for rows.Next() {
		var c WorkItemCommit
		if err := rows.Scan(&c.ID, &c.WorkitemID, &c.WorkspaceID, &c.SessionID,
			&c.RepositoryID, &c.CommitHash, &c.CommitMessage, &c.Author, &c.CommittedAt); err != nil {
			return nil, fmt.Errorf("scan workitem commit failed: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
```

> 确认 `DBWorkItemService` 的 `db` 字段名与 `idutil` 导入路径（参考 `workitem/service/db_service.go` 现有写法）。

- [ ] **Step 2: WorkItemService 接口加方法**

在 `apps/dh-backend/domain/workitem/service/service.go` 的 `WorkItemService` 接口中新增：

```go
	RecordCommit(ctx context.Context, req RecordCommitRequest) error
	ListCommits(workitemID string) ([]WorkItemCommit, error)
```

- [ ] **Step 3: 新增 commit 解析工具函数**

在 `apps/dh-backend/gateway/handler/command.go` 末尾新增 commit 解析逻辑：

```go
import "regexp"

// gitCommitHashRegexp 匹配 git commit 输出中的短/长 commit hash，如 [main abc1234] message。
var gitCommitHashRegexp = regexp.MustCompile(`\[[^\]]*\s([0-9a-f]{7,40})\]`)

// gitCommitMessageRegexp 匹配 git commit 输出中的提交消息。
var gitCommitMessageRegexp = regexp.MustCompile(`\]\s*(.+)`)

// gitCommitCmdRegexp 检测命令字符串是否为 git commit。
var gitCommitCmdRegexp = regexp.MustCompile(`git\s+commit`)

// tryParseGitCommit 从 bash 工具的命令参数与输出中解析 commit hash 与消息。
// 返回 hash, message, ok；非 git commit 命令或解析失败时 ok=false。
func tryParseGitCommit(argsText, resultContent string) (hash, message string, ok bool) {
	if !gitCommitCmdRegexp.MatchString(argsText) {
		return "", "", false
	}
	m := gitCommitHashRegexp.FindStringSubmatch(resultContent)
	if len(m) < 2 {
		return "", "", false
	}
	hash = m[1]
	if mm := gitCommitMessageRegexp.FindStringSubmatch(resultContent); len(mm) >= 2 {
		message = mm[1]
	}
	return hash, message, true
}
```

- [ ] **Step 4: 在 EventToolCallResult 分支记录 commit**

在 `agui_run.go` 的 `EventToolCallResult` 分支（约第 799-818 行），在更新 runParts.Result 之后、`s.checkpointRun()` 之前，新增 commit 记录：

```go
		// 检测 bash 工具执行 git commit，自动记录到需求提交列表。
		if s.workitemID != "" {
			s.state.bufMu.Lock()
			var argsText, toolName string
			for i := len(s.state.runParts) - 1; i >= 0; i-- {
				if s.state.runParts[i].Type == "tool-call" && s.state.runParts[i].ToolCallID == ev.ToolCallID {
					argsText = s.state.runParts[i].ArgsText
					toolName = s.state.runParts[i].ToolName
					break
				}
			}
			s.state.bufMu.Unlock()
			if toolName == "bash" || toolName == "shell" {
				s.tryRecordCommit(argsText, ev.Content)
			}
		}
```

- [ ] **Step 5: 新增 tryRecordCommit 方法**

在 `agui_run.go` 中新增 `agentRunStream` 的方法：

```go
// tryRecordCommit 解析 git commit 输出并记录到需求提交列表（失败静默跳过，不阻塞 agent 流程）。
func (s *agentRunStream) tryRecordCommit(argsText, resultContent string) {
	hash, message, ok := tryParseGitCommit(argsText, resultContent)
	if !ok {
		return
	}
	workspaceID := ""
	if s.h != nil {
		workspaceID = s.h.workspaceIDFromStream(s) // 见下方说明
	}
	svc := workitemDefaultService() // 获取全局 workitem service（见下方说明）
	if svc == nil {
		return
	}
	if err := svc.RecordCommit(s.bgCtx, workitemservice.RecordCommitRequest{
		WorkitemID:    s.workitemID,
		WorkspaceID:   workspaceID,
		SessionID:     s.sessionID,
		CommitHash:    hash,
		CommitMessage: message,
	}); err != nil {
		log.Printf("[AGUIHandler] run=%s record commit failed (workitem=%s): %v",
			s.input.RunID, s.workitemID, err)
	}
}
```

> 实现说明：
> - `workitemDefaultService()`：在 `agui_run.go` 顶部 import `workitemhandler "github.com/.../domain/workitem"` 并调用其导出的 `GetDefaultService()`（需在 workitem handler 包新增该 getter，返回 `defaultWorkItemService`）。
> - `workspaceIDFromStream`：从 `s.input.Workspace` 或请求上下文获取 workspaceID；若 agentRunStream 无直接 workspaceID 字段，需在 Task 5 的 struct 中补 `workspaceID string` 字段并从 `AgentRun` 传入。
> - import 别名需与现有 import 风格一致；`workitemservice` 为 `workitem/service` 包别名。

- [ ] **Step 6: workitem handler 暴露默认 service getter**

在 `apps/dh-backend/domain/workitem/handler.go` 新增：

```go
// GetDefaultService 返回全局 workitem service（供其他 handler 包调用，如 commit 记录）。
func GetDefaultService() service.WorkItemService {
	return defaultWorkItemService
}
```

- [ ] **Step 7: 编译验证**

Run: `go build ./...` && `go vet ./...`（在 `apps/dh-backend` 目录）
Expected: 0 error, 0 warning

> 若编译报循环依赖，将 `RecordCommit` 调用改为通过 server.go 注入的回调或接口，避免 handler 包反向依赖。

---

### Task 7: 需求点2 — GET /workitems/{id}/commits 接口

**Files:**
- Modify: `apps/dh-backend/domain/workitem/handler.go`（新增 WorkItemCommits handler）
- Modify: `apps/dh-backend/gateway/server/server.go`（注册路由）

**Interfaces:**
- Consumes: `WorkItemService.ListCommits`（Task 6 产出）
- Produces: `GET /api/v1/workitems/{id}/commits` 端点

- [ ] **Step 1: 新增 WorkItemCommits handler**

在 `apps/dh-backend/domain/workitem/handler.go` 新增：

```go
// WorkItemCommits 处理 GET /api/v1/workitems/{id}/commits：返回需求关联的开发提交列表。
func WorkItemCommits(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultWorkItemService == nil {
		http.Error(w, `{"code":1,"message":"workitem service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	workitemID := r.PathValue("id")
	if workitemID == "" {
		http.Error(w, `{"code":1,"message":"missing workitem id"}`, http.StatusBadRequest)
		return
	}
	commits, err := defaultWorkItemService.ListCommits(workitemID)
	if err != nil {
		log.Printf("[WorkItem] ListCommits failed: %v", err)
		http.Error(w, `{"code":1,"message":"failed to list commits"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"commits": commits})
}
```

- [ ] **Step 2: 注册路由**

在 `apps/dh-backend/gateway/server/server.go` 的路由常量区（约第 229 行附近）新增：

```go
	ROUTE_WORKITEM_COMMITS = API_V1_PREFIX + "/workitems/{id}/commits"
```

在 `New(cfg)` 的 mux 注册区（约第 658 行附近）新增：

```go
	mux.Handle(ROUTE_WORKITEM_COMMITS, middleware.Auth(http.HandlerFunc(workitemhandler.WorkItemCommits)))
```

> 确认 `workitemhandler` 的 import 别名与现有注册一致（grep `workitemhandler` 确认）。鉴权中间件与现有 workitem 路由一致。

- [ ] **Step 3: 编译验证 + 接口测试**

Run: `go build ./...` && `go vet ./...`（在 `apps/dh-backend` 目录）
Expected: 0 error, 0 warning

Run: 启动后端后 `curl -s http://localhost:8080/api/v1/workitems/<某需求id>/commits -H "Authorization: Bearer <token>"`
Expected: 返回 `{"commits":[...]}`

---

### Task 8: 前端 — 抽取共享组件

**Files:**
- Create: `apps/dh-frontend/src/components/workitem/ResourceCard.tsx`
- Create: `apps/dh-frontend/src/components/workitem/WorkItemDetailDialog.tsx`
- Create: `apps/dh-frontend/src/lib/workitem-utils.ts`
- Modify: `apps/dh-frontend/src/pages/ProcessDetail.tsx`
- Modify: `apps/dh-frontend/src/components/workspace/KanbanWorkspace.tsx`
- Modify: `apps/dh-frontend/src/components/WorkItemCard.tsx`
- Modify: `apps/dh-frontend/src/pages/Requirements.tsx`

**Interfaces:**
- Produces: `ResourceCard`、`WorkItemDetailDialog`、`API_STATUS_TO_UI`/`API_PRIORITY_TO_UI` 共享导出

- [ ] **Step 1: 新建 workitem-utils.ts**

写入 `apps/dh-frontend/src/lib/workitem-utils.ts`：

```ts
import type { WorkItemDTO } from '@/lib/api-types';

/** 工作项状态 API 值 -> UI 中文标签映射。 */
export const API_STATUS_TO_UI: Record<string, string> = {
  backlog: '待处理',
  todo: '待处理',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
  on_hold: '已挂起',
};

/** 工作项优先级 API 值 -> UI 中文标签映射。 */
export const API_PRIORITY_TO_UI: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/** 根据状态判断是否为完成态（用于卡片降低不透明度）。 */
export const DONE_STATUSES = ['已完成', '已取消'];

/** 看板列状态顺序。 */
export const KANBAN_STATUSES = ['待处理', '进行中', '已完成', '已取消', '已挂起'];

export function mapStatus(apiStatus: string): string {
  return API_STATUS_TO_UI[apiStatus] ?? apiStatus;
}

export function mapPriority(apiPriority: string): string {
  return API_PRIORITY_TO_UI[apiPriority] ?? apiPriority;
}

export function isDoneStatus(uiStatus: string): boolean {
  return DONE_STATUSES.includes(uiStatus);
}

export type { WorkItemDTO };
```

> 确认 `WorkItemDTO` 的实际导出位置（grep `WorkItemDTO` 确认在 `api-types.ts` 还是其他文件）。

- [ ] **Step 2: 新建 ResourceCard.tsx**

写入 `apps/dh-frontend/src/components/workitem/ResourceCard.tsx`：

```tsx
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';

interface ResourceCardProps {
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onClick?: () => void;
}

/** 相关资源卡片：有 onClick 时可点击高亮，无 onClick 时灰显占位。 */
export function ResourceCard({ icon: Icon, label, loading, onClick }: ResourceCardProps) {
  const interactive = !!onClick;
  return (
    <button
      type="button"
      disabled={!interactive || loading}
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-lg border border-border/60 p-3 text-xs transition-colors ${
        interactive
          ? 'hover:border-primary/40 hover:bg-primary/5 cursor-pointer'
          : 'opacity-60 cursor-default'
      }`}
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <Icon className="h-5 w-5 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">{label}</span>
    </button>
  );
}
```

- [ ] **Step 3: 新建 WorkItemDetailDialog.tsx**

写入 `apps/dh-frontend/src/components/workitem/WorkItemDetailDialog.tsx`：

```tsx
import { Github, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MarkdownView } from '@/components/chat/MarkdownView';
import { ResourceCard } from './ResourceCard';
import { mapStatus, mapPriority, type WorkItemDTO } from '@/lib/workitem-utils';

interface WorkItemDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workitem: WorkItemDTO | null;
  designLoading?: boolean;
  commitsLoading?: boolean;
  onOpenDesign?: () => void;
  onOpenCommits?: () => void;
}

/** 需求详情 Dialog：基本信息 + 任务描述 + 相关资源（产品设计/代码提交/测试用例）。 */
export function WorkItemDetailDialog({
  open, onOpenChange, workitem, designLoading, commitsLoading, onOpenDesign, onOpenCommits,
}: WorkItemDetailDialogProps) {
  if (!workitem) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            需求详情
            <span className="text-xs font-normal text-muted-foreground">{workitem.displayId ?? workitem.id}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* 基本信息 */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <InfoRow label="标题" value={workitem.title} />
            <InfoRow label="提出人" value={workitem.reporter ?? '-'} />
            <InfoRow label="优先级" value={mapPriority(workitem.priority)} />
            <InfoRow label="状态" value={mapStatus(workitem.status)} />
            <InfoRow label="来源" value={workitem.source ?? '-'} />
            <InfoRow label="负责人" value={workitem.assigneeName ?? '-'} />
            <InfoRow label="创建时间" value={workitem.createdAt ? new Date(workitem.createdAt).toLocaleString() : '-'} />
          </div>
          {/* 任务描述 */}
          {workitem.description && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">任务描述</p>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MarkdownView content={workitem.description} collapsible={false} />
              </div>
            </div>
          )}
          {/* 相关资源 */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">相关资源</p>
            <div className="grid grid-cols-3 gap-2">
              <ResourceCard icon={FileText} label="产品设计" loading={designLoading} onClick={onOpenDesign} />
              <ResourceCard icon={Github} label="代码提交" loading={commitsLoading} onClick={onOpenCommits} />
              <ResourceCard icon={FileText} label="测试用例" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
```

> 确认 `WorkItemDTO` 的字段名（reporter/assigneeName/source/createdAt/displayId）与现有代码一致（参考 KanbanWorkspace.tsx 现有 Dialog 实现）。

- [ ] **Step 4: ProcessDetail.tsx 改用共享组件**

在 `ProcessDetail.tsx` 中：
1. 删除本地 `ResourceCard` 定义（第 184-208 行）
2. 删除本地需求详情 Dialog（第 371-445 行）
3. import `{ WorkItemDetailDialog }` 与 `{ ResourceCard }`
4. 在原 Dialog 位置用 `<WorkItemDetailDialog ... />`，传入 `onOpenDesign={handleOpenDesignContent}`、`onOpenCommits={...}`（Task 9 实现，先传 undefined）

> 保持 `handleOpenDesignContent`（第 251 行）逻辑不变，仅作为回调传入。

- [ ] **Step 5: KanbanWorkspace.tsx 改用共享组件**

同 Step 4，删除 `KanbanWorkspace.tsx` 的本地 `ResourceCard`（第 833-852 行）与需求详情 Dialog（第 642-719 行），改用共享组件，`onOpenDesign={openProductDesignShare}`。

- [ ] **Step 6: WorkItemCard.tsx / Requirements.tsx 改用共享状态映射**

删除 `WorkItemCard.tsx:7-14`、`Requirements.tsx:16-23`、`KanbanWorkspace.tsx:52-59` 的本地 `API_STATUS_TO_UI`/`API_PRIORITY_TO_UI`，改为 `import { mapStatus, mapPriority } from '@/lib/workitem-utils'`。

- [ ] **Step 7: 类型检查 + lint**

Run: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json`
Expected: 0 error

Run: `pnpm --filter @repo/dh-frontend lint`
Expected: 0 error

---

### Task 9: 前端 — 代码提交卡片 + commit 列表 + diff

**Files:**
- Create: `apps/dh-frontend/src/lib/workitem-commit-api.ts`
- Modify: `apps/dh-frontend/src/components/workitem/WorkItemDetailDialog.tsx`（接入 commit 列表）

**Interfaces:**
- Consumes: `GET /api/v1/workitems/{id}/commits`（Task 7 产出）、`project-api.ts` 的 `diff` 接口

- [ ] **Step 1: 新建 workitem-commit-api.ts**

写入 `apps/dh-frontend/src/lib/workitem-commit-api.ts`：

```ts
import { api } from '@/lib/api';

export interface WorkItemCommitDTO {
  id: string;
  workitemId: string;
  workspaceId: string;
  sessionId: string;
  repositoryId?: string;
  commitHash: string;
  commitMessage?: string;
  author?: string;
  committedAt: string;
}

export const workitemCommitApi = {
  /** 查询需求关联的开发提交列表。 */
  list: (workitemId: string) =>
    api.get<{ commits: WorkItemCommitDTO[] }>(`/v1/workitems/${workitemId}/commits`).then(res => res.commits),
};
```

> 确认 `api` 的导入路径与 `productspace-api.ts` 一致。

- [ ] **Step 2: WorkItemDetailDialog 接入 commit 列表**

修改 `WorkItemDetailDialog.tsx`，新增 commit 列表 Dialog/Sheet：
1. 新增 state：`commitsOpen`、`commits`、`commitsLoading`
2. `onOpenCommits` 调用 `workitemCommitApi.list(workitem.id)` 加载列表
3. 展示 commit 列表（hash 短格式、消息、作者、时间），点击调用 `projectApi.diff(path)` 查看 diff（复用 ProjectCode.tsx 的 diff 展示逻辑，或简化为打开新页查看）

> diff 展示可简化：点击 commit 打开一个 diff 预览 Dialog，调用 `project-api.ts` 的 `diff` 接口（需 repositoryId -> path 映射，参考 ProjectCode.tsx 现有逻辑）。

- [ ] **Step 3: ProcessDetail/KanbanWorkspace 传入 onOpenCommits**

在 Step 4/5（Task 8）中已预留 `onOpenCommits`，此处将 `WorkItemDetailDialog` 内部自管理 commit 列表（传入 `workitem.id` 即可），`onOpenCommits` 由 Dialog 内部处理。

> 若采用 Dialog 内部自管理，则 Task 8 的 `onOpenCommits` prop 可移除，改为 Dialog 内部根据 `workitem.id` 自动加载。

- [ ] **Step 4: 类型检查 + lint**

Run: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json` && `pnpm --filter @repo/dh-frontend lint`
Expected: 0 error

---

### Task 10: 缺陷文档 + 编译验证 + 启动

**Files:**
- Create: `docs/bugs/2026-08-11-share-expired-when-doc-offline.md`

**Interfaces:**
- 无

- [ ] **Step 1: 编写缺陷文档**

写入 `docs/bugs/2026-08-11-share-expired-when-doc-offline.md`：

```markdown
# 需求分享在文档下线后显示「已失效」

## 现象

需求关联的文档被下线（archived）或仍为草稿（draft）后，点击需求卡片「产品设计」打开分享页，
页面显示「分享链接不存在或已失效」，无法查看文档内容。

## 根因

`GetSharedRequirement`（`requirement_share.go:208`）查询文档时硬编码 `d.status = 'published'`，
文档下线/草稿后查询无结果，`view.Doc = nil`。若该需求无原型，则 `view.Doc == nil && view.Prototype == nil`，
返回 `ErrNotFound: 分享内容不存在`，前端 `ShareRequirement.tsx:572` 显示为「已失效」。

## 解决方案

采用版本快照方案：创建分享时将文档当前最新 published 版本完整快照到 `requirement_share_doc_snapshots` 表，
`GetSharedRequirement` 改读快照，不再实时查 `product_docs`。文档后续上下线不影响已发出的分享。
老数据通过 `loadDocSnapshotOrFallback` 回退查询兼容。

验证：文档下线后分享页仍展示快照内容；文档发布新版本后已发出的分享保持旧快照（符合版本快照语义）。
```

- [ ] **Step 2: 全量编译验证**

Run: `go vet ./...`（在 `apps/dh-backend` 目录）
Expected: 0 warning

Run: `npx tsc --noEmit -p apps/dh-frontend/tsconfig.check.json`
Expected: 0 error

- [ ] **Step 3: 构建并启动**

Run: `pnpm build`
Expected: 全部构建成功

Run: `bash scripts/restart-dev.sh`
Expected: Gatewayd -> Agent Stub -> DH Backend -> Frontend 全部启动

- [ ] **Step 4: 端到端验证**

1. 需求点1：创建需求关联已发布文档 -> 点击产品设计正常 -> 文档下线 -> 再次点击仍展示快照
2. 需求点2：在 Chat 中引用需求执行 /code 开发 -> agent git commit -> 需求卡片「代码提交」展示 commit -> 点击查看 diff
3. curl 验证：`curl -s http://localhost:8080/api/v1/workitems/<id>/commits -H "Authorization: Bearer <token>"`

---

## Self-Review

**Spec coverage:**
- 需求点1（版本快照）：Task 1（迁移）+ Task 2（写快照）+ Task 3（读快照）✅
- 需求点2（代码提交自动汇集）：Task 1（迁移）+ Task 4（store）+ Task 5（持久化 workitem_id）+ Task 6（commit 记录）+ Task 7（接口）+ Task 8/9（前端）✅
- 需求点3（已实现确认）：无需任务 ✅
- 缺陷文档（规则3）：Task 10 ✅
- 编译 warnings 清零（规则8）：Task 3/5/6/7/8/9/10 ✅
- 启动验证（规则1/11）：Task 10 ✅

**Placeholder scan:** 无 TBD/TODO；Task 6 Step 5 的 `workitemDefaultService()`/`workspaceIDFromStream` 标注了实现说明，非占位符而是跨包调用的具体指引。

**Type consistency:** `RecordCommitRequest`/`WorkItemCommit`（Task 6）与 `WorkItemCommitDTO`（Task 9）字段对应；`UpdateWorkitemID`/`GetWorkitemID`（Task 4）在 Task 5 消费；`ResourceCard`/`WorkItemDetailDialog`（Task 8）在 Task 9 接入 commit。
