package server

import (
	"context"
	"log"
	"net/http"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/agent"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/broker/memory"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/handler"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/hub"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/middleware"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store"
	memstore "github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/store/memory"
	"github.com/deepharness/deepharness-ent-platform/services/api-gateway/internal/worker"
)

// WorkerManager manages agent worker lifecycle per session.
type WorkerManager struct {
	workers   map[string]context.CancelFunc
	mu        sync.Mutex
	broker    broker.MessageBroker
	messages  store.MessageStore
	sessions  store.SessionStore
	agentURL  string
}

func newWorkerManager(broker broker.MessageBroker, messages store.MessageStore, sessions store.SessionStore, agentURL string) *WorkerManager {
	return &WorkerManager{
		workers:  make(map[string]context.CancelFunc),
		broker:   broker,
		messages: messages,
		sessions: sessions,
		agentURL: agentURL,
	}
}

func (wm *WorkerManager) StartWorker(sessionID string) {
	wm.mu.Lock()
	defer wm.mu.Unlock()

	if _, exists := wm.workers[sessionID]; exists {
		return // Worker already running
	}

	ctx, cancel := context.WithCancel(context.Background())
	wm.workers[sessionID] = cancel

	agentClient := agent.NewHTTPClient(wm.agentURL)
	w := worker.NewAgentWorker(wm.broker, wm.messages, wm.sessions, agentClient)

	go func() {
		defer func() {
			wm.mu.Lock()
			delete(wm.workers, sessionID)
			wm.mu.Unlock()
			log.Printf("[WorkerManager] worker stopped for session %s", sessionID)
		}()
		w.Start(ctx, sessionID)
	}()

	log.Printf("[WorkerManager] worker started for session %s", sessionID)
}

func (wm *WorkerManager) StopWorker(sessionID string) {
	wm.mu.Lock()
	cancel, exists := wm.workers[sessionID]
	delete(wm.workers, sessionID)
	wm.mu.Unlock()

	if exists {
		cancel()
		log.Printf("[WorkerManager] worker stopped for session %s", sessionID)
	}
}

func New(agentBaseURL string) http.Handler {
	mux := http.NewServeMux()

	// Infrastructure layer (in-memory implementations)
	sessions := memstore.NewSessionStore()
	messages := memstore.NewMessageStore()
	brok := memory.NewMessageBroker()

	// Business logic layer
	h := hub.NewHub(sessions, messages, brok)
	wm := newWorkerManager(brok, messages, sessions, agentBaseURL)

	// Handlers
	sessionHandler := handler.NewSessionHandler(sessions, wm)
	wsHandler := handler.NewWebSocketHandler(h, sessions)

	// Routes
	mux.HandleFunc("/health", handler.HealthCheck)
	mux.HandleFunc("/api/v1/sessions", sessionHandler.CreateSession)
	mux.HandleFunc("/api/v1/hello", handler.Hello)
	mux.HandleFunc("/ws/v1/sessions/{id}", wsHandler.Handle)

	// Apply middleware
	return middleware.Logger(middleware.CORS(mux))
}
