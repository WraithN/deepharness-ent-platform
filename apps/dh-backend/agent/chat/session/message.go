package session

import (
	"context"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/constants"
)

type MessageStore struct {
	mu       sync.RWMutex
	messages map[string][]chat.Message
}

func NewMessageStore() *MessageStore {
	return &MessageStore{
		messages: make(map[string][]chat.Message),
	}
}

func (m *MessageStore) Append(ctx context.Context, sessionID string, msg chat.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages[sessionID] = append(m.messages[sessionID], msg)
	if len(m.messages[sessionID]) > constants.MAX_MESSAGES_PER_SESSION {
		m.messages[sessionID] = m.messages[sessionID][len(m.messages[sessionID])-constants.MAX_MESSAGES_PER_SESSION:]
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
	return msgs[len(msgs)-limit:], nil
}
