package orchestrator

import (
	"context"
	"encoding/json"
	"net/http"

	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
)

// ProductFlowHandler 启动产品流程的 HTTP 处理器
type ProductFlowHandler struct {
	Orchestrator  *Orchestrator
	WorkspaceRoot string
	UserService   identityservice.UserService
}

// StartProductFlowRequest 启动产品流程请求
 type StartProductFlowRequest struct {
	WorkspaceID   string `json:"workspaceId"`
	TenantID      string `json:"tenantId"`
	WorkitemID    string `json:"workitemId"`
	WorkitemTitle string `json:"workitemTitle"`
	WorkitemDesc  string `json:"workitemDesc"`
}

// StartProductFlow 启动产品流程
func (h *ProductFlowHandler) StartProductFlow(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		writeProductFlowJSON(w, map[string]any{"code": 1, "message": "method not allowed"})
		return
	}

	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		writeProductFlowJSON(w, map[string]any{"code": 2, "message": "unauthorized"})
		return
	}

	// 使用真实用户名作为流程中 AI 节点的操作者展示名称，避免在详情卡片显示用户 ID
	userName := userID
	if h.UserService != nil {
		if user, err := h.UserService.GetByID(userID); err == nil && user.Name != "" {
			userName = user.Name
		}
	}

	var req StartProductFlowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeProductFlowJSON(w, map[string]any{"code": 3, "message": "invalid request body"})
		return
	}
	if req.WorkspaceID == "" || req.WorkitemID == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeProductFlowJSON(w, map[string]any{"code": 4, "message": "workspaceId and workitemId are required"})
		return
	}

	workspacePath, err := pathutil.ResolveWorkspaceRoot(h.WorkspaceRoot, userID, req.WorkspaceID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		writeProductFlowJSON(w, map[string]any{"code": 5, "message": err.Error()})
		return
	}

	// 流程在后台 goroutine 中异步执行，不能复用已被 HTTP 请求 cancel 的 context
	h.Orchestrator.StartProductFlow(context.Background(), userID, userName, req.WorkspaceID, req.TenantID, req.WorkitemID, req.WorkitemTitle, req.WorkitemDesc, workspacePath)

	writeProductFlowJSON(w, map[string]any{"code": 0, "message": "product flow started"})
}

func writeProductFlowJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
