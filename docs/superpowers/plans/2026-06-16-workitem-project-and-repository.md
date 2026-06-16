# Workitem Project 与 Repository 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `demand_project` 改名为 `workitem_project`，把 Git 仓库提升为独立 `domain/repository` 领域，实现创建/更新时自动 SSH clone/pull，并下线旧 `domain/project` 及旧 `/api/v1/projects`、`/api/v1/repositories` 接口。

**Architecture:** 在 `packages/go-sdk` 中新建 `domain/repository` 与 `infrastructure/repository/git`；在 `apps/dh-backend` 新建 `domain/repository`（service + handler）并删除 `domain/project`；`workspace` 服务只保留工作空间与 `workitem_project` 职责；前端同步改名类型/API，Settings 与 Chat 改调新接口。

**Tech Stack:** Go 1.22、PostgreSQL 15 (pgx)、go-git v5、React + TypeScript + Vite。

---

## 文件结构（最终状态）

### 新增
- `packages/go-sdk/common/sqlutil/sqlutil.go`
- `packages/go-sdk/domain/repository/repository.go`
- `packages/go-sdk/infrastructure/repository/git.go`
- `packages/go-sdk/infrastructure/repository/git_test.go`
- `apps/dh-backend/domain/repository/service/service.go`
- `apps/dh-backend/domain/repository/service/db_service.go`
- `apps/dh-backend/domain/repository/service/mock_service.go`
- `apps/dh-backend/domain/repository/handler.go`
- `apps/dh-backend/domain/repository/handler_test.go`
- `apps/web/src/lib/repository-api.ts`
- `infra/database/workspace/migration-20260616.sql`

### 重命名
- `packages/go-sdk/domain/workspace/demand_project.go` → `workitem_project.go`

### 修改
- `packages/go-sdk/go.mod`
- `packages/go-sdk/domain/workspace/workspace.go`（注释）
- `apps/dh-backend/domain/workspace/service/service.go`
- `apps/dh-backend/domain/workspace/service/db_service.go`
- `apps/dh-backend/domain/workspace/service/service_mock.go`
- `apps/dh-backend/domain/workspace/handler.go`
- `apps/dh-backend/gateway/handler/common.go`（新建公共响应 helper）
- `apps/dh-backend/gateway/server/server.go`
- `infra/database/workspace/schema.sql`
- `apps/web/src/types/index.ts`
- `apps/web/src/lib/api-types.ts`
- `apps/web/src/lib/workspace-api.ts`
- `apps/web/src/pages/Settings.tsx`
- `apps/web/src/pages/Chat.tsx`

### 删除
- `apps/dh-backend/domain/project/`（整个目录）
- `packages/go-sdk/domain/project/project.go`

---

## Task 1: 重命名 go-sdk 中的 DemandProject 为 WorkitemProject

**Files:**
- Rename: `packages/go-sdk/domain/workspace/demand_project.go` → `packages/go-sdk/domain/workspace/workitem_project.go`
- Modify: `packages/go-sdk/domain/workspace/workspace.go`

- [ ] **Step 1: 重命名文件并更新结构体**

```bash
cd packages/go-sdk/domain/workspace
mv demand_project.go workitem_project.go
```

将 `workitem_project.go` 内容改为：

```go
package workspace

import "time"

// WorkitemProject 表示工作空间关联的外部工作项项目（Meego/PingCode 等）。
type WorkitemProject struct {
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

- [ ] **Step 2: 修正 workspace.go 注释中的旧术语**

```go
// Workspace 表示一个工作空间，是成员、工作项项目、仓库、标准、CICD 等资源的容器。
```

- [ ] **Step 3: 编译检查**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/packages/go-sdk
go build ./...
```

Expected: 0 errors.

- [ ] **Step 4: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add packages/go-sdk/domain/workspace/
git commit -m "refactor(go-sdk): rename DemandProject to WorkitemProject"
```

---

## Task 1.5: 提取公共 SQL 配置 Helper 到 go-sdk/common/sqlutil

**Files:**
- Create: `packages/go-sdk/common/sqlutil/sqlutil.go`

- [ ] **Step 1: 创建 sqlutil 包**

```go
package sqlutil

import (
	"database/sql"
	"encoding/json"
)

// NullString 将空字符串转换为数据库 NULL。
func NullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// ScanNullString 读取 Nullable 字符串字段。
func ScanNullString(ns sql.NullString) string {
	return ns.String
}

// MarshalConfig 将任意对象序列化为 JSON 字符串，nil 时返回 NULL。
func MarshalConfig(v any) (sql.NullString, error) {
	if v == nil {
		return sql.NullString{}, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: string(b), Valid: true}, nil
}

// UnmarshalConfig 将数据库 JSON 字符串反序列化为任意对象。
func UnmarshalConfig(ns sql.NullString) (any, error) {
	if !ns.Valid || ns.String == "" {
		return nil, nil
	}
	var v any
	if err := json.Unmarshal([]byte(ns.String), &v); err != nil {
		return nil, err
	}
	return v, nil
}
```

- [ ] **Step 2: 编译检查**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/packages/go-sdk
go build ./common/sqlutil
```

Expected: 0 errors.

- [ ] **Step 3: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add packages/go-sdk/common/sqlutil
git commit -m "chore(go-sdk): extract sql config helpers to common/sqlutil"
```

---

## Task 2: Workspace 服务与 Handler 中移除仓库职责并同步改名

**Files:**
- Modify: `apps/dh-backend/domain/workspace/service/service.go`
- Modify: `apps/dh-backend/domain/workspace/service/db_service.go`
- Modify: `apps/dh-backend/domain/workspace/service/service_mock.go`
- Modify: `apps/dh-backend/domain/workspace/handler.go`

- [ ] **Step 1: 修改 WorkspaceService 接口（删除仓库方法，改名 workitem project）**

```go
package service

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
)

// WorkspaceService 定义 workspace 模块的服务接口。
type WorkspaceService interface {
	CreateWorkspace(tenantID, name, description, ownerUserID string) (workspace.Workspace, error)
	GetWorkspace(id string) (workspace.Workspace, error)
	ListWorkspaces(tenantID string) ([]workspace.Workspace, error)

	AddMember(workspaceID, userID, role, subRole string) error
	ListMembers(workspaceID string) ([]workspace.Member, error)
	RemoveMember(workspaceID, userID string) error

	SetWorkitemProject(workspaceID string, req WorkitemProjectRequest) (workspace.WorkitemProject, error)
	GetWorkitemProject(workspaceID string) (workspace.WorkitemProject, error)

	ListAgents(workspaceID string) ([]agent.Agent, error)
	CreateAgent(workspaceID string, req AgentRequest) (agent.Agent, error)
	GetDefaultAgent(workspaceID string) (agent.Agent, error)

	ListStandards(workspaceID string, repoID string) ([]workspace.Standard, error)
	SaveStandard(workspaceID string, req StandardRequest) (workspace.Standard, error)
	DeleteStandard(workspaceID, standardID string) error

	GetCICD(workspaceID string) (workspace.CICD, error)
	SaveCICD(workspaceID string, req CICDRequest) (workspace.CICD, error)
}

// WorkitemProjectRequest 设置工作项项目请求。
type WorkitemProjectRequest struct {
	Platform    string `json:"platform"`
	ExternalKey string `json:"externalKey"`
	Name        string `json:"name"`
}

// AgentRequest 创建 Agent 请求。
type AgentRequest struct {
	Name        string `json:"name"`
	Role        string `json:"role"`
	Description string `json:"description"`
	Config      any    `json:"config"`
	IsDefault   bool   `json:"isDefault"`
}

// StandardRequest 保存规范请求。
type StandardRequest struct {
	ID           string `json:"id,omitempty"`
	RepositoryID string `json:"repositoryId,omitempty"`
	Type         string `json:"type"`
	Name         string `json:"name"`
	Content      string `json:"content"`
}

