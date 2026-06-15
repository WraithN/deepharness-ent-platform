package server

import (
	"context"
	"log"
	"net/http"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/websocket/broker"
	brokermemory "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/websocket/broker/memory"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/orchestrator"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/project"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	ws "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/websocket"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	session "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat/session"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/worker"
)

// WorkerManager manages agent worker lifecycle per session.
type WorkerManager struct {
	workers  map[string]context.CancelFunc
	mu       sync.Mutex
	broker   broker.MessageBroker
	messages chat.MessageStore
	sessions chat.SessionStore
	agentURL string
}

func newWorkerManager(broker broker.MessageBroker, messages chat.MessageStore, sessions chat.SessionStore, agentURL string) *WorkerManager {
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

	agentClient := client.NewHTTPClient(wm.agentURL)
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

func New(cfg config.Config) http.Handler {
	mux := http.NewServeMux()

	// Infrastructure layer (in-memory implementations)
	sessions := session.NewSessionStore()
	messages := session.NewMessageStore()
	brok := brokermemory.NewMessageBroker()

	// Business logic layer
	h := ws.NewWebSocketHub(sessions, messages, brok)
	wm := newWorkerManager(brok, messages, sessions, cfg.AgentBaseURL)

	// Handlers
	sessionHandler := handler.NewSessionHandler(sessions, wm)
	wsHandler := handler.NewWebSocketHandler(h, sessions)

	// Routes
	mux.HandleFunc("/health", handler.HealthCheck)
	mux.HandleFunc("/api/v1/sessions", sessionHandler.CreateSession)
	mux.HandleFunc("/api/v1/hello", handler.Hello)
	mux.HandleFunc("/ws/v1/sessions/{id}", wsHandler.Handle)

	// Internal business modules
	mux.HandleFunc("/api/v1/identity/users", identity.Users)
	mux.HandleFunc("/api/v1/identity/users/me", identity.Me)
	mux.HandleFunc("/api/v1/projects/projects", project.Projects)
	mux.HandleFunc("/api/v1/workitems/", workitem.WorkItems)
	mux.HandleFunc("/api/v1/review/review", pragent.Reviews)
	mux.HandleFunc("/api/v1/audit/events", audit.Events)
	mux.HandleFunc("/api/v1/orchestrator/sessions", orchestrator.Sessions)

	// Apply middleware
	return middleware.Logger(middleware.CORS(mux))
}
