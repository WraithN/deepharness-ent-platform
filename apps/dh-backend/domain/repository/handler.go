package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
)

var defaultService service.RepositoryService

// Init 注入 RepositoryService 实现。
func Init(svc service.RepositoryService) {
	defaultService = svc
}

// sanitizeRepo 清除 Repository 中的敏感字段（SSHKey），防止通过 API 响应泄露私钥。
func sanitizeRepo(r repository.Repository) repository.Repository {
	r.SSHKey = ""
	return r
}

// sanitizeRepos 批量清除 Repository 列表中的敏感字段。
func sanitizeRepos(repos []repository.Repository) []repository.Repository {
	for i := range repos {
		repos[i].SSHKey = ""
	}
	return repos
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
		json.NewEncoder(w).Encode(sanitizeRepos(repos))
	case http.MethodPost:
		var req object.CreateRepositoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.URL == "" || req.Type == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "url and type are required")
			return
		}
		if !gitrepo.IsValidGitURL(req.URL) {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid git URL format, supported: https://, ssh://, git@host:path, git://")
			return
		}
		if !isValidRepoType(req.Type) {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid repository type")
			return
		}
		userID, _ := middleware.UserIDFromContext(r.Context())
		repo, err := defaultService.Create(workspaceID, userID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to create repository")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(sanitizeRepo(repo))
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
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
		json.NewEncoder(w).Encode(sanitizeRepo(repo))
	case http.MethodPut, http.MethodPatch:
		var req object.UpdateRepositoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.URL != "" && !gitrepo.IsValidGitURL(req.URL) {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid git URL format, supported: https://, ssh://, git@host:path, git://")
			return
		}
		if req.Type != "" && !isValidRepoType(req.Type) {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid repository type")
			return
		}
		userID, _ := middleware.UserIDFromContext(r.Context())
		repo, err := defaultService.Update(workspaceID, repoID, userID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "repository not found", "failed to update repository")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(sanitizeRepo(repo))
	case http.MethodDelete:
		if err := defaultService.Delete(workspaceID, repoID); err != nil {
			handler.HandleServiceError(w, err, "repository not found", "failed to delete repository")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
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
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	userID, _ := middleware.UserIDFromContext(r.Context())
	if err := defaultService.Sync(workspaceID, repoID, userID); err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to sync repository")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"accepted"}`))
}

func isValidRepoType(t string) bool {
	switch repository.RepoType(t) {
	case repository.RepoTypeDev, repository.RepoTypeCase:
		return true
	default:
		return false
	}
}

// ScanRepositories 扫描工作空间下的本地 Git 仓库。
func ScanRepositories(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	repos, err := defaultService.Scan(workspaceID, userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(repos)
}

// RepositoryDetails 获取仓库详细信息。
func RepositoryDetails(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	details, err := defaultService.GetDetails(workspaceID, repoID, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to get repository details")
		return
	}
	// 清除嵌套的 Repository 敏感字段，防止 SSH 私钥通过详情接口泄露。
	details.Repository = sanitizeRepo(details.Repository)
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(details)
}

// RepositoryBranches 获取仓库分支列表。
func RepositoryBranches(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	branches, err := defaultService.GetBranches(workspaceID, repoID, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to get branches")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(branches)
}

// RefreshBranches 强制从 git 远端刷新仓库分支列表并更新缓存。
func RefreshBranches(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	branches, err := defaultService.RefreshBranches(workspaceID, repoID, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to refresh branches")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(branches)
}

// RepositoryFileTree 获取仓库文件树。
func RepositoryFileTree(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	branch := r.URL.Query().Get("branch")
	userID, _ := middleware.UserIDFromContext(r.Context())

	tree, err := defaultService.GetFileTree(workspaceID, repoID, branch, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to get file tree")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(tree)
}

// RepositoryFileContent 获取仓库文件内容。
func RepositoryFileContent(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	branch := r.URL.Query().Get("branch")
	path := r.URL.Query().Get("path")

	if path == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "path is required")
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	content, err := defaultService.GetFileContent(workspaceID, repoID, branch, path, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "file not found", "failed to get file content")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(content)
}

// SwitchBranch 切换仓库分支并拉取最新代码。
func SwitchBranch(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	var req struct {
		Branch string `json:"branch"`
	}
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}

	if req.Branch == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "branch name is required")
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	if err := defaultService.SwitchBranch(workspaceID, repoID, req.Branch, userID); err != nil {
		handler.HandleServiceError(w, err, "branch switch failed", err.Error())
		return
	}

	handler.SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "branch": req.Branch})
}

