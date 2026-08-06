package workspace

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/object"
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

// Handler 是 workspace 模块的 HTTP 处理器。
type Handler struct {
	crudSvc      service.WorkspaceCRUDService
	dirSvc       service.WorkspaceDirectoryService
	memberSvc    service.WorkspaceMemberService
	agentSvc     service.WorkspaceAgentService
	standardSvc  service.WorkspaceStandardService
	cicdSvc      service.WorkspaceCICDService
	cicdConfigSvc service.CICDConfigService
	wiProjSvc    service.WorkspaceWorkitemProjectService
	userSvc      identityservice.UserService
}

// NewHandler 创建 workspace HTTP 处理器。
func NewHandler(crudSvc service.WorkspaceCRUDService, dirSvc service.WorkspaceDirectoryService, memberSvc service.WorkspaceMemberService, agentSvc service.WorkspaceAgentService, standardSvc service.WorkspaceStandardService, cicdSvc service.WorkspaceCICDService, cicdConfigSvc service.CICDConfigService, wiProjSvc service.WorkspaceWorkitemProjectService, userSvc identityservice.UserService) *Handler {
	return &Handler{
		crudSvc:       crudSvc,
		dirSvc:        dirSvc,
		memberSvc:     memberSvc,
		agentSvc:      agentSvc,
		standardSvc:   standardSvc,
		cicdSvc:       cicdSvc,
		cicdConfigSvc: cicdConfigSvc,
		wiProjSvc:     wiProjSvc,
		userSvc:       userSvc,
	}
}

// validateAgentPolicy 校验超管传入的空间智能体策略是否合法。
func validateAgentPolicy(policy object.AgentPolicy) error {
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
func (h *Handler) requireSuperAdmin(w http.ResponseWriter, r *http.Request) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return false
	}
	if h.userSvc == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "user service not initialized")
		return false
	}
	user, err := h.userSvc.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "failed to authenticate user")
		return false
	}
	if user.PlatformRole != identity.PlatformRoleSuperAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, handler.ErrCodeForbidden, "forbidden: super admin required")
		return false
	}
	return true
}

// requireWorkspaceAdmin 校验当前请求用户是否为超级管理员、同租户租户管理员或当前工作空间管理员。
func (h *Handler) requireWorkspaceAdmin(w http.ResponseWriter, r *http.Request, workspaceID string) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return false
	}
	if h.userSvc == nil || h.crudSvc == nil || h.memberSvc == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "service not initialized")
		return false
	}
	user, err := h.userSvc.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "failed to authenticate user")
		return false
	}
	if user.PlatformRole == identity.PlatformRoleSuperAdmin {
		return true
	}
	// 租户管理员可管理同租户工作空间（包括成员权限）。
	if user.PlatformRole == identity.PlatformRoleTenantAdmin {
		ws, err := h.crudSvc.GetWorkspace(workspaceID)
		if err == nil && ws.TenantID == user.TenantID {
			return true
		}
	}
	role, err := h.memberSvc.GetMemberRole(workspaceID, userID)
	if err != nil || role != object.MemberRoleSpaceAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, handler.ErrCodeForbidden, "forbidden: space admin required")
		return false
	}
	return true
}

// requireSuperOrTenantAdmin 校验当前请求用户是否为超级管理员或租户管理员。
// 空间管理员的任免仅允许该级别操作。
func (h *Handler) requireSuperOrTenantAdmin(w http.ResponseWriter, r *http.Request) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return false
	}
	if h.userSvc == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "user service not initialized")
		return false
	}
	user, err := h.userSvc.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "failed to authenticate user")
		return false
	}
	if user.PlatformRole != identity.PlatformRoleSuperAdmin && user.PlatformRole != identity.PlatformRoleTenantAdmin {
		handler.WriteJSONError(w, http.StatusForbidden, handler.ErrCodeForbidden, "forbidden: tenant admin required")
		return false
	}
	return true
}

// requireWorkspaceMember 校验当前请求用户是否可查看工作空间成员：
// 超级管理员、同租户租户管理员或该空间任意成员（含普通成员）均可查看。
func (h *Handler) requireWorkspaceMember(w http.ResponseWriter, r *http.Request, workspaceID string) bool {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return false
	}
	if h.userSvc == nil || h.crudSvc == nil || h.memberSvc == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "service not initialized")
		return false
	}
	user, err := h.userSvc.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "failed to authenticate user")
		return false
	}
	if user.PlatformRole == identity.PlatformRoleSuperAdmin {
		return true
	}
	if user.PlatformRole == identity.PlatformRoleTenantAdmin {
		ws, err := h.crudSvc.GetWorkspace(workspaceID)
		if err == nil && ws.TenantID == user.TenantID {
			return true
		}
	}
	if _, err := h.memberSvc.GetMemberRole(workspaceID, userID); err != nil {
		handler.WriteJSONError(w, http.StatusForbidden, handler.ErrCodeForbidden, "forbidden: workspace member required")
		return false
	}
	return true
}

