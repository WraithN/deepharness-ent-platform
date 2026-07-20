package workspace

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	service "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/identity"
)

var (
	defaultService     service.WorkspaceService
	defaultUserService identityservice.UserService
	// allowedAgentKeys 保存全局 config.yaml 中声明的 coding agent key，用于校验超管设置的空间策略。
	allowedAgentKeys = make(map[string]bool)
)

// Init 注入 WorkspaceService 实现（MySQL 或 mock）。
func Init(svc service.WorkspaceService) {
	defaultService = svc
}

// InitUserService 注入 UserService，用于工作空间相关权限校验。
func InitUserService(svc identityservice.UserService) {
	defaultUserService = svc
}

// SetAllowedAgentKeys 设置平台全局允许的 coding agent key 集合。
func SetAllowedAgentKeys(keys []string) {
	allowedAgentKeys = make(map[string]bool, len(keys))
	for _, k := range keys {
		allowedAgentKeys[k] = true
	}
}

// validateAgentPolicy 校验超管传入的空间智能体策略是否合法。
func validateAgentPolicy(policy service.AgentPolicy) error {
	for _, key := range policy.AllowedAgentKeys {
		if !allowedAgentKeys[key] {
			return fmt.Errorf("agent key %s is not allowed by global config", key)
		}
	}
	for key := range policy.DefaultAgentConfigs {
		if !allowedAgentKeys[key] {
			return fmt.Errorf("agent key %s in default configs is not allowed by global config", key)
		}
	}
	for _, key := range policy.LockedAgentKeys {
		if !allowedAgentKeys[key] {
			return fmt.Errorf("agent key %s in locked keys is not allowed by global config", key)
		}
	}
	return nil
}

// requireSuperAdmin 校验当前请求用户是否为超级管理员。
func requireSuperAdmin(w http.ResponseWriter, r *http.Request) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return false
	}
	if defaultUserService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "user service not initialized")
		return false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "failed to authenticate user")
		return false
	}
	if user.PlatformRole != identity.PlatformRoleSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: super admin required")
		return false
	}
	return true
}

// requireWorkspaceAdmin 校验当前请求用户是否为超级管理员、同租户租户管理员或当前工作空间管理员。
func requireWorkspaceAdmin(w http.ResponseWriter, r *http.Request, workspaceID string) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return false
	}
	if defaultUserService == nil || defaultService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "service not initialized")
		return false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "failed to authenticate user")
		return false
	}
	if user.PlatformRole == identity.PlatformRoleSuperAdmin {
		return true
	}
	// 租户管理员可管理同租户工作空间（包括成员权限）。
	if user.PlatformRole == identity.PlatformRoleTenantAdmin {
		ws, err := defaultService.GetWorkspace(workspaceID)
		if err == nil && ws.TenantID == user.TenantID {
			return true
		}
	}
	role, err := defaultService.GetMemberRole(workspaceID, userID)
	if err != nil || role != service.MemberRoleSpaceAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: space admin required")
		return false
	}
	return true
}

// requireSuperOrTenantAdmin 校验当前请求用户是否为超级管理员或租户管理员。
// 空间管理员的任免仅允许该级别操作。
func requireSuperOrTenantAdmin(w http.ResponseWriter, r *http.Request) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return false
	}
	if defaultUserService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "user service not initialized")
		return false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "failed to authenticate user")
		return false
	}
	if user.PlatformRole != identity.PlatformRoleSuperAdmin && user.PlatformRole != identity.PlatformRoleTenantAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin required")
		return false
	}
	return true
}

