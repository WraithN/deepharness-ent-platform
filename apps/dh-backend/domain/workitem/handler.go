package workitem

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
)

var defaultWorkItemService = service.NewMockWorkItemService()

func WorkItems(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	items, err := defaultWorkItemService.ListWorkItems()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list workitems"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(items)
}
