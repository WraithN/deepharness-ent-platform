package project

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/project/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/project"
)

var defaultProjectService = service.NewMockProjectService()

// Projects 处理项目集合请求：GET 列表。
func Projects(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		filter := parseProjectFilter(r)
		projects, err := defaultProjectService.ListProjects(filter)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list projects"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(projects)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// ProjectByID 处理单个项目请求：GET 详情。
func ProjectByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing project id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		p, err := defaultProjectService.GetProject(id)
		if err != nil {
			http.Error(w, `{"code":1,"message":"project not found"}`, http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(p)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// Repositories 处理仓库集合请求：GET 列表。
func Repositories(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		filter := parseRepositoryFilter(r)
		repos, err := defaultProjectService.ListRepositories(filter)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list repositories"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(repos)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// RepositoryByID 处理单个仓库请求：GET 详情。
func RepositoryByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing repository id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		repo, err := defaultProjectService.GetRepository(id)
		if err != nil {
			http.Error(w, `{"code":1,"message":"repository not found"}`, http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(repo)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// RepositoryBranches 返回仓库分支列表。
func RepositoryBranches(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	repoID := r.PathValue("id")
	if repoID == "" {
		http.Error(w, `{"code":1,"message":"missing repository id"}`, http.StatusBadRequest)
		return
	}

	branches, err := defaultProjectService.ListBranches(repoID)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list branches"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(branches)
}

// RepositoryTree 返回仓库文件树。
func RepositoryTree(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	repoID := r.PathValue("id")
	if repoID == "" {
		http.Error(w, `{"code":1,"message":"missing repository id"}`, http.StatusBadRequest)
		return
	}

	branch := r.URL.Query().Get("branch")
	if branch == "" {
		http.Error(w, `{"code":1,"message":"missing branch"}`, http.StatusBadRequest)
		return
	}
	path := r.URL.Query().Get("path")

	tree, err := defaultProjectService.GetTree(repoID, branch, path)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get tree"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(tree)
}

// RepositoryContent 返回仓库文件内容。
func RepositoryContent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	repoID := r.PathValue("id")
	if repoID == "" {
		http.Error(w, `{"code":1,"message":"missing repository id"}`, http.StatusBadRequest)
		return
	}

	branch := r.URL.Query().Get("branch")
	if branch == "" {
		http.Error(w, `{"code":1,"message":"missing branch"}`, http.StatusBadRequest)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, `{"code":1,"message":"missing path"}`, http.StatusBadRequest)
		return
	}

	content, err := defaultProjectService.GetContent(repoID, branch, path)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get content"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(content)
}

func parseProjectFilter(r *http.Request) service.ProjectFilter {
	q := r.URL.Query()
	return service.ProjectFilter{
		TenantID: q.Get("tenantId"),
	}
}

func parseRepositoryFilter(r *http.Request) service.RepositoryFilter {
	q := r.URL.Query()
	return service.RepositoryFilter{
		ProjectID: q.Get("projectId"),
		Type:      repoTypeFromString(q.Get("type")),
	}
}

func repoTypeFromString(s string) project.RepoType {
	switch s {
	case "dev":
		return project.RepoTypeDev
	case "test":
		return project.RepoTypeTest
	case "case":
		return project.RepoTypeCase
	case "product":
		return project.RepoTypeProduct
	default:
		return ""
	}
}
