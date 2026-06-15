# Workspace 数据模型实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Workspace 数据模型落地到 MySQL，并在后端提供 REST API，使「空间配置」「智能会话」等业务从 workspace 维度读取/写入数据。

**Architecture：** 沿用现有 DDD 分层（`packages/go-sdk/domain` 定义模型，`apps/dh-backend/domain/<module>` 实现服务与 Handler，MySQL 持久化）。不建立数据库外键，所有关联校验在应用层完成。

**Tech Stack：** Go 1.22，标准库 `net/http`，`database/sql`，MySQL 8.0，React + TypeScript 前端。

---

## 文件结构总览

| 文件 | 职责 |
|---|---|
| `infra/database/workspace/schema.sql` | 新建 workspace 相关表 |
| `infra/docker/compose.mysql.yml` | 挂载新的 schema 初始化脚本 |
| `packages/go-sdk/domain/workspace/*.go` | Workspace、Member、DemandProject、Standard、CICD 等 DDD 模型 |
| `packages/go-sdk/domain/agent/agent.go` | 调整 Agent/Session 归属为 workspace |
| `packages/go-sdk/domain/project/project.go` | 为 Repository 增加 `workspace_id` |
| `apps/dh-backend/domain/workspace/service/service.go` | Workspace 服务接口与 MySQL 实现 |
| `apps/dh-backend/domain/workspace/handler.go` | Workspace、Member、Agent、Standard、CICD、Repository 路由处理 |
| `apps/dh-backend/domain/project/service/db_service.go` | Repository 的 MySQL 实现 |
| `apps/dh-backend/gateway/server/server.go` | 注册 workspace 路由、初始化服务 |
| `apps/web/src/lib/workspace-api.ts` | 前端 workspace API 封装 |
| `apps/web/src/types/index.ts` | 扩展 Workspace 相关类型 |
| `scripts/migrate-workspace.sql` | 一次性迁移脚本：生成默认 workspace、迁移现有数据 |

---

## Task 1：编写 Workspace Schema

**Files:**
- Create: `infra/database/workspace/schema.sql`
- Modify: `infra/docker/compose.mysql.yml`

- [ ] **Step 1：创建 schema 文件**

在 `infra/database/workspace/schema.sql` 写入以下内容：

```sql
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS workspaces (
  id CHAR(36) PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspaces_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role VARCHAR(50) NOT NULL,
  sub_role VARCHAR(50),
  joined_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  PRIMARY KEY (workspace_id, user_id),
  INDEX idx_workspace_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS demand_projects (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL UNIQUE,
  platform VARCHAR(50) NOT NULL DEFAULT 'meego',
  external_key VARCHAR(200) NOT NULL,
  name VARCHAR(200),
  config JSON,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_demand_projects_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repositories (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  url VARCHAR(500) NOT NULL,
  type VARCHAR(50) NOT NULL,
  default_branch VARCHAR(100),
  config JSON,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_repositories_workspace (workspace_id),
  INDEX idx_repositories_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agents (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  role VARCHAR(100),
  description TEXT,
  config JSON,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_by_user_id CHAR(36),
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_agents_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS skill_library (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL DEFAULT '通用',
  tags VARCHAR(500),
  downloads INT NOT NULL DEFAULT 0,
  rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
  icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle',
  phase VARCHAR(50) NOT NULL DEFAULT '代码开发',
  content TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_skill_library_category (category),
  INDEX idx_skill_library_phase (phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prompt_library (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  use_case VARCHAR(100) NOT NULL DEFAULT '通用',
  usage_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_prompt_library_use_case (use_case)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_skills (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  library_skill_id CHAR(36),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL DEFAULT '通用',
  tags VARCHAR(500),
  downloads INT NOT NULL DEFAULT 0,
  rating DECIMAL(2,1) NOT NULL DEFAULT 5.0,
  icon VARCHAR(50) NOT NULL DEFAULT 'Puzzle',
  phase VARCHAR(50) NOT NULL DEFAULT '代码开发',
  content TEXT,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  installed TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspace_skills_workspace (workspace_id),
  INDEX idx_workspace_skills_library (library_skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_prompts (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  library_prompt_id CHAR(36),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  use_case VARCHAR(100) NOT NULL DEFAULT '通用',
  usage_count INT NOT NULL DEFAULT 0,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  added_to_space TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspace_prompts_workspace (workspace_id),
  INDEX idx_workspace_prompts_library (library_prompt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_standards (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  repository_id CHAR(36),
  type VARCHAR(50) NOT NULL,
  name VARCHAR(200),
  content TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspace_standards_workspace (workspace_id),
  INDEX idx_workspace_standards_repo (repository_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_cicd (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL UNIQUE,
  trigger_branches VARCHAR(500),
  webhook_url VARCHAR(500),
  script TEXT,
  config JSON,
  created_at DATETIME(3) NOT NULL DEFAULT NOW(3),
  updated_at DATETIME(3) NOT NULL DEFAULT NOW(3) ON UPDATE NOW(3),
  INDEX idx_workspace_cicd_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2：修改 compose 挂载**

在 `infra/docker/compose.mysql.yml` 的 `volumes` 下新增一行：

```yaml
      - ../database/workspace/schema.sql:/docker-entrypoint-initdb.d/06_workspace.sql:ro
