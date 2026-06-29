package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
)

type SessionHandler struct {
	sessions       chat.SessionStore
	messages       chat.MessageStore
	gatewaydClient *client.GatewaydClient
}

func NewSessionHandler(sessions chat.SessionStore, messages chat.MessageStore, gatewaydClient *client.GatewaydClient) *SessionHandler {
	return &SessionHandler{
		sessions:       sessions,
		messages:       messages,
		gatewaydClient: gatewaydClient,
	}
}

type CreateSessionRequest struct {
	WorkspaceID string         `json:"workspaceId"`
	AgentID     string         `json:"agentId"`
	AgentType   string         `json:"agentType"`
	Model       string         `json:"model"`
	ProjectID   string         `json:"projectId"`
	Context     map[string]any `json:"context"`
}

type CreateSessionResponse struct {
	SessionID    string `json:"sessionId"`
	GatewaydURL  string `json:"gatewaydUrl"`
	GatewaydWsURL string `json:"gatewaydWsUrl"`
	AgentID      string `json:"agentId"`
}

func (h *SessionHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		sessions, err := h.sessions.ListSessions(r.Context())
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list sessions"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(sessions)
	case http.MethodPost:
		h.CreateSession(w, r)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (h *SessionHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":2,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	workspaceID := req.WorkspaceID
	if workspaceID == "" {
		workspaceID = "ws-default"
	}
	agentID := req.AgentID
	if agentID == "" {
		agentID = "agent-default"
	}

	session := chat.Session{
		ID:          uuid.New().String(),
		WorkspaceID: workspaceID,
		AgentID:     agentID,
		AgentType:   req.AgentType,
		Model:       req.Model,
		ProjectID:   req.ProjectID,
		Context:     req.Context,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := h.sessions.Create(r.Context(), session); err != nil {
		http.Error(w, `{"code":3,"message":"failed to create session"}`, http.StatusInternalServerError)
		return
	}

	// Resolve the actual gatewayd agent instance ID for frontend direct connection
	gwAgentID := h.gatewaydClient.AgentID() // fallback to configured plugin key
	if resolvedID, err := h.gatewaydClient.ResolveAgentID(r.Context()); err == nil && resolvedID != "" {
		gwAgentID = resolvedID
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"code":    0,
		"message": "success",
		"data": CreateSessionResponse{
			SessionID:    session.ID,
			GatewaydURL:  h.gatewaydClient.AdminURL(),
			GatewaydWsURL: h.gatewaydClient.WsURL(),
			AgentID:      gwAgentID,
		},
	})
}

// GetMessages 返回指定会话的历史消息。
func (h *SessionHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing session id"}`, http.StatusBadRequest)
		return
	}

	limit := 100
	messages, err := h.messages.GetHistory(r.Context(), id, limit)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get messages"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(messages)
}
