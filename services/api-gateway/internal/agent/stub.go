package agent

import (
	"context"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

// StubClient is a no-op implementation for development.
// It will be replaced by an HTTP+SSE client when the Coding Agent API is defined.
type StubClient struct{}

func NewStubClient() *StubClient {
	return &StubClient{}
}

func (c *StubClient) SendMessage(ctx context.Context, session domain.Session, msg domain.Message) error {
	// TODO: implement HTTP+SSE communication with Coding Agent
	return nil
}