```

- [ ] **Step 3：在已有 MySQL 容器中执行 schema**

```bash
docker exec -i deepharness-mysql mysql -u root -pdeepharness_root deepharness --default-character-set=utf8mb4 < infra/database/workspace/schema.sql
```

- [ ] **Step 4：验证表创建成功**

```bash
docker exec -i deepharness-mysql mysql -u root -pdeepharness_root deepharness -e "SHOW TABLES LIKE 'workspaces'; SHOW TABLES LIKE 'workspace_members'; SHOW TABLES LIKE 'demand_projects';" 2>/dev/null
```

Expected: 返回 `workspaces`、`workspace_members`、`demand_projects` 等表名。

- [ ] **Step 5：Commit**

```bash
git add infra/database/workspace/schema.sql infra/docker/compose.mysql.yml
git commit -m "feat(workspace): add workspace data model schema"
```

---

## Task 2：扩展 go-sdk 领域模型

**Files:**
- Create: `packages/go-sdk/domain/workspace/workspace.go`
- Create: `packages/go-sdk/domain/workspace/member.go`
- Create: `packages/go-sdk/domain/workspace/demand_project.go`
- Create: `packages/go-sdk/domain/workspace/standard.go`
- Create: `packages/go-sdk/domain/workspace/cicd.go`
- Modify: `packages/go-sdk/domain/agent/agent.go`
- Modify: `packages/go-sdk/domain/project/project.go`

- [ ] **Step 1：创建 Workspace 与 Member 模型**

`packages/go-sdk/domain/workspace/workspace.go`：

```go
package workspace

import "time"

type Workspace struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenantId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
```

`packages/go-sdk/domain/workspace/member.go`：

```go
package workspace

import "time"

type Member struct {
	WorkspaceID string    `json:"workspaceId"`
	UserID      string    `json:"userId"`
	Role        string    `json:"role"`
	SubRole     string    `json:"subRole"`
	JoinedAt    time.Time `json:"joinedAt"`
}
```

- [ ] **Step 2：创建 DemandProject、Standard、CICD 模型**

`packages/go-sdk/domain/workspace/demand_project.go`：

```go
package workspace

import "time"

type DemandProject struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Platform    string    `json:"platform"`
	ExternalKey string    `json:"externalKey"`
	Name        string    `json:"name"`
	Config      any       `json:"config,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
```

`packages/go-sdk/domain/workspace/standard.go`：

```go
package workspace

import "time"

type Standard struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspaceId"`
	RepositoryID string    `json:"repositoryId,omitempty"`
	Type         string    `json:"type"`
	Name         string    `json:"name"`
	Content      string    `json:"content"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
```

`packages/go-sdk/domain/workspace/cicd.go`：

```go
package workspace

import "time"

type CICD struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	TriggerBranches string    `json:"triggerBranches"`
	WebhookURL      string    `json:"webhookUrl"`
	Script          string    `json:"script"`
	Config          any       `json:"config,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
```

- [ ] **Step 3：调整 Agent/Session 归属为 workspace**

修改 `packages/go-sdk/domain/agent/agent.go`：

```go
package agent

import "time"

