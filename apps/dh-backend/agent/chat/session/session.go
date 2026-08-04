package session

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
)

const (
	// defaultMaxSessions 是内存 session 存储的最大 session 数量，防止无限制增长。
	defaultMaxSessions = 10000
	// defaultSessionTTL 是内存 session 的空闲超时时间，超过此时间未更新的 session 会被回收。
	defaultSessionTTL = 24 * time.Hour
	// reaperInterval 是内存 session 回收器的运行间隔。
	reaperInterval = 1 * time.Hour
)

type SessionStore struct {
	mu          sync.RWMutex
	sessions    map[string]chat.Session
	maxSessions int
	ttl         time.Duration
	done        chan struct{}
}

func NewSessionStore() *SessionStore {
	s := &SessionStore{
		sessions:    make(map[string]chat.Session),
		maxSessions: defaultMaxSessions,
		ttl:         defaultSessionTTL,
		done:        make(chan struct{}),
	}
	safego.Go("session-reaper", s.reaper)
	return s
}

// Stop 停止 session 回收 goroutine，释放资源。
func (s *SessionStore) Stop() {
	close(s.done)
}

// reaper 定期清理长时间未更新的 session，避免内存无限增长。
func (s *SessionStore) reaper() {
	ticker := time.NewTicker(reaperInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.mu.Lock()
			cutoff := time.Now().Add(-s.ttl)
			for id, sess := range s.sessions {
				if sess.UpdatedAt.Before(cutoff) {
					delete(s.sessions, id)
				}
			}
			s.mu.Unlock()
		case <-s.done:
			return
		}
	}
}

// evictOldestLocked 在 session 数量超过上限时淘汰最旧的一条。
// 调用方必须持有写锁。
func (s *SessionStore) evictOldestLocked() {
	var oldestID string
	var oldestTime time.Time
	for id, sess := range s.sessions {
		if oldestID == "" || sess.UpdatedAt.Before(oldestTime) {
			oldestID = id
			oldestTime = sess.UpdatedAt
		}
	}
	if oldestID != "" {
		delete(s.sessions, oldestID)
	}
}

func (s *SessionStore) Create(ctx context.Context, sess chat.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sessions) >= s.maxSessions {
		s.evictOldestLocked()
	}
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

// GetSessionTrails 内存实现：返回指定工作空间最近的会话轨迹。
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
	sort.Slice(all, func(i, j int) bool {
		return all[j].UpdatedAt.Before(all[i].UpdatedAt)
	})

	if limit > len(all) {
		limit = len(all)
	}
	result := make([]chat.SessionTrailInfo, 0, limit)
	for i := 0; i < limit; i++ {
		sess := all[i]
		result = append(result, chat.SessionTrailInfo{
			ID:           sess.ID,
			UserID:       sess.UserID,
			Title:        sess.Title,
			AgentType:    sess.AgentType,
			MessageCount: 0, // 内存实现不维护跨 store 的消息计数
			CreatedAt:    sess.CreatedAt,
			UpdatedAt:    sess.UpdatedAt,
		})
	}
	return result, nil
}
