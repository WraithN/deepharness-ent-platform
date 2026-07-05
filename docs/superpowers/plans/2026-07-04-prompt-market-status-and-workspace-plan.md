# 提示词市场状态审核与空间提示词管理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为提示词市场增加审核状态流，实现仅超管可见的审核中提示词，并让租户管理员能将已上架提示词添加到工作空间，最终在智能会话中按工作空间加载提示词。

**Architecture:** 复用 `team_prompts` 表作为全平台提示词库，新增状态、创建人、审核人字段；启用 `workspace_prompts` 表记录空间引用；后端在 SQL 层过滤可见性，前端根据角色展示「添加到空间」或「复制」。

**Tech Stack:** Go 1.22 + PostgreSQL + 标准库 HTTP；React 18 + TypeScript + Tailwind + shadcn/ui。

---

## 文件变更总览

| 文件 | 变更类型 | 职责 |
|---|---|---|
| `infra/database/team/alter_prompts_status.sql` | 新增 | 数据库变更：添加 status/created_by/reviewed_by/reviewed_at |
| `apps/dh-backend/domain/team/service/service.go` | 修改 | Prompt 模型、请求体、TeamService 接口扩展 |
| `apps/dh-backend/domain/team/service/db_service.go` | 修改 | Prompt CRUD、列表过滤、审核逻辑 |
| `apps/dh-backend/domain/team/handler.go` | 修改 | Prompt HTTP handler，新增 `/review` 路由处理 |
| `apps/dh-backend/domain/workspace/service/prompt_service.go` | 新增 | WorkspacePrompt 领域模型、接口、PostgreSQL 实现 |
| `apps/dh-backend/domain/workspace/prompt_handler.go` | 新增 | `/api/v1/workspaces/{id}/prompts` 路由 handler |
| `apps/dh-backend/domain/workspace/service/service.go` | 修改 | 注册新的 WorkspacePromptService（可选，通过独立包注入） |
| `apps/dh-backend/gateway/middleware/auth.go` | 修改 | 新增 `RequireTenantAdmin` 辅助函数 |
| `apps/dh-backend/gateway/server/server.go` | 修改 | 注册 workspace prompts 路由，注入 prompt 服务 |
| `apps/dh-frontend/src/types/index.ts` | 修改 | 扩展 Prompt 类型，新增 WorkspacePrompt 类型 |
| `apps/dh-frontend/src/lib/team-api.ts` | 修改 | 新增 review/updatePrompt 方法 |
| `apps/dh-frontend/src/lib/workspace-api.ts` | 修改 | 新增 list/add/remove prompts 方法 |
| `apps/dh-frontend/src/pages/PromptMarket.tsx` | 修改 | 状态展示、角色化操作按钮、审核中提示词可见 |
| `apps/dh-frontend/src/pages/AdminPage.tsx` | 修改 | 提示词管理接入真实数据与审核操作 |
| `apps/dh-frontend/src/pages/Settings.tsx` | 修改 | 提示词配置标签页加载空间提示词 |
| `apps/dh-frontend/src/pages/Chat.tsx` | 修改 | 智能会话加载当前工作空间提示词 |

---

## Task 1: 数据库变更

**Files:**
- Create: `infra/database/team/alter_prompts_status.sql`

- [ ] **Step 1: 编写 ALTER 脚本**

```sql
ALTER TABLE team_prompts
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(36),
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(36),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD CONSTRAINT chk_team_prompts_status CHECK (status IN ('pending_review', 'on_shelf', 'off_shelf', 'rejected'));

-- 存量数据兼容处理：已存在的提示词直接视为已上架
UPDATE team_prompts SET status = 'on_shelf' WHERE status = 'pending_review';

-- 如果 created_by 为空，后续列表中仅超管可见；可补充设置缺省创建人
-- UPDATE team_prompts SET created_by = 'u1' WHERE created_by IS NULL;
```

- [ ] **Step 2: 在开发库执行迁移**

Run:
```bash
PGPASSWORD=deepharness psql -h 127.0.0.1 -p 5433 -U deepharness -d deepharness -f infra/database/team/alter_prompts_status.sql
```

Expected: `ALTER TABLE` 与 `UPDATE` 成功，无报错。

- [ ] **Step 3: Commit**

```bash
git add infra/database/team/alter_prompts_status.sql
git commit -m "db: add prompt status, creator and reviewer columns"
```

---

## Task 2: 后端 Team Prompt 模型与接口扩展

**Files:**
- Modify: `apps/dh-backend/domain/team/service/service.go`

- [ ] **Step 1: 扩展 Prompt 结构与请求体**

在 `apps/dh-backend/domain/team/service/service.go` 中替换 Prompt、CreatePromptRequest、UpdatePromptRequest 与 TeamService 接口：

