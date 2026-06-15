package broker

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

type MessageBroker interface {
	Publish(ctx context.Context, sessionID string, ev chat.BrokerEvent) error
	Subscribe(ctx context.Context, sessionID string) (<-chan chat.BrokerEvent, error)
	Unsubscribe(ctx context.Context, sessionID string, ch <-chan chat.BrokerEvent) error
}