// requireTenantAdmin 校验当前请求用户是否为租户管理员或超级管理员，返回租户 ID。
func (h *Handler) requireTenantAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return "", false
	}
	if h.userSvc == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "user service not initialized")
		return "", false
	}
	user, err := h.userSvc.GetByID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "failed to authenticate user")
		return "", false
	}
	if user.PlatformRole == identity.PlatformRoleSuperAdmin {
		return user.TenantID, true
	}
	if user.PlatformRole == identity.PlatformRoleTenantAdmin {
		return user.TenantID, true
	}
	handler.WriteJSONError(w, http.StatusForbidden, handler.ErrCodeForbidden, "forbidden: tenant admin required")
	return "", false
}

// Workspaces 处理 GET /api/v1/workspaces 与 POST /api/v1/workspaces。
func (h *Handler) Workspaces(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !h.requireSuperAdmin(w, r) {
			return
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
		workspaces, err := h.crudSvc.ListWorkspaces(r.URL.Query().Get("tenantId"), page, pageSize)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list workspaces")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(workspaces)
	case http.MethodPost:
		tenantID, ok := h.requireTenantAdmin(w, r)
		if !ok {
			return
		}
		var req createWorkspaceRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" || req.OwnerUserID == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name and ownerUserId are required")
			return
		}
		// 工作空间的智能体策略从租户继承，创建时使用空策略（默认值）
		ws, err := h.crudSvc.CreateWorkspace(tenantID, req.Name, req.Description, req.OwnerUserID, req.SubRoles, req.SourceWorkspaceID, object.AgentPolicy{})
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to create workspace")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ws)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// Mine 返回当前登录用户加入的工作空间列表及其成员关系。
// userID 由 auth 中间件从请求上下文注入。
func (h *Handler) Mine(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, handler.ErrCodeUnauthorized, "unauthorized")
		return
	}
	mine, err := h.crudSvc.ListMine(userID)
	if err != nil {
		handler.HandleServiceError(w, err, "workspace not found", "failed to list mine workspaces")
		return
	}

	// 登录后，确保用户在各工作空间下的 projects/files/products 目录存在。
	// os.MkdirAll 是幂等操作，并发安全。
	for _, ws := range mine {
		if err := h.dirSvc.EnsureUserWorkspaceDirs(r.Context(), ws.ID, userID); err != nil {
			log.Printf("[Workspace] ensure user dirs failed for ws=%s user=%s: %v", ws.ID, userID, err)
		}
	}

	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(mine)
}

// WorkspaceByID 处理 GET /api/v1/workspaces/{id}、PUT 更新与 DELETE 删除。
func (h *Handler) WorkspaceByID(w http.ResponseWriter, r *http.Request) {
	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		ws, err := h.crudSvc.GetWorkspace(id)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to get workspace")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(ws)
	case http.MethodPut:
		if !h.requireWorkspaceAdmin(w, r, id) {
			return
		}
		var req updateWorkspaceRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name is required")
			return
		}
		// 智能体策略从租户继承，工作空间更新仅修改名称和描述，保留现有策略不变
		existing, err := h.crudSvc.GetWorkspace(id)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to get workspace")
			return
		}
		existingPolicy := object.AgentPolicy{
			AgentConfigLocked:   existing.AgentConfigLocked,
			LockedAgentKeys:     existing.LockedAgentKeys,
			AllowedAgentKeys:    existing.AllowedAgentKeys,
			DefaultAgentConfigs: nil,
		}
		ws, err := h.crudSvc.UpdateWorkspace(id, req.Name, req.Description, existingPolicy)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to update workspace")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(ws)
	case http.MethodDelete:
		if !h.requireSuperAdmin(w, r) {
			return
		}
		if err := h.crudSvc.DeleteWorkspace(id); err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to delete workspace")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// Members 处理 GET /api/v1/workspaces/{id}/members 与 POST /api/v1/workspaces/{id}/members。
