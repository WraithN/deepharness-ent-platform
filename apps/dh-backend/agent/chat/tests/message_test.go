package tests

import (
	"context"
	"fmt"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat/session"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/constants"
)

func TestMessageStore_AppendAndGetHistory(t *testing.T) {
	ctx := context.Background()
	ms := session.NewMessageStore()
	msg := chat.Message{ID: "msg-1", SessionID: "sess-1", Content: "hello"}

	if err := ms.Append(ctx, "sess-1", msg); err != nil {
		t.Fatalf("append failed: %v", err)
	}

	history, err := ms.GetHistory(ctx, "sess-1", 10)
	if err != nil {
		t.Fatalf("get history failed: %v", err)
	}
	if len(history) != 1 {
		t.Errorf("expected 1 message, got %d", len(history))
	}
}

func TestMessageStore_GetHistory_Limit(t *testing.T) {
	ctx := context.Background()
	ms := session.NewMessageStore()
	for i := 0; i < 5; i++ {
		ms.Append(ctx, "sess-1", chat.Message{ID: fmt.Sprintf("msg-%d", i), SessionID: "sess-1"})
	}
	history, _ := ms.GetHistory(ctx, "sess-1", 3)
	if len(history) != 3 {
		t.Errorf("expected 3 messages, got %d", len(history))
	}
}

func TestMessageStore_GetHistory_EmptySession(t *testing.T) {
	ctx := context.Background()
	ms := session.NewMessageStore()
	history, err := ms.GetHistory(ctx, "unknown", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(history) != 0 {
		t.Errorf("expected 0 messages, got %d", len(history))
	}
}

func TestMessageStore_MaxMessages(t *testing.T) {
	ctx := context.Background()
	ms := session.NewMessageStore()
	for i := 0; i < constants.MAX_MESSAGES_PER_SESSION+10; i++ {
		ms.Append(ctx, "sess-1", chat.Message{ID: fmt.Sprintf("msg-%d", i), SessionID: "sess-1"})
	}
	history, _ := ms.GetHistory(ctx, "sess-1", constants.MAX_MESSAGES_PER_SESSION+10)
	if len(history) != constants.MAX_MESSAGES_PER_SESSION {
		t.Errorf("expected %d messages, got %d", constants.MAX_MESSAGES_PER_SESSION, len(history))
	}
}
