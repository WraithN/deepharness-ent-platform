package repository

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"
)

func TestRepositories_CreateAndList(t *testing.T) {
	Init(service.NewMockRepositoryService())

	reqBody, _ := json.Marshal(service.CreateRepositoryRequest{
		Name: "backend-api",
		URL:  "git@github.com:company/backend-api.git",
		Type: "dev",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/repositories", bytes.NewReader(reqBody))
	req.SetPathValue("id", "ws-1")
	w := httptest.NewRecorder()
	Repositories(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if created["name"] != "backend-api" {
		t.Errorf("unexpected name: %v", created["name"])
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws-1/repositories", nil)
	req.SetPathValue("id", "ws-1")
	w = httptest.NewRecorder()
	Repositories(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 repo, got %d", len(list))
	}
}

func TestRepositories_InvalidType(t *testing.T) {
	Init(service.NewMockRepositoryService())

	reqBody, _ := json.Marshal(service.CreateRepositoryRequest{
		Name: "x",
		URL:  "git@example.com:x.git",
		Type: "badtype",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces/ws-1/repositories", bytes.NewReader(reqBody))
	req.SetPathValue("id", "ws-1")
	w := httptest.NewRecorder()
	Repositories(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}