// 权限：GET 列表对所有空间成员开放；POST 添加需空间管理员/租户管理员，
// 且添加为空间管理员时仅租户管理员（含超级管理员）可操作。
func (h *Handler) Members(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !h.requireWorkspaceMember(w, r, workspaceID) {
			return
		}
		members, err := h.memberSvc.ListMembers(workspaceID)
		if err != nil {
			log.Printf("[Workspace] ListMembers failed: workspaceID=%s err=%v", workspaceID, err)
			handler.HandleServiceError(w, err, "workspace not found", "failed to list members")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(members)
	case http.MethodPost:
		if !h.requireWorkspaceAdmin(w, r, workspaceID) {
			return
		}
		var req addMemberRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.UserID == "" || req.Role == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "userId and role are required")
			return
		}
		if !isValidMemberRole(req.Role) {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid role")
			return
		}
		for _, subRole := range req.SubRoles {
			if !isValidMemberSubRole(subRole) {
				handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid subRole")
				return
			}
		}
		// 添加为空间管理员仅租户管理员（含超级管理员）可操作
		if req.Role == object.MemberRoleSpaceAdmin && !h.requireSuperOrTenantAdmin(w, r) {
			return
		}

		// 支持通过邮箱或 userId 添加成员：若包含 @ 则按邮箱解析为 users.id。
		userID := req.UserID
		if strings.Contains(req.UserID, "@") {
			if h.userSvc == nil {
				handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "user service not initialized")
				return
			}
			u, err := h.userSvc.GetByEmail(req.UserID)
			if err != nil {
				handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "user not found")
				return
			}
			userID = u.ID
		}

		if err := h.memberSvc.AddMember(workspaceID, userID, req.Role, req.SubRoles); err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to add member")
			return
		}
		w.WriteHeader(http.StatusCreated)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// MemberByID 处理 DELETE / PUT /api/v1/workspaces/{id}/members/{userId}。
