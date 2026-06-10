package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store"
)

// WorkerStarter is implemented by WorkerManager.
type WorkerStarter interface {
	StartWorker(sessionID string)
}

type SessionHandler struct {
	sessions      store.SessionStore
	workerStarter WorkerStarter
}

func NewSessionHandler(sessions store.SessionStore, workerStarter WorkerStarter) *SessionHandler {
	return &SessionHandler{
		sessions:      sessions,
		workerStarter: workerStarter,
	}
}

type CreateSessionRequest struct {
	AgentType string         `json:"agentType"`
	Model     string         `json:"model"`
	ProjectID string         `json:"projectId"`
	Context   map[string]any `json:"context"`
}

type CreateSessionResponse struct {
	SessionID string `json:"sessionId"`
	WsURL     string `json:"wsUrl"`
}

func (h *SessionHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":2,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	session := domain.Session{
		ID:        uuid.New().String(),
		AgentType: req.AgentType,
		Model:     req.Model,
		ProjectID: req.ProjectID,
		Context:   req.Context,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := h.sessions.Create(r.Context(), session); err != nil {
		http.Error(w, `{"code":3,"message":"failed to create session"}`, http.StatusInternalServerError)
		return
	}

	// Start agent worker for this session
	if h.workerStarter != nil {
		h.workerStarter.StartWorker(session.ID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"code":    0,
		"message": "success",
		"data": CreateSessionResponse{
			SessionID: session.ID,
			WsURL:     "/ws/v1/sessions/" + session.ID,
		},
	})
}
