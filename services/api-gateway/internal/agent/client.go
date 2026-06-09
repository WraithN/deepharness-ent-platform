package agent

import (
	"context"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

// Client defines the interface for communicating with the Coding Agent.
// The real implementation will send HTTP requests and consume SSE responses.
type Client interface {
	SendMessage(ctx context.Context, session domain.Session, msg domain.Message) error
}
