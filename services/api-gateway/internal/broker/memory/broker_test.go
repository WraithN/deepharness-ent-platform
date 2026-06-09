package memory

import (
	"context"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

func TestMessageBroker_PublishSubscribe(t *testing.T) {
	ctx := context.Background()
	b := NewMessageBroker()

	ch, err := b.Subscribe(ctx, "sess-1")
	if err != nil {
		t.Fatalf("subscribe failed: %v", err)
	}
	defer b.Unsubscribe(ctx, "sess-1", ch)

	ev := domain.BrokerEvent{Type: "message", Payload: domain.Message{ID: "msg-1"}}
	if err := b.Publish(ctx, "sess-1", ev); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	received := <-ch
	if received.Payload.ID != "msg-1" {
		t.Errorf("expected msg-1, got %s", received.Payload.ID)
	}
}

func TestMessageBroker_MultipleSubscribers(t *testing.T) {
	ctx := context.Background()
	b := NewMessageBroker()

	ch1, _ := b.Subscribe(ctx, "sess-1")
	ch2, _ := b.Subscribe(ctx, "sess-1")
	defer b.Unsubscribe(ctx, "sess-1", ch1)
	defer b.Unsubscribe(ctx, "sess-1", ch2)

	b.Publish(ctx, "sess-1", domain.BrokerEvent{Type: "message", Payload: domain.Message{ID: "msg-1"}})

	<-ch1
	<-ch2
	// If both receive without deadlock, test passes
}

func TestMessageBroker_NoSubscribers(t *testing.T) {
	ctx := context.Background()
	b := NewMessageBroker()

	err := b.Publish(ctx, "sess-1", domain.BrokerEvent{Type: "message"})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}
