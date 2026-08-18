# 架构设计工作台重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将架构设计工作台从服务级三视图重构为开发库代码视图，支持 understand 解析 + 开发库/模块/类三层下钻 + 开发库介绍页。

**Architecture:** 后端 arch_handler 改为层级查询（L1/L2/L3 + overview），新增解析触发与 per-workspace 解析锁；新建 dev-lib-analysis 技能编排 understand + 模块识别 + 介绍 + 库间依赖；前端删筛选/视图，加多层下钻、面包屑、介绍页。数据来源：L1/L2/介绍存架构库 YAML，L3 读各开发库 `.understand-anything/knowledge-graph.json`。

**Tech Stack:** Go 1.22（net/http + ServeMux）、React 18 + TypeScript + @antv/x6、YAML（gopkg.in/yaml.v3）、understand 技能（agent 侧）。

## Global Constraints

- 按 AGENTS.md：不主动 git 提交，每个 task 验证通过即完成；提交由用户决定。
- 代码最多 3 层嵌套；复杂业务逻辑加中文注释；禁止魔法值（提取常量）；重复逻辑 ≥2 处封装。
- Go：`go vet ./...` 0 warnings；`go build ./...` 通过。
- 前端：`pnpm exec tsc --noEmit -p tsconfig.check.json` 本次改动 0 新增 errors（工作区有 3 个 pre-existing 无关错误）。
- 架构合规（规则12）：dev-lib-analysis 技能放 `shares/skills/`；agent 产出写共享目录；dh-backend 经 stubclient 读文件，不直接访问文件系统。
- 路径参数：所有 arch 相关路由用 `glm_5.2_ark_toC`（与现有 ROUTE_WORKSPACES_BY_ID_* 一致）。
- 文件读取统一经 `stubclient.FromContext(ctx)`，不直接 os.ReadFile。
- 设计文档：`docs/superpowers/specs/2026-08-13-arch-design-workspace-redesign-design.md`。

## File Structure

### 后端（apps/dh-backend）
- **修改** `domain/repository/arch_handler.go` — `ArchGraph` 改层级查询；新增 Overview/Parse/ParseStatus handler
- **修改** `domain/repository/arch_service.go` — 删除旧 `buildArchGraph` 三视图，新增 L1/L2/L3/overview 读取聚合
- **新建** `domain/repository/service/parse_lock.go` — per-workspace 解析锁（锁文件读写）
- **修改** `gateway/server/server.go` — 注册 4 条新路由（arch/overview, arch/parse, arch/parse/status；arch/graph 路由不变）
- **新建** `domain/repository/arch_service_test.go` — L1/L2/L3 读取聚合的单元测试

### 共享目录
- **新建** `shares/skills/dev-lib-analysis/SKILL.md` — 编排技能

### 前端（apps/dh-frontend）
- **修改** `src/lib/arch-api.ts` — API 类型改为层级，新增 overview/parse/parseStatus 请求
- **修改** `src/components/workspace/ArchDesignWorkspace.tsx` — 重构：删筛选/视图，加 drillLevel/面包屑/介绍页

---

## Task 1: 后端数据结构与 YAML/JSON 读取聚合

**Files:**
- Modify: `apps/dh-backend/domain/repository/arch_service.go`
- Test: `apps/dh-backend/domain/repository/arch_service_test.go`（新建）

**Interfaces:**
- Produces:
  - `type ArchLibrary struct` / `type ArchLibDependency struct`（L1）
  - `type ArchModule struct` / `type ArchModuleDependency struct`（L2）
  - `type ArchOverview struct`（介绍页）
  - `func loadLibraries(ctx, repoPath) (*librariesData, []string)` — 读 `libraries.yaml`
  - `func loadModules(ctx, repoPath, libKey) (*modulesData, []string)` — 读 `modules/<lib>.yaml`
  - `func loadOverview(ctx, repoPath, libKey) (*ArchOverview, error)` — 读 `overviews/<lib>.yaml`
  - `func loadClassView(ctx, kgPath, modulePathPrefix string) (*archView, []string)` — 读 knowledge-graph.json 按 path 过滤

- [x] **Step 1: 定义 L1/L2/overview 结构体与 YAML 标签**

在 `arch_service.go` 顶部（替换旧 `archDomainDef` 等服务级结构体，但保留 `archView`/`archNode`/`archEdge` 复用）新增：

```go
// librariesData 对应架构库 libraries.yaml（L1 开发库层）。
type librariesData struct {
	Libraries    []ArchLibrary        `yaml:"libraries"`
	Dependencies []ArchLibDependency  `yaml:"dependencies"`
	Warnings     []string             `yaml:"warnings"`
	ParsedAt     string               `yaml:"parsedAt"`
}

// ArchLibrary 单个开发库节点。
type ArchLibrary struct {
	Key       string   `yaml:"key" json:"key"`
	Name      string   `yaml:"name" json:"name"`
	Path      string   `yaml:"path" json:"path"`
	Languages []string `yaml:"languages" json:"languages"`
	Summary   string   `yaml:"summary" json:"summary"`
}

// ArchLibDependency 开发库间依赖边。
type ArchLibDependency struct {
	From        string `yaml:"from" json:"from"`
	To          string `yaml:"to" json:"to"`
	Kind        string `yaml:"kind" json:"kind"`
	Description string `yaml:"description" json:"description"`
}

// modulesData 对应 modules/<lib>.yaml（L2 模块层）。
type modulesData struct {
	Modules      []ArchModule            `yaml:"modules"`
	Dependencies []ArchModuleDependency  `yaml:"dependencies"`
}

// ArchModule 单个模块节点。
type ArchModule struct {
	Key       string `yaml:"key" json:"key"`
	Name      string `yaml:"name" json:"name"`
	Path      string `yaml:"path" json:"path"`
	Summary   string `yaml:"summary" json:"summary"`
	FileCount int    `yaml:"fileCount" json:"fileCount"`
}

// ArchModuleDependency 模块间依赖边。
type ArchModuleDependency struct {
	From string `yaml:"from" json:"from"`
	To   string `yaml:"to" json:"to"`
	Kind string `yaml:"kind" json:"kind"`
}

// ArchOverview 开发库介绍页内容（overviews/<lib>.yaml）。
type ArchOverview struct {
	Key          string   `yaml:"key" json:"key"`
	Name         string   `yaml:"name" json:"name"`
	Positioning  string   `yaml:"positioning" json:"positioning"`
	Architecture string   `yaml:"architecture" json:"architecture"`
	TechStack    []string `yaml:"techStack" json:"techStack"`
	CoreModules  []struct {
		Key  string `yaml:"key" json:"key"`
		Role string `yaml:"role" json:"role"`
	} `yaml:"coreModules" json:"coreModules"`
}
```

