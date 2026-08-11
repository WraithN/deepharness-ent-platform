package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
	"github.com/lib/pq"
)

// isDuplicateKeyError 判断 err 是否为 PostgreSQL 唯一约束冲突（SQLSTATE 23505）。
// 兼容 pq / pgx 等不同驱动：先尝试类型断言，再按错误文本和 SQLSTATE 兜底。
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && pqErr.Code == "23505" {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") || strings.Contains(msg, "unique constraint")
}

// PostgresStore 是基于 PostgreSQL 的 SessionStore + MessageStore 实现。
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore 创建 PostgreSQL 存储实现。
func NewPostgresStore(db *sql.DB) *PostgresStore {
	return &PostgresStore{db: db}
}

// ── SessionStore ──

func (s *PostgresStore) Create(ctx context.Context, sess chat.Session) error {
	ctxJSON, err := json.Marshal(sess.Context)
	if err != nil {
		return fmt.Errorf("marshal context failed: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO agent_sessions (id, workspace_id, workspace_path, user_id, agent_id, agent_type, model, project_id, title, context, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, sess.ID, sess.WorkspaceID, sess.WorkspacePath, sess.UserID, sess.AgentID, sess.AgentType, sess.Model, sess.ProjectID, sess.Title, ctxJSON, sess.CreatedAt, sess.UpdatedAt)
	if err != nil {
		// 唯一冲突（session id 已存在）使用类型化错误，便于调用方用 errors.Is 识别。
		if isDuplicateKeyError(err) {
			return fmt.Errorf("%w: insert session failed: %v", common.ErrAlreadyExists, err)
		}
		return fmt.Errorf("insert session failed: %w", err)
	}
	return nil
}

func (s *PostgresStore) Get(ctx context.Context, id string) (chat.Session, error) {
	var sess chat.Session
	var ctxJSON []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT id, workspace_id, COALESCE(workspace_path, ''), COALESCE(user_id, ''), agent_id, agent_type, model, project_id, title, context, created_at, updated_at
		FROM agent_sessions WHERE id = $1
	`, id).Scan(&sess.ID, &sess.WorkspaceID, &sess.WorkspacePath, &sess.UserID, &sess.AgentID, &sess.AgentType, &sess.Model, &sess.ProjectID, &sess.Title, &ctxJSON, &sess.CreatedAt, &sess.UpdatedAt)
	if err == sql.ErrNoRows {
		return chat.Session{}, common.NotFoundErrorf("session not found: %s", id)
	}
	if err != nil {
		return chat.Session{}, fmt.Errorf("get session failed: %w", err)
	}
	if len(ctxJSON) > 0 {
		if err := json.Unmarshal(ctxJSON, &sess.Context); err != nil {
			return chat.Session{}, fmt.Errorf("unmarshal session context failed: %w", err)
		}
	}
	return sess, nil
}

func (s *PostgresStore) UpdateActivity(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_sessions SET updated_at = NOW() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("update session activity failed: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateTitle(ctx context.Context, id string, title string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_sessions SET title = $1 WHERE id = $2`, title, id)
	if err != nil {
		return fmt.Errorf("update session title failed: %w", err)
	}
	return nil
}

func (s *PostgresStore) Delete(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM agent_sessions WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete session failed: %w", err)
	}
	return nil
}

func (s *PostgresStore) ListSessions(ctx context.Context, workspaceID, userID string) ([]chat.Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workspace_id, COALESCE(workspace_path, ''), COALESCE(user_id, ''), agent_id, agent_type, model, project_id, title, context, created_at, updated_at
		FROM agent_sessions
		WHERE workspace_id = $1 AND ($2 = '' OR COALESCE(user_id, '') = '' OR user_id = $2)
		ORDER BY updated_at DESC
	`, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions failed: %w", err)
	}
	defer rows.Close()

	result := make([]chat.Session, 0)
	for rows.Next() {
		var sess chat.Session
		var ctxJSON []byte
		if err := rows.Scan(&sess.ID, &sess.WorkspaceID, &sess.WorkspacePath, &sess.UserID, &sess.AgentID, &sess.AgentType, &sess.Model, &sess.ProjectID, &sess.Title, &ctxJSON, &sess.CreatedAt, &sess.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan session failed: %w", err)
		}
		if len(ctxJSON) > 0 {
			if err := json.Unmarshal(ctxJSON, &sess.Context); err != nil {
				return nil, fmt.Errorf("unmarshal session context failed: %w", err)
			}
		}
		result = append(result, sess)
	}
	return result, rows.Err()
}

// ── 统计查询 ──

// GetSessionTrend 返回指定工作空间最近 days 天每天的会话创建数量。
func (s *PostgresStore) GetSessionTrend(ctx context.Context, workspaceID string, days int) ([]chat.DateCount, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DATE(created_at) AS d, COUNT(*) AS c
		FROM agent_sessions
		WHERE workspace_id = $1 AND created_at >= NOW() - make_interval(days => $2)
		GROUP BY d
		ORDER BY d
	`, workspaceID, days)
	if err != nil {
		return nil, fmt.Errorf("query session trend failed: %w", err)
	}
	defer rows.Close()

	result := make([]chat.DateCount, 0)
	for rows.Next() {
		var dc chat.DateCount
		if err := rows.Scan(&dc.Date, &dc.Count); err != nil {
			return nil, fmt.Errorf("scan date count failed: %w", err)
		}
		result = append(result, dc)
	}
	return result, rows.Err()
}

