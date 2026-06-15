package identity

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
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

func Me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultUserService == nil {
		http.Error(w, `{"code":1,"message":"user service not initialized"}`, http.StatusInternalServerError)
		return
	}
	user, err := defaultUserService.GetMe()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get current user"}`, http.StatusInternalServerError)
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
