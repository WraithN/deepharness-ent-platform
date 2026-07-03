package identity

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
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