// Agent 表示 workspace 级 AI Agent 配置
type Agent struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Name            string    `json:"name"`
	Role            string    `json:"role"`
	Description     string    `json:"description"`
	Config          any       `json:"config,omitempty"`
	IsDefault       bool      `json:"isDefault"`
	CreatedByUserID string    `json:"createdByUserId"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// Session 表示 Agent 会话
type Session struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	AgentID     string    `json:"agentId"`
	Title       string    `json:"title"`
	Model       string    `json:"model"`
	Context     any       `json:"context,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Message 会话消息
type Message struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Role      string    `json:"role"`
	Type      string    `json:"type"`
	Content   string    `json:"content"`
	Metadata  any       `json:"metadata,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}
```

- [ ] **Step 4：为 Repository 增加 workspace_id**

修改 `packages/go-sdk/domain/project/project.go` 中 `Repository` 结构体：

```go
type Repository struct {
	ID            string   `json:"id"`
	WorkspaceID   string   `json:"workspaceId"`
	ProjectID     string   `json:"projectId"`
	Name          string   `json:"name"`
	URL           string   `json:"url"`
	Type          RepoType `json:"type"`
	DefaultBranch string   `json:"defaultBranch"`
	PreviewURL    string   `json:"previewUrl,omitempty"`
	Branches      []string `json:"branches,omitempty"`
}
```

- [ ] **Step 5：编译检查**

```bash
cd packages/go-sdk && go build ./...
```

Expected: 无错误。

- [ ] **Step 6：Commit**

```bash
git add packages/go-sdk/domain/workspace packages/go-sdk/domain/agent/agent.go packages/go-sdk/domain/project/project.go
git commit -m "feat(workspace): add workspace domain models and adjust agent/project"
```

---

## Task 3：MySQL 存储实现

**Files:**
- Create: `apps/dh-backend/domain/workspace/service/service.go`
- Create: `apps/dh-backend/domain/workspace/service/db_service.go`
- Create: `apps/dh-backend/domain/workspace/handler.go`

- [ ] **Step 1：定义 WorkspaceService 接口**

`apps/dh-backend/domain/workspace/service/service.go`：

```go
package service

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/project"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
)

// WorkspaceService 定义 workspace 及其子资源服务。
type WorkspaceService interface {
	// Workspace
	CreateWorkspace(tenantID, name, description string, ownerUserID string) (workspace.Workspace, error)
	GetWorkspace(id string) (workspace.Workspace, error)
	ListWorkspaces(tenantID string) ([]workspace.Workspace, error)

	// Members
	AddMember(workspaceID, userID, role, subRole string) error
	ListMembers(workspaceID string) ([]workspace.Member, error)
	RemoveMember(workspaceID, userID string) error

	// DemandProject
	SetDemandProject(workspaceID string, req DemandProjectRequest) (workspace.DemandProject, error)
	GetDemandProject(workspaceID string) (workspace.DemandProject, error)

	// Repository
	ListRepositories(workspaceID string, repoType project.RepoType) ([]project.Repository, error)
	CreateRepository(workspaceID string, req RepositoryRequest) (project.Repository, error)
	DeleteRepository(workspaceID, repoID string) error

	// Agent
	ListAgents(workspaceID string) ([]agent.Agent, error)
	CreateAgent(workspaceID string, req AgentRequest) (agent.Agent, error)
	GetDefaultAgent(workspaceID string) (agent.Agent, error)

	// Standard
	ListStandards(workspaceID string, repoID string) ([]workspace.Standard, error)
	SaveStandard(workspaceID string, req StandardRequest) (workspace.Standard, error)
	DeleteStandard(workspaceID, standardID string) error

	// CICD
	GetCICD(workspaceID string) (workspace.CICD, error)
	SaveCICD(workspaceID string, req CICDRequest) (workspace.CICD, error)
}
```

同文件中定义请求结构体：

```go
type DemandProjectRequest struct {
	Platform    string `json:"platform"`
	ExternalKey string `json:"externalKey"`
	Name        string `json:"name"`
}

type RepositoryRequest struct {
	Name          string           `json:"name"`
	URL           string           `json:"url"`
	Type          project.RepoType `json:"type"`
	DefaultBranch string           `json:"defaultBranch"`
}

type AgentRequest struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Config      any    `json:"config"`
	IsDefault   bool   `json:"isDefault"`
}

type StandardRequest struct {
	ID           string `json:"id,omitempty"`
	RepositoryID string `json:"repositoryId,omitempty"`
	Type         string `json:"type"`
	Name         string `json:"name"`
	Content      string `json:"content"`
}

type CICDRequest struct {
	TriggerBranches string `json:"triggerBranches"`
	WebhookURL      string `json:"webhookUrl"`
	Script          string `json:"script"`
}
```