// SaveFileContent 保存文件内容
func SaveFileContent(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}

	if req.Path == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "path is required")
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	if err := defaultService.SaveFileContent(workspaceID, repoID, req.Path, req.Content, userID); err != nil {
		handler.HandleServiceError(w, err, "failed to save file", err.Error())
		return
	}

	handler.SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "path": req.Path})
}

// GitCommit 提交 git 更改
func GitCommit(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	var req struct {
		Message string `json:"message"`
	}
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}

	userID, _ := middleware.UserIDFromContext(r.Context())

	hash, err := defaultService.GitCommit(workspaceID, repoID, req.Message, userID)
	if err != nil {
		// 无变更时返回 400 并透传原因，便于前端提示；其它错误统一走服务错误处理。
		if errors.Is(err, service.ErrNoChangesToCommit) {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, err.Error())
			return
		}
		handler.HandleServiceError(w, err, "commit failed", err.Error())
		return
	}

	handler.SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "hash": hash})
}

// GitStatus 获取 git 状态
func GitStatus(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	userID, _ := middleware.UserIDFromContext(r.Context())

	status, err := defaultService.GitStatus(workspaceID, repoID, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "failed to get status", err.Error())
		return
	}

	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]string{"status": status})
}

// UserRepos 处理 GET /api/v1/workspaces/{id}/user-repos。
// 返回工作空间下所有配置仓库在当前用户 projects 目录中的同步状态。
// userID 由 auth 中间件从请求上下文注入。
func UserRepos(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return
	}

	repos, err := defaultService.ListUserRepos(workspaceID, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "failed to list user repos", "failed to list user repos")
		return
	}

	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(repos)
}

// SyncUserRepo 处理 POST /api/v1/workspaces/{id}/user-repos/{repoId}/sync。
// 将指定仓库异步克隆到当前用户的 projects 目录。
func SyncUserRepo(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return
	}

	if err := defaultService.SyncUserRepo(workspaceID, repoID, userID); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"accepted"}`))
}

// SetRemoteURL 处理 POST /api/v1/workspaces/{id}/repositories/{repoId}/remote。
// 设置仓库远程 origin URL 并同步更新本地仓库 remote。
func SetRemoteURL(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	var req object.SetRemoteURLRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	if req.URL == "" || !gitrepo.IsValidGitURL(req.URL) {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid git URL format, supported: https://, ssh://, git@host:path, git://")
		return
	}

	userID, _ := middleware.UserIDFromContext(r.Context())
	if err := defaultService.SetRemoteURL(workspaceID, repoID, userID, req.URL); err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to set remote URL")
		return
	}
	handler.SetJSONHeader(w)
	w.Write([]byte(`{"status":"ok"}`))
}

// PushRepository 处理 POST /api/v1/workspaces/{id}/repositories/{repoId}/push。
// 推送仓库当前分支到远程 origin。
func PushRepository(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	userID, _ := middleware.UserIDFromContext(r.Context())
	if err := defaultService.Push(workspaceID, repoID, userID); err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to push repository")
		return
	}
	handler.SetJSONHeader(w)
	w.Write([]byte(`{"status":"ok"}`))
}

// UnpushedCommits 处理 GET /api/v1/workspaces/{id}/repositories/{repoId}/unpushed。
// 返回本地仓库尚未推送到远程的提交数量。
func UnpushedCommits(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := handler.PathValueOr404(w, r, "repoId")
	if !ok {
		return
	}
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	userID, _ := middleware.UserIDFromContext(r.Context())
	count, err := defaultService.GetUnpushedCommits(workspaceID, repoID, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "repository not found", "failed to get unpushed commits")
		return
	}
	handler.SetJSONHeader(w)
	w.Write([]byte(fmt.Sprintf(`{"count":%d}`, count)))
}
