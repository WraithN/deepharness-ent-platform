// Package agentruntime 处理 Agent 运行时模块的 HTTP 请求。
package agentruntime

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

// parsePageInt 解析分页查询参数，解析失败或非法时返回默认值。
func parsePageInt(value string, defaultValue int) int {
	if value == "" {
		return defaultValue
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return defaultValue
	}
	return n
}

var defaultAgentRuntimeService service.AgentRuntimeService

// Init 注入 Agent 运行时服务实例。
func Init(svc service.AgentRuntimeService) {
	defaultAgentRuntimeService = svc
}

// ReportStatus 处理 POST /api/v1/agent-runtimes/{id}/status，供外部 gatewayd / personal-stub 上报状态。
// 该接口使用固定 Bearer Token 认证，不依赖用户登录态。
func ReportStatus(w http.ResponseWriter, r *http.Request) {
	if defaultAgentRuntimeService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "agent runtime service not initialized")
		return
	}

	if r.Method != http.MethodPost {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	runtimeID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	var req object.ReportStatusRequest
	if !handler.DecodeJSONBody(w, r, &req) {
		return
	}

	rt, err := defaultAgentRuntimeService.ReportStatus(runtimeID, req)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}

	handler.SetJSONHeader(w)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(rt)
}

// ListRuntimes 处理 GET /api/v1/agent-runtimes。
// 超级管理员可查看全部；普通用户只能查看自己上报的运行时。
func ListRuntimes(w http.ResponseWriter, r *http.Request) {
	if defaultAgentRuntimeService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "agent runtime service not initialized")
		return
	}
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}

	filter := object.ListRuntimesFilter{
		TenantID:    r.URL.Query().Get("tenantId"),
		WorkspaceID: r.URL.Query().Get("workspaceId"),
		UserID:      r.URL.Query().Get("userId"),
		AgentType:   r.URL.Query().Get("agentType"),
		Page:        parsePageInt(r.URL.Query().Get("page"), 1),
		PageSize:    parsePageInt(r.URL.Query().Get("pageSize"), 10),
	}

	// 非超级管理员只能查看自己的运行时，强制覆盖 userId 过滤条件。
	if !identity.IsSuperAdmin(r) {
		filter.UserID = userID
	}

	result, err := defaultAgentRuntimeService.List(filter)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}

	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(result)
}

// GetRuntime 处理 GET /api/v1/agent-runtimes/{id}。
// 超级管理员可查看任意运行时；普通用户只能查看自己的运行时。
func GetRuntime(w http.ResponseWriter, r *http.Request) {
	if defaultAgentRuntimeService == nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, "agent runtime service not initialized")
		return
	}
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		handler.WriteJSONError(w, http.StatusUnauthorized, 2, "unauthorized")
		return
	}

	runtimeID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	rt, err := defaultAgentRuntimeService.Get(runtimeID)
	if err != nil {
		handler.HandleServiceError(w, err, "runtime not found", "failed to get runtime")
		return
	}

	if !identity.IsSuperAdmin(r) && rt.UserID != userID {
		handler.WriteJSONError(w, http.StatusForbidden, 3, "forbidden")
		return
	}

	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(rt)
}
