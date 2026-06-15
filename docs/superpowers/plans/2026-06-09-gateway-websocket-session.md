# Gateway WebSocket Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance `services/api-gateway` to support HTTP session creation and bidirectional WebSocket chat for intelligent sessions, with pluggable in-memory storage/broker and a stub agent client interface.

**Architecture:** Layered design with domain models at the core, interface-based storage (SessionStore/MessageStore) and messaging (MessageBroker) that default to in-memory but can be swapped for Redis, a Connection Hub managing WebSocket lifecycles, and a stub AgentClient interface for future HTTP+SSE integration.

**Tech Stack:** Go 1.22, `net/http`, `github.com/gorilla/websocket`, `github.com/google/uuid`, standard library `sync`, `context`, `testing`.

---

## File Structure

```
services/api-gateway/
├── main.go
├── go.mod
├── config/
│   └── config.go               # Environment-based configuration
├── internal/
│   ├── domain/
│   │   ├── constants.go        # Timeouts, limits
│   │   ├── session.go          # Session entity
│   │   ├── message.go          # Message entity
│   │   └── event.go            # BrokerEvent, ErrorInfo
│   ├── store/
│   │   ├── store.go            # SessionStore, MessageStore interfaces
│   │   └── memory/
│   │       ├── session.go      # In-memory SessionStore
│   │       ├── session_test.go
│   │       ├── message.go      # In-memory MessageStore
│   │       └── message_test.go
│   ├── broker/
│   │   ├── broker.go           # MessageBroker interface
│   │   └── memory/
│   │       ├── broker.go       # In-memory MessageBroker
│   │       └── broker_test.go
│   ├── agent/
│   │   ├── client.go           # AgentClient interface
│   │   └── stub.go             # Stub implementation
│   ├── hub/
│   │   └── hub.go              # WebSocket connection management, history replay, event forwarding
│   ├── worker/
│   │   └── agent.go            # Stub agent worker (consumes user messages from broker)
│   ├── handler/
│   │   ├── health.go           # Existing (unchanged)
│   │   ├── hello.go            # Existing (unchanged)
│   │   ├── session.go          # POST /api/v1/sessions
│   │   ├── session_test.go
│   │   └── websocket.go        # WS /ws/v1/sessions/{id}
│   ├── middleware/
│   │   ├── cors.go             # Existing (unchanged)
│   │   └── logger.go           # Existing (unchanged)
│   └── server/
│       └── server.go           # Route registration, dependency wiring
└── Makefile
```

---

### Task 1: Add Go Dependencies

**Files:**
- Modify: `services/api-gateway/go.mod`

- [ ] **Step 1: Add gorilla/websocket and google/uuid**

```bash
cd services/api-gateway && go get github.com/gorilla/websocket github.com/google/uuid
```

- [ ] **Step 2: Verify go.mod updated**

```bash
cat services/api-gateway/go.mod
```

Expected: Contains `require github.com/gorilla/websocket` and `require github.com/google/uuid`.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/go.mod services/api-gateway/go.sum
git commit -m "deps: add gorilla/websocket and google/uuid"
```

---

### Task 2: Config Module

**Files:**
- Create: `services/api-gateway/config/config.go`
- Create: `services/api-gateway/config/config_test.go`

- [ ] **Step 1: Write config.go**

```go
package config

import (
	"os"
	"strconv"
	"time"
)

const (
	DEFAULT_PORT             = "8080"
	DEFAULT_SESSION_STORE    = "memory"
	DEFAULT_MESSAGE_STORE    = "memory"
	DEFAULT_BROKER_TYPE      = "memory"
	DEFAULT_SESSION_TIMEOUT  = 30 * time.Minute
)

type Config struct {
	Port             string
	SessionStoreType string
	MessageStoreType string
	BrokerType       string
	RedisURL         string
	AgentBaseURL     string
	SessionTimeout   time.Duration
}