// CICDRequest 保存 CI/CD 配置请求。
type CICDRequest struct {
	TriggerBranches string `json:"triggerBranches"`
	WebhookURL      string `json:"webhookUrl"`
	Script          string `json:"script"`
}
```

- [ ] **Step 2: 修改 db_service.go 中的方法名、类型和表名**

关键替换（保留其余逻辑不变）：

1. import 中移除 `packages/go-sdk/domain/project`，新增 `"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"`。
2. `SetDemandProject` → `SetWorkitemProject`，返回类型 `workspace.WorkitemProject`，表名 `demand_projects` → `workitem_projects`。
3. `GetDemandProject` → `GetWorkitemProject`，返回类型 `workspace.WorkitemProject`。
4. 删除 `ListRepositories`、`CreateRepository`、`DeleteRepository` 三个方法。
5. `getDemandProjectTx` → `getWorkitemProjectTx`，表名同步修改。
6. 所有 `nullString(...)` 调用改为 `sqlutil.NullString(...)`。
7. 所有 `scanNullString(...)` 调用改为 `sqlutil.ScanNullString(...)`。
8. 所有 `marshalConfig(...)` / `unmarshalConfig(...)` 调用改为 `sqlutil.MarshalConfig(...)` / `sqlutil.UnmarshalConfig(...)`。
9. 删除文件底部本地的 `nullString`、`scanNullString`、`marshalConfig`、`unmarshalConfig` 函数定义。

示例片段（完整 db_service.go 较长，按下面 Diff 风格修改即可）：

```go
// SetWorkitemProject 设置工作空间的工作项项目，使用 workspace_id 作为唯一键进行 upsert。
func (s *DBWorkspaceService) SetWorkitemProject(workspaceID string, req WorkitemProjectRequest) (workspace.WorkitemProject, error) {
	now := time.Now().UTC()

	tx, err := s.db.Begin()
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	if err := workspaceExistsTx(tx, workspaceID); err != nil {
		return workspace.WorkitemProject{}, err
	}

	_, err = tx.Exec(`
		INSERT INTO workitem_projects (id, workspace_id, platform, external_key, name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id) DO UPDATE SET
			platform = EXCLUDED.platform,
			external_key = EXCLUDED.external_key,
			name = EXCLUDED.name,
			updated_at = EXCLUDED.updated_at
	`, uuid.New().String(), workspaceID, req.Platform, req.ExternalKey, req.Name, now, now)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("set workitem project failed: %w", err)
	}

	wp, err := getWorkitemProjectTx(tx, workspaceID)
	if err != nil {
		return workspace.WorkitemProject{}, err
	}

	if err := tx.Commit(); err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("commit failed: %w", err)
	}
	return wp, nil
}

// GetWorkitemProject 获取工作空间的工作项项目。
func (s *DBWorkspaceService) GetWorkitemProject(workspaceID string) (workspace.WorkitemProject, error) {
	var wp workspace.WorkitemProject
	var config sql.NullString
	err := s.db.QueryRow(`
		SELECT id, workspace_id, platform, external_key, name, config, created_at, updated_at
		FROM workitem_projects WHERE workspace_id = $1
	`, workspaceID).Scan(&wp.ID, &wp.WorkspaceID, &wp.Platform, &wp.ExternalKey, &wp.Name, &config, &wp.CreatedAt, &wp.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return workspace.WorkitemProject{}, errors.New("workitem project not found")
	}
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("get workitem project failed: %w", err)
	}
	wp.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("unmarshal workitem project config failed: %w", err)
	}
	return wp, nil
}
```

`getWorkitemProjectTx` 实现类似，表名为 `workitem_projects`。

- [ ] **Step 3: 修改 service_mock.go 中的方法名和类型**

1. import 中移除 `packages/go-sdk/domain/project`。
2. 字段 `demandProjects map[string]workspace.DemandProject` → `workitemProjects map[string]workspace.WorkitemProject`。
3. 初始化 map 类型同步修改。
4. `SetDemandProject` → `SetWorkitemProject`，参数 `DemandProjectRequest` → `WorkitemProjectRequest`，返回 `workspace.WorkitemProject`。
5. `GetDemandProject` → `GetWorkitemProject`，返回 `workspace.WorkitemProject`。
6. 删除 `repos` 字段及 `ListRepositories`、`CreateRepository`、`DeleteRepository` 方法。

示例：

```go
const (
	errWorkspaceNotFound      = "workspace not found"
	errMemberNotFound         = "member not found"
	errWorkitemProjectNotFound = "workitem project not found"
	errAgentNotFound          = "agent not found"
	errStandardNotFound       = "standard not found"
	errCICDNotFound           = "cicd not found"
	errDefaultAgentNotFound   = "default agent not found"
)

// MockWorkspaceService 是 WorkspaceService 的内存实现，用于无 PostgreSQL 的本地开发环境。
type MockWorkspaceService struct {
	mu               sync.RWMutex
	workspaces       map[string]workspace.Workspace
	members          map[string][]workspace.Member
	workitemProjects map[string]workspace.WorkitemProject
	agents           map[string][]agent.Agent
	standards        map[string][]workspace.Standard
	cicd             map[string]workspace.CICD
}

func NewMockWorkspaceService() *MockWorkspaceService {
	s := &MockWorkspaceService{
		workspaces:       make(map[string]workspace.Workspace),
		members:          make(map[string][]workspace.Member),
		workitemProjects: make(map[string]workspace.WorkitemProject),
		agents:           make(map[string][]agent.Agent),
		standards:        make(map[string][]workspace.Standard),
		cicd:             make(map[string]workspace.CICD),
	}
	s.seed()
	return s
}
```

`seed()` 中删除 `s.repos` 的初始化；工作项项目 seed 可保留为空（默认不存在，由前端保存后产生）。

- [ ] **Step 4: 修改 handler.go（改名 demand-project，移除仓库 handler 与 project 导入）**

1. import 移除 `packages/go-sdk/domain/project`。
2. 删除 `WorkspaceRepositories`、`RepositoryByID` 两个 handler。
3. 删除 `repoTypeFromString`、`isValidRepoType`。
4. `DemandProject` handler 改名为 `WorkitemProject`，路径参数处理不变，调用 `defaultService.GetWorkitemProject` / `SetWorkitemProject`，请求类型 `service.WorkitemProjectRequest`。
5. 错误消息中的 "demand project" 改为 "workitem project"。

示例：

```go
// WorkitemProject 处理 GET /api/v1/workspaces/{id}/workitem-project 与 POST /api/v1/workspaces/{id}/workitem-project。
func WorkitemProject(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		wp, err := defaultService.GetWorkitemProject(workspaceID)
		if err != nil {
			handleServiceError(w, err, "workitem project not found", "failed to get workitem project")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(wp)
	case http.MethodPost:
		var req service.WorkitemProjectRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.Platform == "" || req.ExternalKey == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "platform and externalKey are required")
			return
		}
		wp, err := defaultService.SetWorkitemProject(workspaceID, req)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to set workitem project")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(wp)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}
```

- [ ] **Step 5: 编译 workspace 包**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/apps/dh-backend
go build ./domain/workspace/...
```

Expected: 0 errors（此时 server 尚未修改，会缺路由引用，但 workspace 包本身应能编译）。

- [ ] **Step 6: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add apps/dh-backend/domain/workspace/
git commit -m "refactor(workspace): rename demand project to workitem project and remove repository methods"
```

---

## Task 3: 新建 Repository 领域模型与 Git 克隆基础设施

**Files:**
- Create: `packages/go-sdk/domain/repository/repository.go`
- Create: `packages/go-sdk/infrastructure/repository/git.go`
- Create: `packages/go-sdk/infrastructure/repository/git_test.go`
- Modify: `packages/go-sdk/go.mod`

- [ ] **Step 1: 创建 Repository 领域模型**

```go
package repository