```go
// PromptStatus 表示提示词在市场中的生命周期状态。
type PromptStatus string

const (
	PromptStatusPendingReview PromptStatus = "pending_review"
	PromptStatusOnShelf       PromptStatus = "on_shelf"
	PromptStatusOffShelf      PromptStatus = "off_shelf"
	PromptStatusRejected      PromptStatus = "rejected"
)

// Prompt 表示团队提示词，与 team_prompts 表对应。
type Prompt struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	Content      string       `json:"content"`
	UseCase      string       `json:"useCase"`
	UsageCount   int          `json:"usageCount"`
	AddedToSpace bool         `json:"addedToSpace"`
	Status       PromptStatus `json:"status"`
	CreatedBy    string       `json:"createdBy"`
	ReviewedBy   string       `json:"reviewedBy"`
	ReviewedAt   *time.Time   `json:"reviewedAt,omitempty"`
	CreatedAt    time.Time    `json:"createdAt"`
	UpdatedAt    time.Time    `json:"updatedAt"`
}

// CreatePromptRequest 创建提示词请求。
type CreatePromptRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Content     string `json:"content"`
	UseCase     string `json:"useCase"`
}

// UpdatePromptRequest 更新提示词请求。
type UpdatePromptRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Content     *string `json:"content,omitempty"`
	UseCase     *string `json:"useCase,omitempty"`
}

// ReviewPromptRequest 审核提示词请求。
type ReviewPromptRequest struct {
	Action string `json:"action"` // approve | reject | unshelf
}

// TeamService 定义团队技能/提示词服务接口。
type TeamService interface {
	ListSkills() ([]Skill, error)
	CreateSkill(req CreateSkillRequest) (Skill, error)
	UpdateSkill(id string, req UpdateSkillRequest) (Skill, error)
	DeleteSkill(id string) error

	ListPromptsVisibleTo(userID string, isSuperAdmin bool) ([]Prompt, error)
	CreatePrompt(req CreatePromptRequest, createdBy string) (Prompt, error)
	UpdatePrompt(id string, req UpdatePromptRequest, userID string, isSuperAdmin bool) (Prompt, error)
	DeletePrompt(id string, userID string, isSuperAdmin bool) error
	ReviewPrompt(id string, action string, reviewerID string) (Prompt, error)
	GetPrompt(id string) (Prompt, error)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dh-backend/domain/team/service/service.go
git commit -m "team(service): extend Prompt with status, creator and review methods"
```

---

## Task 3: 后端 Team Prompt 业务实现

**Files:**
- Modify: `apps/dh-backend/domain/team/service/db_service.go`

- [ ] **Step 1: 修改 Prompt 查询扫描方法**

新增/替换 `getPrompt`、列表查询与写入方法：

```go
func (s *DBTeamService) getPrompt(id string) (Prompt, error) {
	var p Prompt
	var reviewedAt sql.NullTime
	err := s.db.QueryRow(`
		SELECT id, name, description, content, use_case, usage_count, added_to_space,
		       status, created_by, reviewed_by, reviewed_at, created_at, updated_at
		FROM team_prompts WHERE id = $1
	`, id).Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace,
		&p.Status, &p.CreatedBy, &p.ReviewedBy, &reviewedAt, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Prompt{}, errors.New("prompt not found")
	}
	if err != nil {
		return Prompt{}, fmt.Errorf("get prompt failed: %w", err)
	}
	if reviewedAt.Valid {
		p.ReviewedAt = &reviewedAt.Time
	}
	return p, nil
}

func (s *DBTeamService) GetPrompt(id string) (Prompt, error) {
	return s.getPrompt(id)
}
```

- [ ] **Step 2: 实现可见性列表**

