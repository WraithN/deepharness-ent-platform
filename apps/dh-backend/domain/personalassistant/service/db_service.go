package service

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/object"
	"github.com/google/uuid"
)

// DBPersonalAssistantService 是基于 MySQL 的 PersonalAssistantService 实现。
type DBPersonalAssistantService struct {
	db *sql.DB
}

// NewDBPersonalAssistantService 创建 MySQL 实现的个人助手服务。
func NewDBPersonalAssistantService(db *sql.DB) *DBPersonalAssistantService {
	return &DBPersonalAssistantService{db: db}
}

// ListAssistants 返回全部助手，并根据 userID 计算 isMine。
func (s *DBPersonalAssistantService) ListAssistants(userID string) ([]object.PersonalAssistant, error) {
	rows, err := s.db.Query(`
		SELECT id, name, role, description, creator_id, creator_name, avatar_url, created_at, updated_at
		FROM personal_assistants
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list assistants failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.PersonalAssistant, 0)
	for rows.Next() {
		var a object.PersonalAssistant
		var avatarURL sql.NullString
		err := rows.Scan(&a.ID, &a.Name, &a.Role, &a.Description, &a.CreatorID, &a.CreatorName, &avatarURL, &a.CreatedAt, &a.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan assistant failed: %w", err)
		}
		if avatarURL.Valid {
			a.AvatarURL = avatarURL.String
		}
		a.IsMine = a.CreatorID == userID
		result = append(result, a)
	}
	return result, rows.Err()
}

// CreateAssistant 创建新助手并落库。
func (s *DBPersonalAssistantService) CreateAssistant(userID, userName string, req CreateAssistantRequest) (object.PersonalAssistant, error) {
	now := time.Now().UTC()
	assistant := object.PersonalAssistant{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Role:        req.Role,
		Description: req.Description,
		CreatorID:   userID,
		CreatorName: userName,
		IsMine:      true,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	_, err := s.db.Exec(`
		INSERT INTO personal_assistants (id, name, role, description, creator_id, creator_name, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, assistant.ID, assistant.Name, assistant.Role, assistant.Description, assistant.CreatorID, assistant.CreatorName, assistant.CreatedAt, assistant.UpdatedAt)
	if err != nil {
		return object.PersonalAssistant{}, fmt.Errorf("insert assistant failed: %w", err)
	}
	return assistant, nil
}

// GetAssistant 按 ID 查询助手。
func (s *DBPersonalAssistantService) GetAssistant(id string) (object.PersonalAssistant, error) {
	var a object.PersonalAssistant
	var avatarURL sql.NullString
	err := s.db.QueryRow(`
		SELECT id, name, role, description, creator_id, creator_name, avatar_url, created_at, updated_at
		FROM personal_assistants
		WHERE id = $1
	`, id).Scan(&a.ID, &a.Name, &a.Role, &a.Description, &a.CreatorID, &a.CreatorName, &avatarURL, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return object.PersonalAssistant{}, errors.New("assistant not found")
	}
	if err != nil {
		return object.PersonalAssistant{}, fmt.Errorf("get assistant failed: %w", err)
	}
	if avatarURL.Valid {
		a.AvatarURL = avatarURL.String
	}
	return a, nil
}

// DeleteAssistant 删除助手及其会话、消息。
func (s *DBPersonalAssistantService) DeleteAssistant(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	// 外键已配置 CASCADE，但显式清理更可控。
	if _, err := tx.Exec(`
		DELETE FROM personal_assistant_messages
		WHERE session_id IN (
			SELECT id FROM personal_assistant_sessions WHERE assistant_id = $1
		)
	`, id); err != nil {
		return fmt.Errorf("delete assistant messages failed: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM personal_assistant_sessions WHERE assistant_id = $1`, id); err != nil {
		return fmt.Errorf("delete assistant sessions failed: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM personal_assistants WHERE id = $1`, id); err != nil {
		return fmt.Errorf("delete assistant failed: %w", err)
	}
	return tx.Commit()
}

// ListSessions 返回指定助手的会话列表。
func (s *DBPersonalAssistantService) ListSessions(assistantID string) ([]object.Session, error) {
	rows, err := s.db.Query(`
		SELECT id, assistant_id, title, message_count, created_at, updated_at
		FROM personal_assistant_sessions
		WHERE assistant_id = $1
		ORDER BY updated_at DESC
	`, assistantID)
	if err != nil {
		return nil, fmt.Errorf("list sessions failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.Session, 0)
	for rows.Next() {
		var sess object.Session
		if err := rows.Scan(&sess.ID, &sess.AssistantID, &sess.Title, &sess.MessageCount, &sess.CreatedAt, &sess.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan session failed: %w", err)
		}
		result = append(result, sess)
	}
	return result, rows.Err()
}

// CreateSession 创建新会话。
func (s *DBPersonalAssistantService) CreateSession(assistantID, title string) (object.Session, error) {
	now := time.Now().UTC()
	session := object.Session{
		ID:          uuid.New().String(),
		AssistantID: assistantID,
		Title:       title,
		MessageCount: 0,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	_, err := s.db.Exec(`
		INSERT INTO personal_assistant_sessions (id, assistant_id, title, message_count, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, session.ID, session.AssistantID, session.Title, session.MessageCount, session.CreatedAt, session.UpdatedAt)
	if err != nil {
		return object.Session{}, fmt.Errorf("insert session failed: %w", err)
	}
	return session, nil
}

// DeleteSession 删除会话及其消息。
func (s *DBPersonalAssistantService) DeleteSession(assistantID, sessionID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	// 校验会话属于该助手。
	var id string
	if err := tx.QueryRow(`SELECT id FROM personal_assistant_sessions WHERE id = $1 AND assistant_id = $2`, sessionID, assistantID).Scan(&id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("session not found")
		}
		return fmt.Errorf("validate session failed: %w", err)
	}

	if _, err := tx.Exec(`DELETE FROM personal_assistant_messages WHERE session_id = $1`, sessionID); err != nil {
		return fmt.Errorf("delete messages failed: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM personal_assistant_sessions WHERE id = $1`, sessionID); err != nil {
		return fmt.Errorf("delete session failed: %w", err)
	}
	return tx.Commit()
}

// GetMessages 返回会话消息列表。
func (s *DBPersonalAssistantService) GetMessages(sessionID string) ([]object.Message, error) {
	rows, err := s.db.Query(`
		SELECT id, session_id, role, type, content, created_at
		FROM personal_assistant_messages
		WHERE session_id = $1
		ORDER BY created_at ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get messages failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.Message, 0)
	for rows.Next() {
		var m object.Message
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Type, &m.Content, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan message failed: %w", err)
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

// ProcessMessage 保存用户消息，生成助手回复并更新会话。
func (s *DBPersonalAssistantService) ProcessMessage(assistantID, sessionID, content string) (object.Message, error) {
	assistant, err := s.GetAssistant(assistantID)
	if err != nil {
		return object.Message{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return object.Message{}, fmt.Errorf("begin transaction failed: %w", err)
	}
	defer tx.Rollback()

	// 校验会话存在并锁定。
	var title string
	var msgCount int
	if err := tx.QueryRow(`
		SELECT title, message_count FROM personal_assistant_sessions WHERE id = $1 AND assistant_id = $2
	`, sessionID, assistantID).Scan(&title, &msgCount); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return object.Message{}, errors.New("session not found")
		}
		return object.Message{}, fmt.Errorf("validate session failed: %w", err)
	}

	now := time.Now().UTC()
	userMsg := object.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "user",
		Type:      "text",
		Content:   content,
		CreatedAt: now,
	}
	if _, err := tx.Exec(`
		INSERT INTO personal_assistant_messages (id, session_id, role, type, content, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, userMsg.ID, userMsg.SessionID, userMsg.Role, userMsg.Type, userMsg.Content, userMsg.CreatedAt); err != nil {
		return object.Message{}, fmt.Errorf("insert user message failed: %w", err)
	}

	reply := object.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "assistant",
		Type:      "text",
		Content:   fmt.Sprintf("我是%s（%s）。收到你的消息：%s", assistant.Name, assistant.Role, content),
		CreatedAt: now,
	}
	if _, err := tx.Exec(`
		INSERT INTO personal_assistant_messages (id, session_id, role, type, content, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, reply.ID, reply.SessionID, reply.Role, reply.Type, reply.Content, reply.CreatedAt); err != nil {
		return object.Message{}, fmt.Errorf("insert assistant message failed: %w", err)
	}

	newTitle := title
	if title == "新会话" && len(content) > 0 {
		newTitle = content
		if len(newTitle) > 20 {
			newTitle = newTitle[:20]
		}
	}
	if _, err := tx.Exec(`
		UPDATE personal_assistant_sessions
		SET message_count = message_count + 2, updated_at = $1, title = $2
		WHERE id = $3
	`, now, newTitle, sessionID); err != nil {
		return object.Message{}, fmt.Errorf("update session failed: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return object.Message{}, fmt.Errorf("commit failed: %w", err)
	}
	return reply, nil
}
