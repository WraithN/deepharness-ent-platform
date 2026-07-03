package service

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/audit"
)

// DBEventService 是基于 PostgreSQL 的 EventService 实现。
type DBEventService struct {
	db *sql.DB
}

// NewDBEventService 创建 PostgreSQL 实现的审计事件服务。
func NewDBEventService(db *sql.DB) *DBEventService {
	return &DBEventService{db: db}
}

// ListEvents 返回全部审计事件列表。
func (s *DBEventService) ListEvents() ([]audit.Event, error) {
	rows, err := s.db.Query(`
		SELECT id, tenant_id, user_id, action, resource, details, created_at
		FROM audit_events
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list events failed: %w", err)
	}
	defer rows.Close()

	result := make([]audit.Event, 0)
	for rows.Next() {
		var e audit.Event
		var detailsJSON []byte
		err := rows.Scan(&e.ID, &e.TenantID, &e.UserID, &e.Action, &e.Resource, &detailsJSON, &e.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan event failed: %w", err)
		}
		e.Details = make(map[string]any)
		if len(detailsJSON) > 0 {
			if err := json.Unmarshal(detailsJSON, &e.Details); err != nil {
				return nil, fmt.Errorf("unmarshal event details failed: %w", err)
			}
		}
		result = append(result, e)
	}
	return result, rows.Err()
}
