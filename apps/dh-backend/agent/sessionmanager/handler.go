package sessionmanager

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/sessionmanager/service"
)

var defaultSessionService service.SessionService

func Init(svc service.SessionService) {
	defaultSessionService = svc
}

func Sessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultSessionService == nil {
		http.Error(w, `{"code":1,"message":"session service not initialized"}`, http.StatusInternalServerError)
		return
	}
	sessions, err := defaultSessionService.ListSessions()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list sessions"}`, http.StatusInternalServerError)
		return
	}
	if r.Method == http.MethodGet {
		json.NewEncoder(w).Encode(sessions)
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"message": "POST not implemented"})
}
