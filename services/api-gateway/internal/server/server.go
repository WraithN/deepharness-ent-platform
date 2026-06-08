package server

import (
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/handler"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/middleware"
)

func New() http.Handler {
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("/health", handler.HealthCheck)

	// API routes
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("/api/v1/hello", handler.Hello)

	// Apply middleware
	handler := middleware.Logger(middleware.CORS(apiMux))
	mux.Handle("/api/", handler)

	return mux
}
