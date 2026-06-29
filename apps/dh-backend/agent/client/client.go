package client

import (
	"context"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

// Client defines the interface for communicating with the agent through gatewayd.
type Client interface {
	SendMessage(ctx context.Context, session chat.Session, msg chat.Message) (<-chan SSEEvent, error)
}