```go
// ListPromptsVisibleTo 返回指定用户可见的提示词。
// 规则：on_shelf 全员可见；pending_review/rejected 仅创建人和超管可见；off_shelf 仅超管可见。
func (s *DBTeamService) ListPromptsVisibleTo(userID string, isSuperAdmin bool) ([]Prompt, error) {
	query := `
		SELECT id, name, description, content, use_case, usage_count, added_to_space,
		       status, created_by, reviewed_by, reviewed_at, created_at, updated_at
		FROM team_prompts
		WHERE status = $1
	`
	args := []any{string(PromptStatusOnShelf)}

	if isSuperAdmin {
		query = `
			SELECT id, name, description, content, use_case, usage_count, added_to_space,
			       status, created_by, reviewed_by, reviewed_at, created_at, updated_at
			FROM team_prompts
		`
		args = nil
	} else {
		query += ` OR (status IN ($2, $3) AND created_by = $4)`
		args = append(args, string(PromptStatusPendingReview), string(PromptStatusRejected), userID)
	}

	query += ` ORDER BY created_at DESC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list prompts failed: %w", err)
	}
	defer rows.Close()

	result := make([]Prompt, 0)
	for rows.Next() {
		var p Prompt
		var reviewedAt sql.NullTime
		err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Content, &p.UseCase, &p.UsageCount, &p.AddedToSpace,
			&p.Status, &p.CreatedBy, &p.ReviewedBy, &reviewedAt, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan prompt failed: %w", err)
		}
		if reviewedAt.Valid {
			p.ReviewedAt = &reviewedAt.Time
		}
		result = append(result, p)
	}
	return result, rows.Err()
}
```

- [ ] **Step 3: 实现创建、更新、删除、审核**

```go
// CreatePrompt 创建新提示词，默认进入审核中状态。
func (s *DBTeamService) CreatePrompt(req CreatePromptRequest, createdBy string) (Prompt, error) {
	now := time.Now().UTC()
	prompt := Prompt{
		ID:           uuid.New().String(),
		Name:         req.Name,
		Description:  req.Description,
		Content:      req.Content,
		UseCase:      req.UseCase,
		UsageCount:   0,
		AddedToSpace: true,
		Status:       PromptStatusPendingReview,
		CreatedBy:    createdBy,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	_, err := s.db.Exec(`
		INSERT INTO team_prompts (id, name, description, content, use_case, usage_count, added_to_space,
		                         status, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, prompt.ID, prompt.Name, prompt.Description, prompt.Content, prompt.UseCase, prompt.UsageCount, prompt.AddedToSpace,
		prompt.Status, prompt.CreatedBy, prompt.CreatedAt, prompt.UpdatedAt)
	if err != nil {
		return Prompt{}, fmt.Errorf("insert prompt failed: %w", err)
	}
	return prompt, nil
}

// UpdatePrompt 允许创建人修改 pending/rejected 状态的提示词，超管可修改任意。
func (s *DBTeamService) UpdatePrompt(id string, req UpdatePromptRequest, userID string, isSuperAdmin bool) (Prompt, error) {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return Prompt{}, err
	}
	if !isSuperAdmin && prompt.CreatedBy != userID {
		return Prompt{}, errors.New("forbidden: not the creator")
	}
	if !isSuperAdmin && prompt.Status != PromptStatusPendingReview && prompt.Status != PromptStatusRejected {
		return Prompt{}, errors.New("forbidden: can only edit pending or rejected prompts")
	}

	if req.Name != nil {
		prompt.Name = *req.Name
	}
	if req.Description != nil {
		prompt.Description = *req.Description
	}
	if req.Content != nil {
		prompt.Content = *req.Content
	}
	if req.UseCase != nil {
		prompt.UseCase = *req.UseCase
	}

	_, err = s.db.Exec(`
		UPDATE team_prompts
		SET name = $1, description = $2, content = $3, use_case = $4, updated_at = $5
		WHERE id = $6
	`, prompt.Name, prompt.Description, prompt.Content, prompt.UseCase, time.Now().UTC(), id)
	if err != nil {
		return Prompt{}, fmt.Errorf("update prompt failed: %w", err)
	}
	return s.getPrompt(id)
}

// DeletePrompt 删除提示词，权限规则同 UpdatePrompt。
func (s *DBTeamService) DeletePrompt(id string, userID string, isSuperAdmin bool) error {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return err
	}
	if !isSuperAdmin && prompt.CreatedBy != userID {
		return errors.New("forbidden: not the creator")
	}
	if !isSuperAdmin && prompt.Status != PromptStatusPendingReview && prompt.Status != PromptStatusRejected {
		return errors.New("forbidden: can only delete pending or rejected prompts")
	}

	res, err := s.db.Exec(`DELETE FROM team_prompts WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete prompt failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("prompt not found")
	}
	return nil
}

// ReviewPrompt 超级管理员审核提示词。
func (s *DBTeamService) ReviewPrompt(id string, action string, reviewerID string) (Prompt, error) {
	prompt, err := s.getPrompt(id)
	if err != nil {
		return Prompt{}, err
	}

	now := time.Now().UTC()
	var status PromptStatus
	switch action {
	case "approve":
		status = PromptStatusOnShelf
	case "reject":
		status = PromptStatusRejected
	case "unshelf":
		if prompt.Status != PromptStatusOnShelf {
			return Prompt{}, errors.New("prompt is not on shelf")
		}
		status = PromptStatusOffShelf
	default:
		return Prompt{}, errors.New("invalid review action")
	}

	_, err = s.db.Exec(`
		UPDATE team_prompts
		SET status = $1, reviewed_by = $2, reviewed_at = $3, updated_at = $4
		WHERE id = $5
	`, status, reviewerID, now, now, id)
	if err != nil {
		return Prompt{}, fmt.Errorf("review prompt failed: %w", err)
	}
	return s.getPrompt(id)
}
```

- [ ] **Step 4: 删除旧的 ListPrompts / CreatePrompt / UpdatePrompt 签名**

确保 `DBTeamService` 仍满足 `TeamService` 接口；删除旧的无 userID 参数方法。

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/domain/team/service/db_service.go
git commit -m "team(db): implement prompt status, visibility and review logic"
```

---

## Task 4: 后端 Team Prompt Handler

**Files:**
- Modify: `apps/dh-backend/domain/team/handler.go`

- [ ] **Step 1: 注入 UserService 并添加角色判断辅助函数**

在 `apps/dh-backend/domain/team/handler.go` 顶部改为：

```go
package team

import (
	"encoding/json"
	"net/http"

	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

var (
	defaultService     service.TeamService
	defaultUserService identityservice.UserService
)

func Init(svc service.TeamService) {
	defaultService = svc
}

func InitUserService(svc identityservice.UserService) {
	defaultUserService = svc
}

func currentUser(r *http.Request) (userID string, isSuperAdmin bool, ok bool) {
	userID, ok = middleware.UserIDFromContext(r.Context())
	if !ok {
		return "", false, false
	}
	if defaultUserService == nil {
		return userID, false, false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		return userID, false, false
	}
	return userID, user.PlatformRole == identity.PlatformRoleSuperAdmin, true
}

func requireAuth(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return "", false
	}
	return userID, true
}
```

- [ ] **Step 2: 改造 Prompts handler**

```go
// Prompts 处理 GET /api/v1/team/prompts 与 POST /api/v1/team/prompts。
func Prompts(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)

	switch r.Method {
	case http.MethodGet:
		userID, isSuperAdmin, ok := currentUser(r)
		if !ok {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		prompts, err := defaultService.ListPromptsVisibleTo(userID, isSuperAdmin)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to list prompts")
			return
		}
		json.NewEncoder(w).Encode(prompts)
	case http.MethodPost:
		userID, ok := requireAuth(w, r)
		if !ok {
			return
		}
		var req service.CreatePromptRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.Content == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name and content are required")
			return
		}
		prompt, err := defaultService.CreatePrompt(req, userID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to create prompt")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(prompt)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}
```

- [ ] **Step 3: 改造 PromptByID handler 并新增 ReviewPrompt**

```go
// PromptByID 处理 PATCH /api/v1/team/prompts/{id} 与 DELETE /api/v1/team/prompts/{id}。
func PromptByID(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodPatch:
		userID, isSuperAdmin, authOk := currentUser(r)
		if !authOk {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		var req service.UpdatePromptRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		prompt, err := defaultService.UpdatePrompt(id, req, userID, isSuperAdmin)
		if err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to update prompt")
			return
		}
		json.NewEncoder(w).Encode(prompt)
	case http.MethodDelete:
		userID, isSuperAdmin, authOk := currentUser(r)
		if !authOk {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		if err := defaultService.DeletePrompt(id, userID, isSuperAdmin); err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to delete prompt")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// ReviewPrompt 处理 POST /api/v1/team/prompts/{id}/review。
func ReviewPrompt(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	userID, isSuperAdmin, authOk := currentUser(r)
	if !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	if !isSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return
	}

	var req service.ReviewPromptRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	prompt, err := defaultService.ReviewPrompt(id, req.Action, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "prompt not found", "failed to review prompt")
		return
	}
	json.NewEncoder(w).Encode(prompt)
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dh-backend/domain/team/handler.go
git commit -m "team(handler): add auth, visibility filter and review endpoint"
```

---

## Task 5: 后端 TenantAdmin 校验辅助函数

**Files:**
- Modify: `apps/dh-backend/gateway/middleware/auth.go`

- [ ] **Step 1: 新增 RequireTenantAdmin**

在 `apps/dh-backend/gateway/middleware/auth.go` 中追加：

```go
// TenantAdminChecker 用于需要查询用户角色的中间件辅助校验。
type TenantAdminChecker struct {
	UserService interface {
		GetByID(userID string) (struct {
			PlatformRole string `json:"platformRole"`
		}, error)
	}
}

// RequireTenantAdmin 检查当前用户是否为 tenant_admin 或 super_admin。
// 依赖调用方注入的 identity service；此处通过传入 service 避免循环依赖。
func RequireTenantAdmin(w http.ResponseWriter, r *http.Request, getUser func(string) (identity.User, error)) bool {
	userID, ok := UserIDFromContext(r.Context())
	if !ok {
		writeUnauthorized(w)
		return false
	}
	if getUser == nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, "user service not initialized")
		return false
	}
	user, err := getUser(userID)
	if err != nil {
		WriteJSONError(w, http.StatusUnauthorized, 2, "failed to authenticate user")
		return false
	}
	if user.PlatformRole != identity.PlatformRoleTenantAdmin && user.PlatformRole != identity.PlatformRoleSuperAdmin {
		WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin required")
		return false
	}
	return true
}
```

> 注：更简洁的做法是在需要校验的 handler 包里本地调用 `UserService.GetByID`，避免 middleware 依赖 identity 包导致循环依赖。本计划采用「在 workspace prompt handler 内本地校验」的方式，因此 middleware 中可暂不引入 identity。若后续需要复用，再提取为通用辅助函数。

---

## Task 6: 后端 Workspace Prompt 服务

**Files:**
- Create: `apps/dh-backend/domain/workspace/service/prompt_service.go`

- [ ] **Step 1: 创建模型与接口**

```go
package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/google/uuid"
)

// WorkspacePrompt 表示某个工作空间下的提示词引用或自定义提示词。
type WorkspacePrompt struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	LibraryPromptID *string   `json:"libraryPromptId,omitempty"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Content         string    `json:"content"`
	UseCase         string    `json:"useCase"`
	UsageCount      int       `json:"usageCount"`
	IsCustom        bool      `json:"isCustom"`
	AddedToSpace    bool      `json:"addedToSpace"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// AddWorkspacePromptRequest 从提示词库添加到工作空间的请求。
type AddWorkspacePromptRequest struct {
	LibraryPromptID string `json:"libraryPromptId"`
}

// WorkspacePromptService 定义工作空间提示词服务接口。
type WorkspacePromptService interface {
	List(workspaceID string) ([]WorkspacePrompt, error)
	Add(workspaceID string, req AddWorkspacePromptRequest) (WorkspacePrompt, error)
	Remove(workspaceID, promptID string) error
}
```

- [ ] **Step 2: 创建 PostgreSQL 实现**

```go
// DBWorkspacePromptService 是基于 PostgreSQL 的 WorkspacePromptService 实现。
type DBWorkspacePromptService struct {
	db *sql.DB
}

func NewDBWorkspacePromptService(db *sql.DB) *DBWorkspacePromptService {
	return &DBWorkspacePromptService{db: db}
}

// List 返回工作空间下的提示词列表。
func (s *DBWorkspacePromptService) List(workspaceID string) ([]WorkspacePrompt, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, library_prompt_id, name, description, content, use_case,
		       usage_count, is_custom, added_to_space, created_at, updated_at
		FROM workspace_prompts
		WHERE workspace_id = $1
		ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace prompts failed: %w", err)
	}
	defer rows.Close()

	result := make([]WorkspacePrompt, 0)
	for rows.Next() {
		var p WorkspacePrompt
		var libID sql.NullString
		var desc sql.NullString
		err := rows.Scan(&p.ID, &p.WorkspaceID, &libID, &p.Name, &desc, &p.Content, &p.UseCase,
			&p.UsageCount, &p.IsCustom, &p.AddedToSpace, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan workspace prompt failed: %w", err)
		}
		p.LibraryPromptID = sqlutil.ScanNullStringPtr(libID)
		p.Description = sqlutil.ScanNullString(desc)
		result = append(result, p)
	}
	return result, rows.Err()
}

// Add 从 team_prompts 添加一个已上架提示词到工作空间。
func (s *DBWorkspacePromptService) Add(workspaceID string, req AddWorkspacePromptRequest) (WorkspacePrompt, error) {
	if req.LibraryPromptID == "" {
		return WorkspacePrompt{}, errors.New("libraryPromptId is required")
	}

	var name, content, useCase string
	var desc sql.NullString
	err := s.db.QueryRow(`
		SELECT name, description, content, use_case
		FROM team_prompts
		WHERE id = $1 AND status = $2
	`, req.LibraryPromptID, "on_shelf").Scan(&name, &desc, &content, &useCase)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkspacePrompt{}, errors.New("library prompt not found or not on shelf")
	}
	if err != nil {
		return WorkspacePrompt{}, fmt.Errorf("get library prompt failed: %w", err)
	}

	// 幂等：同一 library_prompt_id 在同一 workspace 下只保留一条
	var existingID string
	err = s.db.QueryRow(`
		SELECT id FROM workspace_prompts
		WHERE workspace_id = $1 AND library_prompt_id = $2
	`, workspaceID, req.LibraryPromptID).Scan(&existingID)
	if err == nil {
		return WorkspacePrompt{}, errors.New("prompt already added to workspace")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return WorkspacePrompt{}, fmt.Errorf("check existing workspace prompt failed: %w", err)
	}

	now := time.Now().UTC()
	p := WorkspacePrompt{
		ID:              uuid.New().String(),
		WorkspaceID:     workspaceID,
		LibraryPromptID: &req.LibraryPromptID,
		Name:            name,
		Description:     sqlutil.ScanNullString(desc),
		Content:         content,
		UseCase:         useCase,
		UsageCount:      0,
		IsCustom:        false,
		AddedToSpace:    true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	_, err = s.db.Exec(`
		INSERT INTO workspace_prompts (id, workspace_id, library_prompt_id, name, description, content, use_case,
		                               usage_count, is_custom, added_to_space, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, p.ID, p.WorkspaceID, p.LibraryPromptID, p.Name, p.Description, p.Content, p.UseCase,
		p.UsageCount, p.IsCustom, p.AddedToSpace, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return WorkspacePrompt{}, fmt.Errorf("insert workspace prompt failed: %w", err)
	}
	return p, nil
}