import "time"

// Repository 表示工作空间下的一个 Git 仓库。
type Repository struct {
	ID            string      `json:"id"`
	WorkspaceID   string      `json:"workspaceId"`
	Name          string      `json:"name"`
	URL           string      `json:"url"`
	Type          RepoType    `json:"type"`
	DefaultBranch string      `json:"defaultBranch"`
	SSHKey        string      `json:"sshKey,omitempty"`
	LocalPath     string      `json:"localPath,omitempty"`
	CloneStatus   CloneStatus `json:"cloneStatus"`
	LastSyncAt    *time.Time  `json:"lastSyncAt,omitempty"`
	ErrorMessage  string      `json:"errorMessage,omitempty"`
	Config        any         `json:"config,omitempty"`
	CreatedAt     time.Time   `json:"createdAt"`
	UpdatedAt     time.Time   `json:"updatedAt"`
}

// RepoType 仓库类型。
type RepoType string

const (
	RepoTypeDev     RepoType = "dev"
	RepoTypeTest    RepoType = "test"
	RepoTypeCase    RepoType = "case"
	RepoTypeProduct RepoType = "product"
)

// CloneStatus 表示本地克隆状态。
type CloneStatus string

const (
	CloneStatusPending CloneStatus = "pending"
	CloneStatusCloning CloneStatus = "cloning"
	CloneStatusCloned  CloneStatus = "cloned"
	CloneStatusFailed  CloneStatus = "failed"
)
```

- [ ] **Step 2: 创建 Git 克隆基础设施**

```go
package repository

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	gitssh "github.com/go-git/go-git/v5/plumbing/transport/ssh"
	"golang.org/x/crypto/ssh"
)

// DefaultWorkspaceRoot 是所有仓库本地克隆的根目录。
const DefaultWorkspaceRoot = "/var/deepharness/workspace"

// DefaultLocalPath 生成仓库默认本地路径。
func DefaultLocalPath(workspaceID, repoName string) string {
	// 简单净化名称，避免路径穿越。
	safe := strings.ReplaceAll(repoName, "..", "")
	safe = strings.ReplaceAll(safe, "/", "-")
	return filepath.Join(DefaultWorkspaceRoot, workspaceID, safe)
}

// GitClient 封装基于 go-git 的克隆/拉取能力。
type GitClient struct {
	root string
}

// NewGitClient 创建 GitClient，root 为空时使用 DefaultWorkspaceRoot。
func NewGitClient(root string) *GitClient {
	if root == "" {
		root = DefaultWorkspaceRoot
	}
	return &GitClient{root: root}
}

// DefaultLocalPath 生成仓库默认本地路径。
func (c *GitClient) DefaultLocalPath(workspaceID, repoName string) string {
	safe := strings.ReplaceAll(repoName, "..", "")
	safe = strings.ReplaceAll(safe, "/", "-")
	return filepath.Join(c.root, workspaceID, safe)
}

// authFromKey 从 SSH 私钥文本构造 go-git 认证器。
func authFromKey(privateKey string) (gitssh.AuthMethod, error) {
	if privateKey == "" {
		return nil, fmt.Errorf("ssh private key is empty")
	}
	signer, err := ssh.ParsePrivateKey([]byte(privateKey))
	if err != nil {
		return nil, fmt.Errorf("parse private key failed: %w", err)
	}
	return &gitssh.PublicKeys{User: "git", Signer: signer}, nil
}

// Clone 将远程仓库克隆到 dest。branch 为空时依次尝试 main、master。
func (c *GitClient) Clone(url, dest, sshKey, branch string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("create repo parent dir failed: %w", err)
	}

	auth, err := authFromKey(sshKey)
	if err != nil {
		return err
	}

	opts := &git.CloneOptions{
		URL:  url,
		Auth: auth,
	}
	if branch != "" {
		opts.ReferenceName = plumbing.NewBranchReferenceName(branch)
		opts.SingleBranch = true
	}

	_, err = git.PlainClone(dest, false, opts)
	if err != nil && branch == "" {
		// 未指定分支且失败时，尝试 main；再失败尝试 master。
		opts.ReferenceName = plumbing.NewBranchReferenceName("main")
		opts.SingleBranch = true
		_, err = git.PlainClone(dest, false, opts)
		if err != nil {
			opts.ReferenceName = plumbing.NewBranchReferenceName("master")
			_, err = git.PlainClone(dest, false, opts)
		}
	}
	if err != nil {
		return fmt.Errorf("git clone failed: %w", err)
	}
	return nil
}

// Pull 在已克隆目录执行 git pull。
func (c *GitClient) Pull(dest, sshKey string) error {
	auth, err := authFromKey(sshKey)
	if err != nil {
		return err
	}

	r, err := git.PlainOpen(dest)
	if err != nil {
		return fmt.Errorf("open repo failed: %w", err)
	}

	w, err := r.Worktree()
	if err != nil {
		return fmt.Errorf("get worktree failed: %w", err)
	}

	if err := w.Pull(&git.PullOptions{Auth: auth}); err != nil {
		// 已经是最新时 go-git 返回 AlreadyUpToDateError，不算失败。
		if err == git.NoErrAlreadyUpToDate {
			return nil
		}
		return fmt.Errorf("git pull failed: %w", err)
	}
	return nil
}
```

- [ ] **Step 3: 添加 go-git 依赖并编写单元测试**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/packages/go-sdk
go get github.com/go-git/go-git/v5
go mod tidy
```

`git_test.go`：

```go
package repository

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultLocalPath(t *testing.T) {
	c := NewGitClient("")
	got := c.DefaultLocalPath("ws-1", "backend/api")
	want := filepath.Join(DefaultWorkspaceRoot, "ws-1", "backend-api")
	if got != want {
		t.Errorf("DefaultLocalPath = %q, want %q", got, want)
	}
}

func TestDefaultLocalPathPreventsTraversal(t *testing.T) {
	c := NewGitClient("")
	got := c.DefaultLocalPath("ws-1", "../../etc")
	if strings.Contains(got, "..") {
		t.Errorf("DefaultLocalPath should not contain traversal: %q", got)
	}
}

func TestCloneWithInvalidSSHKey(t *testing.T) {
	c := NewGitClient("")
	tmp := t.TempDir()
	err := c.Clone("git@example.com:foo/bar.git", filepath.Join(tmp, "bar"), "not-a-key", "")
	if err == nil {
		t.Fatal("expected error for invalid ssh key")
	}
	if !os.IsNotExist(err) {
		// 也可能是解析 key 失败，都算通过。
		return
	}
}
```

- [ ] **Step 4: 运行 go-sdk 测试**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/packages/go-sdk
go test ./...
```

Expected: `ok`（网络相关测试会快速失败但不阻塞）。

- [ ] **Step 5: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add packages/go-sdk/domain/repository packages/go-sdk/infrastructure/repository packages/go-sdk/go.mod packages/go-sdk/go.sum
git commit -m "feat(go-sdk): add repository domain model and git clone helper"
```

---

## Task 4: 提取公共 Handler Helper

**Files:**
- Create: `apps/dh-backend/gateway/handler/common.go`
- Modify: `apps/dh-backend/domain/workspace/handler.go`

- [ ] **Step 1: 创建公共 helper**