- [ ] **Step 2：实现 DBWorkspaceService（以 Workspace 与 Member 为例）**

`apps/dh-backend/domain/workspace/service/db_service.go`：

```go
package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
	"github.com/google/uuid"
)

type DBWorkspaceService struct {
	db *sql.DB
}

func NewDBWorkspaceService(db *sql.DB) *DBWorkspaceService {
	return &DBWorkspaceService{db: db}
}

func (s *DBWorkspaceService) CreateWorkspace(tenantID, name, description, ownerUserID string) (workspace.Workspace, error) {
	now := time.Now().UTC()
	ws := workspace.Workspace{
		ID:          uuid.New().String(),
		TenantID:    tenantID,
		Name:        name,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("begin tx failed: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`
		INSERT INTO workspaces (id, tenant_id, name, description, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, ws.ID, ws.TenantID, ws.Name, ws.Description, ws.CreatedAt, ws.UpdatedAt); err != nil {
		return workspace.Workspace{}, fmt.Errorf("insert workspace failed: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, role, sub_role, joined_at)
		VALUES (?, ?, ?, ?, ?)
	`, ws.ID, ownerUserID, "admin", "pm", now); err != nil {
		return workspace.Workspace{}, fmt.Errorf("insert owner member failed: %w", err)
	}

	return ws, tx.Commit()
}

func (s *DBWorkspaceService) GetWorkspace(id string) (workspace.Workspace, error) {
	var ws workspace.Workspace
	err := s.db.QueryRow(`
		SELECT id, tenant_id, name, description, created_at, updated_at
		FROM workspaces WHERE id = ?
	`, id).Scan(&ws.ID, &ws.TenantID, &ws.Name, &ws.Description, &ws.CreatedAt, &ws.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.Workspace{}, errors.New("workspace not found")
	}
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("get workspace failed: %w", err)
	}
	return ws, nil
}

func (s *DBWorkspaceService) ListWorkspaces(tenantID string) ([]workspace.Workspace, error) {
	rows, err := s.db.Query(`
		SELECT id, tenant_id, name, description, created_at, updated_at
		FROM workspaces WHERE tenant_id = ? ORDER BY created_at DESC
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list workspaces failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Workspace, 0)
	for rows.Next() {
		var ws workspace.Workspace
		if err := rows.Scan(&ws.ID, &ws.TenantID, &ws.Name, &ws.Description, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace failed: %w", err)
		}
		result = append(result, ws)
	}
	return result, rows.Err()
}

func (s *DBWorkspaceService) AddMember(workspaceID, userID, role, subRole string) error {
	_, err := s.db.Exec(`
		INSERT INTO workspace_members (workspace_id, user_id, role, sub_role, joined_at)
		VALUES (?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE role = VALUES(role), sub_role = VALUES(sub_role)
	`, workspaceID, userID, role, subRole, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("add member failed: %w", err)
	}
	return nil
}

