package identity

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
)

var defaultUserService = service.NewMockUserService()

func Users(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	users, err := defaultUserService.ListUsers()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list users"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(users)
}

func Me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	user, err := defaultUserService.GetMe()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get current user"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(user)
}
