package server

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"sync"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	session "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat/session"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/orchestrator"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant"
	paservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/project"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team"
	teamservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	ws "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/websocket"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/websocket/broker"
	brokermemory "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/websocket/broker/memory"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/worker"
	sdkpostgres "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/postgres"
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

	// Shared MySQL connection (if available)
	db := initDB(cfg)

	// Infrastructure layer: MySQL when available, otherwise memory.
	var sessions chat.SessionStore
	var messages chat.MessageStore
	if db != nil {
		sessions = session.NewPostgresStore(db)
		messages = session.NewPostgresStore(db)
		log.Println("[Chat] using postgres storage")
	} else {
		sessions = session.NewSessionStore()
		messages = session.NewMessageStore()
		log.Println("[Chat] using memory storage")
	}
	brok := brokermemory.NewMessageBroker()

	// Business logic layer
	h := ws.NewWebSocketHub(sessions, messages, brok)
	wm := newWorkerManager(brok, messages, sessions, cfg.AgentBaseURL)

	// Personal assistant storage: MySQL when available, otherwise memory mock.
	initPersonalAssistantService(db)

	// Identity module: PostgreSQL when available, otherwise empty mock.
	initIdentityService(db)

	// Workspace module: MySQL when available, otherwise memory mock.
	initWorkspaceService(db)

	// Team skills / prompts: MySQL when available, otherwise memory mock.
	initTeamService(db)

	// Handlers
	sessionHandler := handler.NewSessionHandler(sessions, messages, wm)
	wsHandler := handler.NewWebSocketHandler(h, sessions)

	// Routes
	mux.HandleFunc("/health", handler.HealthCheck)
	mux.HandleFunc("/api/v1/sessions", sessionHandler.Sessions)
	mux.HandleFunc("/api/v1/sessions/{id}/messages", sessionHandler.GetMessages)
	mux.HandleFunc("/api/v1/hello", handler.Hello)
	mux.HandleFunc("/ws/v1/sessions/{id}", wsHandler.Handle)

	// Internal business modules
	mux.HandleFunc("/api/v1/identity/users", identity.Users)
	mux.HandleFunc("/api/v1/identity/users/me", identity.Me)
	mux.HandleFunc("/api/v1/identity/login", identity.Login)
	mux.HandleFunc("/api/v1/projects", project.Projects)
	mux.HandleFunc("/api/v1/projects/{id}", project.ProjectByID)
	mux.HandleFunc("/api/v1/repositories", project.Repositories)
	mux.HandleFunc("/api/v1/repositories/{id}", project.RepositoryByID)
	mux.HandleFunc("/api/v1/repositories/{id}/branches", project.RepositoryBranches)
	mux.HandleFunc("/api/v1/repositories/{id}/tree", project.RepositoryTree)
	mux.HandleFunc("/api/v1/repositories/{id}/content", project.RepositoryContent)
	mux.HandleFunc("/api/v1/workitems", workitem.WorkItems)
	mux.HandleFunc("/api/v1/workitems/{id}", workitem.WorkItemByID)
	mux.HandleFunc("/api/v1/workitems/{id}/status", workitem.UpdateWorkItemStatus)
	mux.HandleFunc("/api/v1/review/review", pragent.Reviews)
	mux.HandleFunc("/api/v1/audit/events", audit.Events)
	mux.HandleFunc("/api/v1/orchestrator/sessions", orchestrator.Sessions)

	// Personal assistant module
	mux.HandleFunc("/api/v1/personal-assistants", personalassistant.Assistants)
	mux.HandleFunc("/api/v1/personal-assistants/{id}", personalassistant.AssistantByID)
	mux.HandleFunc("/api/v1/personal-assistants/{id}/sessions", personalassistant.AssistantSessions)
	mux.HandleFunc("/api/v1/personal-assistants/{id}/sessions/{sessionId}", personalassistant.DeleteSession)
	mux.HandleFunc("/api/v1/personal-assistants/{id}/sessions/{sessionId}/messages", personalassistant.GetMessages)
	mux.HandleFunc("/ws/v1/personal-assistant/{assistantId}/sessions/{sessionId}", personalassistant.WebSocket)

	// Workspace module
	mux.HandleFunc("/api/v1/workspaces", workspace.Workspaces)
	mux.HandleFunc("/api/v1/workspaces/{id}", workspace.WorkspaceByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/members", workspace.Members)
	mux.HandleFunc("/api/v1/workspaces/{id}/members/{userId}", workspace.MemberByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/workitem-project", workspace.WorkitemProject)
	mux.HandleFunc("/api/v1/workspaces/{id}/agents", workspace.WorkspaceAgents)
	mux.HandleFunc("/api/v1/workspaces/{id}/standards", workspace.WorkspaceStandards)
	mux.HandleFunc("/api/v1/workspaces/{id}/standards/{standardId}", workspace.WorkspaceStandardByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/cicd", workspace.WorkspaceCICD)

	// Team skills / prompts
	mux.HandleFunc("/api/v1/team/skills", team.Skills)
	mux.HandleFunc("/api/v1/team/skills/{id}", team.SkillByID)
	mux.HandleFunc("/api/v1/team/prompts", team.Prompts)
	mux.HandleFunc("/api/v1/team/prompts/{id}", team.PromptByID)

	// Apply middleware
	return middleware.Logger(middleware.CORS(mux))
}

func initDB(cfg config.Config) *sql.DB {
	dsn := sdkpostgres.DSN(sdkpostgres.Config{
		Host:     cfg.DBHost,
		Port:     cfg.DBPort,
		User:     cfg.DBUser,
		Password: cfg.DBPassword,
		Database: cfg.DBName,
	})

	db, err := sdkpostgres.OpenDB(dsn)
	if err != nil {
		log.Printf("[DB] postgres connect failed (%v), fallback to memory", err)
		return nil
	}
	log.Printf("[DB] connected to postgres at %s:%s/%s", cfg.DBHost, cfg.DBPort, cfg.DBName)
	return db
}

func initIdentityService(db *sql.DB) {
	if db != nil {
		log.Println("[Identity] using postgres storage")
		identity.Init(identityservice.NewDBUserService(db))
		return
	}
	log.Println("[Identity] using empty memory mock")
	identity.Init(identityservice.NewMockUserService())
}

func initPersonalAssistantService(db *sql.DB) {
	if db != nil {
		log.Println("[PersonalAssistant] using postgres storage")
		personalassistant.Init(paservice.NewDBPersonalAssistantService(db))
		return
	}
	log.Println("[PersonalAssistant] using memory mock")
	personalassistant.Init(paservice.NewMockPersonalAssistantService())
}

func initWorkspaceService(db *sql.DB) {
	if db != nil {
		log.Println("[Workspace] using postgres storage")
		workspace.Init(workspaceservice.NewDBWorkspaceService(db))
		return
	}
	log.Println("[Workspace] using memory mock")
	workspace.Init(workspaceservice.NewMockWorkspaceService())
}

func initTeamService(db *sql.DB) {
	if db != nil {
		log.Println("[Team] using postgres storage")
		team.Init(teamservice.NewDBTeamService(db))
		return
	}
	log.Println("[Team] using memory mock")
	team.Init(teamservice.NewMockTeamService())
}