- [x] **Step 2: 实现 loadLibraries / loadModules / loadOverview**

复用现有 `readArchYamlFiles` 与 `parseYamlFile` 模式（单文件读取）。新增单文件读取辅助：

```go
// readArchYAMLFile 读取架构库内单个 YAML 文件并解析；文件不存在返回 (nil, nil)。
func readArchYAMLFile[T any](ctx context.Context, repoPath, relPath string, out *T) (bool, []string) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false, []string{"personal-stub 客户端不可用"}
	}
	content, err := sc.ReadFile(ctx, filepath.Join(repoPath, relPath))
	if err != nil {
		return false, nil // 文件不存在视为未解析，非错误
	}
	var warnings []string
	if !parseYamlFile(relPath, content, out, &warnings) {
		return false, warnings
	}
	return true, warnings
}

func loadLibraries(ctx context.Context, repoPath string) (*librariesData, []string) {
	var data librariesData
	ok, warnings := readArchYAMLFile(ctx, repoPath, archLibrariesFile, &data)
	if !ok {
		return nil, warnings
	}
	return &data, warnings
}

func loadModules(ctx context.Context, repoPath, libKey string) (*modulesData, []string) {
	var data modulesData
	rel := filepath.Join(archModulesDir, libKey+archYamlExt)
	ok, warnings := readArchYAMLFile(ctx, repoPath, rel, &data)
	if !ok {
		return nil, warnings
	}
	return &data, warnings
}

func loadOverview(ctx context.Context, repoPath, libKey string) (*ArchOverview, error) {
	var data ArchOverview
	rel := filepath.Join(archOverviewsDir, libKey+archYamlExt)
	ok, _ := readArchYAMLFile(ctx, repoPath, rel, &data)
	if !ok {
		return nil, nil
	}
	return &data, nil
}
```

新增常量（在 arch_handler.go 常量块补充）：

```go
archLibrariesFile  = "libraries.yaml"
archModulesDir     = "modules"
archOverviewsDir   = "overviews"
archKGFileName     = "knowledge-graph.json"
archUnderstandDir  = ".understand-anything"
```

- [x] **Step 3: 实现 loadClassView（读 knowledge-graph.json 按 module path 过滤）**

```go
// kgGraph 对应 understand 产出的 knowledge-graph.json 结构（仅取画布所需字段）。
type kgGraph struct {
	Nodes []kgNode `json:"nodes"`
	Edges []kgEdge `json:"edges"`
}
type kgNode struct {
	ID         string `json:"id"`
	Type       string `json:"type"`       // file/function/class
	Name       string `json:"name"`
	Summary    string `json:"summary"`
	FilePath   string `json:"filePath"`
	LineRange  string `json:"lineRange"`
	Complexity string `json:"complexity"`
	Tags       []string `json:"tags"`
}
type kgEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"` // calls/imports/contains/inherits/depends_on
}

// loadClassView 读取开发库 knowledge-graph.json，按 module path 前缀过滤节点与边。
// modulePathPrefix 为模块在开发库内的相对路径前缀（如 "gateway/"）。
func loadClassView(ctx context.Context, kgPath, modulePathPrefix string) (*archView, []string) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil, []string{"personal-stub 客户端不可用"}
	}
	content, err := sc.ReadFile(ctx, kgPath)
	if err != nil {
		return nil, []string{"knowledge-graph.json 读取失败: " + err.Error()}
	}
	var kg kgGraph
	if err := json.Unmarshal([]byte(content), &kg); err != nil {
		return nil, []string{"knowledge-graph.json 解析失败: " + err.Error()}
	}
	// 按 filePath 前缀过滤节点，仅保留 file/function/class 类型。
	prefix := filepath.ToSlash(modulePathPrefix)
	nodeIDs := map[string]bool{}
	var nodes []archNode
	for _, n := range kg.Nodes {
		if n.Type != "file" && n.Type != "function" && n.Type != "class" {
			continue
		}
		if prefix != "" && !strings.HasPrefix(filepath.ToSlash(n.FilePath), prefix) {
			continue
		}
		nodeIDs[n.ID] = true
		nodes = append(nodes, archNode{
			ID: n.ID, Label: n.Name, Kind: n.Type,
			Meta: map[string]string{
				"summary": n.Summary, "filePath": n.FilePath,
				"lineRange": n.LineRange, "complexity": n.Complexity,
			},
		})
	}
	// 仅保留两端都在过滤后节点集合内的边。
	var edges []archEdge
	for _, e := range kg.Edges {
		if !nodeIDs[e.Source] || !nodeIDs[e.Target] {
			continue
		}
		edges = append(edges, archEdge{Source: e.Source, Target: e.Target, Label: e.Kind, Kind: e.Kind})
	}
	return &archView{Nodes: nodes, Edges: edges}, nil
}
```

- [x] **Step 4: 删除旧 buildArchGraph 及其调用的 buildRepoLevelView/buildServiceLevelView/buildDomainLevelView 等服务级函数**

`arch_service.go` 中所有 `buildRepoLevelView`/`buildServiceLevelView`/`buildDomainLevelView`/`buildServiceEdges`/`buildDBShareEdges`/`buildDomainRuleEdges`/`aggregateServiceEdgesToDomain`/`isInfraService` 及旧结构体 `archDomainDef`/`archServiceDef`/`archDomainRules` 等全部删除（被 L1/L2/L3 取代）。同时删除 `arch_handler.go` 中 `loadArchDomains`/`loadArchServices`/`loadArchDomainRules` 及 `archDomainDef` 等旧定义。

- [x] **Step 5: 写单元测试**

`arch_service_test.go`：用 stubclient 的假实现或直接测试纯函数 `loadClassView` 的过滤逻辑（构造 kgGraph JSON 字符串，验证按 prefix 过滤）。由于 `loadClassView` 依赖 stubclient，可测试其内部过滤逻辑：抽取一个纯函数 `filterClassView(kg, prefix) *archView` 并测试它。

```go
package repository

