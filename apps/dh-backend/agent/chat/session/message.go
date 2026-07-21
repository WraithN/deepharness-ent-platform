package session

import (
	"context"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

type MessageStore struct {
	mu          sync.RWMutex
	messages    map[string][]chat.Message
	maxMessages int
}

// NewMessageStore 创建内存消息存储，maxMessages 限制每个会话保留的最大消息数。
func NewMessageStore(maxMessages int) *MessageStore {
	if maxMessages <= 0 {
		maxMessages = 1000
	}
	return &MessageStore{
		messages:    make(map[string][]chat.Message),
		maxMessages: maxMessages,
	}
}

func (m *MessageStore) Append(ctx context.Context, sessionID string, msg chat.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	// 避免同一消息重复追加（如历史消息随每次 run 重复发送）。
	// 若已存在但内容不同，按最新内容更新，保证重试场景下消息内容一致。
	for i, existing := range m.messages[sessionID] {
		if existing.ID == msg.ID {
			if existing.Content != msg.Content {
				m.messages[sessionID][i] = msg
			}
			return nil
		}
	}
	m.messages[sessionID] = append(m.messages[sessionID], msg)
	if len(m.messages[sessionID]) > m.maxMessages {
		m.messages[sessionID] = m.messages[sessionID][len(m.messages[sessionID])-m.maxMessages:]
	}
	return nil
}

func (m *MessageStore) GetHistory(ctx context.Context, sessionID string, limit int) ([]chat.Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	msgs := m.messages[sessionID]
	if len(msgs) == 0 {
		return []chat.Message{}, nil
	}
	if limit > len(msgs) {
		limit = len(msgs)
	}
	// 返回深拷贝，防止调用方修改内部存储。
	result := make([]chat.Message, limit)
	copy(result, msgs[len(msgs)-limit:])
	return result, nil
}

// MigrateMessages 将旧 sessionID 下的所有消息迁移到新 sessionID。
func (m *MessageStore) MigrateMessages(ctx context.Context, oldSessionID, newSessionID string) error {
	if oldSessionID == newSessionID {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	oldMsgs := m.messages[oldSessionID]
	if len(oldMsgs) == 0 {
		return nil
	}
	existing := m.messages[newSessionID]
	for _, msg := range oldMsgs {
		duplicate := false
		for _, exist := range existing {
			if exist.ID == msg.ID {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		existing = append(existing, msg)
	}
	m.messages[newSessionID] = existing
	delete(m.messages, oldSessionID)
	return nil
}
