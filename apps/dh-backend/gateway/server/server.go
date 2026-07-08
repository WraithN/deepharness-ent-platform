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
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig"
	agentconfigservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit"
	auditservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant"
	paservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/service"
	psHandler "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace"
	psService "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc"
	productdocservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/service"
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
	"github.com/redis/go-redis/v9"
)

var (
	defaultAgentConfigService agentconfigservice.AgentConfigService
	productSpaceService       psService.ProductSpaceService
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

	userService := initIdentityService(db)
	initPersonalAssistantService(db)
	workItemSvc := initWorkItemService(db)
	initReviewService(db)
	initEventService(db)
	initOrchestratorService(db)
	workspaceService := initWorkspaceService(db, cfg.WorkspaceRoot, userService, cfg.CodingAgents)
	initProductSpaceService(db, cfg.WorkspaceRoot, workspaceService)
	initAgentConfigService(db, cfg.CodingAgents, cfg.CodingAgentModels)
	initWorkspacePromptService(db)
	initRepositoryService(db, cfg)
	initProductDocService(db)
	initTeamService(db, userService)

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
	sessionHandler := handler.NewSessionHandler(sessions, messages, agentClient, workspaceService, defaultAgentConfigService, cfg, sseBuffer)
	// 为 agentconfig 模块注入会话存储与 gatewayd 客户端，用于配置保存后向运行时同步。
	agentconfig.InitRuntimeSync(sessions, agentClient)
	aguiHandler := handler.NewAGUIHandler(cfg.GatewaydAdminURL, cfg.GatewaydAgentID, sessions, messages, sseBuffer, workItemSvc)
	sseReplayHandler := handler.NewSSEReplayHandler(sseBuffer)
	statsHandler := handler.NewStatsHandler(sessions, cfg.WorkspaceRoot)

	// agent-stub 反向代理：将文件/工程/预览请求转发到 agent-stub 服务。
	// agent-stub 部署在 WORKSPACE_ROOT 所在服务器上，直接操作文件系统和 git。
	stubProxy := handler.NewStubProxy(cfg.AgentStubURL)

	// Routes
	mux.HandleFunc("/health", handler.HealthCheck)
	mux.HandleFunc("/api/v1/agent", aguiHandler.AgentRun)
	mux.HandleFunc("/api/v1/sessions", sessionHandler.Sessions)
	mux.HandleFunc("/api/v1/sessions/{id}", sessionHandler.DeleteSession)
	mux.HandleFunc("/api/v1/sessions/{id}/messages", sessionHandler.GetMessages)
	mux.HandleFunc("/api/v1/sessions/{id}/sse", sseReplayHandler.ServeSSE)
	mux.HandleFunc("/api/v1/hello", handler.Hello)

	// 文件/工程/预览 → 代理到 agent-stub
	mux.HandleFunc("/api/v1/files/", stubProxy.ServeHTTP)
	mux.HandleFunc("/api/v1/projects/", stubProxy.ServeHTTP)
	mux.HandleFunc("/api/v1/preview/", stubProxy.ServeHTTP)

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

	// 租户管理（仅超级管理员）
	mux.Handle("/api/v1/tenants", middleware.Auth(http.HandlerFunc(identity.Tenants)))
	mux.Handle("/api/v1/tenants/{id}", middleware.Auth(http.HandlerFunc(identity.TenantByID)))
	mux.Handle("/api/v1/tenants/{id}/members", middleware.Auth(http.HandlerFunc(identity.TenantMembers)))
	mux.Handle("/api/v1/tenants/{id}/members/{userId}", middleware.Auth(http.HandlerFunc(identity.TenantMemberByID)))

	mux.HandleFunc("/api/v1/workitems", workitem.WorkItems)
	mux.HandleFunc("/api/v1/workitems/{id}", workitem.WorkItemByID)
	mux.HandleFunc("/api/v1/workitems/{id}/status", workitem.UpdateWorkItemStatus)
	mux.HandleFunc("/api/v1/review/review", pragent.Reviews)
	mux.HandleFunc("/api/v1/audit/events", audit.Events)
	mux.HandleFunc("/api/v1/orchestrator/sessions", orchestrator.Sessions)
	mux.HandleFunc("/api/v1/stats/summary", statsHandler.Summary)
	mux.HandleFunc("/api/v1/stats/trend", statsHandler.Trend)
	mux.HandleFunc("/api/v1/stats/commits", statsHandler.CodeCommits)
	mux.HandleFunc("/api/v1/stats/trails", statsHandler.Trails)
	mux.HandleFunc("/api/v1/commands", handler.CommandsHandler)

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
	mux.Handle("/api/v1/workspaces", middleware.Auth(http.HandlerFunc(workspace.Workspaces)))
	mux.Handle("/api/v1/workspaces/{id}", middleware.Auth(http.HandlerFunc(workspace.WorkspaceByID)))
	mux.Handle("/api/v1/workspaces/{id}/members", middleware.Auth(http.HandlerFunc(workspace.Members)))
	mux.Handle("/api/v1/workspaces/{id}/members/{userId}", middleware.Auth(http.HandlerFunc(workspace.MemberByID)))
	mux.HandleFunc("/api/v1/workspaces/{id}/workitem-project", workspace.WorkitemProject)
	mux.Handle("/api/v1/agent-types", middleware.Auth(http.HandlerFunc(agentconfig.AgentTypes)))
	mux.Handle("/api/v1/agent-types/{key}", middleware.Auth(http.HandlerFunc(agentconfig.AgentTypeByKey)))
	mux.Handle("/api/v1/agent-models", middleware.Auth(http.HandlerFunc(agentconfig.AgentModels)))
	mux.HandleFunc("/api/v1/workspaces/{id}/agents", workspace.WorkspaceAgents)
	mux.Handle("/api/v1/workspaces/{id}/agent-configs", middleware.Auth(http.HandlerFunc(agentconfig.WorkspaceAgentConfigs)))
	mux.Handle("/api/v1/workspaces/{id}/agent-configs/{key}", middleware.Auth(http.HandlerFunc(agentconfig.WorkspaceAgentConfigByKey)))
	mux.Handle("/api/v1/workspaces/{id}/available-agents", middleware.Auth(http.HandlerFunc(agentconfig.AvailableAgents)))
	mux.HandleFunc("/api/v1/workspaces/{id}/standards", workspace.WorkspaceStandards)
	mux.HandleFunc("/api/v1/workspaces/{id}/standards/{standardId}", workspace.WorkspaceStandardByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/cicd", workspace.WorkspaceCICD)
	mux.Handle("/api/v1/workspaces/{id}/prompts", middleware.Auth(http.HandlerFunc(workspace.Prompts)))
	mux.Handle("/api/v1/workspaces/{id}/prompts/{promptId}", middleware.Auth(http.HandlerFunc(workspace.PromptByID)))
	mux.Handle("/api/v1/workspaces/{id}/prompt-categories", middleware.Auth(http.HandlerFunc(workspace.PromptCategories)))
	mux.Handle("/api/v1/workspaces/{id}/prompt-categories/{categoryId}", middleware.Auth(http.HandlerFunc(workspace.PromptCategoryByID)))
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories", repository.Repositories)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/scan", repository.ScanRepositories)
	// 用户级仓库操作（需登录态，userID 由 auth 中间件注入）
	mux.Handle("/api/v1/workspaces/{id}/user-repos", middleware.Auth(http.HandlerFunc(repository.UserRepos)))
	mux.Handle("/api/v1/workspaces/{id}/user-repos/{repoId}/sync", middleware.Auth(http.HandlerFunc(repository.SyncUserRepo)))
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}", repository.RepositoryByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/sync", repository.SyncRepository)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/details", repository.RepositoryDetails)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/branches", repository.RepositoryBranches)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/branches/refresh", repository.RefreshBranches)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/switch-branch", repository.SwitchBranch)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/tree", repository.RepositoryFileTree)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/content", repository.RepositoryFileContent)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/save", repository.SaveFileContent)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/commit", repository.GitCommit)
	mux.HandleFunc("/api/v1/workspaces/{id}/repositories/{repoId}/status", repository.GitStatus)

	// Product doc module
	mux.HandleFunc("/api/v1/workspaces/{id}/product-docs", productdoc.ProductDocs)
	mux.HandleFunc("/api/v1/workspaces/{id}/product-docs/{docId}", productdoc.ProductDocByID)
	mux.HandleFunc("/api/v1/workspaces/{id}/product-docs/{docId}/versions", productdoc.ProductDocVersions)
	mux.HandleFunc("/api/v1/workspaces/{id}/product-docs/{docId}/publish", productdoc.PublishProductDoc)

	// Product space module
	psH := psHandler.NewHandler(productSpaceService)
	mux.Handle("/api/v1/workspaces/{id}/product-space/tree", middleware.Auth(http.HandlerFunc(psH.GetTree)))
	mux.Handle("/api/v1/workspaces/{id}/product-space/items", middleware.Auth(http.HandlerFunc(psH.CreateItem)))
	mux.Handle("/api/v1/workspaces/{id}/product-space/items/{itemId}", middleware.Auth(http.HandlerFunc(psH.ItemByID)))
	mux.Handle("/api/v1/workspaces/{id}/product-space/items/{itemId}/content", middleware.Auth(http.HandlerFunc(psH.UpdateContent)))
	mux.Handle("/api/v1/workspaces/{id}/product-space/items/{itemId}/versions", middleware.Auth(http.HandlerFunc(psH.ListVersions)))
	mux.Handle("/api/v1/workspaces/{id}/product-space/items/{itemId}/versions/{version}/restore", middleware.Auth(http.HandlerFunc(psH.RestoreVersion)))
	mux.Handle("/api/v1/workspaces/{id}/product-space/items/{itemId}/download", middleware.Auth(http.HandlerFunc(psH.DownloadVersion)))
	mux.Handle("/api/v1/workspaces/{id}/product-space/folders", middleware.Auth(http.HandlerFunc(psH.Folders)))

	// Team skills / prompts
	mux.HandleFunc("/api/v1/team/skills", team.Skills)
	mux.HandleFunc("/api/v1/team/skills/{id}", team.SkillByID)
	mux.Handle("/api/v1/team/skill-categories", middleware.Auth(http.HandlerFunc(team.SkillCategories)))
	mux.Handle("/api/v1/team/skill-categories/{id}", middleware.Auth(http.HandlerFunc(team.SkillCategoryByID)))

	mux.Handle("/api/v1/team/prompts", middleware.Auth(http.HandlerFunc(team.Prompts)))
	mux.Handle("/api/v1/team/prompts/{id}", middleware.Auth(http.HandlerFunc(team.PromptByID)))
	mux.Handle("/api/v1/team/prompts/{id}/review", middleware.Auth(http.HandlerFunc(team.ReviewPrompt)))
	mux.Handle("/api/v1/team/prompt-categories", middleware.Auth(http.HandlerFunc(team.PromptCategories)))
	mux.Handle("/api/v1/team/prompt-categories/{id}", middleware.Auth(http.HandlerFunc(team.PromptCategoryByID)))
	mux.Handle("/api/v1/team/skills/stats", middleware.Auth(http.HandlerFunc(team.SkillStats)))
	mux.Handle("/api/v1/team/prompts/stats", middleware.Auth(http.HandlerFunc(team.PromptStats)))

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

