package repository

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"gopkg.in/yaml.v3"
)

// 架构库目录/文件名常量（与 arch-repo-analysis skill 的产出结构保持一致）。
// L1=libraries.yaml，L2=modules/<lib>.yaml，介绍页=overviews/<lib>.yaml，
// L3=knowledge-graph.json（位于 .understand-anything/ 下）。
const (
	archLibrariesFile = "libraries.yaml"
	archModulesDir    = "modules"
	archOverviewsDir  = "overviews"
	archKGFileName    = "knowledge-graph.json"
	archUnderstandDir = ".understand-anything"
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

type archDomainOption struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// archGraphResponse 是 GET /arch/graph 的统一响应：
// configured=false 表示空间未配置架构库；cloned=false 表示架构库尚未同步到当前用户目录。
type archGraphResponse struct {
	Configured bool                 `json:"configured"`
	Cloned     bool                 `json:"cloned"`
	RepoID     string               `json:"repoId,omitempty"`
	RepoName   string               `json:"repoName,omitempty"`
	Views      map[string]*archView `json:"views,omitempty"`
	Domains    []archDomainOption   `json:"domains,omitempty"`
	Warnings   []string             `json:"warnings,omitempty"`
}

// ArchGraph 处理 GET /api/v1/workspaces/{id}/arch/graph。
// 读取当前用户目录下架构库（type=arch）的 YAML 元数据，构建三视图架构图数据。
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

	// Task 2 rewrites this handler for level-based query
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
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

// readArchYamlFiles 读取架构库某子目录下的全部 .yaml 文件（文件名 -> 内容）。
// 目录不存在时返回空 map，不视为错误（架构库可能尚未生成该目录）。
func readArchYamlFiles(ctx context.Context, repoPath, subdir string) (map[string]string, []string) {
	files := map[string]string{}
	var warnings []string
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return files, []string{"personal-stub 客户端不可用"}
	}
	dir := filepath.Join(repoPath, subdir)
	entries, err := sc.ListDir(ctx, dir)
	if err != nil {
		return files, nil
	}
	for _, entry := range entries {
		if entry.IsDir || !strings.HasSuffix(entry.Name, archYamlExt) {
			continue
		}
		content, readErr := sc.ReadFile(ctx, filepath.Join(dir, entry.Name))
		if readErr != nil {
			warnings = append(warnings, subdir+"/"+entry.Name+" 读取失败")
			continue
		}
		files[entry.Name] = content
	}
	return files, warnings
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
