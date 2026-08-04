package service

import (
	"database/sql"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/sessionmanager/object"
)

// DBSessionService 是基于 PostgreSQL 的 SessionService 实现。
type DBSessionService struct {
	db *sql.DB
}

// NewDBSessionService 创建 PostgreSQL 实现的编排会话服务。
func NewDBSessionService(db *sql.DB) *DBSessionService {
	return &DBSessionService{db: db}
}

// ListSessions 返回全部编排会话列表。
func (s *DBSessionService) ListSessions() ([]object.AgentSession, error) {
	rows, err := s.db.Query(`
		SELECT id, title, agent_type, model, status, created_at, updated_at
		FROM orchestrator_sessions
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list sessions failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.AgentSession, 0)
	for rows.Next() {
		var sess object.AgentSession
		err := rows.Scan(&sess.ID, &sess.Title, &sess.AgentType, &sess.Model, &sess.Status, &sess.CreatedAt, &sess.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan session failed: %w", err)
		}
		result = append(result, sess)
	}
	return result, rows.Err()
}