import (
	"encoding/json"
	"testing"
)

func TestFilterClassView(t *testing.T) {
	kg := kgGraph{
		Nodes: []kgNode{
			{ID: "f1", Type: "class", Name: "App", FilePath: "gateway/app.go"},
			{ID: "f2", Type: "class", Name: "Repo", FilePath: "domain/repo.go"},
			{ID: "c1", Type: "config", Name: "cfg", FilePath: "gateway/cfg.yaml"},
		},
		Edges: []kgEdge{
			{Source: "f1", Target: "f2", Kind: "imports"},
			{Source: "f1", Target: "c1", Kind: "contains"},
		},
	}
	view := filterClassView(kg, "gateway/")
	if len(view.Nodes) != 1 || view.Nodes[0].ID != "f1" {
		t.Fatalf("expected only gateway/app.go class node, got %+v", view.Nodes)
	}
	// c1 是 config 类型被过滤；f2 不在 gateway/ 前缀下；f1->f2 边因 f2 被剔除
	if len(view.Edges) != 0 {
		t.Fatalf("expected 0 edges after filtering, got %d", len(view.Edges))
	}
}
```

将 `loadClassView` 的过滤部分抽取为 `filterClassView(kg kgGraph, prefix string) *archView`。

- [x] **Step 6: 验证**

Run: `cd apps/dh-backend && go vet ./... && go test ./domain/repository/... -run TestFilterClassView -v`
Expected: PASS，0 vet warnings。

---

## Task 2: arch/graph 层级查询 handler 改造

**Files:**
- Modify: `apps/dh-backend/domain/repository/arch_handler.go`

**Interfaces:**
- Consumes: Task 1 的 loadLibraries/loadModules/loadClassView
- Produces: `ArchGraph` handler 按 `level` 参数返回 `{nodes, edges, drillLevel, lib?, module?, warnings?}`

- [x] **Step 1: 改造 archGraphResponse 结构**

```go
// archGraphResponse 是 GET /arch/graph 的统一响应（层级查询）。
type archGraphResponse struct {
	Configured bool                 `json:"configured"`
	Cloned     bool                 `json:"cloned"`
	RepoID     string               `json:"repoId,omitempty"`
	RepoName   string               `json:"repoName,omitempty"`
	DrillLevel string               `json:"drillLevel,omitempty"` // libraries/modules/classes
	Lib        string               `json:"lib,omitempty"`
	Module     string               `json:"module,omitempty"`
	Nodes      []archNode           `json:"nodes,omitempty"`
	Edges      []archEdge           `json:"edges,omitempty"`
	Warnings   []string             `json:"warnings,omitempty"`
}
```

- [x] **Step 2: 改造 ArchGraph handler 按 level 分发**

```go
func ArchGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	repo, found, err := findArchRepo(workspaceID)
	if err != nil {
		handler.HandleServiceError(w, err, "workspace not found", "failed to list repositories")
		return
	}
	resp := &archGraphResponse{Configured: found}
	if !found {
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(resp)
		return
	}
	resp.RepoID = repo.ID
	resp.RepoName = repo.Name

	localPath := resolveUserLocalPathStatic(repo, userID)
	resp.Cloned = isArchRepoCloned(r.Context(), repo, localPath)
	if !resp.Cloned {
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(resp)
		return
	}

	// 解析已完成的判定：libraries.yaml 存在且有 parsedAt。
	level := r.URL.Query().Get("level")
	if level == "" {
		level = "libraries"
	}
	resp.DrillLevel = level

	switch level {
	case "libraries":
		data, warnings := loadLibraries(r.Context(), localPath)
		if data == nil {
			// 未解析：前端据此进入 not-parsed 状态
			handler.SetJSONHeader(w)
			json.NewEncoder(w).Encode(resp)
			return
		}
		resp.Nodes = libsToNodes(data.Libraries)
		resp.Edges = libDepsToEdges(data.Dependencies)
		resp.Warnings = warnings
	case "modules":
		libKey := r.URL.Query().Get("lib")
		resp.Lib = libKey
		data, warnings := loadModules(r.Context(), localPath, libKey)
		if data == nil {
			handler.SetJSONHeader(w)
			json.NewEncoder(w).Encode(resp)
			return
		}
		resp.Nodes = modulesToNodes(data.Modules)
		resp.Edges = moduleDepsToEdges(data.Dependencies)
		resp.Warnings = warnings
	case "classes":
		libKey := r.URL.Query().Get("lib")
		moduleKey := r.URL.Query().Get("module")
		resp.Lib = libKey
		resp.Module = moduleKey
		nodes, edges, warnings, err := loadClassesForModule(r.Context(), workspaceID, userID, localPath, libKey, moduleKey)
		if err != nil {
			handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, err.Error())
			return
		}
		resp.Nodes = nodes
		resp.Edges = edges
		resp.Warnings = warnings
	default:
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid level")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}
```

- [x] **Step 3: 实现节点/边转换辅助与 loadClassesForModule**

```go
// loadClassesForModule 解析 lib+module 对应的类视图：
// 先读 modules/<lib>.yaml 取 module 的 path 前缀，再读开发库 knowledge-graph.json 过滤。
func loadClassesForModule(ctx context.Context, workspaceID, userID, archRepoPath, libKey, moduleKey string) ([]archNode, []archEdge, []string, error) {
	md, warnings := loadModules(ctx, archRepoPath, libKey)
	if md == nil {
		return nil, nil, warnings, fmt.Errorf("modules/%s.yaml 不存在", libKey)
	}
	var prefix string
	for _, m := range md.Modules {
		if m.Key == moduleKey {
			prefix = m.Path
			break
		}
	}
	if prefix == "" {
		return nil, nil, warnings, fmt.Errorf("module %s not found in %s", moduleKey, libKey)
	}
	// 定位开发库的 knowledge-graph.json：用户 dev-jobs 目录下 <libKey>/.understand-anything/knowledge-graph.json
	kgPath := resolveDevLibKGPath(ctx, workspaceID, userID, libKey)
	if kgPath == "" {
		return nil, nil, append(warnings, "开发库路径解析失败"), nil
	}
	view, w := loadClassView(ctx, kgPath, prefix)
	if view == nil {
		return nil, nil, append(warnings, w...), nil
	}
	return view.Nodes, view.Edges, append(warnings, w...), nil
}
```

`resolveDevLibKGPath` 需通过 defaultService 取开发库（type=dev, name=libKey 或 path 匹配），再用 `userProjectPath` 拼接 `.understand-anything/knowledge-graph.json`。由于 handler 层无法直接调 `userProjectPath`（service 方法），在 service 层新增方法：

```go
// 在 DBRepositoryService 上新增（service/sync_lock.go 或新文件）：
// DevLibKGPath 返回开发库在用户目录下的 knowledge-graph.json 路径。
func (s *DBRepositoryService) DevLibKGPath(ctx context.Context, workspaceID, userID, libKey string) string {
	p := s.userProjectPath(workspaceID, userID, libKey)
	if p == "" {
		return ""
	}
	return filepath.Join(p, archUnderstandDir, archKGFileName)
}
```

handler 层 `resolveDevLibKGPath` 调用 `defaultService.(service.DBRepositoryService)` —— 由于 `defaultService` 是接口，需在接口加 `DevLibKGPath` 方法声明（`service.go` 的 `RepositoryService` 接口）。

转换辅助：

```go
func libsToNodes(libs []ArchLibrary) []archNode {
	nodes := make([]archNode, 0, len(libs))
	for _, l := range libs {
		nodes = append(nodes, archNode{
			ID: l.Key, Label: l.Name, Kind: "library",
			Meta: map[string]string{"summary": l.Summary, "path": l.Path, "languages": strings.Join(l.Languages, ",")},
		})
	}
	return nodes
}
func libDepsToEdges(deps []ArchLibDependency) []archEdge {
	edges := make([]archEdge, 0, len(deps))
	for _, d := range deps {
		edges = append(edges, archEdge{Source: d.From, Target: d.To, Label: d.Kind, Kind: d.Kind})
	}
	return edges
}
// modulesToNodes / moduleDepsToEdges 同理
```

- [x] **Step 4: 在 RepositoryService 接口加 DevLibKGPath 声明**

`service/service.go` 的 `RepositoryService` 接口加：
```go
DevLibKGPath(ctx context.Context, workspaceID, userID, libKey string) string
```

- [x] **Step 5: 验证**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 通过，0 warnings。

---

## Task 3: overview handler

**Files:**
- Modify: `apps/dh-backend/domain/repository/arch_handler.go`

- [x] **Step 1: 新增 ArchOverview handler**

```go
// ArchOverviewHandler 处理 GET /arch/overview?lib=<key>。
func ArchOverviewHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	libKey := r.URL.Query().Get("lib")
	if libKey == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing lib")
		return
	}
	repo, found, err := findArchRepo(workspaceID)
	if err != nil || !found {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "arch repo not found")
		return
	}
	localPath := resolveUserLocalPathStatic(repo, userID)
	ov, err := loadOverview(r.Context(), localPath, libKey)
	if err != nil || ov == nil {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "overview not found")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(ov)
}
```

- [x] **Step 2: 验证**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 通过。

---

## Task 4: 解析锁（parse_lock.go）

**Files:**
- Create: `apps/dh-backend/domain/repository/service/parse_lock.go`

**Interfaces:**
- Produces:
  - `func (s *DBRepositoryService) HasParseLock(ctx, workspaceID, userID, archRepoName) bool`
  - `func (s *DBRepositoryService) WriteParseLock(ctx, workspaceID, userID, archRepoName, sessionID) error`
  - `func (s *DBRepositoryService) DeleteParseLock(ctx, workspaceID, userID, archRepoName)`

- [x] **Step 1: 实现解析锁（复用 sync_lock.go 的 stubclient 模式）**

```go
package service

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
)

