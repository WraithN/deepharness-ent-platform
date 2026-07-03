package pragent

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent/service"
)

var defaultReviewService service.ReviewService

func Init(svc service.ReviewService) {
	defaultReviewService = svc
}

func Reviews(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultReviewService == nil {
		http.Error(w, `{"code":1,"message":"review service not initialized"}`, http.StatusInternalServerError)
		return
	}
	reviews, err := defaultReviewService.ListReviews()
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list reviews"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(reviews)
}
