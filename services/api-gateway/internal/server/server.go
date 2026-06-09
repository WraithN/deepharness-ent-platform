package server

import (
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/agent"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker/memory"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/handler"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/hub"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/middleware"
	memstore "github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store/memory"
)

func New() http.Handler {
	mux := http.NewServeMux()

	// Infrastructure layer (in-memory implementations)
	sessions := memstore.NewSessionStore()
	messages := memstore.NewMessageStore()
	brok := memory.NewMessageBroker()
	agentClient := agent.NewStubClient()

	// Business logic layer
	h := hub.NewHub(sessions, messages, brok)
	_ = agentClient // Will be wired into worker when AgentClient is implemented

	// Handlers
	sessionHandler := handler.NewSessionHandler(sessions)
	wsHandler := handler.NewWebSocketHandler(h)

	// Routes
	mux.HandleFunc("/health", handler.HealthCheck)
	mux.HandleFunc("/api/v1/sessions", sessionHandler.CreateSession)
	mux.HandleFunc("/api/v1/hello", handler.Hello)
	mux.HandleFunc("/ws/v1/sessions/{id}", wsHandler.Handle)

	// Apply middleware
	return middleware.Logger(middleware.CORS(mux))
}
