package tests

import (
	"context"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat/session"
)

func TestSessionStore_CreateAndGet(t *testing.T) {
	ctx := context.Background()
	s := session.NewSessionStore()
	session := chat.Session{ID: "sess-1", AgentType: "opencode"}

	if err := s.Create(ctx, session); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	got, err := s.Get(ctx, "sess-1")
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got.ID != "sess-1" {
		t.Errorf("expected ID sess-1, got %s", got.ID)
	}
}

func TestSessionStore_Get_NotFound(t *testing.T) {
	ctx := context.Background()
	s := session.NewSessionStore()
	_, err := s.Get(ctx, "nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestSessionStore_UpdateActivity(t *testing.T) {
	ctx := context.Background()
	s := session.NewSessionStore()
	s.Create(ctx, chat.Session{ID: "sess-1", AgentType: "opencode"})

	if err := s.UpdateActivity(ctx, "sess-1"); err != nil {
		t.Fatalf("update activity failed: %v", err)
	}

	sess, _ := s.Get(ctx, "sess-1")
	if sess.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
}

func TestSessionStore_Delete(t *testing.T) {
	ctx := context.Background()
	s := session.NewSessionStore()
	s.Create(ctx, chat.Session{ID: "sess-1"})
	s.Delete(ctx, "sess-1")
	_, err := s.Get(ctx, "sess-1")
	if err == nil {
		t.Error("expected error after delete")
	}
}
