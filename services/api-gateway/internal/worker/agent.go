package worker

import (
	"context"
	"log"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker"
)

// AgentWorker consumes user messages from the broker and forwards them to the Coding Agent.
// This is a stub implementation that logs messages. It will be replaced by real HTTP+SSE
// integration when the Agent API is defined.
type AgentWorker struct {
	broker broker.MessageBroker
}

func NewAgentWorker(broker broker.MessageBroker) *AgentWorker {
	return &AgentWorker{broker: broker}
}

// Start begins listening for user messages on the given session.
// It blocks until the context is cancelled.
func (w *AgentWorker) Start(ctx context.Context, sessionID string) {
	ch, err := w.broker.Subscribe(ctx, sessionID)
	if err != nil {
		log.Printf("agent worker subscribe failed: %v", err)
		return
	}
	defer w.broker.Unsubscribe(ctx, sessionID, ch)

	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return
			}
			// Process only user messages; assistant messages are responses from the agent.
			if ev.Type != "message" || ev.Payload.Role != "user" {
				continue
			}
			log.Printf("[AgentWorker] received user message for session %s: %s", sessionID, ev.Payload.Content)
			// TODO: call AgentClient.SendMessage and publish SSE responses back to broker

		case <-ctx.Done():
			return
		}
	}
}
