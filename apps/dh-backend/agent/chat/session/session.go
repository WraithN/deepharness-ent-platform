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

func (s *SessionStore) ListSessions(ctx context.Context, workspaceID, userID string) ([]chat.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]chat.Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		// 按 workspace + user 隔离；未设置 user_id 的历史数据不过滤用户，避免切换后丢失。
		if sess.WorkspaceID != workspaceID {
			continue
		}
		if sess.UserID != "" && sess.UserID != userID {
			continue
		}
		result = append(result, sess)
	}
	return result, nil
}

// GetSessionTrend 内存实现：按工作空间与日期分组统计会话数量。
func (s *SessionStore) GetSessionTrend(ctx context.Context, workspaceID string, days int) ([]chat.DateCount, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cutoff := time.Now().AddDate(0, 0, -days)
	counts := make(map[string]int)
	for _, sess := range s.sessions {
		if sess.WorkspaceID != workspaceID || sess.CreatedAt.Before(cutoff) {
			continue
		}
		date := sess.CreatedAt.Format("2006-01-02")
		counts[date]++
	}

	result := make([]chat.DateCount, 0, len(counts))
	for date, count := range counts {
		result = append(result, chat.DateCount{Date: date, Count: count})
	}
	return result, nil
}

// GetSessionTrails 内存实现：返回指定工作空间最近的会话轨迹（不含消息数量）。
func (s *SessionStore) GetSessionTrails(ctx context.Context, workspaceID string, limit int) ([]chat.SessionTrailInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	all := make([]chat.Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		if sess.WorkspaceID == workspaceID {
			all = append(all, sess)
		}
	}

	// 按更新时间倒序排序。
	for i := 0; i < len(all)-1; i++ {
		for j := i + 1; j < len(all); j++ {
			if all[j].UpdatedAt.After(all[i].UpdatedAt) {
				all[i], all[j] = all[j], all[i]
			}
		}
	}

	if limit > len(all) {
		limit = len(all)
	}
	result := make([]chat.SessionTrailInfo, 0, limit)
	for i := 0; i < limit; i++ {
		sess := all[i]
		result = append(result, chat.SessionTrailInfo{
			ID:        sess.ID,
			UserID:    sess.UserID,
			Title:     sess.Title,
			AgentType: sess.AgentType,
			CreatedAt: sess.CreatedAt,
			UpdatedAt: sess.UpdatedAt,
		})
	}
	return result, nil
}