func (h *Handler) MemberByID(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	if !h.requireWorkspaceAdmin(w, r, workspaceID) {
		return
	}
	userID, ok := handler.PathValueOr404(w, r, "userId")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodDelete:
		// 删除空间管理员仅租户管理员（含超级管理员）可操作；空间管理员只能删除普通成员
		targetRole, err := h.memberSvc.GetMemberRole(workspaceID, userID)
		if err == nil && targetRole == object.MemberRoleSpaceAdmin && !h.requireSuperOrTenantAdmin(w, r) {
			return
		}
		assetAssigneeID := r.URL.Query().Get("assetAssigneeId")
		if err := h.memberSvc.RemoveMember(workspaceID, userID, assetAssigneeID); err != nil {
			handler.HandleServiceError(w, err, "member not found", "failed to remove member")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPut:
		// 查询目标成员当前角色，空间管理员之间的角色互改需要租户管理员/超级管理员权限。
		targetRole, err := h.memberSvc.GetMemberRole(workspaceID, userID)
		if err != nil {
			handler.HandleServiceError(w, err, "member not found", "failed to get member role")
			return
		}
		if targetRole == object.MemberRoleSpaceAdmin && !h.requireSuperOrTenantAdmin(w, r) {
			return
		}

		var req updateMemberRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if !isValidMemberRole(req.Role) {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid role")
			return
		}
		for _, subRole := range req.SubRoles {
			if !isValidMemberSubRole(subRole) {
				handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid subRole")
				return
			}
		}
		// 新角色设为空间管理员同样仅租户管理员（含超级管理员）可操作
		if req.Role == object.MemberRoleSpaceAdmin && !h.requireSuperOrTenantAdmin(w, r) {
			return
		}
		if err := h.memberSvc.UpdateMemberRole(workspaceID, userID, req.Role, req.SubRoles); err != nil {
			log.Printf("[Workspace] UpdateMemberRole failed: workspaceID=%s userID=%s role=%s subRoles=%v err=%v", workspaceID, userID, req.Role, req.SubRoles, err)
			handler.HandleServiceError(w, err, "member not found", "failed to update member role")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// WorkitemProject 处理 GET /api/v1/workspaces/{id}/workitem-project 与 POST /api/v1/workspaces/{id}/workitem-project。
func (h *Handler) WorkitemProject(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		wp, err := h.wiProjSvc.GetWorkitemProject(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workitem project not found", "failed to get workitem project")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(wp)
	case http.MethodPost:
		var req object.WorkitemProjectRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Platform == "" || req.ExternalKey == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "platform and externalKey are required")
			return
		}
		wp, err := h.wiProjSvc.SetWorkitemProject(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to set workitem project")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(wp)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// WorkspaceAgents 处理 GET /api/v1/workspaces/{id}/agents 与 POST /api/v1/workspaces/{id}/agents。
func (h *Handler) WorkspaceAgents(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		agents, err := h.agentSvc.ListAgents(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list agents")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(agents)
	case http.MethodPost:
		var req object.AgentRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name is required")
			return
		}
		agent, err := h.agentSvc.CreateAgent(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to create agent")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(agent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// WorkspaceStandards 处理 GET /api/v1/workspaces/{id}/standards 与 POST /api/v1/workspaces/{id}/standards。
func (h *Handler) WorkspaceStandards(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		repoID := r.URL.Query().Get("repositoryId")
		standards, err := h.standardSvc.ListStandards(workspaceID, repoID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list standards")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(standards)
	case http.MethodPost:
		var req object.StandardRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Type == "" || req.Name == "" || req.Content == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "type, name and content are required")
			return
		}
		standard, err := h.standardSvc.SaveStandard(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "standard not found", "failed to save standard")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(standard)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// WorkspaceStandardByID 处理 DELETE /api/v1/workspaces/{id}/standards/{standardId}。
func (h *Handler) WorkspaceStandardByID(w http.ResponseWriter, r *http.Request) {
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
		if err := h.standardSvc.DeleteStandard(workspaceID, standardID); err != nil {
			handler.HandleServiceError(w, err, "standard not found", "failed to delete standard")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// WorkspaceCICD 处理 GET /api/v1/workspaces/{id}/cicd。
// CI/CD 配置现在由超管在能力配置中维护，租户通过 cicd_config_id 关联；
// 工作空间仅读取其所属租户关联的全局配置。
func (h *Handler) WorkspaceCICD(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}

	cicd, err := h.cicdSvc.GetCICD(workspaceID)
	if err != nil {
		handler.HandleServiceError(w, err, "cicd not found", "failed to get cicd")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(cicd)
}

// CICDConfigs 处理 GET /api/v1/cicd-configs 与 POST /api/v1/cicd-configs。
// 仅超级管理员可操作：列出/创建平台级 CICD 配置。
func (h *Handler) CICDConfigs(w http.ResponseWriter, r *http.Request) {
	if !h.requireSuperAdmin(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		configs, err := h.cicdConfigSvc.ListCICDConfigs()
		if err != nil {
			handler.HandleServiceError(w, err, "cicd config not found", "failed to list cicd configs")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(configs)
	case http.MethodPost:
		var req object.CICDConfigRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name is required")
			return
		}
		config, err := h.cicdConfigSvc.CreateCICDConfig(req)
		if err != nil {
			handler.HandleServiceError(w, err, "cicd config not found", "failed to create cicd config")
			return
		}
		handler.SetJSONHeader(w)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(config)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// CICDConfigByID 处理 GET /api/v1/cicd-configs/{id}、PUT 更新与 DELETE 删除。
// 仅超级管理员可操作。
func (h *Handler) CICDConfigByID(w http.ResponseWriter, r *http.Request) {
	if !h.requireSuperAdmin(w, r) {
		return
	}

	id, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		config, err := h.cicdConfigSvc.GetCICDConfig(id)
		if err != nil {
			handler.HandleServiceError(w, err, "cicd config not found", "failed to get cicd config")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(config)
	case http.MethodPut:
		var req object.CICDConfigRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		if req.Name == "" {
			handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "name is required")
			return
		}
		config, err := h.cicdConfigSvc.UpdateCICDConfig(id, req)
		if err != nil {
			handler.HandleServiceError(w, err, "cicd config not found", "failed to update cicd config")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(config)
	case http.MethodDelete:
		if err := h.cicdConfigSvc.DeleteCICDConfig(id); err != nil {
			handler.HandleServiceError(w, err, "cicd config not found", "failed to delete cicd config")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
	}
}

// isValidMemberRole 校验成员角色是否合法。
func isValidMemberRole(role string) bool {
	return role == object.MemberRoleSpaceAdmin || role == object.MemberRoleMember
}

// isValidMemberSubRole 校验成员子角色是否合法。
func isValidMemberSubRole(subRole string) bool {
	switch subRole {
	case object.MemberSubRoleDeveloper, object.MemberSubRoleTester, object.MemberSubRolePM, object.MemberSubRoleDesigner:
		return true
	default:
		return false
	}
}

type createWorkspaceRequest struct {
	TenantID          string             `json:"tenantId"`
	Name              string             `json:"name"`
	Description       string             `json:"description"`
	OwnerUserID       string             `json:"ownerUserId"`
	SubRoles          []string           `json:"subRoles"`
	SourceWorkspaceID string             `json:"sourceWorkspaceId"`
	AgentPolicy       object.AgentPolicy `json:"agentPolicy"`
}

type updateWorkspaceRequest struct {
	Name        string             `json:"name"`
	Description string             `json:"description"`
	AgentPolicy object.AgentPolicy `json:"agentPolicy"`
}

type addMemberRequest struct {
	UserID   string   `json:"userId"`
	Role     string   `json:"role"`
	SubRoles []string `json:"subRoles"`
}

type updateMemberRequest struct {
	Role     string   `json:"role"`
	SubRoles []string `json:"subRoles"`
}
