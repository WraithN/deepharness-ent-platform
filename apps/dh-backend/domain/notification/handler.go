package notification

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
)

var defaultNotificationService service.NotificationService

// ActionCallback 通知操作回调，由编排层注入
type ActionCallback func(notificationID string, userID string, action string, data map[string]any)

var onAction ActionCallback

// SetActionCallback 注册通知操作回调
func SetActionCallback(cb ActionCallback) {
	onAction = cb
}

// Init 初始化通知服务
func Init(svc service.NotificationService) {
	defaultNotificationService = svc
}

// GetService 获取通知服务实例（供编排层调用）
func GetService() service.NotificationService {
	return defaultNotificationService
}

func notifyNotInitialized(w http.ResponseWriter) {
	handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "notification service not initialized")
}

// List 列出当前用户的通知（按租户维度，跨空间展示全部待办）
func List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultNotificationService == nil {
		notifyNotInitialized(w)
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	unreadOnly := r.URL.Query().Get("unread") == "true"
	// 从 users 表查询用户所属租户，按租户+用户维度展示通知
	tenantID, err := defaultNotificationService.GetUserTenantID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "failed to resolve tenant")
		return
	}
	list, err := defaultNotificationService.ListByTenantAndUser(tenantID, userID, unreadOnly)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	if list == nil {
		list = []object.Notification{}
	}
	json.NewEncoder(w).Encode(list)
}

// MarkAsRead 标记单条通知已读
func MarkAsRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultNotificationService == nil {
		notifyNotInitialized(w)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing notification id")
		return
	}
	if err := defaultNotificationService.MarkAsRead(id); err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// MarkAllAsRead 标记当前用户所有通知已读（跨空间）
func MarkAllAsRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultNotificationService == nil {
		notifyNotInitialized(w)
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	tenantID, err := defaultNotificationService.GetUserTenantID(userID)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, "failed to resolve tenant")
		return
	}
	if err := defaultNotificationService.MarkAllAsRead(tenantID, userID); err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Action 处理通知上的操作（批准/拒绝 AI 开发）
func Action(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultNotificationService == nil {
		notifyNotInitialized(w)
		return
	}
	id := r.PathValue("id")
	if id == "" {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "missing notification id")
		return
	}
	var req object.ActionNotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, handler.ErrCodeGeneral, "invalid request body")
		return
	}

	status := object.ActionApproved
	if req.Action == "reject" {
		status = object.ActionRejected
	}

	updated, err := defaultNotificationService.UpdateActionStatus(id, status)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, handler.ErrCodeGeneral, err.Error())
		return
	}
	// 将研发选择的仓库/工程名/目标空间注入 data，供编排层使用
	if req.Action == "approve" {
		if updated.Data == nil {
			updated.Data = map[string]any{}
		}
		updated.Data["repositoryId"] = req.RepositoryID
		updated.Data["projectName"] = req.ProjectName
		if req.WorkspaceID != "" {
			updated.Data["targetWorkspaceId"] = req.WorkspaceID
		}
		if req.Prompt != "" {
			updated.Data["developerPrompt"] = req.Prompt
		}
		if req.Approved != nil {
			updated.Data["approved"] = *req.Approved
		}
		if req.Reason != "" {
			updated.Data["rejectReason"] = req.Reason
		}
	}
	if onAction != nil && req.Action == "approve" {
		userID, _ := middleware.UserIDFromContext(r.Context())
		safego.Go("notification-action", func() { onAction(id, userID, req.Action, updated.Data) })
	}
	json.NewEncoder(w).Encode(updated)
}
