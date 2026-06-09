package memory

import (
	"context"
	"fmt"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

func TestMessageStore_AppendAndGetHistory(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	msg := domain.Message{ID: "msg-1", SessionID: "sess-1", Content: "hello"}

	if err := store.Append(ctx, "sess-1", msg); err != nil {
		t.Fatalf("append failed: %v", err)
	}

	history, err := store.GetHistory(ctx, "sess-1", 10)
	if err != nil {
		t.Fatalf("get history failed: %v", err)
	}
	if len(history) != 1 {
		t.Errorf("expected 1 message, got %d", len(history))
	}
}

func TestMessageStore_GetHistory_Limit(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	for i := 0; i < 5; i++ {
		store.Append(ctx, "sess-1", domain.Message{ID: fmt.Sprintf("msg-%d", i), SessionID: "sess-1"})
	}
	history, _ := store.GetHistory(ctx, "sess-1", 3)
	if len(history) != 3 {
		t.Errorf("expected 3 messages, got %d", len(history))
	}
}

func TestMessageStore_GetHistory_EmptySession(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	history, err := store.GetHistory(ctx, "unknown", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(history) != 0 {
		t.Errorf("expected 0 messages, got %d", len(history))
	}
}

func TestMessageStore_MaxMessages(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	for i := 0; i < domain.MAX_MESSAGES_PER_SESSION+10; i++ {
		store.Append(ctx, "sess-1", domain.Message{ID: fmt.Sprintf("msg-%d", i), SessionID: "sess-1"})
	}
	history, _ := store.GetHistory(ctx, "sess-1", domain.MAX_MESSAGES_PER_SESSION+10)
	if len(history) != domain.MAX_MESSAGES_PER_SESSION {
		t.Errorf("expected %d messages, got %d", domain.MAX_MESSAGES_PER_SESSION, len(history))
	}
}