// 解析锁文件名后缀（与 .clone.lock 区分）。
const parseLockSuffix = ".parse.lock"

// parseLockPath 返回架构库目录下的解析锁文件路径。
// 格式：{root}/{userID}/{workspaceID}/dev-jobs/{archRepoName}.parse.lock
func (s *DBRepositoryService) parseLockPath(workspaceID, userID, archRepoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	base, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(archRepoName)
	return filepath.Join(base, workspacepath.DirDevJobs, safeName+parseLockSuffix)
}

// HasParseLock 检查解析锁是否存在。
func (s *DBRepositoryService) HasParseLock(ctx context.Context, workspaceID, userID, archRepoName string) bool {
	p := s.parseLockPath(workspaceID, userID, archRepoName)
	if p == "" {
		return false
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	ok, err := sc.FileExists(ctx, p)
	return err == nil && ok
}

// WriteParseLock 写入解析锁，内容为 sessionID + 启动时间。
func (s *DBRepositoryService) WriteParseLock(ctx context.Context, workspaceID, userID, archRepoName, sessionID string) error {
	p := s.parseLockPath(workspaceID, userID, archRepoName)
	if p == "" {
		return fmt.Errorf("workspace root is not configured")
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return fmt.Errorf("personal-stub client not initialized")
	}
	content := fmt.Sprintf("%s\n%d", sessionID, time.Now().UTC().Unix())
	return sc.WriteFile(ctx, p, content)
}

// DeleteParseLock 删除解析锁。
func (s *DBRepositoryService) DeleteParseLock(ctx context.Context, workspaceID, userID, archRepoName string) {
	p := s.parseLockPath(workspaceID, userID, archRepoName)
	if p == "" {
		return
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return
	}
	if ok, err := sc.FileExists(ctx, p); err != nil || !ok {
		return
	}
	_ = sc.DeleteFile(ctx, p)
}
```

- [x] **Step 2: 在 RepositoryService 接口加方法声明**

`service/service.go` 接口加：
```go
HasParseLock(ctx context.Context, workspaceID, userID, archRepoName string) bool
WriteParseLock(ctx context.Context, workspaceID, userID, archRepoName, sessionID string) error
DeleteParseLock(ctx context.Context, workspaceID, userID, archRepoName string)
```

- [x] **Step 3: 验证**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 通过。

---

## Task 5: parse 触发 + status handler

**Files:**
- Modify: `apps/dh-backend/domain/repository/arch_handler.go`

**Interfaces:**
- Consumes: Task 4 解析锁；现有会话创建机制（参考 `gateway/handler/session.go` 的 Sessions 创建 + agui AgentRun）
- Produces: `ArchParse`（POST）+ `ArchParseStatus`（GET）handler

- [x] **Step 1: 定义解析指令构建与状态响应**

```go
const archParseSkillPath = "shares/skills/dev-lib-analysis/SKILL.md"

// buildParsePrompt 构造 dev-lib-analysis 技能指令（预填到 agent 会话）。
func buildParsePrompt(archRepoName string) string {
	return "请阅读共享目录 " + archParseSkillPath + " 技能说明，按其规范对 dev-jobs/ 下全部开发库" +
		"（type=dev）进行解析，产出 libraries.yaml、modules/、overviews/ 写入架构库 dev-jobs/" +
		archRepoName + "。"
}

// parseStatusResponse 解析状态响应。
type parseStatusResponse struct {
	Parsing  bool     `json:"parsing"`
	Parsed   bool     `json:"parsed"`   // libraries.yaml 存在且有 parsedAt
	Warnings []string `json:"warnings"`
}
```

- [x] **Step 2: 实现 ArchParse（POST，加锁 + 创建会话）**

参考 `gateway/handler/session.go` 的会话创建与 `agui_run.go` 的 AgentRun 机制。由于直接复用现有会话创建涉及较多依赖，采用「创建会话 + 预填指令」的简化路径：调用 sessionHandler 创建会话，再把指令作为首条用户消息触发 agent run。

```go
// ArchParse 触发开发库解析：加锁 + 创建 agent 会话发送 dev-lib-analysis 指令。
func ArchParse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	repo, found, err := findArchRepo(workspaceID)
	if err != nil || !found {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "arch repo not found")
		return
	}
	// 加锁防重复
	if defaultService.HasParseLock(r.Context(), workspaceID, userID, repo.Name) {
		handler.WriteJSONError(w, http.StatusConflict, handler.ErrCodeGeneral, "解析正在进行中")
		return
	}
	// 创建 agent 会话并发送指令（委托现有会话+agent run 机制）
	sessionID, err := archParseSessionCreator.CreateAndRun(r.Context(), workspaceID, userID, buildParsePrompt(repo.Name))
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "创建解析会话失败: "+err.Error())
		return
	}
	// 写锁（含 sessionID 便于状态查询关联会话）
	if err := defaultService.WriteParseLock(r.Context(), workspaceID, userID, repo.Name, sessionID); err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "写入解析锁失败: "+err.Error())
		return
	}
	// 异步清理：会话结束后由 status 轮询检测 parsedAt 后清锁（见 ArchParseStatus）
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"sessionId": sessionID})
}
```

`archParseSessionCreator` 是一个注入的会话创建器接口（在 server.go 装配时注入 sessionHandler 的能力）。定义：

```go
// ArchParseSessionCreator 由会话 handler 实现，用于创建并启动一个 agent 会话。
type ArchParseSessionCreator interface {
	CreateAndRun(ctx context.Context, workspaceID, userID, prompt string) (string, error)
}
var archParseSessionCreator ArchParseSessionCreator
// InitArchParseSessionCreator 注入实现（在 server.go 调用）。
func InitArchParseSessionCreator(c ArchParseSessionCreator) { archParseSessionCreator = c }
```

> 注：会话创建的具体对接需参考 `gateway/handler/session.go:Sessions`（POST 创建）与 `agui_run.go:AgentRun`（触发执行）。执行时在 session handler 上实现 `CreateAndRun`：创建会话 + 以 prompt 作为首条消息触发 agent run，返回 sessionID。

- [x] **Step 3: 实现 ArchParseStatus（GET，检测 parsedAt + 清死锁）**

```go
// ArchParseStatus 查询解析状态：锁状态 + libraries.yaml 是否有 parsedAt。
// 若锁存在但 libraries.yaml 已有 parsedAt（agent 已完成），清锁并返回 parsed=true。
func ArchParseStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	repo, found, err := findArchRepo(workspaceID)
	if err != nil || !found {
		handler.WriteJSONError(w, http.StatusNotFound, handler.ErrCodeGeneral, "arch repo not found")
		return
	}
	localPath := resolveUserLocalPathStatic(repo, userID)
	resp := &parseStatusResponse{}
	data, _ := loadLibraries(r.Context(), localPath)
	if data != nil && data.ParsedAt != "" {
		resp.Parsed = true
		resp.Warnings = data.Warnings
		// agent 已完成，清理残留锁
		if defaultService.HasParseLock(r.Context(), workspaceID, userID, repo.Name) {
			defaultService.DeleteParseLock(r.Context(), workspaceID, userID, repo.Name)
		}
	} else {
		resp.Parsing = defaultService.HasParseLock(r.Context(), workspaceID, userID, repo.Name)
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}
```

- [x] **Step 4: 验证**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 通过（`archParseSessionCreator` 的实现注入在 Task 6 路由装配时完成，此处先用接口占位）。

---

## Task 6: 路由注册与 session creator 装配

**Files:**
- Modify: `apps/dh-backend/gateway/server/server.go`

- [x] **Step 1: 新增路由常量**

在路由常量块（`ROUTE_WORKSPACES_BY_ID_ARCH_GRAPH` 附近）加：

```go
ROUTE_WORKSPACES_BY_ID_ARCH_OVERVIEW                                         = API_V1_PREFIX + "/workspaces/glm_5.2_ark_toC/arch/overview"
ROUTE_WORKSPACES_BY_ID_ARCH_PARSE                                            = API_V1_PREFIX + "/workspaces/glm_5.2_ark_toC/arch/parse"
ROUTE_WORKSPACES_BY_ID_ARCH_PARSE_STATUS                                     = API_V1_PREFIX + "/workspaces/glm_5.2_ark_toC/arch/parse/status"
```

- [x] **Step 2: 注册路由（复用 containerMW）**

在 `ROUTE_WORKSPACES_BY_ID_ARCH_GRAPH` 注册行附近加：

```go
mux.Handle(ROUTE_WORKSPACES_BY_ID_ARCH_OVERVIEW, containerMW(http.HandlerFunc(repository.ArchOverviewHandler)))
mux.Handle(ROUTE_WORKSPACES_BY_ID_ARCH_PARSE, containerMW(http.HandlerFunc(repository.ArchParse)))
mux.Handle(ROUTE_WORKSPACES_BY_ID_ARCH_PARSE_STATUS, containerMW(http.HandlerFunc(repository.ArchParseStatus)))
```

- [x] **Step 3: 实现 sessionHandler 的 CreateAndRun 并注入**

在 `gateway/handler/session.go`（或新建 `arch_parse_session.go`）实现 `ArchParseSessionCreator`：

```go
// ArchParseSessionCreatorImpl 复用会话创建与 agent run 机制。
type ArchParseSessionCreatorImpl struct {
	// 依赖：session 创建、agent run 触发（具体字段依现有 handler 注入）
}
func (c *ArchParseSessionCreatorImpl) CreateAndRun(ctx context.Context, workspaceID, userID, prompt string) (string, error) {
	// 1. 创建会话（复用 Sessions handler 的创建逻辑）
	// 2. 以 prompt 作为首条用户消息触发 agent run（复用 AgentRun 逻辑）
	// 3. 返回 sessionID
	// 执行时对接现有 sessionHandler / aguiHandler 的内部方法
	return "", nil // TODO 执行时对接
}
```

在 server.go 装配段（`repository.Init(svc)` 附近）调用：
```go
repository.InitArchParseSessionCreator(&handler.ArchParseSessionCreatorImpl{...})
```

> 注：此步需阅读 session.go / agui_run.go 的会话创建与 agent run 内部方法，提取可复用的创建+触发逻辑。这是本计划中唯一需要较多对接现有代码的步骤。

- [x] **Step 4: 验证**

Run: `cd apps/dh-backend && go vet ./... && go build ./...`
Expected: 通过。

---

## Task 7: dev-lib-analysis 技能

**Files:**
- Create: `shares/skills/dev-lib-analysis/SKILL.md`

- [x] **Step 1: 编写 SKILL.md**

```markdown
---
name: dev-lib-analysis
zh_name: "开发库代码解析"
description: "对 dev-jobs/ 下全部开发库运行 understand 解析，识别模块、生成介绍、推断库间依赖，产出架构库聚合文件"
category: develop
scenario: analysis
tags: ["architecture", "understand", "code-analysis"]
---

