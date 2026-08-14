package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"gopkg.in/yaml.v3"
)

// 架构库目录/文件名常量（与 arch-repo-analysis skill 的产出结构保持一致）。
// L1=libraries.yaml，L2=modules/<lib>.yaml，介绍页=overviews/<lib>.yaml。
// L3 的 knowledge-graph.json 目录/文件名常量见 go-sdk 的 repository.ArchUnderstandDir/ArchKGFileName。
const (
	archLibrariesFile = "libraries.yaml"
	archModulesDir    = "modules"
	archOverviewsDir  = "overviews"
	archYamlExt       = ".yaml"
)

// ── 响应结构 ──

type archNode struct {
	ID           string            `json:"id"`
	Label        string            `json:"label"`
	Kind         string            `json:"kind"`
	BusinessLine string            `json:"businessLine,omitempty"`
	Meta         map[string]string `json:"meta,omitempty"`
}

type archEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"`
	Kind   string `json:"kind"`
}

type archView struct {
	Nodes []archNode `json:"nodes"`
	Edges []archEdge `json:"edges"`
}

// archGraphResponse 是 GET /arch/graph 的统一响应（层级查询）。
type archGraphResponse struct {
	Configured bool       `json:"configured"`
	Cloned     bool       `json:"cloned"`
	RepoID     string     `json:"repoId,omitempty"`
	RepoName   string     `json:"repoName,omitempty"`
	DrillLevel string     `json:"drillLevel,omitempty"` // libraries/modules/classes
	Lib        string     `json:"lib,omitempty"`
	Module     string     `json:"module,omitempty"`
	Nodes      []archNode `json:"nodes,omitempty"`
	Edges      []archEdge `json:"edges,omitempty"`
	Warnings   []string   `json:"warnings,omitempty"`
}

// ArchGraph 处理 GET /api/v1/workspaces/{id}/arch/graph。
// 按 level 参数（libraries/modules/classes）返回对应层级的节点与边：
// L1=开发库层（libraries.yaml）、L2=模块层（modules/<lib>.yaml）、
// L3=类视图（开发库 .understand-anything/knowledge-graph.json 按模块路径过滤）。
// 架构合规：文件读取经 stubclient 委托 personal-stub，不直接访问文件系统。
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

// resolveDevLibKGPath 定位开发库在用户目录下的 knowledge-graph.json 路径。
// 委托 service 层拼接 dev-jobs/<libKey>/.understand-anything/knowledge-graph.json。
func resolveDevLibKGPath(ctx context.Context, workspaceID, userID, libKey string) string {
	return defaultService.DevLibKGPath(ctx, workspaceID, userID, libKey)
}

// libsToNodes 将开发库列表转换为画布节点。
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

// libDepsToEdges 将开发库间依赖转换为画布边。
func libDepsToEdges(deps []ArchLibDependency) []archEdge {
	edges := make([]archEdge, 0, len(deps))
	for _, d := range deps {
		edges = append(edges, archEdge{Source: d.From, Target: d.To, Label: d.Kind, Kind: d.Kind})
	}
	return edges
}

// modulesToNodes 将模块列表转换为画布节点。
func modulesToNodes(mods []ArchModule) []archNode {
	nodes := make([]archNode, 0, len(mods))
	for _, m := range mods {
		nodes = append(nodes, archNode{
			ID: m.Key, Label: m.Name, Kind: "module",
			Meta: map[string]string{"summary": m.Summary, "path": m.Path, "fileCount": strconv.Itoa(m.FileCount)},
		})
	}
	return nodes
}

// moduleDepsToEdges 将模块间依赖转换为画布边。
func moduleDepsToEdges(deps []ArchModuleDependency) []archEdge {
	edges := make([]archEdge, 0, len(deps))
	for _, d := range deps {
		edges = append(edges, archEdge{Source: d.From, Target: d.To, Label: d.Kind, Kind: d.Kind})
	}
	return edges
}

// findArchRepo 返回工作空间内第一个架构库（type=arch）。
func findArchRepo(workspaceID string) (repository.Repository, bool, error) {
	repos, err := defaultService.List(workspaceID)
	if err != nil {
		return repository.Repository{}, false, err
	}
	for _, repo := range repos {
		if repo.Type == repository.RepoTypeArch {
			return repo, true, nil
		}
	}
	return repository.Repository{}, false, nil
}

// isArchRepoCloned 判定架构库在当前用户目录下是否已克隆。
func isArchRepoCloned(ctx context.Context, repo repository.Repository, localPath string) bool {
	if localPath == "" || repo.CloneStatus != repository.CloneStatusCloned {
		return false
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	fi, err := sc.FileInfo(ctx, localPath)
	return err == nil && fi.Exists && fi.IsDir
}

// parseYamlFile 解析单个 YAML 文件；失败时记录 warning 并跳过（不阻断整体出图）。
func parseYamlFile[T any](fileName, content string, out *T, warnings *[]string) bool {
	if err := yaml.Unmarshal([]byte(content), out); err != nil {
		log.Printf("[ArchGraph] parse %s failed: %v", fileName, err)
		*warnings = append(*warnings, fileName+" 解析失败，已跳过")
		return false
	}
	return true
}
