package memory

import (
	"context"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

func TestSessionStore_CreateAndGet(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	session := domain.Session{ID: "sess-1", AgentType: "opencode"}

	if err := store.Create(ctx, session); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	got, err := store.Get(ctx, "sess-1")
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got.ID != "sess-1" {
		t.Errorf("expected ID sess-1, got %s", got.ID)
	}
}

func TestSessionStore_Get_NotFound(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	_, err := store.Get(ctx, "nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestSessionStore_UpdateActivity(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	store.Create(ctx, domain.Session{ID: "sess-1", AgentType: "opencode"})

	if err := store.UpdateActivity(ctx, "sess-1"); err != nil {
		t.Fatalf("update activity failed: %v", err)
	}

	sess, _ := store.Get(ctx, "sess-1")
	if sess.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
}

func TestSessionStore_Delete(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	store.Create(ctx, domain.Session{ID: "sess-1"})
	store.Delete(ctx, "sess-1")
	_, err := store.Get(ctx, "sess-1")
	if err == nil {
		t.Error("expected error after delete")
	}
}
