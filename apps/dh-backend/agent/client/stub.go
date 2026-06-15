package client

import (
	"context"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

// StubClient is a no-op implementation for development.
// It will be replaced by an HTTP+SSE client when the Coding Agent API is defined.
type StubClient struct{}

func NewStubClient() *StubClient {
	return &StubClient{}
}

func (c *StubClient) SendMessage(ctx context.Context, session chat.Session, msg chat.Message) error {
	// TODO: implement HTTP+SSE communication with Coding Agent
	return nil
}
