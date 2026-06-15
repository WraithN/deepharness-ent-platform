package pragent

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent/service"
)

var defaultReviewService = service.NewMockReviewService()

func Reviews(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	reviews, err := defaultReviewService.ListReviews()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list reviews"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(reviews)
}
