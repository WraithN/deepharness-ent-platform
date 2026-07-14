package workspace

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

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
		userID, _ := middleware.UserIDFromContext(r.Context())
		var req service.AddWorkspacePromptRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		p, err := defaultPromptService.Add(workspaceID, req, userID)
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
		// 根据请求体字段分发：存在 enabled 字段时更新启用状态，否则更新分类。
		body, err := io.ReadAll(r.Body)
		if err != nil {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
			return
		}
		var enabledReq service.UpdateWorkspacePromptEnabledRequest
		if err := json.Unmarshal(body, &enabledReq); err == nil && enabledReq.Enabled != nil {
			p, err := defaultPromptService.UpdateEnabled(workspaceID, promptID, enabledReq)
			if err != nil {
				handler.HandleServiceError(w, err, "prompt not found", "failed to update prompt enabled")
				return
			}
			json.NewEncoder(w).Encode(p)
			return
		}
		// 存在 content 字段时更新自定义提示词内容（市场来源快照不可改，服务层会拒绝）。
		var contentReq service.UpdateWorkspacePromptContentRequest
		if err := json.Unmarshal(body, &contentReq); err == nil && contentReq.Content != "" {
			p, err := defaultPromptService.UpdateContent(workspaceID, promptID, contentReq)
			if err != nil {
				handler.HandleServiceError(w, err, "prompt not found or not editable", "failed to update prompt content")
				return
			}
			json.NewEncoder(w).Encode(p)
			return
		}
		var req service.UpdateWorkspacePromptCategoryRequest
		if err := json.Unmarshal(body, &req); err != nil {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
			return
		}
		p, err := defaultPromptService.UpdateCategories(workspaceID, promptID, req)
		if err != nil {
			// 市场来源提示词分类锁定等业务校验错误直接透传原因。
			if !strings.Contains(err.Error(), "not found") {
				handler.WriteJSONError(w, http.StatusBadRequest, 3, err.Error())
				return
			}
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

// PromptAction 处理 POST /api/v1/workspaces/{id}/prompts/{promptId}/{action}。
// action 取值：use（使用次数 +1，任意登录用户）、copy（复制为可编辑副本，任意登录用户）、
// share（分享到市场审核，需空间/租户管理员）。
func PromptAction(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	promptID, ok := handler.PathValueOr404(w, r, "promptId")
	if !ok {
		return
	}
	action, ok := handler.PathValueOr404(w, r, "action")
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	userID, authOk := middleware.UserIDFromContext(r.Context())
	if !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}

	switch action {
	case "use":
		p, err := defaultPromptService.RecordUsage(workspaceID, promptID)
		if err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to record prompt usage")
			return
		}
		json.NewEncoder(w).Encode(p)
	case "copy":
		p, err := defaultPromptService.Copy(workspaceID, promptID, userID)
		if err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to copy prompt")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(p)
	case "share":
		if !canManageSpacePrompts(r, workspaceID) {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or space admin required")
			return
		}
		p, err := defaultPromptService.Share(workspaceID, promptID, userID)
		if err != nil {
			// 业务校验错误（市场来源不可分享/已分享）直接透传原因，便于前端提示。
			if !strings.Contains(err.Error(), "not found") {
				handler.WriteJSONError(w, http.StatusBadRequest, 3, err.Error())
				return
			}
			handler.HandleServiceError(w, err, "prompt not found", "failed to share prompt")
			return
		}
		json.NewEncoder(w).Encode(p)
	default:
		handler.WriteJSONError(w, http.StatusNotFound, 1, "unknown action")
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
		if strings.Contains(err.Error(), "builtin category") {
			handler.WriteJSONError(w, http.StatusBadRequest, 3, err.Error())
			return
		}
		handler.HandleServiceError(w, err, "category not found", "failed to delete category")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type createPromptCategoryRequest struct {
	Name string `json:"name"`
}
