package memory

import (
	"context"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
)

// maxEventsPerSession 限制单个 session 在内存中缓存的最大事件数，防止异常场景下无限增长。
const maxEventsPerSession = 10000

// MemoryBuffer 是 SSEBuffer 的内存实现。
// 使用 map[sessionID][]Event 存储每个会话的待消费事件队列，
// 使用 map[sessionID]map[runID][]byte 存储 run 级 checkpoint 状态。
//
// 生产环境可替换为 Redis 实现，使 checkpoint 跨进程重启存活。
type MemoryBuffer struct {
	mu        sync.RWMutex
	pending   map[string][]agui.Event
	runStates map[string]map[string][]byte
}

func New() *MemoryBuffer {
	return &MemoryBuffer{
		pending:   make(map[string][]agui.Event),
		runStates: make(map[string]map[string][]byte),
	}
}

func (b *MemoryBuffer) Append(_ context.Context, sessionID string, ev agui.Event) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pending[sessionID] = append(b.pending[sessionID], ev)
	// 超过上限时淘汰最旧事件，保持 FIFO 并限制内存占用。
	if len(b.pending[sessionID]) > maxEventsPerSession {
		overflow := len(b.pending[sessionID]) - maxEventsPerSession
		b.pending[sessionID] = b.pending[sessionID][overflow:]
	}
	return nil
}

func (b *MemoryBuffer) Pending(_ context.Context, sessionID string) ([]agui.Event, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	evs := b.pending[sessionID]
	if len(evs) == 0 {
		return []agui.Event{}, nil
	}
	result := make([]agui.Event, len(evs))
	copy(result, evs)
	return result, nil
}

func (b *MemoryBuffer) PopPending(_ context.Context, sessionID string) ([]agui.Event, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	evs := b.pending[sessionID]
	if len(evs) == 0 {
		delete(b.pending, sessionID)
		return []agui.Event{}, nil
	}
	result := make([]agui.Event, len(evs))
	copy(result, evs)
	delete(b.pending, sessionID)
	return result, nil
}

func (b *MemoryBuffer) Clear(_ context.Context, sessionID string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	delete(b.pending, sessionID)
	return nil
}

func (b *MemoryBuffer) SaveRunState(_ context.Context, sessionID, runID string, state []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.runStates[sessionID] == nil {
		b.runStates[sessionID] = make(map[string][]byte)
	}
	cp := make([]byte, len(state))
	copy(cp, state)
	b.runStates[sessionID][runID] = cp
	return nil
}

func (b *MemoryBuffer) LoadRunState(_ context.Context, sessionID, runID string) ([]byte, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if states, ok := b.runStates[sessionID]; ok {
		if state, ok := states[runID]; ok {
			result := make([]byte, len(state))
			copy(result, state)
			return result, nil
		}
	}
	return nil, nil
}

func (b *MemoryBuffer) ClearRunState(_ context.Context, sessionID, runID string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if states, ok := b.runStates[sessionID]; ok {
		delete(states, runID)
		if len(states) == 0 {
			delete(b.runStates, sessionID)
		}
	}
	return nil
}

func (b *MemoryBuffer) LoadPendingRunStates(_ context.Context, sessionID string) (map[string][]byte, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	states, ok := b.runStates[sessionID]
	if !ok || len(states) == 0 {
		return map[string][]byte{}, nil
	}
	result := make(map[string][]byte, len(states))
	for k, v := range states {
		cp := make([]byte, len(v))
		copy(cp, v)
		result[k] = cp
	}
	return result, nil
}
