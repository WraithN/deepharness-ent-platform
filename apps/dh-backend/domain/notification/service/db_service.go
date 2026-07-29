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

// Create 创建通知
func (s *DBNotificationService) Create(req object.CreateNotificationRequest) (object.Notification, error) {
	dataJSON, _ := json.Marshal(req.Data)
	actionStatus := object.ActionPending
	if req.ActionType == "" {
		actionStatus = ""
	}
	workspaceID := req.WorkspaceID
	var n object.Notification
	var returnedDataJSON string
	err := s.db.QueryRow(`
		INSERT INTO notifications (user_id, workspace_id, type, title, body, data, action_type, action_status, action_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, user_id, workspace_id, type, title, body, data, read, action_type, action_status, action_url, created_at, updated_at`,
		req.UserID, workspaceID, req.Type, req.Title, req.Body, string(dataJSON), req.ActionType, actionStatus, req.ActionURL,
	).Scan(&n.ID, &n.UserID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &returnedDataJSON, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return object.Notification{}, fmt.Errorf("create notification: %w", err)
	}
	if returnedDataJSON != "" && returnedDataJSON != "null" {
		_ = json.Unmarshal([]byte(returnedDataJSON), &n.Data)
	}
	return n, nil
}

// ListByWorkspaceAndUser 按工作空间和用户查询通知
func (s *DBNotificationService) ListByWorkspaceAndUser(workspaceID string, userID string, unreadOnly bool) ([]object.Notification, error) {
	query := `SELECT id, user_id, workspace_id, type, title, body, data, read, action_type, action_status, action_url, created_at, updated_at FROM notifications WHERE workspace_id = $1 AND user_id = $2`
	args := []any{workspaceID, userID}
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

// MarkAllAsRead 标记当前工作空间下所有通知已读
func (s *DBNotificationService) MarkAllAsRead(workspaceID string, userID string) error {
	_, err := s.db.Exec(`UPDATE notifications SET read = TRUE, updated_at = NOW() WHERE workspace_id = $1 AND user_id = $2 AND read = FALSE`, workspaceID, userID)
	return err
}

// GetByID 根据 ID 查询通知
func (s *DBNotificationService) GetByID(id string) (object.Notification, error) {
	var n object.Notification
	var dataJSON string
	err := s.db.QueryRow(`
		SELECT id, user_id, workspace_id, type, title, body, data, read, action_type, action_status, action_url, created_at, updated_at
		FROM notifications WHERE id = $1`, id,
	).Scan(&n.ID, &n.UserID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &dataJSON, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return object.Notification{}, fmt.Errorf("get notification: %w", err)
	}
	if dataJSON != "" && dataJSON != "null" {
		_ = json.Unmarshal([]byte(dataJSON), &n.Data)
	}
	return n, nil
}

// UpdateActionStatus 更新操作状态
func (s *DBNotificationService) UpdateActionStatus(id string, status string) (object.Notification, error) {
	var n object.Notification
	var dataJSON string
	err := s.db.QueryRow(`
		UPDATE notifications SET action_status = $2, read = TRUE, updated_at = NOW()
		WHERE id = $1
		RETURNING id, user_id, workspace_id, type, title, body, data, read, action_type, action_status, action_url, created_at, updated_at`,
		id, status,
	).Scan(&n.ID, &n.UserID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &dataJSON, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return object.Notification{}, fmt.Errorf("update action status: %w", err)
	}
	if dataJSON != "" && dataJSON != "null" {
		_ = json.Unmarshal([]byte(dataJSON), &n.Data)
	}
	return n, nil
}

// ListByTypeAndData 按工作空间、类型和 data 字段查询通知（编排层用于查重）
func (s *DBNotificationService) ListByTypeAndData(ctx context.Context, workspaceID string, notifType string, dataKey string, dataValue string) ([]object.Notification, error) {
	query := `SELECT id, user_id, workspace_id, type, title, body, data, read, action_type, action_status, action_url, created_at, updated_at
		FROM notifications WHERE workspace_id = $1 AND type = $2 AND data->>$3 = $4 ORDER BY created_at DESC LIMIT 10`
	rows, err := s.db.QueryContext(ctx, query, workspaceID, notifType, dataKey, dataValue)
	if err != nil {
		return nil, fmt.Errorf("list by type and data: %w", err)
	}
	defer rows.Close()
	return scanNotifications(rows)
}

func scanNotifications(rows *sql.Rows) ([]object.Notification, error) {
	var list []object.Notification
	for rows.Next() {
		var n object.Notification
		var dataJSON string
		if err := rows.Scan(&n.ID, &n.UserID, &n.WorkspaceID, &n.Type, &n.Title, &n.Body, &dataJSON, &n.Read, &n.ActionType, &n.ActionStatus, &n.ActionURL, &n.CreatedAt, &n.UpdatedAt); err != nil {
			log.Printf("[Notification] scan error: %v", err)
			continue
		}
		if dataJSON != "" && dataJSON != "null" {
			_ = json.Unmarshal([]byte(dataJSON), &n.Data)
		}
		list = append(list, n)
	}
	return list, nil
}
