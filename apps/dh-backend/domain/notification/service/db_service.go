package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
)

// DBNotificationService PostgreSQL 实现
type DBNotificationService struct {
	db *sql.DB
}

// NewDBNotificationService 创建 DB 通知服务
func NewDBNotificationService(db *sql.DB) *DBNotificationService {
	return &DBNotificationService{db: db}
}

// notificationColumns 是统一的 SELECT 列列表
const notificationColumns = `id, user_id, tenant_id, workspace_id, type, title, body, data, read, action_type, action_status, action_url, created_at, updated_at`

// scanNotification 扫描单行通知数据
func scanNotification(scanner interface{ Scan(dest ...any) error }, n *object.Notification) error {
	var dataJSON string
	err := scanner.Scan(&n.ID, &n.UserID, &n.TenantID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &dataJSON, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return err
	}
	if dataJSON != "" && dataJSON != "null" {
		_ = json.Unmarshal([]byte(dataJSON), &n.Data)
	}
	return nil
}

// Create 创建通知
func (s *DBNotificationService) Create(req object.CreateNotificationRequest) (object.Notification, error) {
	dataJSON, _ := json.Marshal(req.Data)
	actionStatus := object.ActionPending
	if req.ActionType == "" {
		actionStatus = ""
	}
	var n object.Notification
	var returnedDataJSON string
	err := s.db.QueryRow(`
		INSERT INTO notifications (user_id, tenant_id, workspace_id, type, title, body, data, action_type, action_status, action_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING `+notificationColumns,
		req.UserID, req.TenantID, req.WorkspaceID, req.Type, req.Title, req.Body, string(dataJSON), req.ActionType, actionStatus, req.ActionURL,
	).Scan(&n.ID, &n.UserID, &n.TenantID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &returnedDataJSON, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return object.Notification{}, fmt.Errorf("create notification: %w", err)
	}
	if returnedDataJSON != "" && returnedDataJSON != "null" {
		_ = json.Unmarshal([]byte(returnedDataJSON), &n.Data)
	}
	return n, nil
}

// ListByTenantAndUser 按租户和用户查询通知（跨空间展示全部待办）
func (s *DBNotificationService) ListByTenantAndUser(tenantID string, userID string, unreadOnly bool) ([]object.Notification, error) {
	query := fmt.Sprintf(`SELECT %s FROM notifications WHERE tenant_id = $1 AND user_id = $2`, notificationColumns)
	args := []any{tenantID, userID}
	if unreadOnly {
		query += ` AND read = FALSE`
	}
	query += ` ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()
	return scanNotifications(rows)
}

// MarkAsRead 标记已读
func (s *DBNotificationService) MarkAsRead(id string) error {
	_, err := s.db.Exec(`UPDATE notifications SET read = TRUE, updated_at = NOW() WHERE id = $1`, id)
	return err
}

// MarkAllAsRead 标记当前租户下用户所有通知已读
func (s *DBNotificationService) MarkAllAsRead(tenantID string, userID string) error {
	_, err := s.db.Exec(`UPDATE notifications SET read = TRUE, updated_at = NOW() WHERE tenant_id = $1 AND user_id = $2 AND read = FALSE`, tenantID, userID)
	return err
}

// GetByID 根据 ID 查询通知
func (s *DBNotificationService) GetByID(id string) (object.Notification, error) {
	var n object.Notification
	err := s.db.QueryRow(fmt.Sprintf(`SELECT %s FROM notifications WHERE id = $1`, notificationColumns), id).Scan(
		&n.ID, &n.UserID, &n.TenantID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &sql.NullString{}, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return object.Notification{}, fmt.Errorf("get notification: %w", err)
	}
	// 重新查询以正确解析 data JSON
	row := s.db.QueryRow(fmt.Sprintf(`SELECT %s FROM notifications WHERE id = $1`, notificationColumns), id)
	if err := scanNotification(row, &n); err != nil {
		return object.Notification{}, fmt.Errorf("get notification rescan: %w", err)
	}
	return n, nil
}

// UpdateActionStatus 更新操作状态
func (s *DBNotificationService) UpdateActionStatus(id string, status string) (object.Notification, error) {
	var n object.Notification
	err := s.db.QueryRow(`
		UPDATE notifications SET action_status = $2, read = TRUE, updated_at = NOW()
		WHERE id = $1
		RETURNING `+notificationColumns,
		id, status,
	).Scan(&n.ID, &n.UserID, &n.TenantID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &sql.NullString{}, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return object.Notification{}, fmt.Errorf("update action status: %w", err)
	}
	// 重新查询以正确解析 data JSON
	row := s.db.QueryRow(fmt.Sprintf(`SELECT %s FROM notifications WHERE id = $1`, notificationColumns), id)
	if err := scanNotification(row, &n); err != nil {
		return object.Notification{}, fmt.Errorf("update action status rescan: %w", err)
	}
	return n, nil
}

// ListByTypeAndData 按租户、类型和 data 字段查询通知（编排层用于查重）
func (s *DBNotificationService) ListByTypeAndData(ctx context.Context, tenantID string, notifType string, dataKey string, dataValue string) ([]object.Notification, error) {
	query := fmt.Sprintf(`SELECT %s FROM notifications WHERE tenant_id = $1 AND type = $2 AND data->>$3 = $4 ORDER BY created_at DESC LIMIT 10`, notificationColumns)
	rows, err := s.db.QueryContext(ctx, query, tenantID, notifType, dataKey, dataValue)
	if err != nil {
		return nil, fmt.Errorf("list by type and data: %w", err)
	}
	defer rows.Close()
	return scanNotifications(rows)
}

// GetUserTenantID 从 users 表查询用户的租户 ID
func (s *DBNotificationService) GetUserTenantID(userID string) (string, error) {
	var tenantID string
	err := s.db.QueryRow(`SELECT tenant_id FROM users WHERE id = $1`, userID).Scan(&tenantID)
	if err != nil {
		return "", fmt.Errorf("get user tenant_id: %w", err)
	}
	return tenantID, nil
}

func scanNotifications(rows *sql.Rows) ([]object.Notification, error) {
	var list []object.Notification
	for rows.Next() {
		var n object.Notification
		if err := scanNotification(rows, &n); err != nil {
			log.Printf("[Notification] scan error: %v", err)
			continue
		}
		list = append(list, n)
	}
	return list, nil
}