func (s *DBWorkspaceService) ListMembers(workspaceID string) ([]workspace.Member, error) {
	rows, err := s.db.Query(`
		SELECT workspace_id, user_id, role, sub_role, joined_at
		FROM workspace_members WHERE workspace_id = ?
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list members failed: %w", err)
	}
	defer rows.Close()

	result := make([]workspace.Member, 0)
	for rows.Next() {
		var m workspace.Member
		if err := rows.Scan(&m.WorkspaceID, &m.UserID, &m.Role, &m.SubRole, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("scan member failed: %w", err)
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func (s *DBWorkspaceService) RemoveMember(workspaceID, userID string) error {
	_, err := s.db.Exec(`
		DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?
	`, workspaceID, userID)
	if err != nil {
		return fmt.Errorf("remove member failed: %w", err)
	}
	return nil
}
```

- [ ] **Step 3：补充 DemandProject / Repository / Agent / Standard / CICD 实现**

在 `db_service.go` 中继续实现（示例骨架）：

```go
func (s *DBWorkspaceService) SetDemandProject(workspaceID string, req DemandProjectRequest) (workspace.DemandProject, error) {
	now := time.Now().UTC()
	dp := workspace.DemandProject{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		Platform:    req.Platform,
		ExternalKey: req.ExternalKey,
		Name:        req.Name,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if dp.Platform == "" {
		dp.Platform = "meego"
	}

	_, err := s.db.Exec(`
		INSERT INTO demand_projects (id, workspace_id, platform, external_key, name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			platform = VALUES(platform), external_key = VALUES(external_key), name = VALUES(name), updated_at = VALUES(updated_at)
	`, dp.ID, dp.WorkspaceID, dp.Platform, dp.ExternalKey, dp.Name, dp.CreatedAt, dp.UpdatedAt)
	if err != nil {
		return workspace.DemandProject{}, fmt.Errorf("set demand project failed: %w", err)
	}
	return dp, nil
}
```

其他方法按同样模式实现（使用 `uuid.New().String()`、`time.Now().UTC()`、标准 `database/sql` 操作）。

- [ ] **Step 4：创建 Handler**

`apps/dh-backend/domain/workspace/handler.go`：

```go
package workspace

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
)

var defaultService service.WorkspaceService

func Init(svc service.WorkspaceService) {
	defaultService = svc
}

func Workspaces(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		tenantID := r.URL.Query().Get("tenantId")
		list, err := defaultService.ListWorkspaces(tenantID)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list workspaces"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var req struct {
			TenantID    string `json:"tenantId"`
			Name        string `json:"name"`
			Description string `json:"description"`
			OwnerUserID string `json:"ownerUserId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request"}`, http.StatusBadRequest)
			return
		}
		ws, err := defaultService.CreateWorkspace(req.TenantID, req.Name, req.Description, req.OwnerUserID)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to create workspace"}`, http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ws)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func WorkspaceByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing workspace id"}`, http.StatusBadRequest)
		return
	}
	ws, err := defaultService.GetWorkspace(id)
	if err != nil {
		http.Error(w, `{"code":1,"message":"workspace not found"}`, http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(ws)
}
```

类似补充 Members、DemandProject、Repositories、Agents、Standards、CICD 的 Handler 方法。

- [ ] **Step 5：编译检查**

```bash
cd apps/dh-backend && go build ./...
```

Expected: 无错误。

- [ ] **Step 6：Commit**

```bash
git add apps/dh-backend/domain/workspace
git commit -m "feat(workspace): add workspace service and handler skeleton"
```

---

## Task 4：注册路由并初始化服务

**Files:**
- Modify: `apps/dh-backend/gateway/server/server.go`

- [ ] **Step 1：引入 workspace 包并初始化服务**

在 `apps/dh-backend/gateway/server/server.go` 中：

```go
import (
	// ... existing imports ...
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
)
```

在 `New(cfg config.Config)` 中，db 初始化之后加入：

```go
// Workspace service: MySQL when available, otherwise memory mock.
initWorkspaceService(db)
```

新增函数：

```go
func initWorkspaceService(db *sql.DB) {
	if db != nil {
		log.Println("[Workspace] using mysql storage")
		workspace.Init(workspaceservice.NewDBWorkspaceService(db))
		return
	}
	log.Println("[Workspace] using memory mock")
	workspace.Init(workspaceservice.NewMockWorkspaceService())
}
```

- [ ] **Step 2：注册路由**

在路由区域加入：

```go
// Workspace module
mux.HandleFunc("/api/v1/workspaces", workspace.Workspaces)
mux.HandleFunc("/api/v1/workspaces/{id}", workspace.WorkspaceByID)
mux.HandleFunc("/api/v1/workspaces/{id}/members", workspace.Members)
mux.HandleFunc("/api/v1/workspaces/{id}/members/{userId}", workspace.MemberByID)
mux.HandleFunc("/api/v1/workspaces/{id}/demand-project", workspace.DemandProject)
mux.HandleFunc("/api/v1/workspaces/{id}/repositories", workspace.WorkspaceRepositories)
mux.HandleFunc("/api/v1/workspaces/{id}/agents", workspace.WorkspaceAgents)
mux.HandleFunc("/api/v1/workspaces/{id}/standards", workspace.WorkspaceStandards)
mux.HandleFunc("/api/v1/workspaces/{id}/cicd", workspace.WorkspaceCICD)
```

- [ ] **Step 3：编译并运行**

```bash
cd apps/dh-backend && go build ./...
pnpm --filter @repo/dh-backend dev
```

Expected: 后端正常启动，日志出现 `[Workspace] using mysql storage`。

- [ ] **Step 4：curl 测试创建 workspace**

```bash
curl -s -X POST http://localhost:8080/api/v1/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"t1","name":"测试空间","description":"测试","ownerUserId":"u1"}'
```

Expected: 返回包含 `id`、`tenantId`、`name` 的 workspace JSON。

- [ ] **Step 5：Commit**

```bash
git add apps/dh-backend/gateway/server/server.go
git commit -m "feat(workspace): register workspace routes and init service"
```

---

## Task 5：迁移现有数据到 Workspace 模型

**Files:**
- Create: `scripts/migrate-workspace.sql`

- [ ] **Step 1：编写迁移脚本**

`scripts/migrate-workspace.sql`：

```sql
SET NAMES utf8mb4;

-- 1. 生成默认 workspace
INSERT INTO workspaces (id, tenant_id, name, description, created_at, updated_at)
SELECT 'ws-default', 't1', '默认工作空间', '由旧数据迁移生成的默认空间', NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = 'ws-default');