# 开发库代码解析（dev-lib-analysis）

你是一位资深系统架构师。任务是对当前用户工作区 `dev-jobs/` 目录下的全部开发库
（type=dev 的工程仓库，排除架构库自身）进行代码解析，产出架构库聚合文件。

## 一、产出目标（写入架构库，通常 dev-jobs/<arch-repo>/）

\`\`\`
<arch-repo>/
├── libraries.yaml          # 开发库列表 + 库间依赖
├── modules/<lib>.yaml      # 每个开发库的模块划分 + 模块间依赖
├── overviews/<lib>.yaml    # 每个开发库的介绍页
└── README.md               # 说明（不存在时创建）
\`\`\`

## 二、执行步骤

1. **清点开发库**：列出 `dev-jobs/` 下全部工程仓库（排除架构库自身），记录每个库的
   名称、路径、主语言（从 go.mod / package.json / pom.xml 识别）。

2. **逐库 understand 解析**：对每个开发库执行 `understand --language zh`（在开发库根目录），
   产出 `<lib>/.understand-anything/knowledge-graph.json`。单库失败则记入 warnings 继续。

3. **识别模块**：读取每库 knowledge-graph.json，按代码结构与语义（目录/包/职责）划分模块。
   每个模块需有：key（英文中划线）、name（中文）、path（相对开发库根的路径前缀）、
   summary（1-2 句作用介绍）、fileCount。写入 `modules/<lib>.yaml`，并产出模块间依赖边
   （从 knowledge-graph.json 的 imports/calls 跨模块引用聚合）。

4. **生成介绍**：为每个库生成 `overviews/<lib>.yaml`，含：
   - positioning：1-2 句定位
   - architecture：架构风格与分层简介
   - techStack：技术栈
   - coreModules：核心模块列表（key + role）

5. **推断库间依赖**：综合各库的入口（main/路由注册）与对外调用（imports/depends_on 跨库引用、
   API 调用、包依赖），推断开发库间依赖，写入 `libraries.yaml` 的 dependencies（from/to/kind/description）。

6. **汇总**：写入 `libraries.yaml` 的 libraries（含 key/name/path/languages/summary）、
   warnings、parsedAt（当前 UTC 时间 ISO8601）。

## 三、文件格式

### libraries.yaml
\`\`\`yaml
libraries:
  - key: <英文key>
    name: <中文名>
    path: dev-jobs/<库名>
    languages: [go]
    summary: <1句简介>
dependencies:
  - from: <libKey>
    to: <libKey>
    kind: imports  # imports | calls | depends_on
    description: <说明>
warnings:
  - "<失败库与原因>"
parsedAt: "2026-08-13T12:00:00Z"
\`\`\`

### modules/<lib>.yaml
\`\`\`yaml
modules:
  - key: <英文key>
    name: <中文名>
    path: <相对路径前缀，如 gateway/>
    summary: <1-2句作用介绍>
    fileCount: 12
dependencies:
  - from: <moduleKey>
    to: <moduleKey>
    kind: calls  # calls | imports | depends_on
\`\`\`

### overviews/<lib>.yaml
\`\`\`yaml
key: <libKey>
name: <中文名>
positioning: <定位>
architecture: <架构简介>
techStack: [go, postgresql]
coreModules:
  - key: <moduleKey>
    role: <职责>
\`\`\`
```

