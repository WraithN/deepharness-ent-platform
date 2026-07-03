package server

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer/memory"
	redisbuffer "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer/redis"
	session "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat/session"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/orchestrator"
	orchestratorservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/orchestrator/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit"
	auditservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant"
	paservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent"
	pragentservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository"
	repositoryservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team"
	teamservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	sdkpostgres "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/postgres"
)

func New(cfg config.Config) http.Handler {
	mux := http.NewServeMux()

	// Shared DB connection (if available)
	db := initDB(cfg)

	// Infrastructure layer: PostgreSQL storage.
	sessions := session.NewPostgresStore(db)
	messages := session.NewPostgresStore(db)
	log.Println("[Chat] using postgres storage")
	// Business logic layer
	agentClient := client.NewGatewaydClient(cfg.GatewaydAdminURL, cfg.GatewaydAgentID)

	initIdentityService(db)
	initPersonalAssistantService(db)
	workItemSvc := initWorkItemService(db)
	initReviewService(db)
	initEventService(db)
	initOrchestratorService(db)
	workspaceService := initWorkspaceService(db, cfg.WorkspaceRoot)
	initRepositoryService(db, cfg.WorkspaceRoot)
	initTeamService(db)

	// Handlers
	// 根据 buffer_store_type 配置选择 SSE buffer 后端：memory（默认）或 redis。
	// Redis 支持单节点和 Cluster 模式，生产环境推荐使用 Redis 以支持崩溃恢复。
	var sseBuffer buffer.SSEBuffer
	switch cfg.BufferStoreType {
	case "redis":
		var redisOpts []redisbuffer.Option
		if cfg.RedisPrefix != "" {
			redisOpts = append(redisOpts, redisbuffer.WithKeyPrefix(cfg.RedisPrefix))
		}
		sseBuffer = redisbuffer.NewFromOptions(cfg.RedisAddrs, cfg.RedisPassword, cfg.RedisDB, redisOpts...)
		log.Printf("[Server] using Redis SSE buffer, addrs=%v prefix=%s", cfg.RedisAddrs, cfg.RedisPrefix)
	default:
		sseBuffer = memory.New()
		log.Printf("[Server] using in-memory SSE buffer")
	}
	sessionHandler := handler.NewSessionHandler(sessions, messages, agentClient, workspaceService, cfg, sseBuffer)
	aguiHandler := handler.NewAGUIHandler(cfg.GatewaydAdminURL, cfg.GatewaydAgentID, sessions, messages, sseBuffer, workItemSvc)
	sseReplayHandler := handler.NewSSEReplayHandler(sseBuffer)
	handler.SetFilesRoot(cfg.WorkspaceRoot)
	// 允许文件 API 访问 workspaceRoot 下的路径（agent 在此目录下创建文件）
	handler.SetAllowedRoots([]string{cfg.WorkspaceRoot})

	// Routes
	mux.HandleFunc("/health", handler.HealthCheck)
	mux.HandleFunc("/api/v1/agent", aguiHandler.AgentRun)
	mux.HandleFunc("/api/v1/sessions", sessionHandler.Sessions)
	mux.HandleFunc("/api/v1/sessions/{id}", sessionHandler.DeleteSession)
	mux.HandleFunc("/api/v1/sessions/{id}/messages", sessionHandler.GetMessages)
	mux.HandleFunc("/api/v1/sessions/{id}/sse", sseReplayHandler.ServeSSE)
	mux.HandleFunc("/api/v1/hello", handler.Hello)

	// 文件读取/写入/删除/下载/版本查询/保存
	mux.HandleFunc("/api/v1/files/content", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handler.FileContent(w, r)
		case http.MethodPut, http.MethodPost:
			handler.FileWrite(w, r)
		case http.MethodDelete:
			handler.FileDelete(w, r)
		default:
			handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		}
	})
	mux.HandleFunc("/api/v1/files/download", handler.FileDownload)
	mux.HandleFunc("/api/v1/files/versions", handler.FileVersions)
	mux.HandleFunc("/api/v1/files/save-to-feishu", handler.SaveToFeishu)

	// 工程项目管理（AI 创建/修改的工程预览与同步）
	mux.HandleFunc("/api/v1/projects/tree", handler.ProjectTree)
	mux.HandleFunc("/api/v1/projects/diff", handler.ProjectDiff)
	mux.HandleFunc("/api/v1/projects/check", handler.ProjectCheck)
	mux.HandleFunc("/api/v1/projects/sync", handler.ProjectSync)

	// Internal business modules
	mux.HandleFunc("/api/v1/identity/users", identity.Users)
	mux.Handle("/api/v1/identity/users/me", middleware.Auth(http.HandlerFunc(identity.Me)))
	mux.Handle("/api/v1/identity/users/me/profile", middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			identity.GetProfile(w, r)
		case http.MethodPut, http.MethodPost:
			identity.SaveProfile(w, r)
		default:
			handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		}
	})))
	mux.HandleFunc("/api/v1/identity/login", identity.Login)
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
	// /workspaces/mine 需登录态，需在 /workspaces/{id} 之前注册以避免路径冲突。
	mux.Handle("/api/v1/workspaces/mine", middleware.Auth(http.HandlerFunc(workspace.Mine)))
	mux.HandleFunc("/api/v1/workspaces", workspace.Workspaces)
	mux.HandleFunc("/api/v1/workspaces/{id}", workspace.WorkspaceByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/members", workspace.Members)
	mux.HandleFunc("/api/v1/workspaces/{id}/members/{userId}", workspace.MemberByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/workitem-project", workspace.WorkitemProject)
	mux.HandleFunc("/api/v1/workspaces/{id}/agents", workspace.WorkspaceAgents)
	mux.HandleFunc("/api/v1/workspaces/{id}/standards", workspace.WorkspaceStandards)
	mux.HandleFunc("/api/v1/workspaces/{id}/standards/{standardId}", workspace.WorkspaceStandardByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/cicd", workspace.WorkspaceCICD)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories", repository.Repositories)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/scan", repository.ScanRepositories)
	// 用户级仓库操作（需登录态，userID 由 auth 中间件注入）
	mux.Handle("/api/v1/workspaces/{id}/user-repos", middleware.Auth(http.HandlerFunc(repository.UserRepos)))
	mux.Handle("/api/v1/workspaces/{id}/user-repos/{repoId}/sync", middleware.Auth(http.HandlerFunc(repository.SyncUserRepo)))
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}", repository.RepositoryByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/sync", repository.SyncRepository)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/details", repository.RepositoryDetails)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/branches", repository.RepositoryBranches)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/switch-branch", repository.SwitchBranch)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/tree", repository.RepositoryFileTree)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/content", repository.RepositoryFileContent)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/save", repository.SaveFileContent)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/commit", repository.GitCommit)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/status", repository.GitStatus)

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

	pool := sdkpostgres.PoolConfig{
		MaxOpenConns:    cfg.DBMaxOpenConns,
		MaxIdleConns:    cfg.DBMaxIdleConns,
		ConnMaxLifetime: cfg.DBConnMaxLifetime,
	}

	db, err := sdkpostgres.OpenDBWithPool(dsn, pool)
	if err != nil {
		log.Fatalf("[DB] postgres connect failed: %v", err)
	}
	log.Printf("[DB] connected to postgres at %s:%s/%s (pool: maxOpen=%d, maxIdle=%d, maxLifetime=%s)",
		cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBMaxOpenConns, cfg.DBMaxIdleConns, cfg.DBConnMaxLifetime)
	return db
}