func initIdentityService(db *sql.DB) identityservice.UserService {
	log.Println("[Identity] using postgres storage")
	svc := identityservice.NewDBUserService(db)
	identity.Init(svc)
	return svc
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

func initWorkspaceService(db *sql.DB, workspaceRoot string, userService identityservice.UserService, codingAgents []config.CodingAgentDefinition) workspaceservice.WorkspaceService {
	log.Printf("[Workspace] using postgres storage, workspaceRoot=%s", workspaceRoot)
	svc := workspaceservice.NewDBWorkspaceService(db, workspaceRoot)
	workspace.Init(svc)
	workspace.InitUserService(userService)
	keys := make([]string, 0, len(codingAgents))
	for _, a := range codingAgents {
		keys = append(keys, a.Key)
	}
	workspace.SetAllowedAgentKeys(keys)
	return svc
}

func initAgentConfigService(db *sql.DB, codingAgents []config.CodingAgentDefinition, models []string) {
	log.Println("[AgentConfig] using postgres storage")
	agents := make([]agent.AgentType, 0, len(codingAgents))
	for _, a := range codingAgents {
		agents = append(agents, agent.AgentType{
			Key:         a.Key,
			Name:        a.Name,
			Description: a.Description,
			Enabled:     true,
			Builtin:     true,
		})
	}
	defaultAgentConfigService = agentconfigservice.NewDBAgentConfigService(db, agentconfigservice.AgentGlobalConfig{
		Agents: agents,
		Models: models,
	})
	agentconfig.Init(defaultAgentConfigService)
}

func initTeamService(db *sql.DB, userService identityservice.UserService) {
	log.Println("[Team] using postgres storage")
	svc := teamservice.NewDBTeamService(db)
	team.Init(svc)
	team.InitUserService(userService)
}

func initWorkspacePromptService(db *sql.DB) {
	log.Println("[WorkspacePrompt] using postgres storage")
	svc := workspaceservice.NewDBWorkspacePromptService(db)
	workspace.InitPromptService(svc)
}

func initProductDocService(db *sql.DB) {
	log.Println("[ProductDoc] using postgres storage")
	productdoc.Init(productdocservice.NewDBProductDocService(db))
}

func initProductSpaceService(db *sql.DB, workspaceRoot string, workspaceService workspaceservice.WorkspaceService) {
	log.Printf("[ProductSpace] using postgres storage, workspaceRoot=%s", workspaceRoot)
	var err error
	productSpaceService, err = psService.NewDBProductSpaceService(db, workspaceRoot, workspaceService)
	if err != nil {
		log.Fatalf("init productspace service: %v", err)
	}
}

func initRepositoryService(db *sql.DB, cfg config.Config) {
	root := cfg.WorkspaceRoot
	log.Printf("[Repository] using postgres storage with git clone, root=%s", root)
	svc := repositoryservice.NewDBRepositoryService(db, root, &dbSSHKeyResolver{db: db})

	// 根据 buffer_store_type 选择分支缓存后端：redis（分布式）或 memory（开发环境）。
	if cfg.BufferStoreType == "redis" && len(cfg.RedisAddrs) > 0 {
		var redisClient redis.UniversalClient
		if len(cfg.RedisAddrs) == 1 {
			redisClient = redis.NewClient(&redis.Options{
				Addr:     cfg.RedisAddrs[0],
				Password: cfg.RedisPassword,
				DB:       cfg.RedisDB,
			})
		} else {
			redisClient = redis.NewClusterClient(&redis.ClusterOptions{
				Addrs:    cfg.RedisAddrs,
				Password: cfg.RedisPassword,
			})
		}
		svc.SetBranchCache(repositoryservice.NewRedisBranchCache(redisClient))
		log.Printf("[Repository] branch cache: redis, addrs=%v", cfg.RedisAddrs)
	} else {
		log.Printf("[Repository] branch cache: memory (dev mode)")
	}

	repository.Init(svc)
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