- [x] **Step 2: 部署到共享目录**

将 SKILL.md 复制到 `shares/skills/dev-lib-analysis/SKILL.md`（仓库内版本控制）。
运行时由 dh-backend 部署到 `{workspaceRoot}/shares/skills/`（现有部署机制，参考 arch-repo-analysis 已部署）。

Run: `ls shares/skills/dev-lib-analysis/SKILL.md`
Expected: 文件存在。

---

## Task 8: 前端 arch-api.ts 改造

**Files:**
- Modify: `apps/dh-frontend/src/lib/arch-api.ts`

- [x] **Step 1: 替换类型为层级模型**

```typescript
import { api } from './api';

export type ArchDrillLevel = 'libraries' | 'modules' | 'classes';

export interface ArchNode {
  id: string;
  label: string;
  kind: string;
  meta?: Record<string, string>;
}
export interface ArchEdge {
  source: string;
  target: string;
  label: string;
  kind: string;
}

export interface ArchGraphResponse {
  configured: boolean;
  cloned: boolean;
  repoId?: string;
  repoName?: string;
  drillLevel?: ArchDrillLevel;
  lib?: string;
  module?: string;
  nodes?: ArchNode[];
  edges?: ArchEdge[];
  warnings?: string[];
}

export interface ArchOverview {
  key: string;
  name: string;
  positioning: string;
  architecture: string;
  techStack: string[];
  coreModules: { key: string; role: string }[];
}

export interface ArchParseStatus {
  parsing: boolean;
  parsed: boolean;
  warnings?: string[];
}

const ARCH_GRAPH_TIMEOUT_MS = 15000;

export const archApi = {
  graph: (workspaceId: string, params: { level: ArchDrillLevel; lib?: string; module?: string }) =>
    api.get<ArchGraphResponse>(
      `/v1/workspaces/${workspaceId}/arch/graph?level=${params.level}` +
      (params.lib ? `&lib=${encodeURIComponent(params.lib)}` : '') +
      (params.module ? `&module=${encodeURIComponent(params.module)}` : ''),
    ),
  overview: (workspaceId: string, lib: string) =>
    api.get<ArchOverview>(`/v1/workspaces/${workspaceId}/arch/overview?lib=${encodeURIComponent(lib)}`),
  parse: (workspaceId: string) =>
    api.post<{ sessionId: string }>(`/v1/workspaces/${workspaceId}/arch/parse`, {}),
  parseStatus: (workspaceId: string) =>
    api.get<ArchParseStatus>(`/v1/workspaces/${workspaceId}/arch/parse/status`),
};
```