```go
package handler

import (
	"encoding/json"
	"net/http"
	"strings"
)

// ErrorResponse 统一错误响应结构。
type ErrorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// SetJSONHeader 设置响应 Content-Type 为 application/json。
func SetJSONHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
}

// WriteJSONError 写入 JSON 格式错误响应。
func WriteJSONError(w http.ResponseWriter, status, code int, message string) {
	SetJSONHeader(w)
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ErrorResponse{Code: code, Message: message})
}

// HandleServiceError 统一处理服务层错误，识别 not found 返回 404。
func HandleServiceError(w http.ResponseWriter, err error, notFoundMsg, defaultMsg string) {
	if strings.Contains(err.Error(), "not found") {
		WriteJSONError(w, http.StatusNotFound, 1, notFoundMsg)
		return
	}
	WriteJSONError(w, http.StatusInternalServerError, 1, defaultMsg)
}

// DecodeJSONBody 解码 JSON 请求体，失败时返回 400。
func DecodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return false
	}
	return true
}

// PathValueOr404 提取路径参数，为空时返回 400。
func PathValueOr404(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	v := r.PathValue(name)
	if v == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "missing "+name)
		return "", false
	}
	return v, true
}
```

- [ ] **Step 2: 修改 workspace/handler.go 使用公共 helper**

删除以下本地定义：
- `errorResponse`
- `setJSONHeader`
- `writeJSONError`
- `handleServiceError`
- `decodeJSONBody`
- `pathValueOr404`

将调用处改为：
- `setJSONHeader(w)` → `handler.SetJSONHeader(w)`
- `writeJSONError(...)` → `handler.WriteJSONError(...)`
- `handleServiceError(...)` → `handler.HandleServiceError(...)`
- `decodeJSONBody(...)` → `handler.DecodeJSONBody(...)`
- `pathValueOr404(...)` → `handler.PathValueOr404(...)`

import 改为：

```go
import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)
```

- [ ] **Step 3: 编译检查**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/apps/dh-backend
go build ./domain/workspace/... ./gateway/handler/...
```

Expected: 0 errors.

- [ ] **Step 4: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add apps/dh-backend/gateway/handler/common.go apps/dh-backend/domain/workspace/handler.go
git commit -m "refactor(handler): extract common response helpers"
```

---

## Task 5: 新建 domain/repository 服务与 Handler

**Files:**
- Create: `apps/dh-backend/domain/repository/service/service.go`
- Create: `apps/dh-backend/domain/repository/service/db_service.go`
- Create: `apps/dh-backend/domain/repository/service/mock_service.go`
- Create: `apps/dh-backend/domain/repository/handler.go`
- Create: `apps/dh-backend/domain/repository/handler_test.go`

- [ ] **Step 1: 定义 RepositoryService 接口与请求结构体**

```go
package service

import (
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

// RepositoryService 定义仓库领域服务接口。
type RepositoryService interface {
	List(workspaceID string) ([]repository.Repository, error)
	Get(workspaceID, repoID string) (repository.Repository, error)
	Create(workspaceID string, req CreateRepositoryRequest) (repository.Repository, error)
	Update(workspaceID, repoID string, req UpdateRepositoryRequest) (repository.Repository, error)
	Delete(workspaceID, repoID string) error
	Sync(workspaceID, repoID string) error
}

// CreateRepositoryRequest 创建仓库请求。
type CreateRepositoryRequest struct {
	Name          string `json:"name"`
	URL           string `json:"url"`
	Type          string `json:"type"`
	DefaultBranch string `json:"defaultBranch"`
	SSHKey        string `json:"sshKey"`
}

// UpdateRepositoryRequest 更新仓库请求。
type UpdateRepositoryRequest struct {
	Name          string `json:"name,omitempty"`
	URL           string `json:"url,omitempty"`
	Type          string `json:"type,omitempty"`
	DefaultBranch string `json:"defaultBranch,omitempty"`
	SSHKey        string `json:"sshKey,omitempty"`
}
```

- [ ] **Step 2: 实现 DBRepositoryService**

```go
package service

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
	"github.com/google/uuid"
)

// DBRepositoryService 是基于 PostgreSQL 的 RepositoryService 实现。
type DBRepositoryService struct {
	db        *sql.DB
	gitClient *gitrepo.GitClient
	syncMu    sync.Mutex
}

// NewDBRepositoryService 创建 DBRepositoryService。
func NewDBRepositoryService(db *sql.DB, root string) *DBRepositoryService {
	return &DBRepositoryService{
		db:        db,
		gitClient: gitrepo.NewGitClient(root),
	}
}

// List 列出工作空间下所有仓库。
func (s *DBRepositoryService) List(workspaceID string) ([]repository.Repository, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, last_sync_at, error_message, config, created_at, updated_at
		FROM repositories WHERE workspace_id = $1 ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list repositories failed: %w", err)
	}
	defer rows.Close()

	result := make([]repository.Repository, 0)
	for rows.Next() {
		r, err := scanRepository(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate repositories failed: %w", err)
	}
	return result, nil
}

// Get 获取单个仓库。
func (s *DBRepositoryService) Get(workspaceID, repoID string) (repository.Repository, error) {
	row := s.db.QueryRow(`
		SELECT id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, last_sync_at, error_message, config, created_at, updated_at
		FROM repositories WHERE id = $1 AND workspace_id = $2
	`, repoID, workspaceID)
	return scanRepository(row)
}

// Create 创建仓库并触发异步 clone。
func (s *DBRepositoryService) Create(workspaceID string, req CreateRepositoryRequest) (repository.Repository, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return repository.Repository{}, err
	}

	now := time.Now().UTC()
	r := repository.Repository{
		ID:            uuid.New().String(),
		WorkspaceID:   workspaceID,
		Name:          req.Name,
		URL:           req.URL,
		Type:          repository.RepoType(req.Type),
		DefaultBranch: req.DefaultBranch,
		SSHKey:        req.SSHKey,
		LocalPath:     s.gitClient.DefaultLocalPath(workspaceID, req.Name),
		CloneStatus:   repository.CloneStatusPending,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	configStr, err := sqlutil.MarshalConfig(nil)
	if err != nil {
		return repository.Repository{}, err
	}

	_, err = s.db.Exec(`
		INSERT INTO repositories (id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, r.ID, r.WorkspaceID, r.Name, r.URL, r.Type, r.DefaultBranch, r.SSHKey, r.LocalPath, r.CloneStatus, configStr, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("insert repository failed: %w", err)
	}

	go s.syncRepository(r)
	return r, nil
}

// Update 更新仓库并触发同步（clone 或 pull）。
func (s *DBRepositoryService) Update(workspaceID, repoID string, req UpdateRepositoryRequest) (repository.Repository, error) {
	existing, err := s.Get(workspaceID, repoID)
	if err != nil {
		return repository.Repository{}, err
	}

	if req.Name != "" {
		existing.Name = req.Name
		existing.LocalPath = s.gitClient.DefaultLocalPath(workspaceID, req.Name)
	}
	if req.URL != "" {
		existing.URL = req.URL
	}
	if req.Type != "" {
		existing.Type = repository.RepoType(req.Type)
	}
	if req.DefaultBranch != "" {
		existing.DefaultBranch = req.DefaultBranch
	}
	if req.SSHKey != "" {
		existing.SSHKey = req.SSHKey
	}

	_, err = s.db.Exec(`
		UPDATE repositories
		SET name = $1, url = $2, type = $3, default_branch = $4, ssh_key = $5, local_path = $6, updated_at = $7
		WHERE id = $8 AND workspace_id = $9
	`, existing.Name, existing.URL, existing.Type, existing.DefaultBranch, existing.SSHKey, existing.LocalPath, time.Now().UTC(), existing.ID, existing.WorkspaceID)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("update repository failed: %w", err)
	}

	go s.syncRepository(existing)
	return s.Get(workspaceID, repoID)
}

// Delete 删除仓库记录并清理本地目录。
func (s *DBRepositoryService) Delete(workspaceID, repoID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	res, err := s.db.Exec(`DELETE FROM repositories WHERE id = $1 AND workspace_id = $2`, repoID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete repository failed: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errors.New("repository not found")
	}

	if r.LocalPath != "" {
		_ = os.RemoveAll(r.LocalPath)
	}
	return nil
}