// GetSessionTrails 返回指定工作空间最近 limit 条会话轨迹（含消息数量）。
func (s *PostgresStore) GetSessionTrails(ctx context.Context, workspaceID string, limit int) ([]chat.SessionTrailInfo, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, COALESCE(s.user_id, ''), COALESCE(u.name, ''), COALESCE(s.title, ''), s.agent_type, s.created_at, s.updated_at,
		       COUNT(DISTINCT m.id) AS msg_count
		FROM agent_sessions s
		LEFT JOIN users u ON u.id = s.user_id
		LEFT JOIN agent_messages m ON m.session_id = s.id
		WHERE s.workspace_id = $1
		GROUP BY s.id, u.name
		ORDER BY s.updated_at DESC
		LIMIT $2
	`, workspaceID, limit)
	if err != nil {
		return nil, fmt.Errorf("query session trails failed: %w", err)
	}
	defer rows.Close()

	result := make([]chat.SessionTrailInfo, 0)
	for rows.Next() {
		var t chat.SessionTrailInfo
		if err := rows.Scan(&t.ID, &t.UserID, &t.UserName, &t.Title, &t.AgentType, &t.CreatedAt, &t.UpdatedAt, &t.MessageCount); err != nil {
			return nil, fmt.Errorf("scan session trail failed: %w", err)
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

// ── MessageStore ──

func (s *PostgresStore) Append(ctx context.Context, sessionID string, msg chat.Message) error {
	metaJSON, err := json.Marshal(msg.Metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata failed: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO agent_messages (id, session_id, role, type, content, metadata, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE SET
			role = EXCLUDED.role,
			type = EXCLUDED.type,
			content = EXCLUDED.content,
			metadata = EXCLUDED.metadata,
			created_at = EXCLUDED.created_at
	`, msg.ID, sessionID, msg.Role, msg.Type, msg.Content, metaJSON, msg.Timestamp)
	if err != nil {
		return fmt.Errorf("insert message failed: %w", err)
	}
	return nil
}

func (s *PostgresStore) GetHistory(ctx context.Context, sessionID string, limit int) ([]chat.Message, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, role, type, content, metadata, created_at
		FROM agent_messages
		WHERE session_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("get history failed: %w", err)
	}
	defer rows.Close()

	result := make([]chat.Message, 0, limit)
	for rows.Next() {
		var msg chat.Message
		var metaJSON []byte
		if err := rows.Scan(&msg.ID, &msg.SessionID, &msg.Role, &msg.Type, &msg.Content, &metaJSON, &msg.Timestamp); err != nil {
			return nil, fmt.Errorf("scan message failed: %w", err)
		}
		if len(metaJSON) > 0 {
			if err := json.Unmarshal(metaJSON, &msg.Metadata); err != nil {
				return nil, fmt.Errorf("unmarshal message metadata failed: %w", err)
			}
		}
		result = append(result, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages failed: %w", err)
	}
	// 按时间正序返回，与内存实现一致。
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result, nil
}

// MigrateMessages 将旧 sessionID 下的所有消息迁移到新 sessionID。
func (s *PostgresStore) MigrateMessages(ctx context.Context, oldSessionID, newSessionID string) error {
	if oldSessionID == newSessionID {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migrate messages transaction failed: %w", err)
	}
	defer tx.Rollback()

	// 预检目标 session 是否存在，不存在则创建占位记录，避免外键约束失败。
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM agent_sessions WHERE id = $1)`, newSessionID).Scan(&exists); err != nil {
		return fmt.Errorf("check target session failed: %w", err)
	}
	if !exists {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO agent_sessions (id, workspace_id, user_id, agent_id, agent_type, model, project_id, title, context, created_at, updated_at)
			VALUES ($1, '', '', 'agent-default', 'chat', '', '', '', '{}', NOW(), NOW())
		`, newSessionID); err != nil {
			return fmt.Errorf("create target session placeholder failed: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE agent_messages SET session_id = $1 WHERE session_id = $2
	`, newSessionID, oldSessionID); err != nil {
		return fmt.Errorf("migrate messages failed: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migrate messages failed: %w", err)
	}
	return nil
}

// ── WorkitemID ──

// UpdateWorkitemID 仅在当前 workitem_id 为空时写入，首条引用锁定，避免关联漂移。
func (s *PostgresStore) UpdateWorkitemID(ctx context.Context, sessionID, workitemID string) error {
	if workitemID == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE agent_sessions SET workitem_id = $1
		WHERE id = $2 AND (workitem_id IS NULL OR workitem_id = '')
	`, workitemID, sessionID)
	if err != nil {
		return fmt.Errorf("update session workitem_id failed: %w", err)
	}
	return nil
}

// GetWorkitemID 返回会话关联的需求 ID，未关联时返回空字符串。
func (s *PostgresStore) GetWorkitemID(ctx context.Context, sessionID string) (string, error) {
	var workitemID sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT workitem_id FROM agent_sessions WHERE id = $1`, sessionID,
	).Scan(&workitemID)
	if err != nil {
		return "", fmt.Errorf("get session workitem_id failed: %w", err)
	}
	return workitemID.String, nil
}
