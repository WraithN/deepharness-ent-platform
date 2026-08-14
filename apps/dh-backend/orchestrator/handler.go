package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
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
	DocPath       string `json:"docPath,omitempty"`
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
	processID, err := h.Orchestrator.StartProductFlow(context.Background(), userID, userName, req.WorkspaceID, req.TenantID, req.WorkitemID, req.WorkitemTitle, req.WorkitemDesc, req.DocPath, workspacePath)
	if err != nil {
		if errors.Is(err, ErrProductFlowInProgress) {
			w.WriteHeader(http.StatusConflict)
			writeProductFlowJSON(w, map[string]any{"code": handler.ErrCodeProductFlowInProgress, "message": err.Error()})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		writeProductFlowJSON(w, map[string]any{"code": handler.ErrCodeGeneral, "message": err.Error()})
		return
	}

	writeProductFlowJSON(w, map[string]any{"code": 0, "message": "product flow started", "processId": processID})
}

func writeProductFlowJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// RetryProductFlow 重试产品流程的失败节点。
func (h *ProductFlowHandler) RetryProductFlow(w http.ResponseWriter, r *http.Request) {
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

	processID := r.PathValue("id")
	if processID == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeProductFlowJSON(w, map[string]any{"code": 4, "message": "process id is required"})
		return
	}

	userName := userID
	if h.UserService != nil {
		if user, err := h.UserService.GetByID(userID); err == nil && user.Name != "" {
			userName = user.Name
		}
	}

	if err := h.Orchestrator.RetryProductFlow(context.Background(), processID, userID, userName); err != nil {
		if errors.Is(err, ErrProductFlowRetryUnavailable) {
			w.WriteHeader(http.StatusConflict)
			writeProductFlowJSON(w, map[string]any{"code": 6, "message": err.Error()})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		writeProductFlowJSON(w, map[string]any{"code": handler.ErrCodeGeneral, "message": err.Error()})
		return
	}

	writeProductFlowJSON(w, map[string]any{"code": 0, "message": "product flow retry started", "processId": processID})
}

// AiDraftReviewRequest 是 AI 草案复核人工通过/拒绝的请求体。
type AiDraftReviewRequest struct {
	Approved bool `json:"approved"`
}

// AiDraftReview 处理 AI 草案复核的人工通过/拒绝（从流程详情页提交）。
func (h *ProductFlowHandler) AiDraftReview(w http.ResponseWriter, r *http.Request) {
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

	processID := r.PathValue("id")
	if processID == "" {
		w.WriteHeader(http.StatusBadRequest)
		writeProductFlowJSON(w, map[string]any{"code": 4, "message": "process id is required"})
		return
	}

	var req AiDraftReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		writeProductFlowJSON(w, map[string]any{"code": 3, "message": "invalid request body"})
		return
	}

	userName := userID
	if h.UserService != nil {
		if user, err := h.UserService.GetByID(userID); err == nil && user.Name != "" {
			userName = user.Name
		}
	}

	if err := h.Orchestrator.AiDraftReview(context.Background(), processID, userID, userName, req.Approved); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		writeProductFlowJSON(w, map[string]any{"code": handler.ErrCodeGeneral, "message": err.Error()})
		return
	}

	writeProductFlowJSON(w, map[string]any{"code": 0, "message": "ai draft review decision submitted"})
}
