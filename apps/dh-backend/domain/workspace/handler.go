package workspace

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
)

var defaultService service.WorkspaceService

// Init 注入 WorkspaceService 实现（MySQL 或 mock）。
func Init(svc service.WorkspaceService) {
	defaultService = svc
}

// Workspaces 处理 GET /api/v1/workspaces 与 POST /api/v1/workspaces。
func Workspaces(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		workspaces, err := defaultService.ListWorkspaces(r.URL.Query().Get("tenantId"))
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list workspaces")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(workspaces)
	case http.MethodPost:
		var req createWorkspaceRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.OwnerUserID == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name and ownerUserId are required")
			return
		}
		ws, err := defaultService.CreateWorkspace(req.TenantID, req.Name, req.Description, req.OwnerUserID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to create workspace")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ws)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceByID 处理 GET /api/v1/workspaces/{id}。
func WorkspaceByID(w http.ResponseWriter, r *http.Request) {
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ws, err := defaultService.GetWorkspace(id)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to get workspace")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(ws)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// Members 处理 GET /api/v1/workspaces/{id}/members 与 POST /api/v1/workspaces/{id}/members。
func Members(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		members, err := defaultService.ListMembers(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list members")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(members)
	case http.MethodPost:
		var req addMemberRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == "" || req.Role == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "userId and role are required")
			return
		}
		if !isValidMemberRole(req.Role) {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid role")
			return
		}
		if req.SubRole != "" && !isValidMemberSubRole(req.SubRole) {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid subRole")
			return
		}
		if err := defaultService.AddMember(workspaceID, req.UserID, req.Role, req.SubRole); err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to add member")
			return
		}
		w.WriteHeader(http.StatusCreated)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// MemberByID 处理 DELETE /api/v1/workspaces/{id}/members/{userId}。
func MemberByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, ok := handler.PathValueOr404(w, r, "userId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if err := defaultService.RemoveMember(workspaceID, userID); err != nil {
			handler.HandleServiceError(w, err, "member not found", "failed to remove member")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkitemProject 处理 GET /api/v1/workspaces/{id}/workitem-project 与 POST /api/v1/workspaces/{id}/workitem-project。
func WorkitemProject(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		wp, err := defaultService.GetWorkitemProject(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workitem project not found", "failed to get workitem project")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(wp)
	case http.MethodPost:
		var req service.WorkitemProjectRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Platform == "" || req.ExternalKey == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "platform and externalKey are required")
			return
		}
		wp, err := defaultService.SetWorkitemProject(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to set workitem project")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(wp)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceAgents 处理 GET /api/v1/workspaces/{id}/agents 与 POST /api/v1/workspaces/{id}/agents。
func WorkspaceAgents(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		agents, err := defaultService.ListAgents(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list agents")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(agents)
	case http.MethodPost:
		var req service.AgentRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name is required")
			return
		}
		agent, err := defaultService.CreateAgent(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to create agent")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(agent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceStandards 处理 GET /api/v1/workspaces/{id}/standards 与 POST /api/v1/workspaces/{id}/standards。
func WorkspaceStandards(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		repoID := r.URL.Query().Get("repositoryId")
		standards, err := defaultService.ListStandards(workspaceID, repoID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list standards")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(standards)
	case http.MethodPost:
		var req service.StandardRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Type == "" || req.Name == "" || req.Content == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "type, name and content are required")
			return
		}
		standard, err := defaultService.SaveStandard(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "standard not found", "failed to save standard")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(standard)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceStandardByID 处理 DELETE /api/v1/workspaces/{id}/standards/{standardId}。
func WorkspaceStandardByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	standardID, ok := handler.PathValueOr404(w, r, "standardId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if err := defaultService.DeleteStandard(workspaceID, standardID); err != nil {
			handler.HandleServiceError(w, err, "standard not found", "failed to delete standard")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceCICD 处理 GET /api/v1/workspaces/{id}/cicd 与 POST /api/v1/workspaces/{id}/cicd。
func WorkspaceCICD(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		cicd, err := defaultService.GetCICD(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "cicd not found", "failed to get cicd")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(cicd)
	case http.MethodPost:
		var req service.CICDRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.TriggerBranches == "" && req.WebhookURL == "" && req.Script == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "at least one cicd field is required")
			return
		}
		cicd, err := defaultService.SaveCICD(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to save cicd")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(cicd)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// isValidMemberRole 校验成员角色是否合法。
func isValidMemberRole(role string) bool {
	return role == service.MemberRoleAdmin || role == service.MemberRoleUser
}

// isValidMemberSubRole 校验成员子角色是否合法。
func isValidMemberSubRole(subRole string) bool {
	switch subRole {
	case service.MemberSubRoleDeveloper, service.MemberSubRoleTester, service.MemberSubRolePM, service.MemberSubRoleDesigner:
		return true
	default:
		return false
	}
}

type createWorkspaceRequest struct {
	TenantID    string `json:"tenantId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	OwnerUserID string `json:"ownerUserId"`
}

type addMemberRequest struct {
	UserID  string `json:"userId"`
	Role    string `json:"role"`
	SubRole string `json:"subRole"`
}
