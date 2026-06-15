package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

// MySQLStore 是基于 MySQL 的 SessionStore + MessageStore 实现。
type MySQLStore struct {
	db *sql.DB
}

// NewMySQLStore 创建 MySQL 存储实现。
func NewMySQLStore(db *sql.DB) *MySQLStore {
	return &MySQLStore{db: db}
}

// ── SessionStore ──

func (s *MySQLStore) Create(ctx context.Context, sess chat.Session) error {
	ctxJSON, err := json.Marshal(sess.Context)
	if err != nil {
		return fmt.Errorf("marshal context failed: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO agent_sessions (id, agent_type, model, project_id, title, context, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, sess.ID, sess.AgentType, sess.Model, sess.ProjectID, sess.Title, ctxJSON, sess.CreatedAt, sess.UpdatedAt)
	if err != nil {
		return fmt.Errorf("insert session failed: %w", err)
	}
	return nil
}

func (s *MySQLStore) Get(ctx context.Context, id string) (chat.Session, error) {
	var sess chat.Session
	var ctxJSON []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT id, agent_type, model, project_id, title, context, created_at, updated_at
		FROM agent_sessions WHERE id = ?
	`, id).Scan(&sess.ID, &sess.AgentType, &sess.Model, &sess.ProjectID, &sess.Title, &ctxJSON, &sess.CreatedAt, &sess.UpdatedAt)
	if err == sql.ErrNoRows {
		return chat.Session{}, fmt.Errorf("session not found: %s", id)
	}
	if err != nil {
		return chat.Session{}, fmt.Errorf("get session failed: %w", err)
	}
	if len(ctxJSON) > 0 {
		_ = json.Unmarshal(ctxJSON, &sess.Context)
	}
	return sess, nil
}

func (s *MySQLStore) UpdateActivity(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_sessions SET updated_at = NOW(3) WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("update session activity failed: %w", err)
	}
	return nil
}

func (s *MySQLStore) UpdateTitle(ctx context.Context, id string, title string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_sessions SET title = ? WHERE id = ?`, title, id)
	if err != nil {
		return fmt.Errorf("update session title failed: %w", err)
	}
	return nil
}

func (s *MySQLStore) Delete(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agent_sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete session failed: %w", err)
	}
	return nil
}

func (s *MySQLStore) ListSessions(ctx context.Context) ([]chat.Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, agent_type, model, project_id, title, context, created_at, updated_at
		FROM agent_sessions
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list sessions failed: %w", err)
	}
	defer rows.Close()

	result := make([]chat.Session, 0)
	for rows.Next() {
		var sess chat.Session
		var ctxJSON []byte
		if err := rows.Scan(&sess.ID, &sess.AgentType, &sess.Model, &sess.ProjectID, &sess.Title, &ctxJSON, &sess.CreatedAt, &sess.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan session failed: %w", err)
		}
		if len(ctxJSON) > 0 {
			_ = json.Unmarshal(ctxJSON, &sess.Context)
		}
		result = append(result, sess)
	}
	return result, rows.Err()
}

// ── MessageStore ──

func (s *MySQLStore) Append(ctx context.Context, sessionID string, msg chat.Message) error {
	metaJSON, err := json.Marshal(msg.Metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata failed: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO agent_messages (id, session_id, role, type, content, metadata, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, msg.ID, sessionID, msg.Role, msg.Type, msg.Content, metaJSON, msg.Timestamp)
	if err != nil {
		return fmt.Errorf("insert message failed: %w", err)
	}
	return nil
}

func (s *MySQLStore) GetHistory(ctx context.Context, sessionID string, limit int) ([]chat.Message, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, role, type, content, metadata, created_at
		FROM agent_messages
		WHERE session_id = ?
		ORDER BY created_at ASC
		LIMIT ?
	`, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("get history failed: %w", err)
	}
	defer rows.Close()

	result := make([]chat.Message, 0)
	for rows.Next() {
		var msg chat.Message
		var metaJSON []byte
		if err := rows.Scan(&msg.ID, &msg.SessionID, &msg.Role, &msg.Type, &msg.Content, &metaJSON, &msg.Timestamp); err != nil {
			return nil, fmt.Errorf("scan message failed: %w", err)
		}
		if len(metaJSON) > 0 {
			_ = json.Unmarshal(metaJSON, &msg.Metadata)
		}
		result = append(result, msg)
	}
	return result, rows.Err()
}
