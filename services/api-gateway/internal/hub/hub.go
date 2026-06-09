package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/google/uuid"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store"
)

type Connection struct {
	conn      *websocket.Conn
	sendMu    sync.Mutex
	sessionID string
	cancel    context.CancelFunc
}

type Hub struct {
	sessions    store.SessionStore
	messages    store.MessageStore
	broker      broker.MessageBroker
	connections map[string]*Connection
	mu          sync.RWMutex
}

func NewHub(sessions store.SessionStore, messages store.MessageStore, broker broker.MessageBroker) *Hub {
	return &Hub{
		sessions:    sessions,
		messages:    messages,
		broker:      broker,
		connections: make(map[string]*Connection),
	}
}

func (h *Hub) Register(sessionID string, conn *websocket.Conn) error {
	ctx := context.Background()
	if _, err := h.sessions.Get(ctx, sessionID); err != nil {
		return fmt.Errorf("invalid session: %w", err)
	}

	wsCtx, cancel := context.WithCancel(context.Background())
	c := &Connection{
		conn:      conn,
		sessionID: sessionID,
		cancel:    cancel,
	}

	h.mu.Lock()
	oldConn := h.connections[sessionID]
	h.connections[sessionID] = c
	h.mu.Unlock()

	if oldConn != nil {
		oldConn.cancel()
		oldConn.conn.Close()
	}

	// Replay message history
	history, err := h.messages.GetHistory(ctx, sessionID, domain.RECONNECT_HISTORY_LIMIT)
	if err != nil {
		log.Printf("failed to get history: %v", err)
	} else {
		for _, msg := range history {
			h.sendToConnection(c, domain.BrokerEvent{
				Type:    "message",
				Payload: msg,
			})
		}
	}

	go h.forwardEvents(wsCtx, c)
	return nil
}

func (h *Hub) Unregister(sessionID string) {
	h.mu.Lock()
	c := h.connections[sessionID]
	delete(h.connections, sessionID)
	h.mu.Unlock()

	if c != nil {
		c.cancel()
		c.conn.Close()
	}
}

func (h *Hub) HandleMessage(sessionID string, rawMsg []byte) error {
	var envelope struct {
		Event   string `json:"event"`
		Payload struct {
			Type    string `json:"type"`
			Content string `json:"content"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(rawMsg, &envelope); err != nil {
		return fmt.Errorf("unmarshal envelope: %w", err)
	}

	msg := domain.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "user",
		Type:      envelope.Payload.Type,
		Content:   envelope.Payload.Content,
		Timestamp: time.Now(),
	}

	ctx := context.Background()
	if err := h.messages.Append(ctx, sessionID, msg); err != nil {
		return fmt.Errorf("append message: %w", err)
	}
	if err := h.broker.Publish(ctx, sessionID, domain.BrokerEvent{
		Type:    "message",
		Payload: msg,
	}); err != nil {
		return fmt.Errorf("publish message: %w", err)
	}
	return nil
}

func (h *Hub) forwardEvents(ctx context.Context, c *Connection) {
	ch, err := h.broker.Subscribe(ctx, c.sessionID)
	if err != nil {
		log.Printf("failed to subscribe: %v", err)
		return
	}
	defer h.broker.Unsubscribe(ctx, c.sessionID, ch)

	for {
		select {
		case ev, ok := <-ch:
			if !ok {
				return
			}
			// Only forward assistant/system messages and status/errors to client.
			// User messages are already rendered by frontend.
			if ev.Type == "message" && ev.Payload.Role == "user" {
				continue
			}
			h.sendToConnection(c, ev)

		case <-ctx.Done():
			return
		}
	}
}

func (h *Hub) sendToConnection(c *Connection, ev domain.BrokerEvent) {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	c.conn.SetWriteDeadline(time.Now().Add(domain.WS_WRITE_TIMEOUT))
	if err := c.conn.WriteJSON(ev); err != nil {
		log.Printf("websocket write error: %v", err)
	}
}
