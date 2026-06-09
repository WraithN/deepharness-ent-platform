package memory

import (
	"context"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

type MessageStore struct {
	mu       sync.RWMutex
	messages map[string][]domain.Message
}

func NewMessageStore() *MessageStore {
	return &MessageStore{
		messages: make(map[string][]domain.Message),
	}
}

func (m *MessageStore) Append(ctx context.Context, sessionID string, msg domain.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages[sessionID] = append(m.messages[sessionID], msg)
	if len(m.messages[sessionID]) > domain.MAX_MESSAGES_PER_SESSION {
		m.messages[sessionID] = m.messages[sessionID][len(m.messages[sessionID])-domain.MAX_MESSAGES_PER_SESSION:]
	}
	return nil
}

func (m *MessageStore) GetHistory(ctx context.Context, sessionID string, limit int) ([]domain.Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	msgs := m.messages[sessionID]
	if len(msgs) == 0 {
		return []domain.Message{}, nil
	}
	if limit > len(msgs) {
		limit = len(msgs)
	}
	return msgs[len(msgs)-limit:], nil
}