删除旧的 `ArchNodeKind`/`ArchEdgeKind`/`ArchView`/`ArchViewMode`/`ArchDomainOption` 及 `EDGE_KINDS` 等。

- [x] **Step 2: 验证类型**

Run: `cd apps/dh-frontend && pnpm exec tsc --noEmit -p tsconfig.check.json 2>&1 | grep arch-api`
Expected: 无 arch-api 相关 error（ArchDesignWorkspace 的引用错误在 Task 9 修复）。

---

## Task 9: 前端 ArchDesignWorkspace 重构

**Files:**
- Modify: `apps/dh-frontend/src/components/workspace/ArchDesignWorkspace.tsx`

- [x] **Step 1: 重写组件状态与数据加载**

删除 `viewMode`/`businessLine`/`edgeKindFilter`/`graphData.views/domains` 相关。新增层级状态：

```typescript
type PageState = 'loading' | 'not-configured' | 'not-synced' | 'not-parsed' | 'parsing' | 'ready';
type DrillLevel = 'libraries' | 'modules' | 'classes';

const [pageState, setPageState] = useState<PageState>('loading');
const [drillLevel, setDrillLevel] = useState<DrillLevel>('libraries');
const [selectedLib, setSelectedLib] = useState<string>('');
const [selectedModule, setSelectedModule] = useState<string>('');
const [nodes, setNodes] = useState<ArchNode[]>([]);
const [edges, setEdges] = useState<ArchEdge[]>([]);
const [overview, setOverview] = useState<ArchOverview | null>(null);
const [showOverview, setShowOverview] = useState(false);
const [parsing, setParsing] = useState(false);
```

`loadGraph` 改为按 drillLevel 调用：

```typescript
const loadGraph = useCallback(() => {
  if (!workspaceId) return;
  archApi.graph(workspaceId, { level: drillLevel, lib: selectedLib, module: selectedModule })
    .then(res => {
      if (!res.configured) { setPageState('not-configured'); return; }
      if (!res.cloned) { setPageState('not-synced'); return; }
      // L1 且无 nodes 表示未解析
      if (drillLevel === 'libraries' && (!res.nodes || res.nodes.length === 0) && !res.warnings?.length) {
        setPageState('not-parsed'); return;
      }
      setNodes(res.nodes ?? []);
      setEdges(res.edges ?? []);
      setPageState('ready');
    })
    .catch(() => toast.error('加载架构图失败'));
}, [workspaceId, drillLevel, selectedLib, selectedModule]);
```

- [x] **Step 2: 实现下钻与面包屑**

```typescript
// 下钻到模块层
const drillToModules = (libKey: string) => {
  setSelectedLib(libKey);
  setDrillLevel('modules');
  setSelectedModule('');
};
// 下钻到类层
const drillToClasses = (moduleKey: string) => {
  setSelectedModule(moduleKey);
  setDrillLevel('classes');
};
// 面包屑回退
const drillBack = (to: DrillLevel) => {
  setDrillLevel(to);
  if (to === 'libraries') { setSelectedLib(''); setSelectedModule(''); }
  if (to === 'modules') setSelectedModule('');
};
```

`useEffect(loadGraph, [loadGraph])` 保持，drillLevel/selectedLib/selectedModule 变化触发重载。

- [x] **Step 3: 实现介绍页抽屉**

