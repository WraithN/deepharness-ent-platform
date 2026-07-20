package team

import (
	"encoding/json"
	"net/http"
	"strconv"

	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

var (
	defaultService     service.TeamService
	defaultUserService identityservice.UserService
)

// Init 注入 TeamService 实现（MySQL 或 mock）。
func Init(svc service.TeamService) {
	defaultService = svc
}

// InitUserService 注入 UserService，用于角色校验。
func InitUserService(svc identityservice.UserService) {
	defaultUserService = svc
}

// currentUser 返回当前请求的用户 ID、是否为超级管理员以及是否已认证。
func currentUser(r *http.Request) (userID string, isSuperAdmin bool, ok bool) {
	userID, role, ok := currentUserWithRole(r)
	if !ok {
		return "", false, false
	}
	return userID, role == identity.PlatformRoleSuperAdmin, ok
}

// currentUserWithRole 返回当前用户 ID 与平台角色。
func currentUserWithRole(r *http.Request) (userID string, role identity.PlatformRole, ok bool) {
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

// requireAuth 要求请求必须携带有效用户 ID。
func requireAuth(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return "", false
	}
	return userID, true
}

// Skills 处理 GET /api/v1/team/skills 与 POST /api/v1/team/skills。
func Skills(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)

	switch r.Method {
	case http.MethodGet:
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
		workspaceID := r.URL.Query().Get("workspaceId")
		skills, err := defaultService.ListSkills(workspaceID, page, pageSize)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to list skills")
			return
		}
		json.NewEncoder(w).Encode(skills)
	case http.MethodPost:
		var req service.CreateSkillRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name is required")
			return
		}
		workspaceID := r.URL.Query().Get("workspaceId")
		skill, err := defaultService.CreateSkill(req, workspaceID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to create skill")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(skill)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// SkillByID 处理 PATCH /api/v1/team/skills/{id} 与 DELETE /api/v1/team/skills/{id}。
func SkillByID(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var req service.UpdateSkillRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		workspaceID := r.URL.Query().Get("workspaceId")
		skill, err := defaultService.UpdateSkill(id, req, workspaceID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to update skill")
			return
		}
		json.NewEncoder(w).Encode(skill)
	case http.MethodDelete:
		workspaceID := r.URL.Query().Get("workspaceId")
		if err := defaultService.DeleteSkill(id, workspaceID); err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to delete skill")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// Prompts 处理 GET /api/v1/team/prompts 与 POST /api/v1/team/prompts。
func Prompts(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)

	switch r.Method {
	case http.MethodGet:
		userID, isSuperAdmin, ok := currentUser(r)
		if !ok {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
		prompts, err := defaultService.ListPromptsVisibleTo(userID, isSuperAdmin, page, pageSize)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to list prompts")
			return
		}
		json.NewEncoder(w).Encode(prompts)
	case http.MethodPost:
		userID, ok := requireAuth(w, r)
		if !ok {
			return
		}
		var req service.CreatePromptRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.Content == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name and content are required")
			return
		}
		prompt, err := defaultService.CreatePrompt(req, userID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to create prompt")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(prompt)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// PromptByID 处理 PATCH /api/v1/team/prompts/{id} 与 DELETE /api/v1/team/prompts/{id}。
func PromptByID(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodPatch:
		userID, isSuperAdmin, authOk := currentUser(r)
		if !authOk {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		var req service.UpdatePromptRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		prompt, err := defaultService.UpdatePrompt(id, req, userID, isSuperAdmin)
		if err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to update prompt")
			return
		}
		json.NewEncoder(w).Encode(prompt)
	case http.MethodDelete:
		userID, isSuperAdmin, authOk := currentUser(r)
		if !authOk {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		if err := defaultService.DeletePrompt(id, userID, isSuperAdmin); err != nil {
			handler.HandleServiceError(w, err, "prompt not found", "failed to delete prompt")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// ReviewPrompt 处理 POST /api/v1/team/prompts/{id}/review。
func ReviewPrompt(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	_, isSuperAdmin, authOk := currentUser(r)
	if !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	if !isSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return
	}

	var req service.ReviewPromptRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	prompt, err := defaultService.ReviewPrompt(id, req.Action, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "prompt not found", "failed to review prompt")
		return
	}
	json.NewEncoder(w).Encode(prompt)
}

// ReviewSkill 处理 POST /api/v1/team/skills/{id}/review（仅超管）。
func ReviewSkill(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	_, isSuperAdmin, authOk := currentUser(r)
	if !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	if !isSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return
	}

	var req service.ReviewPromptRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	workspaceID := r.URL.Query().Get("workspaceId")
	skill, err := defaultService.ReviewSkill(id, req.Action, userID, workspaceID)
	if err != nil {
		handler.HandleServiceError(w, err, "skill not found", "failed to review skill")
		return
	}
	json.NewEncoder(w).Encode(skill)
}

// SkillCategoriesUpdate 处理 PUT /api/v1/team/skills/{id}/categories（仅超管）。
func SkillCategoriesUpdate(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodPut {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	if !requireSuperAdmin(w, r) {
		return
	}

	var req service.UpdateCategoriesRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	workspaceID := r.URL.Query().Get("workspaceId")
	skill, err := defaultService.UpdateSkillCategories(id, workspaceID, req.CategoryIDs)
	if err != nil {
		handler.HandleServiceError(w, err, "skill not found", "failed to update skill categories")
		return
	}
	json.NewEncoder(w).Encode(skill)
}

// PromptCategoriesUpdate 处理 PUT /api/v1/team/prompts/{id}/categories（仅超管）。
func PromptCategoriesUpdate(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodPut {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	if !requireSuperAdmin(w, r) {
		return
	}

	var req service.UpdateCategoriesRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	prompt, err := defaultService.UpdatePromptCategories(id, req.CategoryIDs)
	if err != nil {
		handler.HandleServiceError(w, err, "prompt not found", "failed to update prompt categories")
		return
	}
	json.NewEncoder(w).Encode(prompt)
}

// requireSuperAdmin 校验当前请求为已认证超级管理员（规则6：三个新 handler 共用鉴权逻辑）。
func requireSuperAdmin(w http.ResponseWriter, r *http.Request) bool {
	_, isSuperAdmin, authOk := currentUser(r)
	if !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return false
	}
	if !isSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return false
	}
	return true
}

// PromptUsage 处理 POST /api/v1/team/prompts/{id}/use。
// 复制提示词内容时上报：同一用户同一提示词每天只计数一次（服务层去重）。
func PromptUsage(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	userID, authOk := requireAuth(w, r)
	if !authOk {
		return
	}

	prompt, err := defaultService.RecordPromptUsage(id, userID)
	if err != nil {
		handler.HandleServiceError(w, err, "prompt not found", "failed to record prompt usage")
		return
	}
	json.NewEncoder(w).Encode(prompt)
}

// SkillCategories 处理 GET /api/v1/team/skill-categories 与 POST /api/v1/team/skill-categories。
func SkillCategories(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)

	switch r.Method {
	case http.MethodGet:
		workspaceID := r.URL.Query().Get("workspaceId")
		categories, err := defaultService.ListSkillCategories(workspaceID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to list skill categories")
			return
		}
		json.NewEncoder(w).Encode(categories)
	case http.MethodPost:
		_, role, ok := currentUserWithRole(r)
		if !ok {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		if role != identity.PlatformRoleSuperAdmin && role != identity.PlatformRoleTenantAdmin {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or super admin required")
			return
		}
		var req service.CreateSkillCategoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name is required")
			return
		}
		workspaceID := r.URL.Query().Get("workspaceId")
		category, err := defaultService.CreateSkillCategory(req, workspaceID)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to create skill category")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(category)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// SkillCategoryByID 处理 DELETE /api/v1/team/skill-categories/{id}。
func SkillCategoryByID(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodDelete {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	_, role, authOk := currentUserWithRole(r)
	if !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	if role != identity.PlatformRoleSuperAdmin && role != identity.PlatformRoleTenantAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin or super admin required")
		return
	}

	workspaceID := r.URL.Query().Get("workspaceId")
	if err := defaultService.DeleteSkillCategory(id, workspaceID); err != nil {
		handler.HandleServiceError(w, err, "skill category not found", "failed to delete skill category")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PromptCategories 处理 GET /api/v1/team/prompt-categories 与 POST /api/v1/team/prompt-categories。
func PromptCategories(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)

	switch r.Method {
	case http.MethodGet:
		categories, err := defaultService.ListPromptCategories()
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to list prompt categories")
			return
		}
		json.NewEncoder(w).Encode(categories)
	case http.MethodPost:
		_, isSuperAdmin, ok := currentUser(r)
		if !ok {
			handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
			return
		}
		if !isSuperAdmin {
			handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
			return
		}
		var req service.CreatePromptCategoryRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name is required")
			return
		}
		category, err := defaultService.CreatePromptCategory(req)
		if err != nil {
			handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to create prompt category")
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(category)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// PromptCategoryByID 处理 DELETE /api/v1/team/prompt-categories/{id}。
func PromptCategoryByID(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodDelete {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	_, isSuperAdmin, authOk := currentUser(r)
	if !authOk {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	if !isSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return
	}

	if err := defaultService.DeletePromptCategory(id); err != nil {
		handler.HandleServiceError(w, err, "prompt category not found", "failed to delete prompt category")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SkillStats 处理 GET /api/v1/team/skills/stats。
func SkillStats(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	_, isSuperAdmin, ok := currentUser(r)
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	if !isSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return
	}

	workspaceID := r.URL.Query().Get("workspaceId")
	stats, err := defaultService.GetSkillStats(workspaceID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to get skill stats")
		return
	}
	json.NewEncoder(w).Encode(stats)
}

// PromptStats 处理 GET /api/v1/team/prompts/stats。
func PromptStats(w http.ResponseWriter, r *http.Request) {
	handler.SetJSONHeader(w)
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	_, isSuperAdmin, ok := currentUser(r)
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	if !isSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return
	}

	stats, err := defaultService.GetPromptStats()
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "failed to get prompt stats")
		return
	}
	json.NewEncoder(w).Encode(stats)
}
