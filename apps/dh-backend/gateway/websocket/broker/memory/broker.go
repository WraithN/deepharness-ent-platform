package memory

import (
	"context"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

type MessageBroker struct {
	mu          sync.RWMutex
	subscribers map[string][]chan chat.BrokerEvent
}

func NewMessageBroker() *MessageBroker {
	return &MessageBroker{
		subscribers: make(map[string][]chan chat.BrokerEvent),
	}
}

func (b *MessageBroker) Publish(ctx context.Context, sessionID string, ev chat.BrokerEvent) error {
	b.mu.RLock()
	subs := b.subscribers[sessionID]
	b.mu.RUnlock()
	for _, ch := range subs {
		select {
		case ch <- ev:
		default:
			// Channel full, drop event to prevent blocking
		}
	}
	return nil
}

func (b *MessageBroker) Subscribe(ctx context.Context, sessionID string) (<-chan chat.BrokerEvent, error) {
	ch := make(chan chat.BrokerEvent, 10)
	b.mu.Lock()
	b.subscribers[sessionID] = append(b.subscribers[sessionID], ch)
	b.mu.Unlock()
	return ch, nil
}

func (b *MessageBroker) Unsubscribe(ctx context.Context, sessionID string, ch <-chan chat.BrokerEvent) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	subs := b.subscribers[sessionID]
	for i, sub := range subs {
		if sub == ch {
			close(sub)
			b.subscribers[sessionID] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	return nil
}