// Sync 手动触发仓库同步。
func (s *DBRepositoryService) Sync(workspaceID, repoID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}
	go s.syncRepository(r)
	return nil
}

// syncRepository 执行 clone 或 pull，并更新数据库状态。
func (s *DBRepositoryService) syncRepository(r repository.Repository) {
	s.syncMu.Lock()
	defer s.syncMu.Unlock()

	s.updateStatus(r.ID, repository.CloneStatusCloning, "")

	exists := false
	if _, err := os.Stat(filepath.Join(r.LocalPath, ".git")); err == nil {
		exists = true
	}

	var err error
	if exists {
		err = s.gitClient.Pull(r.LocalPath, r.SSHKey)
	} else {
		err = s.gitClient.Clone(r.URL, r.LocalPath, r.SSHKey, r.DefaultBranch)
	}

	if err != nil {
		s.updateStatus(r.ID, repository.CloneStatusFailed, err.Error())
		return
	}
	now := time.Now().UTC()
	s.updateStatusAndSyncTime(r.ID, repository.CloneStatusCloned, &now)
}

func (s *DBRepositoryService) updateStatus(id string, status repository.CloneStatus, errMsg string) {
	_, _ = s.db.Exec(`UPDATE repositories SET clone_status = $1, error_message = $2 WHERE id = $3`, status, errMsg, id)
}

func (s *DBRepositoryService) updateStatusAndSyncTime(id string, status repository.CloneStatus, t *time.Time) {
	_, _ = s.db.Exec(`UPDATE repositories SET clone_status = $1, last_sync_at = $2, error_message = $3 WHERE id = $4`, status, t, "", id)
}

func (s *DBRepositoryService) workspaceExists(workspaceID string) error {
	var id string
	err := s.db.QueryRow(`SELECT id FROM workspaces WHERE id = $1`, workspaceID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("workspace not found")
	}
	if err != nil {
		return fmt.Errorf("check workspace exists failed: %w", err)
	}
	return nil
}

// scannable 兼容 *sql.Row 与 *sql.Rows。
type scannable interface {
	Scan(dest ...any) error
}

func scanRepository(row scannable) (repository.Repository, error) {
	var r repository.Repository
	var defaultBranch, sshKey, localPath, errorMessage sql.NullString
	var lastSyncAt sql.NullTime
	var config sql.NullString

	err := row.Scan(
		&r.ID, &r.WorkspaceID, &r.Name, &r.URL, &r.Type,
		&defaultBranch, &sshKey, &localPath, &r.CloneStatus,
		&lastSyncAt, &errorMessage, &config,
		&r.CreatedAt, &r.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return repository.Repository{}, errors.New("repository not found")
	}
	if err != nil {
		return repository.Repository{}, fmt.Errorf("scan repository failed: %w", err)
	}

	r.DefaultBranch = sqlutil.ScanNullString(defaultBranch)
	r.SSHKey = sqlutil.ScanNullString(sshKey)
	r.LocalPath = sqlutil.ScanNullString(localPath)
	r.ErrorMessage = sqlutil.ScanNullString(errorMessage)
	if lastSyncAt.Valid {
		r.LastSyncAt = &lastSyncAt.Time
	}
	r.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("unmarshal repository config failed: %w", err)
	}
	return r, nil
}

// 复用 packages/go-sdk/common/sqlutil 中的 ScanNullString / MarshalConfig / UnmarshalConfig，
// 避免与 workspace service 重复定义。
```

注意：需要在文件头部添加 `"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"`。

- [ ] **Step 3: 实现 MockRepositoryService**

```go
package service

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"github.com/google/uuid"
)

// MockRepositoryService 是 RepositoryService 的内存 mock，不执行真实 clone。
type MockRepositoryService struct {
	mu     sync.RWMutex
	repos  map[string]repository.Repository
	byWS   map[string][]string
}

// NewMockRepositoryService 创建 MockRepositoryService。
func NewMockRepositoryService() *MockRepositoryService {
	return &MockRepositoryService{
		repos: make(map[string]repository.Repository),
		byWS:  make(map[string][]string),
	}
}

