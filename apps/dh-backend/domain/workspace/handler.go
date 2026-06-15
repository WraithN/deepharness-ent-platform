package workspace

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/project"
)

var defaultService service.WorkspaceService

// Init 注入 WorkspaceService 实现（MySQL 或 mock）。
func Init(svc service.WorkspaceService) {
	defaultService = svc
}

// errorResponse 统一错误响应结构。
type errorResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// setJSONHeader 设置响应 Content-Type 为 application/json。
func setJSONHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
}

// writeJSONError 写入 JSON 格式错误响应。
func writeJSONError(w http.ResponseWriter, status, code int, message string) {
	setJSONHeader(w)
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(errorResponse{Code: code, Message: message})
}

// handleServiceError 统一处理服务层错误，识别 not found 返回 404。
func handleServiceError(w http.ResponseWriter, err error, notFoundMsg, defaultMsg string) {
	if strings.Contains(err.Error(), "not found") {
		writeJSONError(w, http.StatusNotFound, 1, notFoundMsg)
		return
	}
	writeJSONError(w, http.StatusInternalServerError, 1, defaultMsg)
}

// decodeJSONBody 解码 JSON 请求体，失败时返回 400。
func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return false
	}
	return true
}

// pathValueOr404 提取路径参数，为空时返回 400（函数名保留历史约定，实际语义为参数缺失）。
func pathValueOr404(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	v := r.PathValue(name)
	if v == "" {
		writeJSONError(w, http.StatusBadRequest, 1, "missing "+name)
		return "", false
	}
	return v, true
}

// Workspaces 处理 GET /api/v1/workspaces 与 POST /api/v1/workspaces。
func Workspaces(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		workspaces, err := defaultService.ListWorkspaces(r.URL.Query().Get("tenantId"))
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to list workspaces")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(workspaces)
	case http.MethodPost:
		var req createWorkspaceRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.OwnerUserID == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "name and ownerUserId are required")
			return
		}
		ws, err := defaultService.CreateWorkspace(req.TenantID, req.Name, req.Description, req.OwnerUserID)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to create workspace")
			return
		}
		setJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ws)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceByID 处理 GET /api/v1/workspaces/{id}。
func WorkspaceByID(w http.ResponseWriter, r *http.Request) {
	id, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ws, err := defaultService.GetWorkspace(id)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to get workspace")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(ws)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// Members 处理 GET /api/v1/workspaces/{id}/members 与 POST /api/v1/workspaces/{id}/members。
func Members(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		members, err := defaultService.ListMembers(workspaceID)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to list members")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(members)
	case http.MethodPost:
		var req addMemberRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == "" || req.Role == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "userId and role are required")
			return
		}
		if !isValidMemberRole(req.Role) {
			writeJSONError(w, http.StatusBadRequest, 1, "invalid role")
			return
		}
		if req.SubRole != "" && !isValidMemberSubRole(req.SubRole) {
			writeJSONError(w, http.StatusBadRequest, 1, "invalid subRole")
			return
		}
		if err := defaultService.AddMember(workspaceID, req.UserID, req.Role, req.SubRole); err != nil {
			handleServiceError(w, err, "workspace not found", "failed to add member")
			return
		}
		w.WriteHeader(http.StatusCreated)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// MemberByID 处理 DELETE /api/v1/workspaces/{id}/members/{userId}。
func MemberByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, ok := pathValueOr404(w, r, "userId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if err := defaultService.RemoveMember(workspaceID, userID); err != nil {
			handleServiceError(w, err, "member not found", "failed to remove member")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// DemandProject 处理 GET /api/v1/workspaces/{id}/demand-project 与 POST /api/v1/workspaces/{id}/demand-project。
func DemandProject(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		dp, err := defaultService.GetDemandProject(workspaceID)
		if err != nil {
			handleServiceError(w, err, "demand project not found", "failed to get demand project")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(dp)
	case http.MethodPost:
		var req service.DemandProjectRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.Platform == "" || req.ExternalKey == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "platform and externalKey are required")
			return
		}
		dp, err := defaultService.SetDemandProject(workspaceID, req)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to set demand project")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(dp)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceRepositories 处理 GET /api/v1/workspaces/{id}/repositories 与 POST /api/v1/workspaces/{id}/repositories。
func WorkspaceRepositories(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		typeStr := r.URL.Query().Get("type")
		var repoType project.RepoType
		if typeStr != "" {
			var err error
			repoType, err = repoTypeFromString(typeStr)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, 1, "invalid repository type")
				return
			}
		}
		repos, err := defaultService.ListRepositories(workspaceID, repoType)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to list repositories")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(repos)
	case http.MethodPost:
		var req service.RepositoryRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.URL == "" || req.Type == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "name, url and type are required")
			return
		}
		if !isValidRepoType(req.Type) {
			writeJSONError(w, http.StatusBadRequest, 1, "invalid repository type")
			return
		}
		repo, err := defaultService.CreateRepository(workspaceID, req)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to create repository")
			return
		}
		setJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(repo)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// RepositoryByID 处理 DELETE /api/v1/workspaces/{id}/repositories/{repoId}。
func RepositoryByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}
	repoID, ok := pathValueOr404(w, r, "repoId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if err := defaultService.DeleteRepository(workspaceID, repoID); err != nil {
			handleServiceError(w, err, "repository not found", "failed to delete repository")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceAgents 处理 GET /api/v1/workspaces/{id}/agents 与 POST /api/v1/workspaces/{id}/agents。
func WorkspaceAgents(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		agents, err := defaultService.ListAgents(workspaceID)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to list agents")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(agents)
	case http.MethodPost:
		var req service.AgentRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "name is required")
			return
		}
		agent, err := defaultService.CreateAgent(workspaceID, req)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to create agent")
			return
		}
		setJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(agent)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceStandards 处理 GET /api/v1/workspaces/{id}/standards 与 POST /api/v1/workspaces/{id}/standards。
func WorkspaceStandards(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		repoID := r.URL.Query().Get("repositoryId")
		standards, err := defaultService.ListStandards(workspaceID, repoID)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to list standards")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(standards)
	case http.MethodPost:
		var req service.StandardRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.Type == "" || req.Name == "" || req.Content == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "type, name and content are required")
			return
		}
		standard, err := defaultService.SaveStandard(workspaceID, req)
		if err != nil {
			handleServiceError(w, err, "standard not found", "failed to save standard")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(standard)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceStandardByID 处理 DELETE /api/v1/workspaces/{id}/standards/{standardId}。
func WorkspaceStandardByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}
	standardID, ok := pathValueOr404(w, r, "standardId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if err := defaultService.DeleteStandard(workspaceID, standardID); err != nil {
			handleServiceError(w, err, "standard not found", "failed to delete standard")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceCICD 处理 GET /api/v1/workspaces/{id}/cicd 与 POST /api/v1/workspaces/{id}/cicd。
func WorkspaceCICD(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := pathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		cicd, err := defaultService.GetCICD(workspaceID)
		if err != nil {
			handleServiceError(w, err, "cicd not found", "failed to get cicd")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(cicd)
	case http.MethodPost:
		var req service.CICDRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		if req.TriggerBranches == "" && req.WebhookURL == "" && req.Script == "" {
			writeJSONError(w, http.StatusBadRequest, 1, "at least one cicd field is required")
			return
		}
		cicd, err := defaultService.SaveCICD(workspaceID, req)
		if err != nil {
			handleServiceError(w, err, "workspace not found", "failed to save cicd")
			return
		}
		setJSONHeader(w)
		json.NewEncoder(w).Encode(cicd)
	default:
		writeJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// repoTypeFromString 将查询字符串转换为仓库类型，未知或空时返回错误。
func repoTypeFromString(s string) (project.RepoType, error) {
	switch s {
	case "dev":
		return project.RepoTypeDev, nil
	case "test":
		return project.RepoTypeTest, nil
	case "case":
		return project.RepoTypeCase, nil
	case "product":
		return project.RepoTypeProduct, nil
	default:
		return "", errors.New("invalid repository type")
	}
}

// isValidRepoType 校验仓库类型是否合法。
func isValidRepoType(t project.RepoType) bool {
	switch t {
	case project.RepoTypeDev, project.RepoTypeTest, project.RepoTypeCase, project.RepoTypeProduct:
		return true
	default:
		return false
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
