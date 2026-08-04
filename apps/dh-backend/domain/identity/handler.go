package identity

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

var defaultUserService service.UserService

func Init(svc service.UserService) {
	defaultUserService = svc
}

func Users(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultUserService == nil {
		http.Error(w, `{"code":1,"message":"user service not initialized"}`, http.StatusInternalServerError)
		return
	}
	users, err := defaultUserService.ListUsers()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list users"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(users)
}

// Me 返回当前登录用户信息，userID 由 auth 中间件从请求上下文注入。
func Me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultUserService == nil {
		http.Error(w, `{"code":1,"message":"user service not initialized"}`, http.StatusInternalServerError)
		return
	}
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"code":2,"message":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		http.Error(w, `{"code":3,"message":"failed to get current user"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(user)
}

// Login 验证邮箱密码，返回用户信息。
func Login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultUserService == nil {
		http.Error(w, `{"code":1,"message":"user service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":2,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	user, err := defaultUserService.VerifyPassword(req.Email, req.Password)
	if err != nil {
		http.Error(w, `{"code":3,"message":"invalid email or password"}`, http.StatusUnauthorized)
		return
	}

	json.NewEncoder(w).Encode(map[string]any{
		"code":    0,
		"message": "success",
		"data":    user,
	})
}

// GetProfile 返回当前登录用户的个人信息。
func GetProfile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultUserService == nil {
		http.Error(w, `{"code":1,"message":"user service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"code":2,"message":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	profile, err := defaultUserService.GetProfile(userID)
	if err != nil {
		http.Error(w, `{"code":3,"message":"failed to get profile"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(profile)
}

// SaveProfile 保存当前登录用户的个人信息（昵称、头像、描述、SSH Key）。
func SaveProfile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultUserService == nil {
		http.Error(w, `{"code":1,"message":"user service not initialized"}`, http.StatusInternalServerError)
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"code":2,"message":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	var req struct {
		Name        string `json:"name"`
		AvatarURL   string `json:"avatarUrl"`
		Description string `json:"description"`
		SSHKey      string `json:"sshKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":2,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	profile, err := defaultUserService.SaveProfile(userID, req.Name, req.AvatarURL, req.Description, req.SSHKey)
	if err != nil {
		http.Error(w, `{"code":3,"message":"failed to save profile"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(profile)
}

// ── 租户管理 ──

// RequireSuperAdmin 是 requireSuperAdmin 的导出包装，供其他模块复用超级管理员鉴权。
func RequireSuperAdmin(w http.ResponseWriter, r *http.Request) bool {
	return requireSuperAdmin(w, r)
}

// requireTenantOrSuperAdmin 校验当前请求用户是否有权操作指定租户的资源。
// 超级管理员可操作任意租户；租户管理员仅可操作自己所属的租户。
// tenantID 参数为 URL 中的租户 ID。
func requireTenantOrSuperAdmin(w http.ResponseWriter, r *http.Request, tenantID string) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return false
	}
	if defaultUserService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "user service not initialized")
		return false
	}
	currentUser, err := defaultUserService.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "failed to authenticate user")
		return false
	}
	if currentUser.PlatformRole == identity.PlatformRoleSuperAdmin {
		return true
	}
	if currentUser.PlatformRole == identity.PlatformRoleTenantAdmin && currentUser.TenantID == tenantID {
		return true
	}
	handler.WriteJSONError(w, http.StatusForbidden, handler.ErrCodeForbidden, "forbidden: tenant admin or super admin required")
	return false
}

// IsSuperAdmin 判断当前请求用户是否为超级管理员，不写入响应。
func IsSuperAdmin(r *http.Request) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		return false
	}
	if defaultUserService == nil {
		return false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		return false
	}
	return user.PlatformRole == identity.PlatformRoleSuperAdmin
}

// requireSuperAdmin 校验当前请求用户是否为超级管理员。
func requireSuperAdmin(w http.ResponseWriter, r *http.Request) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return false
	}
	if defaultUserService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "user service not initialized")
		return false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "failed to authenticate user")
		return false
	}
	if user.PlatformRole != identity.PlatformRoleSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, handler.ErrCodeForbidden, "forbidden: super admin required")
		return false
	}
	return true
}

// Tenants 处理 GET /api/v1/tenants 与 POST /api/v1/tenants。
func Tenants(w http.ResponseWriter, r *http.Request) {
	if !requireSuperAdmin(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		tenants, err := defaultUserService.ListTenants()
		if err != nil {
			handler.HandleServiceError(w, err, "tenant not found", "failed to list tenants")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(tenants)
	case http.MethodPost:
		var req struct {
			Name        string               `json:"name"`
			AgentPolicy service.TenantPolicy `json:"agentPolicy"`
		}
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name is required")
			return
		}
		t, err := defaultUserService.CreateTenant(req.Name, req.AgentPolicy)
		if err != nil {
			handler.HandleServiceError(w, err, "tenant not found", "failed to create tenant")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(t)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// TenantByID 处理 GET/PUT/DELETE /api/v1/tenants/{id}。
func TenantByID(w http.ResponseWriter, r *http.Request) {
	if !requireSuperAdmin(w, r) {
		return
	}
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		t, err := defaultUserService.GetTenant(id)
		if err != nil {
			handler.HandleServiceError(w, err, "tenant not found", "failed to get tenant")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(t)
	case http.MethodPut:
		var req struct {
			Name        string               `json:"name"`
			AgentPolicy service.TenantPolicy `json:"agentPolicy"`
		}
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name is required")
			return
		}
		t, err := defaultUserService.UpdateTenant(id, req.Name, req.AgentPolicy)
		if err != nil {
			handler.HandleServiceError(w, err, "tenant not found", "failed to update tenant")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(t)
	case http.MethodDelete:
		if err := defaultUserService.DeleteTenant(id); err != nil {
			handler.HandleServiceError(w, err, "tenant not found", "failed to delete tenant")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// TenantMembers 处理 GET /api/v1/tenants/{id}/members 与 POST /api/v1/tenants/{id}/members。
func TenantMembers(w http.ResponseWriter, r *http.Request) {
	if !requireSuperAdmin(w, r) {
		return
	}
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		members, err := defaultUserService.ListTenantMembers(id)
		if err != nil {
			handler.HandleServiceError(w, err, "tenant not found", "failed to list tenant members")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(members)
	case http.MethodPost:
		var req struct {
			Email string `json:"email"`
			Name  string `json:"name"`
		}
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Email == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "email is required")
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name is required")
			return
		}
		member, err := defaultUserService.AddTenantMember(id, req.Email, req.Name)
		if err != nil {
			handler.HandleServiceError(w, err, "tenant not found", "failed to add tenant member")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(member)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// TenantMemberByID 处理 PUT /api/v1/tenants/{id}/members/{userId} — 设置/取消租户管理员。
func TenantMemberByID(w http.ResponseWriter, r *http.Request) {
	if !requireSuperAdmin(w, r) {
		return
	}
	tenantID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, ok := handler.PathValueOr404(w, r, "userId")
	if !ok {
		return
	}
	if r.Method != http.MethodPut {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	var req struct {
		IsAdmin bool `json:"isAdmin"`
	}
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}
	if err := defaultUserService.SetTenantAdmin(tenantID, userID, req.IsAdmin); err != nil {
		handler.HandleServiceError(w, err, "tenant member not found", "failed to set tenant admin")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