// requireWorkspaceMember 校验当前请求用户是否可查看工作空间成员：
// 超级管理员、同租户租户管理员或该空间任意成员（含普通成员）均可查看。
func requireWorkspaceMember(w http.ResponseWriter, r *http.Request, workspaceID string) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return false
	}
	if defaultUserService == nil || defaultService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "service not initialized")
		return false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "failed to authenticate user")
		return false
	}
	if user.PlatformRole == identity.PlatformRoleSuperAdmin {
		return true
	}
	if user.PlatformRole == identity.PlatformRoleTenantAdmin {
		ws, err := defaultService.GetWorkspace(workspaceID)
		if err == nil && ws.TenantID == user.TenantID {
			return true
		}
	}
	if _, err := defaultService.GetMemberRole(workspaceID, userID); err != nil {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: workspace member required")
		return false
	}
	return true
}

// requireTenantAdmin 校验当前请求用户是否为租户管理员或超级管理员，返回租户 ID。
func requireTenantAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return "", false
	}
	if defaultUserService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "user service not initialized")
		return "", false
	}
	user, err := defaultUserService.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "failed to authenticate user")
		return "", false
	}
	if user.PlatformRole == identity.PlatformRoleSuperAdmin {
		return user.TenantID, true
	}
	if user.PlatformRole == identity.PlatformRoleTenantAdmin {
		return user.TenantID, true
	}
	handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden: tenant admin required")
	return "", false
}

// Workspaces 处理 GET /api/v1/workspaces 与 POST /api/v1/workspaces。
func Workspaces(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !requireSuperAdmin(w, r) {
			return
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
		workspaces, err := defaultService.ListWorkspaces(r.URL.Query().Get("tenantId"), page, pageSize)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list workspaces")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(workspaces)
	case http.MethodPost:
		tenantID, ok := requireTenantAdmin(w, r)
		if !ok {
			return
		}
		var req createWorkspaceRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.OwnerUserID == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name and ownerUserId are required")
			return
		}
		// 工作空间的智能体策略从租户继承，创建时使用空策略（默认值）
		ws, err := defaultService.CreateWorkspace(tenantID, req.Name, req.Description, req.OwnerUserID, req.SubRole, req.SourceWorkspaceID, service.AgentPolicy{})
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

// Mine 返回当前登录用户加入的工作空间列表及其成员关系。
// userID 由 auth 中间件从请求上下文注入。
func Mine(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}
	mine, err := defaultService.ListMine(userID)
	if err != nil {
		handler.HandleServiceError(w, err, "workspace not found", "failed to list mine workspaces")
		return
	}

	// 登录后，确保用户在各工作空间下的 projects/files/products 目录存在。
	// os.MkdirAll 是幂等操作，并发安全。
	for _, ws := range mine {
		if err := defaultService.EnsureUserWorkspaceDirs(r.Context(), ws.ID, userID); err != nil {
			log.Printf("[Workspace] ensure user dirs failed for ws=%s user=%s: %v", ws.ID, userID, err)
		}
	}

	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(mine)
}

// WorkspaceByID 处理 GET /api/v1/workspaces/{id}、PUT 更新与 DELETE 删除。
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
	case http.MethodPut:
		if !requireWorkspaceAdmin(w, r, id) {
			return
		}
		var req updateWorkspaceRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "name is required")
			return
		}
		// 智能体策略从租户继承，工作空间更新仅修改名称和描述，保留现有策略不变
		existing, err := defaultService.GetWorkspace(id)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to get workspace")
			return
		}
		existingPolicy := service.AgentPolicy{
			AgentConfigLocked:   existing.AgentConfigLocked,
			LockedAgentKeys:     existing.LockedAgentKeys,
			AllowedAgentKeys:    existing.AllowedAgentKeys,
			DefaultAgentConfigs: nil,
		}
		ws, err := defaultService.UpdateWorkspace(id, req.Name, req.Description, existingPolicy)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to update workspace")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(ws)
	case http.MethodDelete:
		if !requireSuperAdmin(w, r) {
			return
		}
		if err := defaultService.DeleteWorkspace(id); err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to delete workspace")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// Members 处理 GET /api/v1/workspaces/{id}/members 与 POST /api/v1/workspaces/{id}/members。
