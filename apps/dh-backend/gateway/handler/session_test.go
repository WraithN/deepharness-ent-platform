package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat/session"
)

type mockWorkerStarter struct{}

func (m *mockWorkerStarter) StartWorker(sessionID string) {}

func TestCreateSession_Success(t *testing.T) {
	sessions := session.NewSessionStore()
	messages := session.NewMessageStore()
	h := NewSessionHandler(sessions, messages, &mockWorkerStarter{})

	reqBody, _ := json.Marshal(map[string]any{
		"agentType": "opencode",
		"model":     "claude-3-7",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewReader(reqBody))
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatal("expected data object in response")
	}
	if data["sessionId"] == "" {
		t.Error("expected sessionId in response")
	}
	if data["wsUrl"] == "" {
		t.Error("expected wsUrl in response")
	}
}

func TestCreateSession_InvalidBody(t *testing.T) {
	sessions := session.NewSessionStore()
	messages := session.NewMessageStore()
	h := NewSessionHandler(sessions, messages, &mockWorkerStarter{})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewReader([]byte("not-json")))
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestSessions_MethodNotAllowed(t *testing.T) {
	sessions := session.NewSessionStore()
	messages := session.NewMessageStore()
	h := NewSessionHandler(sessions, messages, &mockWorkerStarter{})

	req := httptest.NewRequest(http.MethodPut, "/api/v1/sessions", nil)
	w := httptest.NewRecorder()

	h.Sessions(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}
