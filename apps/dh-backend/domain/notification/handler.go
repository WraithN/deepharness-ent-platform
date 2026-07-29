package notification

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/service"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
)

var defaultNotificationService service.NotificationService
var workspaceService workspaceservice.WorkspaceService

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

// SetWorkspaceService 注入工作空间服务（用于AI开发工程绑定检查）
func SetWorkspaceService(svc workspaceservice.WorkspaceService) {
	workspaceService = svc
}

func notifyNotInitialized(w http.ResponseWriter) {
	handler.WriteJSONError(w, http.StatusInternalServerError, 1, "notification service not initialized")
}

// List 列出当前工作空间下用户的通知
func List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultNotificationService == nil {
		notifyNotInitialized(w)
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	workspaceID := r.URL.Query().Get("workspaceId")
	unreadOnly := r.URL.Query().Get("unread") == "true"
	list, err := defaultNotificationService.ListByWorkspaceAndUser(workspaceID, userID, unreadOnly)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
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
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "missing notification id")
		return
	}
	if err := defaultNotificationService.MarkAsRead(id); err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// MarkAllAsRead 标记当前工作空间下所有通知已读
func MarkAllAsRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if defaultNotificationService == nil {
		notifyNotInitialized(w)
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())
	workspaceID := r.URL.Query().Get("workspaceId")
	if err := defaultNotificationService.MarkAllAsRead(workspaceID, userID); err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
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
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "missing notification id")
		return
	}
	var req object.ActionNotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		handler.WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}

	status := object.ActionApproved
	if req.Action == "reject" {
		status = object.ActionRejected
	}

	if req.Action == "approve" {
		if err := checkProjectBinding(id); err != nil {
			handler.WriteJSONError(w, http.StatusBadRequest, 1, "请先在研发空间中绑定AI开发工程，再进行批准操作")
			return
		}
	}

	updated, err := defaultNotificationService.UpdateActionStatus(id, status)
	if err != nil {
		handler.WriteJSONError(w, http.StatusInternalServerError, 1, err.Error())
		return
	}
	if onAction != nil && req.Action == "approve" {
		userID, _ := middleware.UserIDFromContext(r.Context())
		go onAction(id, userID, req.Action, updated.Data)
	}
	json.NewEncoder(w).Encode(updated)
}

// checkProjectBinding 检查工作空间是否已绑定AI开发工程
func checkProjectBinding(notificationID string) error {
	notif, err := defaultNotificationService.GetByID(notificationID)
	if err != nil {
		return err
	}
	if workspaceService == nil {
		return nil
	}
	_, err = workspaceService.GetWorkitemProject(notif.WorkspaceID)
	if err != nil {
		return err
	}
	return nil
}