func Load() Config {
	return Config{
		Port:             getEnv("PORT", DEFAULT_PORT),
		SessionStoreType: getEnv("SESSION_STORE", DEFAULT_SESSION_STORE),
		MessageStoreType: getEnv("MESSAGE_STORE", DEFAULT_MESSAGE_STORE),
		BrokerType:       getEnv("BROKER_TYPE", DEFAULT_BROKER_TYPE),
		RedisURL:         os.Getenv("REDIS_URL"),
		AgentBaseURL:     os.Getenv("AGENT_BASE_URL"),
		SessionTimeout:   getDurationEnv("SESSION_TIMEOUT", DEFAULT_SESSION_TIMEOUT),
	}
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return defaultValue
	}
	d, err := strconv.Atoi(v)
	if err != nil {
		return defaultValue
	}
	return time.Duration(d) * time.Minute
}
```

- [ ] **Step 2: Write config_test.go**

```go
package config

import (
	"os"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	os.Unsetenv("PORT")
	os.Unsetenv("SESSION_STORE")
	cfg := Load()
	if cfg.Port != DEFAULT_PORT {
		t.Errorf("expected port %s, got %s", DEFAULT_PORT, cfg.Port)
	}
	if cfg.SessionStoreType != DEFAULT_SESSION_STORE {
		t.Errorf("expected session store %s, got %s", DEFAULT_SESSION_STORE, cfg.SessionStoreType)
	}
	if cfg.SessionTimeout != DEFAULT_SESSION_TIMEOUT {
		t.Errorf("expected timeout %v, got %v", DEFAULT_SESSION_TIMEOUT, cfg.SessionTimeout)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("SESSION_STORE", "redis")
	defer os.Unsetenv("PORT")
	defer os.Unsetenv("SESSION_STORE")
	cfg := Load()
	if cfg.Port != "9090" {
		t.Errorf("expected port 9090, got %s", cfg.Port)
	}
	if cfg.SessionStoreType != "redis" {
		t.Errorf("expected redis, got %s", cfg.SessionStoreType)
	}
}

func TestLoad_DurationEnv(t *testing.T) {
	os.Setenv("SESSION_TIMEOUT", "60")
	defer os.Unsetenv("SESSION_TIMEOUT")
	cfg := Load()
	if cfg.SessionTimeout != 60*time.Minute {
		t.Errorf("expected 60m, got %v", cfg.SessionTimeout)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd services/api-gateway && go test ./config/... -v
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/config/
git commit -m "feat: add config module with env parsing"
```

---

### Task 3: Domain Models and Constants

**Files:**
- Create: `services/api-gateway/internal/domain/constants.go`
- Create: `services/api-gateway/internal/domain/session.go`
- Create: `services/api-gateway/internal/domain/message.go`
- Create: `services/api-gateway/internal/domain/event.go`

- [ ] **Step 1: Write constants.go**

```go
package domain

import "time"

const (
	RECONNECT_HISTORY_LIMIT = 50
	WS_WRITE_TIMEOUT        = 10 * time.Second
	MAX_MESSAGES_PER_SESSION = 1000
	SESSION_TIMEOUT         = 30 * time.Minute
	AGENT_REQUEST_TIMEOUT   = 120 * time.Second
	AGENT_SSE_RETRY_MAX     = 3
)
```

- [ ] **Step 2: Write session.go**

```go
package domain

import "time"

type Session struct {
	ID        string
	AgentType string
	Model     string
	ProjectID string
	Context   map[string]any
	CreatedAt time.Time
	UpdatedAt time.Time
}
```

- [ ] **Step 3: Write message.go**

```go
package domain

import "time"

type Message struct {
	ID        string
	SessionID string
	Role      string
	Type      string
	Content   string
	Metadata  map[string]any
	Timestamp time.Time
}
```

- [ ] **Step 4: Write event.go**

```go
package domain

type BrokerEvent struct {
	Type    string
	Payload Message
	Error   *ErrorInfo
}

type ErrorInfo struct {
	Code    string
	Message string
}
```

- [ ] **Step 5: Verify build**

```bash
cd services/api-gateway && go build ./internal/domain/...
```

Expected: Build succeeds with no output.

- [ ] **Step 6: Commit**

```bash
git add services/api-gateway/internal/domain/
git commit -m "feat: add domain models (session, message, event, constants)"
```

---

### Task 4: Store Interfaces

**Files:**
- Create: `services/api-gateway/internal/store/store.go`

- [ ] **Step 1: Write store.go**

```go
package store

import (
	"context"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

type SessionStore interface {
	Create(ctx context.Context, s domain.Session) error
	Get(ctx context.Context, id string) (domain.Session, error)
	UpdateActivity(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
}

type MessageStore interface {
	Append(ctx context.Context, sessionID string, msg domain.Message) error
	GetHistory(ctx context.Context, sessionID string, limit int) ([]domain.Message, error)
}
```

- [ ] **Step 2: Verify build**

```bash
cd services/api-gateway && go build ./internal/store/...
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/internal/store/store.go
git commit -m "feat: add SessionStore and MessageStore interfaces"
```

---

### Task 5: Memory Session Store Implementation + Tests

**Files:**
- Create: `services/api-gateway/internal/store/memory/session.go`
- Create: `services/api-gateway/internal/store/memory/session_test.go`

- [ ] **Step 1: Write session.go**

```go
package memory

import (
	"context"
	"fmt"
	"sync"
	"time"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]domain.Session
}

func NewSessionStore() *SessionStore {
	return &SessionStore{
		sessions: make(map[string]domain.Session),
	}
}

func (s *SessionStore) Create(ctx context.Context, sess domain.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sess.ID] = sess
	return nil
}

func (s *SessionStore) Get(ctx context.Context, id string) (domain.Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	if !ok {
		return domain.Session{}, fmt.Errorf("session not found: %s", id)
	}
	return sess, nil
}

func (s *SessionStore) UpdateActivity(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return fmt.Errorf("session not found: %s", id)
	}
	sess.UpdatedAt = time.Now()
	s.sessions[id] = sess
	return nil
}

func (s *SessionStore) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
	return nil
}
```

- [ ] **Step 2: Write session_test.go**

```go
package memory

import (
	"context"
	"testing"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

func TestSessionStore_CreateAndGet(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	session := domain.Session{ID: "sess-1", AgentType: "opencode"}

	if err := store.Create(ctx, session); err != nil {
		t.Fatalf("create failed: %v", err)
	}

	got, err := store.Get(ctx, "sess-1")
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got.ID != "sess-1" {
		t.Errorf("expected ID sess-1, got %s", got.ID)
	}
}

func TestSessionStore_Get_NotFound(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	_, err := store.Get(ctx, "nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestSessionStore_UpdateActivity(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	store.Create(ctx, domain.Session{ID: "sess-1", AgentType: "opencode"})

	if err := store.UpdateActivity(ctx, "sess-1"); err != nil {
		t.Fatalf("update activity failed: %v", err)
	}

	sess, _ := store.Get(ctx, "sess-1")
	if sess.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
}

func TestSessionStore_Delete(t *testing.T) {
	ctx := context.Background()
	store := NewSessionStore()
	store.Create(ctx, domain.Session{ID: "sess-1"})
	store.Delete(ctx, "sess-1")
	_, err := store.Get(ctx, "sess-1")
	if err == nil {
		t.Error("expected error after delete")
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd services/api-gateway && go test ./internal/store/memory/... -v -run TestSessionStore
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/internal/store/memory/session.go services/api-gateway/internal/store/memory/session_test.go
git commit -m "feat: add in-memory SessionStore with tests"
```

---

### Task 6: Memory Message Store Implementation + Tests

**Files:**
- Create: `services/api-gateway/internal/store/memory/message.go`
- Create: `services/api-gateway/internal/store/memory/message_test.go`

- [ ] **Step 1: Write message.go**

```go
package memory

import (
	"context"
	"fmt"
	"sync"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

type MessageStore struct {
	mu       sync.RWMutex
	messages map[string][]domain.Message
}

func NewMessageStore() *MessageStore {
	return &MessageStore{
		messages: make(map[string][]domain.Message),
	}
}

func (m *MessageStore) Append(ctx context.Context, sessionID string, msg domain.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages[sessionID] = append(m.messages[sessionID], msg)
	if len(m.messages[sessionID]) > domain.MAX_MESSAGES_PER_SESSION {
		m.messages[sessionID] = m.messages[sessionID][len(m.messages[sessionID])-domain.MAX_MESSAGES_PER_SESSION:]
	}
	return nil
}

func (m *MessageStore) GetHistory(ctx context.Context, sessionID string, limit int) ([]domain.Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	msgs := m.messages[sessionID]
	if len(msgs) == 0 {
		return []domain.Message{}, nil
	}
	if limit > len(msgs) {
		limit = len(msgs)
	}
	return msgs[len(msgs)-limit:], nil
}
```

- [ ] **Step 2: Write message_test.go**

```go
package memory

import (
	"context"
	"fmt"
	"testing"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

func TestMessageStore_AppendAndGetHistory(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	msg := domain.Message{ID: "msg-1", SessionID: "sess-1", Content: "hello"}

	if err := store.Append(ctx, "sess-1", msg); err != nil {
		t.Fatalf("append failed: %v", err)
	}

	history, err := store.GetHistory(ctx, "sess-1", 10)
	if err != nil {
		t.Fatalf("get history failed: %v", err)
	}
	if len(history) != 1 {
		t.Errorf("expected 1 message, got %d", len(history))
	}
}

func TestMessageStore_GetHistory_Limit(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	for i := 0; i < 5; i++ {
		store.Append(ctx, "sess-1", domain.Message{ID: fmt.Sprintf("msg-%d", i), SessionID: "sess-1"})
	}
	history, _ := store.GetHistory(ctx, "sess-1", 3)
	if len(history) != 3 {
		t.Errorf("expected 3 messages, got %d", len(history))
	}
}

func TestMessageStore_GetHistory_EmptySession(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	history, err := store.GetHistory(ctx, "unknown", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(history) != 0 {
		t.Errorf("expected 0 messages, got %d", len(history))
	}
}

func TestMessageStore_MaxMessages(t *testing.T) {
	ctx := context.Background()
	store := NewMessageStore()
	for i := 0; i < domain.MAX_MESSAGES_PER_SESSION+10; i++ {
		store.Append(ctx, "sess-1", domain.Message{ID: fmt.Sprintf("msg-%d", i), SessionID: "sess-1"})
	}
	history, _ := store.GetHistory(ctx, "sess-1", domain.MAX_MESSAGES_PER_SESSION+10)
	if len(history) != domain.MAX_MESSAGES_PER_SESSION {
		t.Errorf("expected %d messages, got %d", domain.MAX_MESSAGES_PER_SESSION, len(history))
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd services/api-gateway && go test ./internal/store/memory/... -v -run TestMessageStore
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/internal/store/memory/message.go services/api-gateway/internal/store/memory/message_test.go
git commit -m "feat: add in-memory MessageStore with tests"
```

---

### Task 7: Broker Interface + Memory Implementation + Tests

**Files:**
- Create: `services/api-gateway/internal/broker/broker.go`
- Create: `services/api-gateway/internal/broker/memory/broker.go`
- Create: `services/api-gateway/internal/broker/memory/broker_test.go`

- [ ] **Step 1: Write broker.go (interface)**

```go
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
```

- [ ] **Step 2: Write memory/broker.go**

```go
package memory

import (
	"context"
	"sync"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

type MessageBroker struct {
	mu          sync.RWMutex
	subscribers map[string][]chan domain.BrokerEvent
}

func NewMessageBroker() *MessageBroker {
	return &MessageBroker{
		subscribers: make(map[string][]chan domain.BrokerEvent),
	}
}

func (b *MessageBroker) Publish(ctx context.Context, sessionID string, ev domain.BrokerEvent) error {
	b.mu.RLock()
	subs := b.subscribers[sessionID]
	b.mu.RUnlock()
	for _, ch := range subs {
		select {
		case ch <- ev:
		default:
			// Channel full, drop event to prevent blocking
		}
	}
	return nil
}

func (b *MessageBroker) Subscribe(ctx context.Context, sessionID string) (<-chan domain.BrokerEvent, error) {
	ch := make(chan domain.BrokerEvent, 10)
	b.mu.Lock()
	b.subscribers[sessionID] = append(b.subscribers[sessionID], ch)
	b.mu.Unlock()
	return ch, nil
}

func (b *MessageBroker) Unsubscribe(ctx context.Context, sessionID string, ch <-chan domain.BrokerEvent) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	subs := b.subscribers[sessionID]
	for i, sub := range subs {
		if sub == ch {
			close(sub)
			b.subscribers[sessionID] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	return nil
}
```

- [ ] **Step 3: Write memory/broker_test.go**

```go
package memory

import (
	"context"
	"testing"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
)

func TestMessageBroker_PublishSubscribe(t *testing.T) {
	ctx := context.Background()
	b := NewMessageBroker()

	ch, err := b.Subscribe(ctx, "sess-1")
	if err != nil {
		t.Fatalf("subscribe failed: %v", err)
	}
	defer b.Unsubscribe(ctx, "sess-1", ch)

	ev := domain.BrokerEvent{Type: "message", Payload: domain.Message{ID: "msg-1"}}
	if err := b.Publish(ctx, "sess-1", ev); err != nil {
		t.Fatalf("publish failed: %v", err)
	}

	received := <-ch
	if received.Payload.ID != "msg-1" {
		t.Errorf("expected msg-1, got %s", received.Payload.ID)
	}
}

func TestMessageBroker_MultipleSubscribers(t *testing.T) {
	ctx := context.Background()
	b := NewMessageBroker()

	ch1, _ := b.Subscribe(ctx, "sess-1")
	ch2, _ := b.Subscribe(ctx, "sess-1")
	defer b.Unsubscribe(ctx, "sess-1", ch1)
	defer b.Unsubscribe(ctx, "sess-1", ch2)

	b.Publish(ctx, "sess-1", domain.BrokerEvent{Type: "message", Payload: domain.Message{ID: "msg-1"}})

	<-ch1
	<-ch2
	// If both receive without deadlock, test passes
}

func TestMessageBroker_NoSubscribers(t *testing.T) {
	ctx := context.Background()
	b := NewMessageBroker()

	err := b.Publish(ctx, "sess-1", domain.BrokerEvent{Type: "message"})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 4: Run tests**

```bash
cd services/api-gateway && go test ./internal/broker/memory/... -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/api-gateway/internal/broker/
git commit -m "feat: add MessageBroker interface and in-memory implementation with tests"
```

---

### Task 8: Agent Client Interface (Stub)

**Files:**
- Create: `services/api-gateway/internal/agent/client.go`
- Create: `services/api-gateway/internal/agent/stub.go`

- [ ] **Step 1: Write client.go**

```go
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
```

- [ ] **Step 2: Write stub.go**

```go
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
```

- [ ] **Step 3: Verify build**

```bash
cd services/api-gateway && go build ./internal/agent/...
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/internal/agent/
git commit -m "feat: add AgentClient interface with stub implementation"
```

---

### Task 9: Connection Hub

**Files:**
- Create: `services/api-gateway/internal/hub/hub.go`

- [ ] **Step 1: Write hub.go**

```go
package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store"
	"github.com/gorilla/websocket"
	"github.com/google/uuid"
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
```

- [ ] **Step 2: Verify build**

```bash
cd services/api-gateway && go build ./internal/hub/...
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/internal/hub/hub.go
git commit -m "feat: add Connection Hub for WebSocket lifecycle and event forwarding"
```

---

### Task 10: Session HTTP Handler + Tests

**Files:**
- Create: `services/api-gateway/internal/handler/session.go`
- Create: `services/api-gateway/internal/handler/session_test.go`

- [ ] **Step 1: Write session.go**

```go
package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store"
)

type SessionHandler struct {
	sessions store.SessionStore
}

func NewSessionHandler(sessions store.SessionStore) *SessionHandler {
	return &SessionHandler{sessions: sessions}
}

type CreateSessionRequest struct {
	AgentType string         `json:"agentType"`
	Model     string         `json:"model"`
	ProjectID string         `json:"projectId"`
	Context   map[string]any `json:"context"`
}

type CreateSessionResponse struct {
	SessionID string `json:"sessionId"`
	WsURL     string `json:"wsUrl"`
}

func (h *SessionHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"code":2,"message":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	session := domain.Session{
		ID:        uuid.New().String(),
		AgentType: req.AgentType,
		Model:     req.Model,
		ProjectID: req.ProjectID,
		Context:   req.Context,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := h.sessions.Create(r.Context(), session); err != nil {
		http.Error(w, `{"code":3,"message":"failed to create session"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"code":    0,
		"message": "success",
		"data": CreateSessionResponse{
			SessionID: session.ID,
			WsURL:     "/ws/v1/sessions/" + session.ID,
		},
	})
}
```

- [ ] **Step 2: Write session_test.go**

```go
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store/memory"
)

func TestCreateSession_Success(t *testing.T) {
	sessions := memory.NewSessionStore()
	h := NewSessionHandler(sessions)

	reqBody, _ := json.Marshal(map[string]any{
		"agentType": "opencode",
		"model":     "claude-3-7",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewReader(reqBody))
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatal("expected data object in response")
	}
	if data["sessionId"] == "" {
		t.Error("expected sessionId in response")
	}
	if data["wsUrl"] == "" {
		t.Error("expected wsUrl in response")
	}
}

func TestCreateSession_InvalidBody(t *testing.T) {
	sessions := memory.NewSessionStore()
	h := NewSessionHandler(sessions)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewReader([]byte("not-json")))
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCreateSession_MethodNotAllowed(t *testing.T) {
	sessions := memory.NewSessionStore()
	h := NewSessionHandler(sessions)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	w := httptest.NewRecorder()

	h.CreateSession(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd services/api-gateway && go test ./internal/handler/... -v -run TestCreateSession
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/internal/handler/session.go services/api-gateway/internal/handler/session_test.go
git commit -m "feat: add session creation HTTP handler with tests"
```

---

### Task 11: WebSocket Handler

**Files:**
- Create: `services/api-gateway/internal/handler/websocket.go`

- [ ] **Step 1: Write websocket.go**

```go
package handler

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/hub"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins for development; tighten in production.
		return true
	},
}

type WebSocketHandler struct {
	hub *hub.Hub
}

func NewWebSocketHandler(h *hub.Hub) *WebSocketHandler {
	return &WebSocketHandler{hub: h}
}

func (h *WebSocketHandler) Handle(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if sessionID == "" {
		http.Error(w, `{"code":1,"message":"missing session id"}`, http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	if err := h.hub.Register(sessionID, conn); err != nil {
		log.Printf("websocket register failed: %v", err)
		conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "invalid_session"))
		return
	}
	defer h.hub.Unregister(sessionID)

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("websocket read error: %v", err)
			}
			break
		}
		if err := h.hub.HandleMessage(sessionID, message); err != nil {
			log.Printf("handle message error: %v", err)
		}
	}
}
```

- [ ] **Step 2: Verify build**

```bash
cd services/api-gateway && go build ./internal/handler/...
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/internal/handler/websocket.go
git commit -m "feat: add WebSocket handler for session connections"
```

---

### Task 12: Server Wiring

**Files:**
- Modify: `services/api-gateway/internal/server/server.go`

- [ ] **Step 1: Update server.go**

```go
package server

import (
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/agent"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker/memory"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/handler"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/hub"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/middleware"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store/memory"
)

func New() http.Handler {
	mux := http.NewServeMux()

	// Infrastructure layer (in-memory implementations)
	sessions := memory.NewSessionStore()
	messages := memory.NewMessageStore()
	brok := memory.NewMessageBroker()
	agentClient := agent.NewStubClient()

	// Business logic layer
	h := hub.NewHub(sessions, messages, brok)
	_ = agentClient // Will be wired into worker when AgentClient is implemented

	// Handlers
	sessionHandler := handler.NewSessionHandler(sessions)
	wsHandler := handler.NewWebSocketHandler(h)

	// Routes
	mux.HandleFunc("/health", handler.HealthCheck)
	mux.HandleFunc("/api/v1/sessions", sessionHandler.CreateSession)
	mux.HandleFunc("/api/v1/hello", handler.Hello)
	mux.HandleFunc("/ws/v1/sessions/{id}", wsHandler.Handle)

	// Apply middleware
	return middleware.Logger(middleware.CORS(mux))
}
```

- [ ] **Step 2: Verify build**

```bash
cd services/api-gateway && go build ./...
```

Expected: Build succeeds.

- [ ] **Step 3: Run go vet**

```bash
cd services/api-gateway && go vet ./...
```

Expected: No warnings.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/internal/server/server.go
git commit -m "feat: wire session and websocket handlers into server"
```

---

### Task 13: Agent Worker Stub

**Files:**
- Create: `services/api-gateway/internal/worker/agent.go`

- [ ] **Step 1: Write agent.go**

```go
package worker

import (
	"context"
	"log"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/domain"
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
```

- [ ] **Step 2: Verify build**

```bash
cd services/api-gateway && go build ./internal/worker/...
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/internal/worker/
git commit -m "feat: add stub AgentWorker for future agent integration"
```

---

### Task 14: Integration Test

**Files:**
- Create: `services/api-gateway/internal/server/server_test.go`

- [ ] **Step 1: Write server_test.go**

```go
package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestEndToEnd_CreateSessionAndConnect(t *testing.T) {
	srv := httptest.NewServer(New())
	defer srv.Close()

	// Step 1: Create session via HTTP
	reqBody, _ := json.Marshal(map[string]any{
		"agentType": "opencode",
		"model":     "claude-3-7",
	})
	resp, err := http.Post(srv.URL+"/api/v1/sessions", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatalf("create session failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	data := body["data"].(map[string]any)
	wsPath := data["wsUrl"].(string)

	// Convert http:// to ws://
	wsURL := strings.Replace(srv.URL, "http://", "ws://", 1) + wsPath

	// Step 2: Connect via WebSocket
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	defer wsConn.Close()

	// Step 3: Send a chat message
	msg := map[string]any{
		"event": "message",
		"payload": map[string]any{
			"type":    "text",
			"content": "hello agent",
		},
	}
	if err := wsConn.WriteJSON(msg); err != nil {
		t.Fatalf("websocket write failed: %v", err)
	}

	// Give server time to process
	time.Sleep(100 * time.Millisecond)

	// Step 4: Verify WebSocket is still open (no error response)
	wsConn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	_, _, err = wsConn.ReadMessage()
	// We expect timeout because stub agent doesn't send responses
	if err != nil && !strings.Contains(err.Error(), "timeout") {
		t.Fatalf("unexpected websocket error: %v", err)
	}
}

func TestWebSocket_InvalidSession(t *testing.T) {
	srv := httptest.NewServer(New())
	defer srv.Close()

	wsURL := strings.Replace(srv.URL, "http://", "ws://", 1) + "/ws/v1/sessions/nonexistent"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected dial to fail for invalid session")
	}
	if resp != nil && resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}
```

- [ ] **Step 2: Run tests**

```bash
cd services/api-gateway && go test ./internal/server/... -v
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add services/api-gateway/internal/server/server_test.go
git commit -m "test: add end-to-end integration test for session creation and websocket"
```

---

### Task 15: Final Build and Verification

- [ ] **Step 1: Build entire service**

```bash
cd services/api-gateway && go build -o dist/api-gateway ./...
```

Expected: Binary created at `services/api-gateway/dist/api-gateway` with no errors.

- [ ] **Step 2: Run all tests**

```bash
cd services/api-gateway && go test ./... -v
```

Expected: All tests pass.

- [ ] **Step 3: Run go vet**

```bash
cd services/api-gateway && go vet ./...
```

Expected: 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add services/api-gateway/dist/api-gateway
git commit -m "chore: build api-gateway binary"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ HTTP session creation endpoint (`POST /api/v1/sessions`) — Task 10
- ✅ WebSocket connection endpoint (`WS /ws/v1/sessions/{id}`) — Task 11
- ✅ SessionStore interface + memory implementation — Tasks 4, 5
- ✅ MessageStore interface + memory implementation — Tasks 4, 6
- ✅ MessageBroker interface + memory implementation — Task 7
- ✅ AgentClient interface + stub — Task 8
- ✅ Connection Hub with history replay — Task 9
- ✅ Configurable backends (memory default, redis预留) — Task 2, interfaces throughout
- ✅ Agent Worker stub — Task 13
- ✅ Error handling (invalid session, bad JSON, method not allowed) — Tasks 10, 11
- ✅ Constants extracted (no magic values) — Task 3

**2. Placeholder scan:**
- ✅ No "TBD", "TODO", "implement later" in plan steps (only in code comments for known future work)
- ✅ Every step has exact file paths
- ✅ Every code step shows complete code
- ✅ Every test step shows exact command and expected output

**3. Type consistency:**
- ✅ `SessionStore.Create(ctx, domain.Session)` used consistently
- ✅ `MessageStore.Append(ctx, sessionID, domain.Message)` used consistently
- ✅ `BrokerEvent` structure matches in Hub, Broker, and Worker
- ✅ WebSocket envelope format consistent between hub and tests

**4. Gaps:** None identified. All spec requirements map to at least one task.
