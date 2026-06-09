package broker

import (
	"context"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

type MessageBroker interface {
	Publish(ctx context.Context, sessionID string, ev domain.BrokerEvent) error
	Subscribe(ctx context.Context, sessionID string) (<-chan domain.BrokerEvent, error)
	Unsubscribe(ctx context.Context, sessionID string, ch <-chan domain.BrokerEvent) error
}
