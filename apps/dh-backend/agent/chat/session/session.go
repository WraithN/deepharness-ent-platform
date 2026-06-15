package session

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]chat.Session
}

func NewSessionStore() *SessionStore {
	return &SessionStore{
		sessions: make(map[string]chat.Session),
	}
}

func (s *SessionStore) Create(ctx context.Context, sess chat.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sess.ID] = sess
	return nil
}

func (s *SessionStore) Get(ctx context.Context, id string) (chat.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	if !ok {
		return chat.Session{}, fmt.Errorf("session not found: %s", id)
	}
	return sess, nil
}

func (s *SessionStore) UpdateActivity(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}
	sess.UpdatedAt = time.Now()
	s.sessions[id] = sess
	return nil
}

func (s *SessionStore) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
	return nil
}

func (s *SessionStore) UpdateTitle(ctx context.Context, id string, title string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}
	sess.Title = title
	s.sessions[id] = sess
	return nil
}

func (s *SessionStore) ListSessions(ctx context.Context) ([]chat.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]chat.Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		result = append(result, sess)
	}
	return result, nil
}
