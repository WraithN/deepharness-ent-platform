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
		return userID, "", true
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		return userID, "", true
	}
	return userID, user.PlatformRole, true
}

func canManageSpacePrompts(r *http.Request, workspaceID string) bool {
	userID, role, ok := currentUserPlatformRole(r)
	if !ok {
		return false
	}
	// 租户管理员与超级管理员拥有全局空间提示词管理权限。
	if role == identity.PlatformRoleTenantAdmin || role == identity.PlatformRoleSuperAdmin {
		return true
	}
	// 空间管理员（space_admin）可管理自己所在空间的提示词。
	members, err := defaultService.ListMembers(workspaceID)
	if err != nil {
		return false
	}
	for _, m := range members {
		if m.UserID == userID && m.Role == service.MemberRoleSpaceAdmin {
			return true
		}
	}
	return false
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
		if !canManageSpacePrompts(r, workspaceID) {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or space admin required")
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

// PromptByID 处理 PATCH /api/v1/workspaces/{id}/prompts/{promptId} 与 DELETE /api/v1/workspaces/{id}/prompts/{promptId}。
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
	case http.MethodPatch:
		if !canManageSpacePrompts(r, workspaceID) {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or space admin required")
			return
		}
		var req service.UpdateWorkspacePromptCategoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		p, err := defaultPromptService.UpdateCategories(workspaceID, promptID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to update prompt categories")
			return
		}
		json.NewEncoder(w).Encode(p)
	case http.MethodDelete:
		if !canManageSpacePrompts(r, workspaceID) {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or space admin required")
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

// PromptCategories 处理 GET /api/v1/workspaces/{id}/prompt-categories 与 POST /api/v1/workspaces/{id}/prompt-categories。
func PromptCategories(w http.ResponseWriter, r *http.Request) {
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
		categories, err := defaultPromptService.ListCategories(workspaceID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to list prompt categories")
			return
		}
		json.NewEncoder(w).Encode(categories)
	case http.MethodPost:
		if !canManageSpacePrompts(r, workspaceID) {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or space admin required")
			return
		}
		var req createPromptCategoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name is required")
			return
		}
		c, err := defaultPromptService.CreateCategory(workspaceID, req.Name)
		if err != nil {
			handler.HandleServiceError(w, err, "category not found", "failed to create category")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// PromptCategoryByID 处理 DELETE /api/v1/workspaces/{id}/prompt-categories/{categoryId}。
func PromptCategoryByID(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	categoryID, ok := handler.PathValueOr404(w, r, "categoryId")
	if !ok {
		return
	}

	if r.Method != http.MethodDelete {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	if !canManageSpacePrompts(r, workspaceID) {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or space admin required")
		return
	}
	if err := defaultPromptService.DeleteCategory(workspaceID, categoryID); err != nil {
		handler.HandleServiceError(w, err, "category not found", "failed to delete category")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type createPromptCategoryRequest struct {
	Name string `json:"name"`
}