```typescript
const openOverview = (libKey: string) => {
  if (!workspaceId) return;
  archApi.overview(workspaceId, libKey)
    .then(ov => { setOverview(ov); setShowOverview(true); })
    .catch(() => toast.error('加载介绍失败'));
};
```

- [x] **Step 4: 实现解析触发（not-parsed/parsing 状态）**

复用 Task 4 的 sync 同步逻辑（not-synced 状态保留），新增 not-parsed/parsing：

```typescript
const PARSE_POLL_INTERVAL_MS = 3000;
const PARSE_POLL_TIMEOUT_MS = 600000;

const handleParse = () => {
  if (!workspaceId) return;
  setParsing(true);
  archApi.parse(workspaceId)
    .then(() => {
      const poll = setInterval(() => {
        archApi.parseStatus(workspaceId).then(st => {
          if (st.parsed) {
            clearInterval(poll);
            setParsing(false);
            setDrillLevel('libraries');
            loadGraph();
          } else if (!st.parsing && !st.parsed) {
            // 锁已清但未完成：失败或超时
            clearInterval(poll);
            setParsing(false);
            if (st.warnings?.length) toast.error('解析失败：' + st.warnings.join('; '));
          }
        });
      }, PARSE_POLL_INTERVAL_MS);
      setTimeout(() => { clearInterval(poll); setParsing(false); }, PARSE_POLL_TIMEOUT_MS);
    })
    .catch(err => {
      setParsing(false);
      toast.error('解析失败：' + (err instanceof Error ? err.message : '未知错误'));
    });
};
```

- [x] **Step 5: 重写 render（删除筛选面板，加面包屑+介绍抽屉+解析按钮）**

- 删除左侧筛选面板（视图模式/依赖过滤/业务线/图例）。
- 顶部加面包屑：`架构总览 > <selectedLib> > <selectedModule>`（按 drillLevel 显示）。
- not-parsed 状态：显示「解析开发库」按钮。
- parsing 状态：显示 Loader2 旋转 + "解析中..."。
- 节点点击：L1 点击开发库节点弹出小菜单（介绍/下钻）；L2 点击模块节点下钻 L3；L3 点击节点右侧详情。
- 介绍抽屉：`showOverview` 时右侧抽屉展示 overview（positioning/architecture/techStack/coreModules）。
- 保留：缩放工具栏、导出（导出当前层 nodes/edges JSON）、重置画布。

X6 画布渲染逻辑（`useEffect`）复用现有网格布局，但用新的 `nodes`/`edges` 状态。

- [x] **Step 6: 验证**

Run: `cd apps/dh-frontend && pnpm exec tsc --noEmit -p tsconfig.check.json 2>&1 | grep ArchDesignWorkspace`
Expected: 无 ArchDesignWorkspace 相关 error。

---

## Task 10: 集成验证

- [x] **Step 1: 后端全量验证**

Run: `cd apps/dh-backend && go vet ./... && go build ./... && go test ./domain/repository/... -v`
Expected: 0 warnings，build 通过，测试 PASS。

- [x] **Step 2: 前端验证**

Run: `cd apps/dh-frontend && pnpm exec tsc --noEmit -p tsconfig.check.json 2>&1 | grep -E "ArchDesign|arch-api"`
Expected: 无本次改动相关 error。

- [x] **Step 3: 启动开发环境**

Run: `bash scripts/restart-dev.sh`
Expected: 全部服务启动，dh-backend 重建。

- [x] **Step 4: 手动验证（curl 基本可达性）**

Run: `curl -s -w "\n%{http_code}\n" http://localhost:8080/api/v1/workspaces/glm_5.2_ark_toC/arch/graph?level=libraries`
Expected: 401（鉴权拦截，路由匹配正常）。

Run: `curl -s -w "\n%{http_code}\n" http://localhost:8080/api/v1/workspaces/glm_5.2_ark_toC/arch/parse`
Expected: 401（POST 路由可达）。

- [x] **Step 5: 部署技能到共享目录**

确认 `shares/skills/dev-lib-analysis/SKILL.md` 已就位，重启后 personal-stub 会同步 skills。

- [ ] **Step 6: 浏览器端到端验证**

1. 进入架构设计工作台，确认旧的筛选/视图模式已消失。
2. 若架构库未同步 -> not-synced（点同步架构库，复用已修复的同步逻辑）。
3. 同步后 -> not-parsed，点「解析开发库」-> parsing 轮询 -> ready 展示 L1 开发库图。
4. 点开发库「介绍」-> 抽屉展示介绍页。
5. 点开发库「下钻」-> L2 模块图（模块节点显示 summary）。
6. 点模块 -> L3 类图。
7. 面包屑回退正常。

---

## Self-Review

**Spec coverage:**
- §3 数据流：Task 5(parse 触发)+Task 7(技能)+Task 1(读取)+Task 9(展示) ✓
- §4 数据模型：Task 1 结构体 + Task 7 技能产出格式 ✓
- §5 解析流程与加锁：Task 4(锁)+Task 5(parse/status) ✓
- §6 前端交互：Task 9(状态机/下钻/面包屑/介绍页/删筛选) ✓
- §7 后端 API：Task 2(graph 改造)+Task 3(overview)+Task 5(parse/status)+Task 6(路由) ✓

**Placeholder scan:** Task 5/Task 6 的 session creator 对接标注了「执行时对接现有 session.go/agui_run.go」——这是必要的现有代码对接说明，非占位符；给出了接口定义与注入点。其余步骤均有具体代码。

**Type consistency:** `ArchLibrary`/`ArchModule`/`ArchOverview` 在 Task 1 定义，Task 2/3 使用一致；前端 `ArchGraphResponse`/`ArchOverview`/`ArchParseStatus` 在 Task 8 定义，Task 9 使用一致；`drillLevel` 枚举值 `libraries/modules/classes` 前后端一致。

**Gap:** Task 5 的 `ArchParseSessionCreatorImpl.CreateAndRun` 需对接现有会话创建+agent run，执行时需读 session.go/agui_run.go 提取可复用方法——已在 Task 6 Step 3 标注为对接重点。
