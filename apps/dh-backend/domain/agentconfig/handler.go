package agentconfig

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
)

var (
	defaultService       service.AgentConfigService
	defaultSessionStore  chat.SessionStore
	defaultGatewayClient *client.GatewaydClient
)

// Init 注入 AgentConfigService 实现。
func Init(svc service.AgentConfigService) {
	defaultService = svc
}

// InitRuntimeSync 注入用于向 gatewayd 同步模型配置的会话存储与网关客户端。
func InitRuntimeSync(sessions chat.SessionStore, gw *client.GatewaydClient) {
	defaultSessionStore = sessions
	defaultGatewayClient = gw
}

// syncAgentConfigToGateway 把保存后的空间智能体配置推送到该工作空间下所有活跃会话。
func syncAgentConfigToGateway(ctx context.Context, workspaceID string, cfg agent.WorkspaceAgentConfig) {
	if defaultSessionStore == nil || defaultGatewayClient == nil {
		log.Printf("[AgentConfig] runtime sync skipped: sessionStore=%v gatewayClient=%v", defaultSessionStore, defaultGatewayClient)
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// 同步配置到指定工作空间下的所有活跃会话；userID 传空表示不过滤用户。
	sessions, err := defaultSessionStore.ListSessions(ctx, workspaceID, "")
	if err != nil {
		log.Printf("[AgentConfig] list sessions for sync failed: %v", err)
		return
	}
	matched := 0
	const sessionActiveWindow = 1 * time.Hour
	for _, sess := range sessions {
		if sess.WorkspaceID != workspaceID {
			continue
		}
		// 只同步最近活跃的会话，避免为已过期/被 gatewayd 回收的会话产生大量无效请求。
		if time.Since(sess.UpdatedAt) > sessionActiveWindow {
			continue
		}
		pluginKey, _ := sess.Context["pluginKey"].(string)
		instanceID, _ := sess.Context["instanceId"].(string)
		if pluginKey != cfg.AgentKey || instanceID == "" {
			continue
		}
		matched++
		req := client.UpdateAgentConfigRequest{
			Model:     cfg.Model,
			ModelType: cfg.ModelSource,
			BaseURL:   cfg.BaseURL,
			APIKey:    cfg.APIKey,
		}
		if cfg.Temperature != nil {
			req.Temperature = cfg.Temperature
		}
		if cfg.AdvancedConfig != nil && cfg.AdvancedConfig.MaxTokens != nil {
			req.MaxTokens = cfg.AdvancedConfig.MaxTokens
		}
		if syncErr := defaultGatewayClient.UpdateAgentConfig(ctx, sess.ID, instanceID, req); syncErr != nil {
			log.Printf("[AgentConfig] sync config to gatewayd session=%s instance=%s failed: %v", sess.ID, instanceID, syncErr)
		} else {
			log.Printf("[AgentConfig] synced config to gatewayd session=%s instance=%s", sess.ID, instanceID)
		}
	}
	log.Printf("[AgentConfig] runtime sync finished: workspace=%s agent=%s matched=%d", workspaceID, cfg.AgentKey, matched)
}

// AgentTypes 处理 GET /api/v1/agent-types 与 PUT /api/v1/agent-types/{key}。
func AgentTypes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		types, err := defaultService.ListAgentTypes()
		if err != nil {
			handler.HandleServiceError(w, err, "agent type not found", "failed to list agent types")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(types)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// AgentTypeByKey 处理 PUT /api/v1/agent-types/{key}。
func AgentTypeByKey(w http.ResponseWriter, r *http.Request) {
	key, ok := handler.PathValueOr404(w, r, "key")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodPut:
		var req updateAgentTypeRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		at, err := defaultService.UpdateAgentType(key, req.Enabled)
		if err != nil {
			handler.HandleServiceError(w, err, "agent type not found", "failed to update agent type")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(at)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceAgentConfigs 处理 GET /api/v1/workspaces/{id}/agent-configs。
func WorkspaceAgentConfigs(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodGet:
		configs, err := defaultService.ListWorkspaceConfigs(workspaceID)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace not found", "failed to list workspace agent configs")
			return
		}
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(configs)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// WorkspaceAgentConfigByKey 处理 PUT /api/v1/workspaces/{id}/agent-configs/{key}。
func WorkspaceAgentConfigByKey(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	agentKey, ok := handler.PathValueOr404(w, r, "key")
	if !ok {
		return
	}

	switch r.Method {
	case http.MethodPut:
		var req service.SaveWorkspaceConfigRequest
		if !handler.DecodeJSONBody(w, r, &req) {
			return
		}
		req.AgentKey = agentKey
		if err := defaultService.CanModifyWorkspaceConfig(workspaceID, req.AgentKey); err != nil {
			handler.WriteJSONError(w, http.StatusForbidden, 3, err.Error())
			return
		}
		cfg, err := defaultService.SaveWorkspaceConfig(workspaceID, req)
		if err != nil {
			handler.HandleServiceError(w, err, "workspace agent config not found", "failed to save workspace agent config")
			return
		}
		// 异步将新配置同步到 gatewayd，不阻塞 HTTP 响应。
		// 使用独立上下文，避免 HTTP 请求结束后上下文被取消导致同步中断。
		go syncAgentConfigToGateway(context.Background(), workspaceID, cfg)
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(cfg)
	default:
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
	}
}

// AgentModels 处理 GET /api/v1/agent-models，返回按厂商分组的全局模型池。
func AgentModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	groups := defaultService.ListGlobalModelGroups()
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(groups)
}

// AvailableAgents 处理 GET /api/v1/workspaces/{id}/available-agents。
func AvailableAgents(w http.ResponseWriter, r *http.Request) {
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}

	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	agents, err := defaultService.ListAvailableAgents(workspaceID)
	if err != nil {
		handler.HandleServiceError(w, err, "workspace not found", "failed to list available agents")
		return
	}
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(agents)
}

type updateAgentTypeRequest struct {
	Enabled bool `json:"enabled"`
}
