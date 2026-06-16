package repository

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
)

const defaultErrorCode = 1

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
			handler.WriteJSONError(w, http.StatusBadRequest, defaultErrorCode, "name, url and type are required")
			return
		}
		if !isValidRepoType(req.Type) {
			handler.WriteJSONError(w, http.StatusBadRequest, defaultErrorCode, "invalid repository type")
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
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, defaultErrorCode, "method not allowed")
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
			handler.WriteJSONError(w, http.StatusBadRequest, defaultErrorCode, "invalid repository type")
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
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, defaultErrorCode, "method not allowed")
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
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, defaultErrorCode, "method not allowed")
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
