package client

import (
	"context"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

// Client defines the interface for communicating with the Coding Agent.
// The real implementation will send HTTP requests and consume SSE responses.
type Client interface {
	SendMessage(ctx context.Context, session chat.Session, msg chat.Message) error
}
