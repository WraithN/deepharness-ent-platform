package audit

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit/service"
)

var defaultEventService = service.NewMockEventService()

func Events(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	items, err := defaultEventService.ListEvents()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list audits"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(items)
}