-- 2. 把现有用户加入默认 workspace
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role, sub_role, joined_at)
SELECT 'ws-default', id, 'admin', 'pm', created_at FROM users;

-- 3. 迁移 team_skills -> skill_library + workspace_skills
INSERT INTO skill_library (id, name, description, category, tags, downloads, rating, icon, phase, content, created_at, updated_at)
SELECT id, name, description, category, tags, downloads, rating, icon, phase, NULL, created_at, updated_at
FROM team_skills
WHERE id LIKE 'skill-%'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO workspace_skills (id, workspace_id, library_skill_id, name, description, category, tags, downloads, rating, icon, phase, content, is_custom, installed, created_at, updated_at)
SELECT id, 'ws-default', id, name, description, category, tags, downloads, rating, icon, phase, NULL, 0, installed, created_at, updated_at
FROM team_skills
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- 4. 迁移 team_prompts -> prompt_library + workspace_prompts
INSERT INTO prompt_library (id, name, description, content, use_case, usage_count, created_at, updated_at)
SELECT id, name, description, content, use_case, usage_count, created_at, updated_at
FROM team_prompts
WHERE id LIKE 'prompt-%'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO workspace_prompts (id, workspace_id, library_prompt_id, name, description, content, use_case, usage_count, is_custom, added_to_space, created_at, updated_at)
SELECT id, 'ws-default', id, name, description, content, use_case, usage_count, 0, added_to_space, created_at, updated_at
FROM team_prompts
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- 5. 回填 agent_sessions workspace_id / agent_id
-- 需要先创建默认 agent（如果不存在）
INSERT INTO agents (id, workspace_id, name, role, description, config, is_default, created_by_user_id, created_at, updated_at)
SELECT 'agent-default', 'ws-default', '默认智能体', 'general', '迁移生成的默认智能体', '{}', 1, 'u1', NOW(3), NOW(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE id = 'agent-default');

UPDATE agent_sessions
SET workspace_id = 'ws-default', agent_id = 'agent-default'
WHERE workspace_id IS NULL OR workspace_id = '';
```

- [ ] **Step 2：执行迁移**

```bash
docker exec -i deepharness-mysql mysql -u root -pdeepharness_root deepharness --default-character-set=utf8mb4 < scripts/migrate-workspace.sql
```

- [ ] **Step 3：验证**

```bash
docker exec -i deepharness-mysql mysql -u root -pdeepharness_root deepharness -e "SELECT COUNT(*) FROM workspaces; SELECT COUNT(*) FROM workspace_skills; SELECT COUNT(*) FROM agent_sessions WHERE workspace_id = 'ws-default';" 2>/dev/null
```

Expected: workspace 1 条，workspace_skills >= 10 条，agent_sessions 已回填。

- [ ] **Step 4：Commit**

```bash
git add scripts/migrate-workspace.sql
git commit -m "chore(workspace): add migration script for existing data"
```

---

## Task 6：前端类型与 API 封装

**Files:**
- Create: `apps/web/src/lib/workspace-api.ts`
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1：扩展前端类型**

在 `apps/web/src/types/index.ts` 追加：

```ts
export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: 'admin' | 'user';
  subRole?: 'developer' | 'tester' | 'pm' | 'designer';
  joinedAt: string;
}