// Remove 从工作空间移除提示词引用。
func (s *DBWorkspacePromptService) Remove(workspaceID, promptID string) error {
	res, err := s.db.Exec(`
		DELETE FROM workspace_prompts WHERE workspace_id = $1 AND id = $2
	`, workspaceID, promptID)
	if err != nil {
		return fmt.Errorf("delete workspace prompt failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("workspace prompt not found")
	}
	return nil
}
```

- [ ] **Step 3: 确认 sqlutil 提供了 ScanNullStringPtr**

若 `packages/go-sdk/common/sqlutil` 没有 `ScanNullStringPtr`，在该包中新增：

```go
func ScanNullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dh-backend/domain/workspace/service/prompt_service.go
git commit -m "workspace(service): add WorkspacePromptService for space prompt references"
```

---

## Task 7: 后端 Workspace Prompt Handler

**Files:**
- Create: `apps/dh-backend/domain/workspace/prompt_handler.go`

- [ ] **Step 1: 实现 handler**

```go
package workspace

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

var defaultPromptService service.WorkspacePromptService

// InitPromptService 注入 WorkspacePromptService 实现。
func InitPromptService(svc service.WorkspacePromptService) {
	defaultPromptService = svc
}

func currentUserPlatformRole(r *http.Request) (userID string, role identity.PlatformRole, ok bool) {
	userID, ok = middleware.UserIDFromContext(r.Context())
	if !ok {
		return "", "", false
	}
	if defaultUserService == nil {
		return userID, "", false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		return userID, "", false
	}
	return userID, user.PlatformRole, true
}

func canManageSpacePrompts(r *http.Request) bool {
	_, role, ok := currentUserPlatformRole(r)
	if !ok {
		return false
	}
	return role == identity.PlatformRoleTenantAdmin || role == identity.PlatformRoleSuperAdmin
}

// Prompts 处理 GET /api/v1/workspaces/{id}/prompts 与 POST /api/v1/workspaces/{id}/prompts。
func Prompts(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if _, authOk := middleware.UserIDFromContext(r.Context()); !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		prompts, err := defaultPromptService.List(workspaceID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to list workspace prompts")
			return
		}
		json.NewEncoder(w).Encode(prompts)
	case http.MethodPost:
		if !canManageSpacePrompts(r) {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin required")
			return
		}
		var req service.AddWorkspacePromptRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		p, err := defaultPromptService.Add(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to add prompt")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(p)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// PromptByID 处理 DELETE /api/v1/workspaces/{id}/prompts/{promptId}。
func PromptByID(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	promptID, ok := handler.PathValueOr404(w, r, "promptId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if !canManageSpacePrompts(r) {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin required")
			return
		}
		if err := defaultPromptService.Remove(workspaceID, promptID); err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to remove prompt")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dh-backend/domain/workspace/prompt_handler.go
git commit -m "workspace(handler): add workspace prompt routes with tenant admin guard"
```

---

## Task 8: 后端路由注册与服务注入

**Files:**
- Modify: `apps/dh-backend/gateway/server/server.go`

- [ ] **Step 1: 初始化 WorkspacePromptService 与 UserService 注入 team**

在 `New` 函数中，找到 `initTeamService(db)` 调用位置，改为：

```go
userService := identityservice.NewDBUserService(db)
identity.Init(userService)
// ...
workspaceService := initWorkspaceService(db, cfg.WorkspaceRoot, userService)
// ...
initTeamService(db, userService)
```

- [ ] **Step 2: 修改 initTeamService 与新增 initWorkspacePromptService**

替换/新增初始化函数：

```go
func initTeamService(db *sql.DB, userService identityservice.UserService) {
	log.Println("[Team] using postgres storage")
	svc := teamservice.NewDBTeamService(db)
	team.Init(svc)
	team.InitUserService(userService)
}

func initWorkspacePromptService(db *sql.DB) workspaceservice.WorkspacePromptService {
	log.Println("[WorkspacePrompt] using postgres storage")
	svc := workspaceservice.NewDBWorkspacePromptService(db)
	workspace.InitPromptService(svc)
	return svc
}
```

- [ ] **Step 3: 注册路由**

在 workspace routes 区域追加：

```go
mux.Handle("/api/v1/workspaces/{id}/prompts", middleware.Auth(http.HandlerFunc(workspace.Prompts)))
mux.Handle("/api/v1/workspaces/{id}/prompts/{promptId}", middleware.Auth(http.HandlerFunc(workspace.PromptByID)))
```

并在 team routes 区域追加：

```go
mux.Handle("/api/v1/team/prompts/{id}/review", middleware.Auth(http.HandlerFunc(team.ReviewPrompt)))
```

- [ ] **Step 4: Commit**

```bash
git add apps/dh-backend/gateway/server/server.go
git commit -m "server: register workspace prompt routes and inject services"
```

---

## Task 9: 前端类型扩展

**Files:**
- Modify: `apps/dh-frontend/src/types/index.ts`

- [ ] **Step 1: 扩展 Prompt 与新增 WorkspacePrompt**

```ts
export type PromptStatus = 'pending_review' | 'on_shelf' | 'off_shelf' | 'rejected';

export interface Prompt {
  id: string;
  name: string;
  description: string;
  useCase: string;
  usageCount: number;
  addedToSpace?: boolean;
  content?: string;
  status?: PromptStatus;
  createdBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspacePrompt {
  id: string;
  workspaceId: string;
  libraryPromptId?: string;
  name: string;
  description: string;
  content: string;
  useCase: string;
  usageCount: number;
  isCustom: boolean;
  addedToSpace: boolean;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dh-frontend/src/types/index.ts
git commit -m "types: add PromptStatus and WorkspacePrompt types"
```

---

## Task 10: 前端 API 客户端扩展

**Files:**
- Modify: `apps/dh-frontend/src/lib/team-api.ts`
- Modify: `apps/dh-frontend/src/lib/workspace-api.ts`

- [ ] **Step 1: 扩展 teamApi**

```ts
export const teamApi = {
  // ... existing skill methods

  listPrompts: () => api.get<Prompt[]>('/v1/team/prompts'),
  createPrompt: (req: CreatePromptRequest) => api.post<Prompt>('/v1/team/prompts', req),
  updatePrompt: (id: string, req: Partial<CreatePromptRequest>) =>
    api.patch<Prompt>(`/v1/team/prompts/${id}`, req),
  deletePrompt: (id: string) => api.delete<void>(`/v1/team/prompts/${id}`),
  reviewPrompt: (id: string, action: 'approve' | 'reject' | 'unshelf') =>
    api.post<Prompt>(`/v1/team/prompts/${id}/review`, { action }),
};
```

> 旧的 `updatePromptAdded` 方法可以保留但不再使用，或标记为废弃。

- [ ] **Step 2: 扩展 workspaceApi**

```ts
export const workspaceApi = {
  // ... existing methods

  listPrompts: (workspaceId: string) => api.get<WorkspacePrompt[]>(`/v1/workspaces/${workspaceId}/prompts`),
  addPrompt: (workspaceId: string, libraryPromptId: string) =>
    api.post<WorkspacePrompt>(`/v1/workspaces/${workspaceId}/prompts`, { libraryPromptId }),
  removePrompt: (workspaceId: string, promptId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/prompts/${promptId}`),
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/dh-frontend/src/lib/team-api.ts apps/dh-frontend/src/lib/workspace-api.ts
git commit -m "api: add review and workspace prompt client methods"
```

---

## Task 11: PromptMarket 页面改造

**Files:**
- Modify: `apps/dh-frontend/src/pages/PromptMarket.tsx`

- [ ] **Step 1: 引入 useAuth 与角色判断**

```ts
import { useAuth } from '@/contexts/AuthContext';
import { PLATFORM_ROLE } from '@/lib/role-constants';
```

- [ ] **Step 2: 添加状态常量与辅助函数**

```ts
const PROMPT_STATUS_LABEL: Record<PromptStatus, string> = {
  pending_review: '审核中',
  on_shelf: '已上架',
  off_shelf: '已下架',
  rejected: '已拒绝',
};

const PROMPT_STATUS_VARIANT: Record<PromptStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  pending_review: 'secondary',
  on_shelf: 'default',
  off_shelf: 'outline',
  rejected: 'destructive',
};
```

- [ ] **Step 3: 组件内获取用户与角色**

```ts
const { user } = useAuth();
const isTenantAdmin = user?.platformRole === PLATFORM_ROLE.TENANT_ADMIN || user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
const isSuperAdmin = user?.platformRole === PLATFORM_ROLE.SUPER_ADMIN;
```

- [ ] **Step 4: 改造 handleAdd 调用 workspaceApi**

需要知道当前工作空间 ID。从 `localStorage` 读取：

```ts
const currentWorkspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';

const handleAddToWorkspace = async (prompt: Prompt) => {
  if (!prompt.id) return;
  try {
    await workspaceApi.addPrompt(currentWorkspaceId, prompt.id);
    setPrompts(prompts.map(p => p.id === prompt.id ? { ...p, addedToSpace: true } : p));
    toast.success('提示词已添加到当前空间');
  } catch {
    toast.error('添加失败');
  }
};
```

- [ ] **Step 5: 卡片展示状态与按钮**

在卡片头部替换 `addedToSpace` 徽标为状态徽标：

```tsx
<Badge variant={PROMPT_STATUS_VARIANT[prompt.status || 'on_shelf']}>
  {PROMPT_STATUS_LABEL[prompt.status || 'on_shelf']}
</Badge>
```

在底部按钮区根据角色渲染：

```tsx
<Button variant="outline" className="flex-1" onClick={() => handleCopy(prompt.content || prompt.description)}>
  <Copy className="mr-2 h-4 w-4" /> 复制
</Button>
{isTenantAdmin && prompt.status === 'on_shelf' && (
  <Button className="flex-1" disabled={prompt.addedToSpace} onClick={() => handleAddToWorkspace(prompt)}>
    {prompt.addedToSpace ? '已添加' : '添加到空间'}
  </Button>
)}
{isSuperAdmin && prompt.status === 'pending_review' && (
  <Button variant="default" size="sm" onClick={() => teamApi.reviewPrompt(prompt.id, 'approve').then(() => { /* refresh */ loadPrompts(); })}>
    通过
  </Button>
)}
{isSuperAdmin && prompt.status === 'pending_review' && (
  <Button variant="destructive" size="sm" onClick={() => teamApi.reviewPrompt(prompt.id, 'reject').then(() => loadPrompts())}>
    拒绝
  </Button>
)}
{isSuperAdmin && prompt.status === 'on_shelf' && (
  <Button variant="outline" size="sm" onClick={() => teamApi.reviewPrompt(prompt.id, 'unshelf').then(() => loadPrompts())}>
    下架
  </Button>
)}
```

- [ ] **Step 6: 创建成功后文案**

```ts
toast.success('自定义提示词已提交审核，仅你和超管可见');
```

- [ ] **Step 7: Commit**

```bash
git add apps/dh-frontend/src/pages/PromptMarket.tsx
git commit -m "frontend(prompt-market): show status, copy vs add by role"
```

---

## Task 12: AdminPage 提示词管理接入真实数据

**Files:**
- Modify: `apps/dh-frontend/src/pages/AdminPage.tsx`

- [ ] **Step 1: 加载提示词列表**

在 AdminPage 中新增状态：

```ts
const [prompts, setPrompts] = useState<Prompt[]>([]);
const [promptStatusFilter, setPromptStatusFilter] = useState<PromptStatus | 'all'>('all');
```

在 useEffect 或 tab 切换时加载：

```ts
const loadPrompts = async () => {
  try {
    const list = await teamApi.listPrompts();
    setPrompts(list);
  } catch {
    toast.error('加载提示词失败');
  }
};

useEffect(() => {
  if (location.pathname === '/admin/prompts') loadPrompts();
}, [location.pathname]);
```

- [ ] **Step 2: 状态筛选器**

将状态 Select 的 `onValueChange` 绑定到 `setPromptStatusFilter`：

```tsx
<Select value={promptStatusFilter} onValueChange={(v) => setPromptStatusFilter(v as PromptStatus | 'all')}>
  <SelectItem value="all">所有状态</SelectItem>
  <SelectItem value="on_shelf">已上架</SelectItem>
  <SelectItem value="pending_review">审核中</SelectItem>
  <SelectItem value="off_shelf">已下架</SelectItem>
  <SelectItem value="rejected">已拒绝</SelectItem>
</Select>
```

- [ ] **Step 3: 表格渲染**

用 `prompts.filter(...)` 替换 `skills.map(...)`：

```tsx
{prompts
  .filter(p => promptStatusFilter === 'all' || p.status === promptStatusFilter)
  .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
  .map(p => (
    <TableRow key={p.id}>
      <TableCell className="font-medium">{p.name}</TableCell>
      <TableCell>{p.useCase}</TableCell>
      <TableCell>
        <Badge variant={PROMPT_STATUS_VARIANT[p.status || 'on_shelf']}>
          {PROMPT_STATUS_LABEL[p.status || 'on_shelf']}
        </Badge>
      </TableCell>
      <TableCell className="text-right space-x-2">
        {p.status === 'pending_review' && (
          <Button variant="outline" size="sm" onClick={() => teamApi.reviewPrompt(p.id, 'approve').then(loadPrompts)}>通过审核</Button>
        )}
        {p.status === 'on_shelf' && (
          <Button variant="outline" size="sm" onClick={() => teamApi.reviewPrompt(p.id, 'unshelf').then(loadPrompts)}>下架</Button>
        )}
        {(p.status === 'off_shelf' || p.status === 'rejected') && (
          <Button variant="outline" size="sm" onClick={() => teamApi.reviewPrompt(p.id, 'approve').then(loadPrompts)}>重新上架</Button>
        )}
      </TableCell>
    </TableRow>
  ))}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dh-frontend/src/pages/AdminPage.tsx
git commit -m "frontend(admin): real prompt data with review actions"
```

---

## Task 13: Settings 提示词配置标签页改造

**Files:**
- Modify: `apps/dh-frontend/src/pages/Settings.tsx`

- [ ] **Step 1: 修改状态类型**

将 `prompts` 状态改为 `WorkspacePrompt[]`，并新增市场弹窗相关状态：

```ts
const [prompts, setPrompts] = useState<WorkspacePrompt[]>([]);
const [marketPrompts, setMarketPrompts] = useState<Prompt[]>([]);
const [promptMarketOpen, setPromptMarketOpen] = useState(false);
```

- [ ] **Step 2: 加载空间提示词**

替换现有的 `teamApi.listPrompts()` 加载：

```ts
useEffect(() => {
  let cancelled = false;
  const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
  Promise.all([
    teamApi.listSkills(),
    workspaceApi.listPrompts(wsId),
  ])
    .then(([loadedSkills, loadedPrompts]) => {
      if (cancelled) return;
      setSkills(loadedSkills);
      setPrompts(loadedPrompts);
    })
    .catch(err => {
      if (cancelled) return;
      console.error('Failed to load workspace prompts:', err);
      toast.error('加载空间提示词失败');
    });
  return () => { cancelled = true };
}, [membership?.workspaceId]);
```

- [ ] **Step 3: 打开市场弹窗时加载已上架提示词**

```ts
const openPromptMarket = async () => {
  setPromptMarketOpen(true);
  try {
    const list = await teamApi.listPrompts();
    const existingIds = new Set(prompts.map(p => p.libraryPromptId).filter(Boolean));
    setMarketPrompts(list.filter(p => p.status === 'on_shelf' && !existingIds.has(p.id)));
  } catch {
    toast.error('加载提示词市场失败');
  }
};
```

- [ ] **Step 4: 添加与移除**

```ts
const handleAddMarketPrompt = async (promptId: string) => {
  const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
  try {
    const added = await workspaceApi.addPrompt(wsId, promptId);
    setPrompts([added, ...prompts]);
    setMarketPrompts(marketPrompts.filter(p => p.id !== promptId));
    toast.success('已添加到空间');
  } catch {
    toast.error('添加失败');
  }
};

const handleRemoveWorkspacePrompt = async (promptId: string) => {
  const wsId = membership?.workspaceId || localStorage.getItem('currentWorkspaceId') || 'ws-default';
  try {
    await workspaceApi.removePrompt(wsId, promptId);
    setPrompts(prompts.filter(p => p.id !== promptId));
    toast.success('已移除');
  } catch {
    toast.error('移除失败');
  }
};
```

- [ ] **Step 5: 市场弹窗 UI**

将现有的 `promptMarketOpen` Dialog（若存在）改为展示 `marketPrompts`，每个条目显示「添加」按钮；非管理员只读。

- [ ] **Step 6: Commit**

```bash
git add apps/dh-frontend/src/pages/Settings.tsx
git commit -m "frontend(settings): workspace prompt management with market add"
```

---

## Task 14: Chat 智能会话加载空间提示词

**Files:**
- Modify: `apps/dh-frontend/src/pages/Chat.tsx`

- [ ] **Step 1: 修改加载逻辑**

将：

```ts
Promise.all([teamApi.listSkills(), teamApi.listPrompts()])
```

改为：

```ts
const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
Promise.all([
  teamApi.listSkills(),
  workspaceApi.listPrompts(workspaceId).catch((): WorkspacePrompt[] => []),
])
  .then(([loadedSkills, loadedPrompts]) => {
    if (cancelled) return;
    setAvailableSkills(loadedSkills);
    setAvailablePrompts(loadedPrompts);
  })
```

- [ ] **Step 2: 确认 insertPrompt 与 Prompt 类型兼容**

`availablePrompts` 当前类型为 `Prompt[]`，可改为 `WorkspacePrompt[]` 或保持 `Prompt[]` 但映射字段。建议在 Chat 组件本地状态改为 `(Prompt | WorkspacePrompt)[]`，插入时使用 `p.content`。

- [ ] **Step 3: Commit**

```bash
git add apps/dh-frontend/src/pages/Chat.tsx
git commit -m "frontend(chat): load workspace prompts instead of global prompts"
```

---

## Task 15: 编译与验证

- [ ] **Step 1: 后端编译**

Run:
```bash
cd apps/dh-backend && go build ./... && go vet ./...
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 2: 前端类型检查**

Run:
```bash
pnpm check-types
```

Expected: `@repo/dh-frontend:check-types` 成功。

- [ ] **Step 3: 前端构建**

Run:
```bash
pnpm build
```

Expected: build successful, no TS errors.

- [ ] **Step 4: 功能验证**

启动 dev 环境：
```bash
pnpm dev
```

执行验证脚本：
```bash
# 1. 普通用户创建提示词后，未审核不可见
TOKEN_U2="u2"
curl -s -X POST -H "Authorization: Bearer $TOKEN_U2" -H "Content-Type: application/json" \
  -d '{"name":"test","description":"d","content":"c","useCase":"研发"}' \
  http://localhost:8080/api/v1/team/prompts

# 2. 普通用户列表中看不到 pending_review（除非是自己的）
curl -s -H "Authorization: Bearer $TOKEN_U2" http://localhost:8080/api/v1/team/prompts | grep -c "pending_review"

# 3. 超管可以看到并审核通过
TOKEN_U1="u1"
curl -s -H "Authorization: Bearer $TOKEN_U1" http://localhost:8080/api/v1/team/prompts | grep "pending_review"
curl -s -X POST -H "Authorization: Bearer $TOKEN_U1" -H "Content-Type: application/json" \
  -d '{"action":"approve"}' http://localhost:8080/api/v1/team/prompts/{id}/review

# 4. 租户管理员添加到空间
curl -s -X POST -H "Authorization: Bearer $TOKEN_TENANT_ADMIN" -H "Content-Type: application/json" \
  -d '{"libraryPromptId":"{id}"}' http://localhost:8080/api/v1/workspaces/ws-default/prompts

# 5. 空间成员列表可见
curl -s -H "Authorization: Bearer $TOKEN_U2" http://localhost:8080/api/v1/workspaces/ws-default/prompts
```

- [ ] **Step 5: Commit 验证脚本（可选）**

将验证命令写入 `scripts/verify-prompt-market.sh` 并提交。

- [ ] **Step 6: 最终 Commit**

```bash
git commit -m "feat: prompt market status review and workspace prompt management"
```

---

## 自检清单

- [x] 数据库变更覆盖 status / created_by / reviewed_by / reviewed_at。
- [x] 后端列表过滤实现「审核中仅创建人和超管可见」。
- [x] 后端审核接口支持 approve / reject / unshelf。
- [x] 后端 workspace prompts 接口有租户管理员权限校验。
- [x] 前端 PromptMarket 根据角色展示「复制」或「添加到空间」。
- [x] 前端 AdminPage 提示词管理接入真实数据与审核操作。
- [x] 前端 Settings 提示词配置加载 workspace_prompts。
- [x] 前端 Chat 加载当前工作空间提示词。
- [x] 每一步都包含具体文件路径、代码与验证命令。