func initIdentityService(db *sql.DB) {
	log.Println("[Identity] using postgres storage")
	identity.Init(identityservice.NewDBUserService(db))
}

func initPersonalAssistantService(db *sql.DB) {
	log.Println("[PersonalAssistant] using postgres storage")
	personalassistant.Init(paservice.NewDBPersonalAssistantService(db))
}

func initWorkItemService(db *sql.DB) workitemservice.WorkItemService {
	log.Println("[WorkItem] using postgres storage")
	svc := workitemservice.NewDBWorkItemService(db)
	workitem.Init(svc)
	return svc
}

func initReviewService(db *sql.DB) {
	log.Println("[PR Agent] using postgres storage")
	pragent.Init(pragentservice.NewDBReviewService(db))
}

func initEventService(db *sql.DB) {
	log.Println("[Audit] using postgres storage")
	audit.Init(auditservice.NewDBEventService(db))
}

func initOrchestratorService(db *sql.DB) {
	log.Println("[Orchestrator] using postgres storage")
	orchestrator.Init(orchestratorservice.NewDBSessionService(db))
}

func initWorkspaceService(db *sql.DB, workspaceRoot string) workspaceservice.WorkspaceService {
	log.Printf("[Workspace] using postgres storage, workspaceRoot=%s", workspaceRoot)
	svc := workspaceservice.NewDBWorkspaceService(db, workspaceRoot)
	workspace.Init(svc)
	return svc
}

func initTeamService(db *sql.DB) {
	log.Println("[Team] using postgres storage")
	team.Init(teamservice.NewDBTeamService(db))
}

func initRepositoryService(db *sql.DB, root string) {
	log.Printf("[Repository] using postgres storage with git clone, root=%s", root)
	repository.Init(repositoryservice.NewDBRepositoryService(db, root, &dbSSHKeyResolver{db: db}))
}

// dbSSHKeyResolver 从 user_profiles 表解析用户 SSH Key，供仓库克隆/拉取使用。
type dbSSHKeyResolver struct {
	db *sql.DB
}

func (r *dbSSHKeyResolver) ResolveSSHKey(userID string) (string, error) {
	if r.db == nil || userID == "" {
		return "", nil
	}
	var key string
	err := r.db.QueryRow(`SELECT ssh_key FROM user_profiles WHERE user_id = $1`, userID).Scan(&key)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("resolve ssh key failed: %w", err)
	}
	return key, nil
}
