package service

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
)

// NotificationService 通知服务接口
type NotificationService interface {
	Create(req object.CreateNotificationRequest) (object.Notification, error)
	ListByWorkspaceAndUser(workspaceID string, userID string, unreadOnly bool) ([]object.Notification, error)
	MarkAsRead(id string) error
	MarkAllAsRead(workspaceID string, userID string) error
	GetByID(id string) (object.Notification, error)
	UpdateActionStatus(id string, status string) (object.Notification, error)
	ListByTypeAndData(ctx context.Context, workspaceID string, notifType string, dataKey string, dataValue string) ([]object.Notification, error)
}
