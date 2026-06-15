package personalassistant

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/service"
)

var defaultService service.PersonalAssistantService

// currentUserID 用于 mock 身份，生产环境应从认证中间件获取。
const currentUserID = "u1"
const currentUserName = "Meego"

// Init 注入 PersonalAssistantService 实现（MySQL 或 mock）。
func Init(svc service.PersonalAssistantService) {
	defaultService = svc
}

// ListAssistants 处理 GET /api/v1/personal-assistants。
func ListAssistants(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	assistants, err := defaultService.ListAssistants(currentUserID)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list assistants"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(assistants)
}

// CreateAssistant 处理 POST /api/v1/personal-assistants。
func CreateAssistant(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req service.CreateAssistantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	assistant, err := defaultService.CreateAssistant(currentUserID, currentUserName, req)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to create assistant"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(assistant)
}

// AssistantByID 处理 GET /api/v1/personal-assistants/{id}。
func AssistantByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing assistant id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	assistant, err := defaultService.GetAssistant(id)
	if err != nil {
		http.Error(w, `{"code":1,"message":"assistant not found"}`, http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(assistant)
}

// DeleteAssistant 处理 DELETE /api/v1/personal-assistants/{id}。
func DeleteAssistant(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing assistant id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodDelete {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if err := defaultService.DeleteAssistant(id); err != nil {
		http.Error(w, `{"code":1,"message":"failed to delete assistant"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListSessions 处理 GET /api/v1/personal-assistants/{id}/sessions。
func ListSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing assistant id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	sessions, err := defaultService.ListSessions(id)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to list sessions"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(sessions)
}

// CreateSession 处理 POST /api/v1/personal-assistants/{id}/sessions。
func CreateSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing assistant id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Title = "新会话"
	}

	session, err := defaultService.CreateSession(id, req.Title)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to create session"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(session)
}

// DeleteSession 处理 DELETE /api/v1/personal-assistants/{id}/sessions/{sessionId}。
func DeleteSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	sessionID := r.PathValue("sessionId")
	if id == "" || sessionID == "" {
		http.Error(w, `{"code":1,"message":"missing assistant or session id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodDelete {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if err := defaultService.DeleteSession(id, sessionID); err != nil {
		http.Error(w, `{"code":1,"message":"failed to delete session"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetMessages 处理 GET /api/v1/personal-assistants/{id}/sessions/{sessionId}/messages。
func GetMessages(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	sessionID := r.PathValue("sessionId")
	if id == "" || sessionID == "" {
		http.Error(w, `{"code":1,"message":"missing assistant or session id"}`, http.StatusBadRequest)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	messages, err := defaultService.GetMessages(sessionID)
	if err != nil {
		http.Error(w, `{"code":1,"message":"failed to get messages"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(messages)
}

// Assistants 处理 /api/v1/personal-assistants：GET 列表、POST 创建。
func Assistants(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		ListAssistants(w, r)
	case http.MethodPost:
		CreateAssistant(w, r)
	default:
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// AssistantSessions 处理 /api/v1/personal-assistants/{id}/sessions：GET 列表、POST 创建。
func AssistantSessions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		ListSessions(w, r)
	case http.MethodPost:
		CreateSession(w, r)
	default:
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}