// 权限：GET 列表对所有空间成员开放；POST 添加需空间管理员/租户管理员，
// 且添加为空间管理员时仅租户管理员（含超级管理员）可操作。
func Members(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requireWorkspaceMember(w, r, workspaceID) {
			return
		}
		members, err := defaultService.ListMembers(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list members")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(members)
	case http.MethodPost:
		if !requireWorkspaceAdmin(w, r, workspaceID) {
			return
		}
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
		// 添加为空间管理员仅租户管理员（含超级管理员）可操作
		if req.Role == service.MemberRoleSpaceAdmin && !requireSuperOrTenantAdmin(w, r) {
			return
		}

		// 支持通过邮箱或 userId 添加成员：若包含 @ 则按邮箱解析为 users.id。
		userID := req.UserID
		if strings.Contains(req.UserID, "@") {
			if defaultUserService == nil {
				handler.WriteJSONError(w, http.StatusInternalServerError, 1, "user service not initialized")
				return
			}
			u, err := defaultUserService.GetByEmail(req.UserID)
			if err != nil {
				handler.WriteJSONError(w, http.StatusBadRequest, 1, "user not found")
				return
			}
			userID = u.ID
		}

		if err := defaultService.AddMember(workspaceID, userID, req.Role, req.SubRole); err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to add member")
			return
		}
		w.WriteHeader(http.StatusCreated)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// MemberByID 处理 DELETE / PUT /api/v1/workspaces/{id}/members/{userId}。
func MemberByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	if !requireWorkspaceAdmin(w, r, workspaceID) {
		return
	}
	userID, ok := handler.PathValueOr404(w, r, "userId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		// 删除空间管理员仅租户管理员（含超级管理员）可操作；空间管理员只能删除普通成员
		targetRole, err := defaultService.GetMemberRole(workspaceID, userID)
		if err == nil && targetRole == service.MemberRoleSpaceAdmin && !requireSuperOrTenantAdmin(w, r) {
			return
		}
		assetAssigneeID := r.URL.Query().Get("assetAssigneeId")
		if err := defaultService.RemoveMember(workspaceID, userID, assetAssigneeID); err != nil {
			handler.HandleServiceError(w, err, "member not found", "failed to remove member")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPut:
		// 查询目标成员当前角色，空间管理员之间的角色互改需要租户管理员/超级管理员权限。
		targetRole, err := defaultService.GetMemberRole(workspaceID, userID)
		if err != nil {
			handler.HandleServiceError(w, err, "member not found", "failed to get member role")
			return
		}
		if targetRole == service.MemberRoleSpaceAdmin && !requireSuperOrTenantAdmin(w, r) {
			return
		}

		var req updateMemberRequest
		if !handler.DecodeJSONBody(w, r, &req) {
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
		// 新角色设为空间管理员同样仅租户管理员（含超级管理员）可操作
		if req.Role == service.MemberRoleSpaceAdmin && !requireSuperOrTenantAdmin(w, r) {
			return
		}
		if err := defaultService.UpdateMemberRole(workspaceID, userID, req.Role, req.SubRole); err != nil {
			handler.HandleServiceError(w, err, "member not found", "failed to update member role")
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
	return role == service.MemberRoleSpaceAdmin || role == service.MemberRoleMember
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
	TenantID          string            `json:"tenantId"`
	Name              string            `json:"name"`
	Description       string            `json:"description"`
	OwnerUserID       string            `json:"ownerUserId"`
	SubRole           string            `json:"subRole"`
	SourceWorkspaceID string            `json:"sourceWorkspaceId"`
	AgentPolicy       service.AgentPolicy `json:"agentPolicy"`
}

type updateWorkspaceRequest struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	AgentPolicy service.AgentPolicy `json:"agentPolicy"`
}

type addMemberRequest struct {
	UserID  string `json:"userId"`
	Role    string `json:"role"`
	SubRole string `json:"subRole"`
}

type updateMemberRequest struct {
	Role    string `json:"role"`
	SubRole string `json:"subRole"`
}
