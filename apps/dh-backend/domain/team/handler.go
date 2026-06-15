package team

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/service"
)

var defaultService service.TeamService

// Init 注入 TeamService 实现（MySQL 或 mock）。
func Init(svc service.TeamService) {
	defaultService = svc
}

// Skills 处理 GET /api/v1/team/skills 与 POST /api/v1/team/skills。
func Skills(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		skills, err := defaultService.ListSkills()
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list skills"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(skills)
	case http.MethodPost:
		var req service.CreateSkillRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, `{"code":1,"message":"name is required"}`, http.StatusBadRequest)
			return
		}
		skill, err := defaultService.CreateSkill(req)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to create skill"}`, http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(skill)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// SkillByID 处理 PATCH /api/v1/team/skills/{id} 与 DELETE /api/v1/team/skills/{id}。
func SkillByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing skill id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var req service.UpdateSkillRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		skill, err := defaultService.UpdateSkill(id, req)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to update skill"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(skill)
	case http.MethodDelete:
		if err := defaultService.DeleteSkill(id); err != nil {
			http.Error(w, `{"code":1,"message":"failed to delete skill"}`, http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// Prompts 处理 GET /api/v1/team/prompts 与 POST /api/v1/team/prompts。
func Prompts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		prompts, err := defaultService.ListPrompts()
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to list prompts"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(prompts)
	case http.MethodPost:
		var req service.CreatePromptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		if req.Name == "" || req.Content == "" {
			http.Error(w, `{"code":1,"message":"name and content are required"}`, http.StatusBadRequest)
			return
		}
		prompt, err := defaultService.CreatePrompt(req)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to create prompt"}`, http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(prompt)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// PromptByID 处理 PATCH /api/v1/team/prompts/{id} 与 DELETE /api/v1/team/prompts/{id}。
func PromptByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"code":1,"message":"missing prompt id"}`, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var req service.UpdatePromptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"code":1,"message":"invalid request body"}`, http.StatusBadRequest)
			return
		}
		prompt, err := defaultService.UpdatePrompt(id, req)
		if err != nil {
			http.Error(w, `{"code":1,"message":"failed to update prompt"}`, http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(prompt)
	case http.MethodDelete:
		if err := defaultService.DeletePrompt(id); err != nil {
			http.Error(w, `{"code":1,"message":"failed to delete prompt"}`, http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}