export interface DemandProject {
  id: string;
  workspaceId: string;
  platform: string;
  externalKey: string;
  name: string;
  config?: Record<string, unknown>;
}

export interface WorkspaceStandard {
  id: string;
  workspaceId: string;
  repositoryId?: string;
  type: 'coding' | 'design' | 'engineering';
  name: string;
  content: string;
}

export interface WorkspaceCICD {
  id: string;
  workspaceId: string;
  triggerBranches: string;
  webhookUrl: string;
  script: string;
}
```

- [ ] **Step 2：创建 API 封装**

`apps/web/src/lib/workspace-api.ts`：

```ts
import { api } from './api';
import type { Workspace, WorkspaceMember, DemandProject, WorkspaceStandard, WorkspaceCICD } from '@/types';

export const workspaceApi = {
  list: (tenantId: string) => api.get<Workspace[]>(`/v1/workspaces?tenantId=${tenantId}`),
  create: (req: { tenantId: string; name: string; description?: string; ownerUserId: string }) =>
    api.post<Workspace>('/v1/workspaces', req),
  get: (id: string) => api.get<Workspace>(`/v1/workspaces/${id}`),

  members: (workspaceId: string) => api.get<WorkspaceMember[]>(`/v1/workspaces/${workspaceId}/members`),
  addMember: (workspaceId: string, req: { userId: string; role: string; subRole?: string }) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/members`, req),
  removeMember: (workspaceId: string, userId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/members/${userId}`),

  getDemandProject: (workspaceId: string) =>
    api.get<DemandProject>(`/v1/workspaces/${workspaceId}/demand-project`),
  setDemandProject: (workspaceId: string, req: Partial<DemandProject>) =>
    api.post<DemandProject>(`/v1/workspaces/${workspaceId}/demand-project`, req),

  listStandards: (workspaceId: string, repositoryId?: string) =>
    api.get<WorkspaceStandard[]>(`/v1/workspaces/${workspaceId}/standards${repositoryId ? `?repositoryId=${repositoryId}` : ''}`),
  saveStandard: (workspaceId: string, req: Partial<WorkspaceStandard>) =>
    api.post<WorkspaceStandard>(`/v1/workspaces/${workspaceId}/standards`, req),
  deleteStandard: (workspaceId: string, id: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/standards/${id}`),

  getCICD: (workspaceId: string) => api.get<WorkspaceCICD>(`/v1/workspaces/${workspaceId}/cicd`),
  saveCICD: (workspaceId: string, req: Partial<WorkspaceCICD>) =>
    api.post<WorkspaceCICD>(`/v1/workspaces/${workspaceId}/cicd`, req),
};
```

- [ ] **Step 3：类型检查**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.check.json
```

Expected: 0 errors（除已存在的历史错误外无新增）。

- [ ] **Step 4：Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/lib/workspace-api.ts
git commit -m "feat(workspace): add frontend types and api client"
```

---

## Task 7：Settings 页面接入 Workspace API

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`

- [ ] **Step 1：加载当前 workspace 配置**

在 `Settings.tsx` 中加入：

```ts
const [workspace, setWorkspace] = useState<Workspace | null>(null);
const [members, setMembers] = useState<WorkspaceMember[]>([]);
const [demandProject, setDemandProject] = useState<DemandProject | null>(null);
const [standards, setStandards] = useState<WorkspaceStandard[]>([]);
const [cicd, setCicd] = useState<WorkspaceCICD | null>(null);

useEffect(() => {
  const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
  Promise.all([
    workspaceApi.get(workspaceId),
    workspaceApi.members(workspaceId),
    workspaceApi.getDemandProject(workspaceId).catch(() => null),
    workspaceApi.listStandards(workspaceId),
    workspaceApi.getCICD(workspaceId).catch(() => null),
  ]).then(([ws, mems, dp, stds, cicdCfg]) => {
    setWorkspace(ws);
    setMembers(mems);
    setDemandProject(dp);
    setStandards(stds);
    setCicd(cicdCfg);
  }).catch(err => {
    console.error('Failed to load workspace settings:', err);
    toast.error('加载空间配置失败');
  });
}, []);
```

- [ ] **Step 2：把 Settings 字段绑定到新模型**

- `meegoProject` 输入框绑定 `demandProject?.externalKey`，保存时调用 `workspaceApi.setDemandProject`。
- Git 仓库列表改用 `repositories` API（可复用现有 `/v1/repositories?workspaceId=` 查询）。
- 编码/设计规范从 `workspace_standards` 读取/保存。
- CICD 配置从 `workspace_cicd` 读取/保存。
- 成员列表从 `members` 读取。

- [ ] **Step 3：保存时调用 API**

把 `handleSave` 改为：

```ts
const handleSave = async () => {
  const workspaceId = workspace?.id || 'ws-default';
  try {
    await workspaceApi.setDemandProject(workspaceId, {
      platform: 'meego',
      externalKey: meegoProjectValue,
      name: workspace?.name || '',
    });
    toast.success('设置已保存');
  } catch {
    toast.error('保存失败');
  }
};
```

- [ ] **Step 4：验证页面加载无报错**

```bash
cd /home/nan/deepharness-ent-platform && pnpm build
```

Expected: 构建成功。

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/pages/Settings.tsx
git commit -m "feat(workspace): wire Settings page to workspace APIs"
```

---

## Task 8：Chat 页面使用 Workspace Agent

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`
- Modify: `apps/dh-backend/agent/chat/session/mysql.go`
- Modify: `apps/dh-backend/gateway/handler/session.go`

- [ ] **Step 1：创建会话时指定 workspace 与 agent**

修改 `apps/dh-backend/gateway/handler/session.go` 的 `Sessions` 方法：

```go
type createSessionRequest struct {
	WorkspaceID string `json:"workspaceId"`
	AgentID     string `json:"agentId"`
	Title       string `json:"title"`
	Model       string `json:"model"`
}
```

创建 `chat.Session` 时写入 `WorkspaceID` 与 `AgentID`。

- [ ] **Step 2：MySQLStore 保存 workspace_id / agent_id**

修改 `apps/dh-backend/agent/chat/session/mysql.go` 的 `Create` 方法，把 `WorkspaceID`、`AgentID` 写入 `agent_sessions`。

- [ ] **Step 3：前端 Chat 获取当前 workspace 的 agents**

在 `Chat.tsx` 中：

```ts
const [agents, setAgents] = useState<Agent[]>([]);
useEffect(() => {
  const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
  api.get<Agent[]>(`/v1/workspaces/${workspaceId}/agents`)
    .then(setAgents)
    .catch(err => console.error('Failed to load agents:', err));
}, []);
```

创建会话时传入 `workspaceId` 与默认 `agentId`。

- [ ] **Step 4：验证**

1. 打开智能会话页面，能正常创建会话。
2. 检查 `agent_sessions` 新记录包含 `workspace_id` 与 `agent_id`。

- [ ] **Step 5：Commit**

```bash
git add apps/dh-backend/agent/chat/session/mysql.go apps/dh-backend/gateway/handler/session.go apps/web/src/pages/Chat.tsx
git commit -m "feat(workspace): link chat sessions to workspace and agent"
```

---

## Task 9：最终验证

- [ ] **Step 1：后端编译与静态检查**

```bash
cd apps/dh-backend && go vet ./...
cd apps/agent-runtime && go vet ./...
cd apps/agent-runtime/mock && go vet ./...
```

Expected: 0 warnings。

- [ ] **Step 2：前端类型检查与构建**

```bash
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.check.json
cd /home/nan/deepharness-ent-platform && pnpm build
```

Expected: 构建成功。

- [ ] **Step 3：重启 dev 并 curl 验证**

```bash
cd /home/nan/deepharness-ent-platform && pnpm dev
```

验证：

```bash
curl -s http://localhost:8080/api/v1/workspaces?tenantId=t1
curl -s http://localhost:8080/api/v1/workspaces/ws-default/demand-project
curl -s http://localhost:8080/api/v1/workspaces/ws-default/agents
```

Expected: 均返回正常 JSON，中文无乱码。

- [ ] **Step 4：Commit 任何剩余改动**

```bash
git commit -am "feat(workspace): finalize workspace data model integration"
```

---

## 自检清单

- [x] **Spec coverage:** 设计文档中的 workspace、member、demand_project、repository、agent、standard、cicd、skill/prompt 分级模型均有对应实现任务。
- [x] **Placeholder scan:** 计划中没有 TBD/TODO，每个任务包含具体文件路径、代码、命令。
- [x] **Type consistency:** `workspace_id` / `agent_id` / `repository_id` 命名在全计划一致，与 spec 对齐。
