package worker

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/websocket/broker"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
)

// AgentWorker consumes user messages from the broker, forwards them to the Coding Agent,
// and publishes agent responses back to the broker.
type AgentWorker struct {
	broker      broker.MessageBroker
	messages    chat.MessageStore
	sessions    chat.SessionStore
	agentClient *client.HTTPClient
}

// NewAgentWorker creates a new agent worker.
func NewAgentWorker(broker broker.MessageBroker, messages chat.MessageStore, sessions chat.SessionStore, agentClient *client.HTTPClient) *AgentWorker {
	return &AgentWorker{
		broker:      broker,
		messages:    messages,
		sessions:    sessions,
		agentClient: agentClient,
	}
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

	log.Printf("[AgentWorker] started for session %s", sessionID)

	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				log.Printf("[AgentWorker] channel closed for session %s", sessionID)
				return
			}
			// Process only user messages; assistant messages are responses from the agent.
			if ev.Type != "message" || ev.Payload.Role != "user" {
				continue
			}
			log.Printf("[AgentWorker] processing user message for session %s", sessionID)
			w.processMessage(ctx, sessionID, ev.Payload)

		case <-ctx.Done():
			log.Printf("[AgentWorker] context cancelled for session %s", sessionID)
			return
		}
	}
}

func (w *AgentWorker) processMessage(ctx context.Context, sessionID string, userMsg chat.Message) {
	session, err := w.sessions.Get(ctx, sessionID)
	if err != nil {
		log.Printf("[AgentWorker] failed to get session %s: %v", sessionID, err)
		w.publishError(sessionID, "failed to get session: "+err.Error())
		return
	}

	events, err := w.agentClient.SendMessage(ctx, session, userMsg)
	if err != nil {
		log.Printf("[AgentWorker] failed to send message to agent: %v", err)
		w.publishError(sessionID, "agent communication failed: "+err.Error())
		return
	}

	// Track the current messageID from message.updated events
	var currentMessageID string
	for ev := range events {
		w.handleAgentEvent(ctx, sessionID, ev, &currentMessageID)
	}
}

func (w *AgentWorker) handleAgentEvent(ctx context.Context, sessionID string, ev client.SSEEvent, currentMessageID *string) {
	switch ev.Type {
	case "message.updated":
		// Extract messageID from lifecycle event to group parts
		var props struct {
			Info struct {
				ID string `json:"id"`
			} `json:"info"`
		}
		if err := json.Unmarshal(ev.Properties, &props); err == nil && props.Info.ID != "" {
			*currentMessageID = props.Info.ID
		}
		return

	case "message.part.updated":
		var props struct {
			Part struct {
				ID      string `json:"id"`
				Type    string `json:"type"`
				Content string `json:"content"`
				Delta   string `json:"delta"`
				Name    string `json:"name"`
				Input   string `json:"input"`
				Output  string `json:"output"`
				Status  string `json:"status"`
				Tasks   []struct {
					ID     string `json:"id"`
					Title  string `json:"title"`
					Status string `json:"status"`
				} `json:"tasks"`
			} `json:"part"`
		}
		if err := json.Unmarshal(ev.Properties, &props); err != nil {
			log.Printf("[AgentWorker] failed to unmarshal part event: %v", err)
			return
		}

		// Convert agent part type to gateway message type
		msgType := convertPartType(props.Part.Type)
		if msgType == "" {
			return // Unsupported part type
		}

		// Build content from available fields
		content := props.Part.Content
		if content == "" && props.Part.Output != "" {
			content = props.Part.Output
		}
		if content == "" && props.Part.Input != "" {
			content = props.Part.Input
		}

		metadata := map[string]any{
			"agentPartID":  props.Part.ID,
			"agentPartType": props.Part.Type,
			"name":         props.Part.Name,
			"status":       props.Part.Status,
			"messageID":    *currentMessageID,
		}
		if len(props.Part.Tasks) > 0 {
			metadata["tasks"] = props.Part.Tasks
		}

		msg := chat.Message{
			ID:        uuid.New().String(),
			SessionID: sessionID,
			Role:      "assistant",
			Type:      msgType,
			Content:   content,
			Metadata:  metadata,
			Timestamp: time.Now(),
		}

		if err := w.messages.Append(ctx, sessionID, msg); err != nil {
			log.Printf("[AgentWorker] failed to append message: %v", err)
			return
		}

		if err := w.broker.Publish(ctx, sessionID, chat.BrokerEvent{
			Type:    "message",
			Payload: msg,
		}); err != nil {
			log.Printf("[AgentWorker] failed to publish message: %v", err)
			return
		}

	case "session.error":
		var props struct {
			Error struct {
				Message string `json:"message"`
				Code    int    `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(ev.Properties, &props); err != nil {
			log.Printf("[AgentWorker] failed to unmarshal error event: %v", err)
			return
		}
		w.publishError(sessionID, props.Error.Message)

	default:
		// Ignore other events (heartbeat, server.connected, etc.)
	}
}

func (w *AgentWorker) publishError(sessionID string, message string) {
	ctx := context.Background()
	msg := chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "system",
		Type:      "error",
		Content:   message,
		Timestamp: time.Now(),
	}
	w.messages.Append(ctx, sessionID, msg)
	w.broker.Publish(ctx, sessionID, chat.BrokerEvent{
		Type:    "error",
		Payload: msg,
		Error: &chat.ErrorInfo{
			Code:    "AGENT_ERROR",
			Message: message,
		},
	})
}

func convertPartType(agentType string) string {
	switch agentType {
	case "text":
		return "text"
	case "reasoning":
		return "thinking"
	case "tool_use":
		return "tool_use"
	case "tool_result":
		return "tool_result"
	case "diff":
		return "diff"
	case "task_list":
		return "task_list"
	case "context_compression":
		return "context_compression"
	default:
		return ""
	}
}