func (s *MockRepositoryService) List(workspaceID string) ([]repository.Repository, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := s.byWS[workspaceID]
	result := make([]repository.Repository, 0, len(ids))
	for _, id := range ids {
		result = append(result, s.repos[id])
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

func (s *MockRepositoryService) Get(workspaceID, repoID string) (repository.Repository, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	r, ok := s.repos[repoID]
	if !ok || r.WorkspaceID != workspaceID {
		return repository.Repository{}, errors.New("repository not found")
	}
	return r, nil
}

func (s *MockRepositoryService) Create(workspaceID string, req CreateRepositoryRequest) (repository.Repository, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	r := repository.Repository{
		ID:            uuid.New().String(),
		WorkspaceID:   workspaceID,
		Name:          req.Name,
		URL:           req.URL,
		Type:          repository.RepoType(req.Type),
		DefaultBranch: req.DefaultBranch,
		SSHKey:        req.SSHKey,
		LocalPath:     "/tmp/mock-" + workspaceID + "-" + req.Name,
		CloneStatus:   repository.CloneStatusPending,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	s.repos[r.ID] = r
	s.byWS[workspaceID] = append(s.byWS[workspaceID], r.ID)
	return r, nil
}

func (s *MockRepositoryService) Update(workspaceID, repoID string, req UpdateRepositoryRequest) (repository.Repository, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.repos[repoID]
	if !ok || r.WorkspaceID != workspaceID {
		return repository.Repository{}, errors.New("repository not found")
	}
	if req.Name != "" {
		r.Name = req.Name
	}
	if req.URL != "" {
		r.URL = req.URL
	}
	if req.Type != "" {
		r.Type = repository.RepoType(req.Type)
	}
	if req.DefaultBranch != "" {
		r.DefaultBranch = req.DefaultBranch
	}
	if req.SSHKey != "" {
		r.SSHKey = req.SSHKey
	}
	r.UpdatedAt = time.Now().UTC()
	s.repos[repoID] = r
	return r, nil
}

func (s *MockRepositoryService) Delete(workspaceID, repoID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	r, ok := s.repos[repoID]
	if !ok || r.WorkspaceID != workspaceID {
		return errors.New("repository not found")
	}
	delete(s.repos, repoID)
	ids := s.byWS[workspaceID]
	for i, id := range ids {
		if id == repoID {
			s.byWS[workspaceID] = append(ids[:i], ids[i+1:]...)
			break
		}
	}
	return nil
}

func (s *MockRepositoryService) Sync(workspaceID, repoID string) error {
	_, err := s.Get(workspaceID, repoID)
	return err
}
```

- [ ] **Step 4: 创建 Repository Handler**

```go
package repository

import (
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

var defaultService service.RepositoryService

// Init 注入 RepositoryService 实现。
func Init(svc service.RepositoryService) {
	defaultService = svc
}

// Repositories 处理 GET /api/v1/workspaces/{id}/repositories 与 POST /api/v1/workspaces/{id}/repositories。
func Repositories(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		repos, err := defaultService.List(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list repositories")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(repos)
	case http.MethodPost:
		var req service.CreateRepositoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.URL == "" || req.Type == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name, url and type are required")
			return
		}
		if !isValidRepoType(req.Type) {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid repository type")
			return
		}
		repo, err := defaultService.Create(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to create repository")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(repo)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// RepositoryByID 处理 GET/PUT/DELETE /api/v1/workspaces/{id}/repositories/{repoId}。
func RepositoryByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		repo, err := defaultService.Get(workspaceID, repoID)
		if err != nil {
			handler.HandleServiceError(w, err, "repository not found", "failed to get repository")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(repo)
	case http.MethodPut, http.MethodPatch:
		var req service.UpdateRepositoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Type != "" && !isValidRepoType(req.Type) {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid repository type")
			return
		}
		repo, err := defaultService.Update(workspaceID, repoID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "repository not found", "failed to update repository")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(repo)
	case http.MethodDelete:
		if err := defaultService.Delete(workspaceID, repoID); err != nil {
			handler.HandleServiceError(w, err, "repository not found", "failed to delete repository")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// SyncRepository 处理 POST /api/v1/workspaces/{id}/repositories/{repoId}/sync。
func SyncRepository(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	if err := defaultService.Sync(workspaceID, repoID); err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to sync repository")
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func isValidRepoType(t string) bool {
	switch repository.RepoType(t) {
	case repository.RepoTypeDev, repository.RepoTypeTest, repository.RepoTypeCase, repository.RepoTypeProduct:
		return true
	default:
		return false
	}
}
```

注意：需要在文件头部添加 `import "encoding/json"`。

- [ ] **Step 5: 编写 Repository Handler 单元测试**

```go
package repository

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"
)

func TestRepositories_CreateAndList(t *testing.T) {
	Init(service.NewMockRepositoryService())

	reqBody, _ := json.Marshal(service.CreateRepositoryRequest{
		Name: "backend-api",
		URL:  "git@github.com:company/backend-api.git",
		Type: "dev",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/repositories", bytes.NewReader(reqBody))
	req.SetPathValue("id", "ws-1")
	w := httptest.NewRecorder()
	Repositories(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if created["name"] != "backend-api" {
		t.Errorf("unexpected name: %v", created["name"])
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/repositories", nil)
	req.SetPathValue("id", "ws-1")
	w = httptest.NewRecorder()
	Repositories(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 repo, got %d", len(list))
	}
}

func TestRepositories_InvalidType(t *testing.T) {
	Init(service.NewMockRepositoryService())

	reqBody, _ := json.Marshal(service.CreateRepositoryRequest{
		Name: "x",
		URL:  "git@example.com:x.git",
		Type: "badtype",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/repositories", bytes.NewReader(reqBody))
	req.SetPathValue("id", "ws-1")
	w := httptest.NewRecorder()
	Repositories(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}
```

- [ ] **Step 6: 编译并测试 repository 包**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/apps/dh-backend
go mod tidy
go test ./domain/repository/...
```

Expected: tests pass.

- [ ] **Step 7: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add apps/dh-backend/domain/repository apps/dh-backend/go.mod apps/dh-backend/go.sum
git commit -m "feat(repository): add independent repository service and handler"
```

---

## Task 6: 注册 Repository 路由、下线旧 project 路由并更新入口

**Files:**
- Modify: `apps/dh-backend/gateway/server/server.go`

- [ ] **Step 1: 更新 server.go**

修改 import：
- 移除 `"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/project"`
- 添加 `"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository"` 与 `repositoryservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"`

修改路由注册区域：

```go
	// Internal business modules
	mux.HandleFunc("/api/v1/identity/users", identity.Users)
	mux.HandleFunc("/api/v1/identity/users/me", identity.Me)
	mux.HandleFunc("/api/v1/identity/login", identity.Login)
	// 旧的 project / repositories 接口已下线，不再注册。
	mux.HandleFunc("/api/v1/workitems", workitem.WorkItems)
	mux.HandleFunc("/api/v1/workitems/{id}", workitem.WorkItemByID)
	mux.HandleFunc("/api/v1/workitems/{id}/status", workitem.UpdateWorkItemStatus)
	mux.HandleFunc("/api/v1/review/review", pragent.Reviews)
	mux.HandleFunc("/api/v1/audit/events", audit.Events)
	mux.HandleFunc("/api/v1/orchestrator/sessions", orchestrator.Sessions)
```

Workspace 模块路由更新：

```go
	// Workspace module
	mux.HandleFunc("/api/v1/workspaces", workspace.Workspaces)
	mux.HandleFunc("/api/v1/workspaces/{id}", workspace.WorkspaceByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/members", workspace.Members)
	mux.HandleFunc("/api/v1/workspaces/{id}/members/{userId}", workspace.MemberByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/workitem-project", workspace.WorkitemProject)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories", repository.Repositories)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}", repository.RepositoryByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/sync", repository.SyncRepository)
	mux.HandleFunc("/api/v1/workspaces/{id}/agents", workspace.WorkspaceAgents)
	mux.HandleFunc("/api/v1/workspaces/{id}/standards", workspace.WorkspaceStandards)
	mux.HandleFunc("/api/v1/workspaces/{id}/standards/{standardId}", workspace.WorkspaceStandardByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/cicd", workspace.WorkspaceCICD)
```

添加 repository service 初始化：

```go
func initRepositoryService(db *sql.DB) {
	if db != nil {
		log.Println("[Repository] using postgres storage with git clone")
		repository.Init(repositoryservice.NewDBRepositoryService(db, ""))
		return
	}
	log.Println("[Repository] using memory mock")
	repository.Init(repositoryservice.NewMockRepositoryService())
}
```

在 `New` 函数中，在 `initWorkspaceService(db)` 之后调用 `initRepositoryService(db)`。

- [ ] **Step 2: 编译 dh-backend**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/apps/dh-backend
go build ./...
```

Expected: 0 errors.

- [ ] **Step 3: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add apps/dh-backend/gateway/server/server.go
git commit -m "feat(server): register repository routes and remove legacy project routes"
```

---

## Task 7: 更新数据库 Schema 与迁移脚本

**Files:**
- Modify: `infra/database/workspace/schema.sql`
- Create: `infra/database/workspace/migration-20260616.sql`

- [ ] **Step 1: 修改 schema.sql**

1. 将 `demand_projects` 表定义与注释整体替换为 `workitem_projects`。
2. 在 `repositories` 表中新增列：`ssh_key TEXT`、`local_path VARCHAR(500)`、`clone_status VARCHAR(50) NOT NULL DEFAULT 'pending'`、`last_sync_at TIMESTAMPTZ`、`error_message TEXT`。
3. 在 `repositories` 表上添加 `UNIQUE (workspace_id, name)`。

关键变更示例：

```sql
CREATE TABLE IF NOT EXISTS workitem_projects (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'meego',
    external_key VARCHAR(200) NOT NULL,
    name VARCHAR(200),
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workitem_projects IS '工作项项目（一个空间仅对应一个）';
COMMENT ON COLUMN workitem_projects.id IS '工作项项目 ID（VARCHAR(36)）';
COMMENT ON COLUMN workitem_projects.workspace_id IS '所属空间 ID';
COMMENT ON COLUMN workitem_projects.platform IS '需求平台类型';
COMMENT ON COLUMN workitem_projects.external_key IS '外部系统项目标识';
COMMENT ON COLUMN workitem_projects.name IS '工作项项目名称';
COMMENT ON COLUMN workitem_projects.config IS '平台相关配置';
COMMENT ON COLUMN workitem_projects.created_at IS '创建时间';
COMMENT ON COLUMN workitem_projects.updated_at IS '更新时间';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workitem_projects_workspace_id ON workitem_projects (workspace_id);

DROP TRIGGER IF EXISTS trigger_workitem_projects_updated_at ON workitem_projects;
CREATE TRIGGER trigger_workitem_projects_updated_at
BEFORE UPDATE ON workitem_projects
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

`repositories` 表：

```sql
CREATE TABLE IF NOT EXISTS repositories (
    id VARCHAR(36) PRIMARY KEY,
    workspace_id VARCHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    url VARCHAR(500) NOT NULL,
    type VARCHAR(50) NOT NULL,
    default_branch VARCHAR(100),
    ssh_key TEXT,
    local_path VARCHAR(500),
    clone_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    last_sync_at TIMESTAMPTZ,
    error_message TEXT,
    config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, name)
);
```

- [ ] **Step 2: 创建迁移脚本**

```sql
-- migration-20260616.sql
-- 目标：将已有 PostgreSQL 实例从 demand_projects/repositories(旧) 迁移到新结构。
-- 请在 psql 中执行：\i migration-20260616.sql

-- 1. 重命名 demand_projects 为 workitem_projects
ALTER TABLE IF EXISTS demand_projects RENAME TO workitem_projects;
ALTER INDEX IF EXISTS idx_demand_projects_workspace_id RENAME TO idx_workitem_projects_workspace_id;
ALTER TRIGGER IF EXISTS trigger_demand_projects_updated_at ON workitem_projects RENAME TO trigger_workitem_projects_updated_at;

-- 2. 扩展 repositories 表
ALTER TABLE IF EXISTS repositories
    ADD COLUMN IF NOT EXISTS ssh_key TEXT,
    ADD COLUMN IF NOT EXISTS local_path VARCHAR(500),
    ADD COLUMN IF NOT EXISTS clone_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 已有数据默认标记为 pending，等待重新同步
UPDATE repositories SET clone_status = 'pending' WHERE clone_status IS NULL;

-- 添加唯一约束（如果尚未存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'repositories_workspace_id_name_key'
    ) THEN
        ALTER TABLE repositories ADD CONSTRAINT repositories_workspace_id_name_key UNIQUE (workspace_id, name);
    END IF;
END $$;
```

- [ ] **Step 3: 应用迁移到本地 Postgres**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
PGPASSWORD=deep123 psql -h localhost -p 5433 -U deepharness -d deepharness -f infra/database/workspace/migration-20260616.sql
```

Expected: 无 ERROR。

- [ ] **Step 4: 提交**

```bash
git add infra/database/workspace/schema.sql infra/database/workspace/migration-20260616.sql
git commit -m "chore(db): rename demand_projects and expand repositories schema"
```

---

## Task 8: 前端类型与 API 层改名

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/lib/api-types.ts`
- Modify: `apps/web/src/lib/workspace-api.ts`
- Create: `apps/web/src/lib/repository-api.ts`

- [ ] **Step 1: 更新 types/index.ts**

```ts
export interface WorkitemProject {
  id: string;
  workspaceId: string;
  platform: string;
  externalKey: string;
  name: string;
  config?: Record<string, unknown>;
}

export interface WorkspaceRepository {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  type: 'dev' | 'test' | 'case' | 'product';
  defaultBranch?: string;
  sshKey?: string;
  localPath?: string;
  cloneStatus: 'pending' | 'cloning' | 'cloned' | 'failed';
  lastSyncAt?: string;
  errorMessage?: string;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

删除旧的 `DemandProject` 类型。

- [ ] **Step 2: 更新 api-types.ts**

将 `RepositoryDTO` 改为：

```ts
export interface RepositoryDTO {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  type: RepoType;
  defaultBranch?: string;
  sshKey?: string;
  localPath?: string;
  cloneStatus: 'pending' | 'cloning' | 'cloned' | 'failed';
  lastSyncAt?: string;
  errorMessage?: string;
}
```

`ProjectDTO` 不再需要，可删除。

- [ ] **Step 3: 更新 workspace-api.ts**

```ts
import { api } from './api';
import type {
  Workspace,
  WorkspaceMember,
  WorkitemProject,
  WorkspaceStandard,
  WorkspaceCICD,
  WorkspaceAgent,
} from '@/types';

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

  getWorkitemProject: (workspaceId: string) =>
    api.get<WorkitemProject>(`/v1/workspaces/${workspaceId}/workitem-project`),
  setWorkitemProject: (workspaceId: string, req: Partial<WorkitemProject>) =>
    api.post<WorkitemProject>(`/v1/workspaces/${workspaceId}/workitem-project`, req),

  listAgents: (workspaceId: string) => api.get<WorkspaceAgent[]>(`/v1/workspaces/${workspaceId}/agents`),

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

- [ ] **Step 4: 创建 repository-api.ts**

```ts
import { api } from './api';
import type { WorkspaceRepository } from '@/types';

export interface CreateRepositoryRequest {
  name: string;
  url: string;
  type: WorkspaceRepository['type'];
  defaultBranch?: string;
  sshKey?: string;
}

export interface UpdateRepositoryRequest {
  name?: string;
  url?: string;
  type?: WorkspaceRepository['type'];
  defaultBranch?: string;
  sshKey?: string;
}

export const repositoryApi = {
  list: (workspaceId: string) =>
    api.get<WorkspaceRepository[]>(`/v1/workspaces/${workspaceId}/repositories`),
  get: (workspaceId: string, repoId: string) =>
    api.get<WorkspaceRepository>(`/v1/workspaces/${workspaceId}/repositories/${repoId}`),
  create: (workspaceId: string, req: CreateRepositoryRequest) =>
    api.post<WorkspaceRepository>(`/v1/workspaces/${workspaceId}/repositories`, req),
  update: (workspaceId: string, repoId: string, req: UpdateRepositoryRequest) =>
    api.patch<WorkspaceRepository>(`/v1/workspaces/${workspaceId}/repositories/${repoId}`, req),
  delete: (workspaceId: string, repoId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/repositories/${repoId}`),
  sync: (workspaceId: string, repoId: string) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/repositories/${repoId}/sync`),
};
```

- [ ] **Step 5: 类型检查**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
npx tsc --noEmit -p apps/web/tsconfig.check.json
```

Expected: 0 errors（此时 Settings/Chat 可能仍引用旧类型，先不处理，下一任务解决）。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/types/index.ts apps/web/src/lib/api-types.ts apps/web/src/lib/workspace-api.ts apps/web/src/lib/repository-api.ts
git commit -m "refactor(web): rename types/api to workitem project and add repository-api"
```

---

## Task 9: 更新 Settings.tsx 与 Chat.tsx

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`
- Modify: `apps/web/src/pages/Chat.tsx`

- [ ] **Step 1: Settings.tsx 导入与状态改名**

将 `DemandProject` 导入改为 `WorkitemProject`，并新增 `repositoryApi` 导入：

```ts
import { repositoryApi } from '@/lib/repository-api';
import { workspaceApi } from '@/lib/workspace-api';
import type { ..., WorkitemProject, WorkspaceRepository, ... } from '@/types';
```

状态：

```ts
const [workitemProject, setWorkitemProject] = useState<WorkitemProject | null>(null);
const [gitRepos, setGitRepos] = useState<WorkspaceRepository[]>([
  { id: '1', url: mockSettings.gitlabUrl || '', name: '主项目', type: 'dev', cloneStatus: 'pending', createdAt: '', updatedAt: '' }
]);
```

加载数据时：

```ts
workspaceApi.getWorkitemProject(workspaceId).catch(() => null),
repositoryApi.list(workspaceId).catch(() => []),
```

保存到状态：

```ts
setWorkitemProject(wp);
setGitRepos(repos as WorkspaceRepository[]);
```

`handleSaveBasic` 改为同时保存工作项项目和仓库列表：

```ts
const handleSaveBasic = async () => {
  const workspaceId = workspace?.id || 'ws-default';
  try {
    await workspaceApi.setWorkitemProject(workspaceId, {
      platform: reqPlatform,
      externalKey: settings.meegoProject,
      name: workspace?.name || settings.meegoProject,
    });
    await Promise.all(
      gitRepos.map(r =>
        repositoryApi.update(workspaceId, r.id, {
          name: r.name,
          url: r.url,
          type: r.type,
          defaultBranch: r.defaultBranch,
          sshKey: r.sshKey,
        })
      )
    );
    toast.success('基础配置已保存');
  } catch {
    toast.error('保存基础配置失败');
  }
};
```

新增仓库：

```ts
const handleAddRepo = () => {
  const workspaceId = workspace?.id || 'ws-default';
  repositoryApi.create(workspaceId, { name: '', url: '', type: 'dev' })
    .then(repo => setGitRepos([...gitRepos, repo]))
    .catch(() => toast.error('新增仓库失败'));
};
```

删除仓库：

```ts
const handleRemoveRepo = (id: string) => {
  const workspaceId = workspace?.id || 'ws-default';
  if (gitRepos.length > 1) {
    repositoryApi.delete(workspaceId, id)
      .then(() => setGitRepos(gitRepos.filter(repo => repo.id !== id)))
      .catch(() => toast.error('删除仓库失败'));
  } else {
    toast.error('至少需要保留一个 Git 仓库');
  }
};
```

在 UI 中为每个仓库增加 `SSH Key`、`默认分支` 输入框和 `cloneStatus` 显示。示例（插入到现有仓库卡片中）：

```tsx
<div className="space-y-2 w-full sm:w-1/4">
  <Label className="text-xs text-muted-foreground">默认分支</Label>
  <Input
    placeholder="main"
    value={repo.defaultBranch || ''}
    onChange={e => setGitRepos(repos => repos.map(r => r.id === repo.id ? { ...r, defaultBranch: e.target.value } : r))}
    className="bg-background"
    disabled={isReadOnly}
  />
</div>
<div className="space-y-2 w-full">
  <Label className="text-xs text-muted-foreground">SSH 私钥</Label>
  <Textarea
    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
    value={repo.sshKey || ''}
    onChange={e => setGitRepos(repos => repos.map(r => r.id === repo.id ? { ...r, sshKey: e.target.value } : r))}
    className="bg-background font-mono text-xs"
    disabled={isReadOnly}
    rows={3}
  />
</div>
<div className="flex items-center gap-2 text-xs text-muted-foreground">
  <Badge variant={repo.cloneStatus === 'cloned' ? 'default' : repo.cloneStatus === 'failed' ? 'destructive' : 'secondary'}>
    {repo.cloneStatus}
  </Badge>
  {repo.errorMessage && <span className="text-destructive truncate">{repo.errorMessage}</span>}
</div>
```

- [ ] **Step 2: Chat.tsx 改用 workspace repository API**

将：

```ts
api.get<RepositoryDTO[]>('/v1/repositories?type=dev')
```

改为：

```ts
const workspaceId = localStorage.getItem('currentWorkspaceId') || 'ws-default';
repositoryApi.list(workspaceId)
```

并新增导入：

```ts
import { repositoryApi } from '@/lib/repository-api';
```

创建会话时 `projectId: 'p1'` 字段已无用，但会话接口目前仍接收该字段，可保留以兼容旧 payload；本次不强制删除。

- [ ] **Step 3: 前端类型检查**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
npx tsc --noEmit -p apps/web/tsconfig.check.json
```

Expected: 0 errors。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/Settings.tsx apps/web/src/pages/Chat.tsx
git commit -m "feat(web): update Settings and Chat for workitem project and repository API"
```

---

## Task 10: 清理旧 domain/project 与 go-sdk domain/project

**Files:**
- Delete: `apps/dh-backend/domain/project/`（handler.go、object/types.go、service/service.go、service/service_mock.go）
- Delete: `packages/go-sdk/domain/project/project.go`
- Modify: 检查并移除 `ProjectDTO` 等残留引用

- [ ] **Step 1: 删除旧目录与文件**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
rm -rf apps/dh-backend/domain/project
rm packages/go-sdk/domain/project/project.go
rmdir packages/go-sdk/domain/project 2>/dev/null || true
```

- [ ] **Step 2: 扫描并确认无旧 project 引用**

```bash
grep -R "packages/go-sdk/domain/project" apps/ packages/ || echo "no references"
grep -R "domain/project" apps/dh-backend || echo "no references"
```

Expected: 无引用。

- [ ] **Step 3: 编译检查**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/apps/dh-backend
go build ./...
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/packages/go-sdk
go build ./...
```

Expected: 0 errors。

- [ ] **Step 4: 提交**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
git add -A
git commit -m "chore: remove legacy domain/project and sdk domain/project"
```

---

## 计划自检

| 设计点 | 对应任务 |
|---|---|
| `demand_project` → `workitem_project` | Task 1、Task 2、Task 8 |
| 仓库独立领域 `domain/repository` | Task 3、Task 5、Task 6 |
| 创建/更新时自动 clone/pull | Task 3、`DBRepositoryService.syncRepository` |
| 下线旧 `/api/v1/projects`、`/api/v1/repositories` | Task 6 |
| 数据表 `workitem_projects` + repositories 扩展列 | Task 7 |
| 前端 Settings/Chat 改调新接口 | Task 8、Task 9 |
| 消除重复 helper | Task 1.5、Task 4 |

**Placeholder 扫描结果：** 本计划无 TBD / TODO / implement later；所有代码步骤均含完整代码或精确替换说明；所有命令均含期望输出。

---

## Task 11: 全量验证

- [ ] **Step 1: Go vet / build**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
cd packages/go-sdk && go vet ./... && go build ./... && cd ../..
cd apps/dh-backend && go vet ./... && go build ./... && cd ../..
```

Expected: 全 0 errors / exit 0。

- [ ] **Step 2: Go tests**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/packages/go-sdk && go test ./...
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model/apps/dh-backend && go test ./...
```

Expected: PASS。

- [ ] **Step 3: TypeScript 类型检查**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
npx tsc --noEmit -p apps/web/tsconfig.check.json
```

Expected: 0 errors。

- [ ] **Step 4: 前端构建**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
pnpm build
```

Expected: 成功。

- [ ] **Step 5: 启动开发服务器并验证**

```bash
# 确保 Postgres 已启动
docker compose -f infra/docker/compose.postgres.yml up -d --remove-orphans

# 启动全部服务
pnpm dev
```

等待后端和前端启动后执行：

```bash
# 1. 旧接口下线验证（应返回 404）
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v1/projects || true
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v1/repositories || true

# 2. workitem project 读写
export WS_ID=ws-default
curl -s -X POST http://localhost:8080/api/v1/workspaces/${WS_ID}/workitem-project \
  -H "Content-Type: application/json" \
  -d '{"platform":"meego","externalKey":"MEEGO-DEMO","name":"Demo"}' | jq .
curl -s http://localhost:8080/api/v1/workspaces/${WS_ID}/workitem-project | jq .

# 3. repository 创建（可用一个公开只读仓库或任意可访问仓库，验证接口落盘）
curl -s -X POST http://localhost:8080/api/v1/workspaces/${WS_ID}/repositories \
  -H "Content-Type: application/json" \
  -d '{"name":"demo-repo","url":"git@github.com:octocat/Hello-World.git","type":"dev","defaultBranch":"master"}' | jq .

# 4. 查看列表与 clone 状态
sleep 3
curl -s http://localhost:8080/api/v1/workspaces/${WS_ID}/repositories | jq .

# 5. 检查本地目录（如果配置了有效 SSH key，应能看到文件）
ls -la /var/deepharness/workspace/${WS_ID}/demo-repo 2>/dev/null || echo "目录尚未生成或 clone 失败，查看 errorMessage"
```

Expected:
- 旧接口返回 404。
- workitem project 正常读写。
- repository 创建成功，`cloneStatus` 从 `pending` → `cloning` → `cloned`/`failed`。
- 若 SSH key 有效，本地路径出现仓库文件。

- [ ] **Step 6: 提交最终验证结果**

```bash
cd /home/nan/deepharness-ent-platform/.worktrees/feature-workspace-data-model
# 如验证过程中有未提交的文档/日志更新，一并提交。
git status
```

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-06-16-workitem-project-and-repository.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** - Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
